/**
 * Outbound completion callbacks — the reply half of the webhook API.
 *
 * `webhook.ts` is inbound-only: a caller POSTs work and then long-polls
 * `GET /<id>` until the card reaches `done`. Every integration therefore burns a
 * timer and a request loop to learn something we already know the instant it
 * happens. A caller can now hand us a `callbackUrl` with the task and we POST the
 * completion to it instead. The poll endpoint is untouched — this is additive, and
 * a caller that wants both gets both.
 *
 * WE ARE THE REQUESTING PARTY HERE, which inverts the threat model. Inbound, the
 * risk is someone reaching us; outbound, the risk is someone using us to reach
 * something else — the classic SSRF shape, where a URL we were handed points at
 * `127.0.0.1:<something>` or `169.254.169.254` and we obligingly fetch it from
 * inside the user's machine. So the URL is checked twice:
 *
 *   1. `validateCallbackUrl` at accept time — https only, no credentials, no
 *      private/loopback/link-local literal, length capped.
 *   2. again inside `deliverCallback`, in TWO places, because they catch different
 *      things: a literal IP is checked directly (Node connects straight to an IP
 *      and never consults DNS, so a lookup hook would never see it), and a NAME is
 *      checked against the address DNS actually returned — that is the rebinding
 *      case, where a host that passed step 1 resolves to 127.0.0.1.
 *
 * Deliberately free of any `electron` import so it can be unit-tested as a plain
 * Node module, the same rule webhook.ts follows.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest, type ClientRequest } from 'node:http';

/** A callback URL is a URL, not a document. 2 KB is already generous for one
 *  carrying a correlation id and a signature-bearing query string. */
export const MAX_CALLBACK_URL_LENGTH = 2048;

/** Tries, including the first. Five with the backoff below spans ~40s, which
 *  covers a receiver restarting without holding a socket open for minutes. */
export const CALLBACK_MAX_ATTEMPTS = 5;

/** How long a single POST may take before it is abandoned and counted as a
 *  failed attempt. */
export const CALLBACK_TIMEOUT_MS = 10_000;

/** The receiver reads these two and recomputes the HMAC over
 *  `${timestamp}.${body}`. Documented in README.md's webhook section. */
export const SIGNATURE_HEADER = 'x-md-signature';
export const TIMESTAMP_HEADER = 'x-md-timestamp';

export type CallbackUrlCheck =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Is this IP literal one we must never be talked into fetching?
 *
 * Covers loopback, RFC1918, link-local (including the cloud metadata address that
 * lives there), CGNAT, "this network", and the IPv6 equivalents — plus
 * IPv4-mapped IPv6, which is the usual way a blocklist gets walked around.
 *
 * Pure and exported because it is used at two different moments: against a
 * literal in the URL, and against the socket's actual peer once DNS has resolved.
 */
export function isPrivateAddress(addr: string): boolean {
  const ip = addr.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!ip) return true; // unknown peer → treat as unsafe

  // IPv4-mapped IPv6 is an IPv4 address wearing a hat, and it is the usual way a
  // blocklist gets walked around. It arrives in TWO spellings and both must
  // unwrap: the readable `::ffff:127.0.0.1`, and the HEX form `::ffff:7f00:1`,
  // which is what `new URL()` rewrites the readable one into — so a check that
  // only understood the dotted form passed loopback straight through.
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  const v4 = dotted
    ? dotted[1]
    : hex
      ? [parseInt(hex[1], 16) >> 8, parseInt(hex[1], 16) & 0xff,
         parseInt(hex[2], 16) >> 8, parseInt(hex[2], 16) & 0xff].join('.')
      : ip;

  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4);
  if (octets) {
    const [a, b] = [Number(octets[1]), Number(octets[2])];
    if (octets.slice(1).some((o) => Number(o) > 255)) return true; // malformed → unsafe
    if (a === 0) return true;                       // 0.0.0.0/8 "this network"
    if (a === 10) return true;                      // RFC1918
    if (a === 127) return true;                     // loopback
    if (a === 169 && b === 254) return true;         // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true;         // RFC1918
    if (a === 192 && b === 0) return true;           // IETF protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true;                       // multicast + reserved
    return false;
  }

  if (ip === '::' || ip === '::1') return true;      // unspecified, loopback
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true;    // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(ip)) return true;    // fe80::/10 link-local
  if (/^ff[0-9a-f]{2}:/.test(ip)) return true;       // multicast
  return false;
}

/** Hostnames that never leave the machine (or the LAN), independent of DNS. */
const LOCAL_HOSTNAMES = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/;

/**
 * Accept-time validation of a caller-supplied callback URL.
 *
 * `allowPrivate` exists for development against a receiver on the same machine.
 * It is NOT a config the user can set from the UI — it comes from the dev-mode
 * flag, because "allow us to POST to localhost on request" is a capability, not a
 * preference.
 */
export function validateCallbackUrl(raw: unknown, opts: { allowPrivate?: boolean } = {}): CallbackUrlCheck {
  if (typeof raw !== 'string') return { ok: false, error: 'callbackUrl must be a string' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'callbackUrl must not be empty' };
  if (trimmed.length > MAX_CALLBACK_URL_LENGTH) {
    return { ok: false, error: `callbackUrl must be at most ${MAX_CALLBACK_URL_LENGTH} characters` };
  }

  let url: URL;
  try { url = new URL(trimmed); }
  catch { return { ok: false, error: 'callbackUrl must be an absolute URL' }; }

  const httpOk = opts.allowPrivate && url.protocol === 'http:';
  if (url.protocol !== 'https:' && !httpOk) {
    return { ok: false, error: 'callbackUrl must be https' };
  }

  // `https://user:pass@host/` would put a credential into every log line and
  // retry record we write about this delivery. Refuse it rather than redact it.
  if (url.username || url.password) {
    return { ok: false, error: 'callbackUrl must not embed credentials' };
  }

  if (!opts.allowPrivate) {
    const host = url.hostname.toLowerCase();
    if (LOCAL_HOSTNAMES.test(host)) return { ok: false, error: 'callbackUrl must not point at a local host' };
    // Only meaningful for a literal; a NAME that resolves privately is caught at
    // connect time instead, which is the only place it can be.
    if (/^[\d.]+$/.test(host) || host.includes(':')) {
      if (isPrivateAddress(host)) return { ok: false, error: 'callbackUrl must not point at a private address' };
    }
  }

  return { ok: true, url: url.toString() };
}

/**
 * `sha256=<hex>` over `${timestamp}.${body}`, keyed with the endpoint's existing
 * shared secret — the same one the caller already echoes inbound, so a receiver
 * that can verify this has nothing new to store.
 *
 * The timestamp is inside the signed material, not merely alongside it. Signing
 * the body alone means a captured delivery can be replayed forever; with the
 * stamp covered, a receiver can reject anything older than its own tolerance and
 * the signature cannot be re-pointed at a fresh one.
 */
export function signPayload(body: string, secret: string, timestamp: number | string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** Constant-time signature check. Exported for the receiver-side example in the
 *  README and for the tests — nothing in this process verifies its own signature. */
export function verifySignature(body: string, secret: string, timestamp: number | string, provided: string): boolean {
  const expected = Buffer.from(signPayload(body, secret, timestamp));
  const actual = Buffer.from(String(provided));
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Delay before attempt `n` (1-based). Attempt 1 is immediate; after that it
 * triples from 1s and clamps at 30s: 0, 1s, 3s, 9s, 27s.
 *
 * No jitter, deliberately. Jitter exists to desynchronise a fleet of retrying
 * clients; there is exactly one of us, and a deterministic schedule is one that
 * can be asserted and that an operator reading log.jsonl can recognise.
 */
export function backoffDelayMs(attempt: number): number {
  if (attempt <= 1) return 0;
  return Math.min(30_000, 1000 * 3 ** (attempt - 2));
}

/** A 2xx is delivered. Everything else is an attempt that failed — but 4xx says
 *  the receiver understood us and objected, so repeating it verbatim will not
 *  help. Only 408 and 429 are worth waiting out. */
export function isRetryableStatus(status: number): boolean {
  if (status >= 200 && status < 300) return false;
  if (status === 408 || status === 429) return true;
  return status >= 500;
}

export interface CallbackPayload {
  taskId: string;
  status: string;
  title: string;
  result: string;
  /** Pairs this delivery with the inbound request, same id the ledger uses. */
  correlationId?: string;
  completedAt: string;
}

export interface CallbackAttemptResult {
  ok: boolean;
  status?: number;
  error?: string;
  /** Whether another attempt could plausibly succeed. */
  retryable: boolean;
}

/**
 * One POST. Resolves rather than rejects: a delivery attempt failing is expected
 * traffic, not an exception, and the retry loop wants a verdict either way.
 *
 * The connect-time address check is the second half of the SSRF gate. `lookup`
 * is where Node hands over the resolved address before the socket is used, so a
 * name that resolved to something private is refused there — after DNS, before a
 * single byte of the signed body leaves the machine.
 */
export function deliverCallback(
  url: string,
  body: string,
  headers: Record<string, string>,
  opts: { allowPrivate?: boolean; timeoutMs?: number } = {}
): Promise<CallbackAttemptResult> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: CallbackAttemptResult): void => { if (!settled) { settled = true; resolve(r); } };

    // A LITERAL never reaches `lookup` — Node connects straight to an IP without
    // asking DNS anything — so the guard below would never see it. Check it here
    // instead, which also makes this function safe on its own rather than only
    // when it is called after `validateCallbackUrl`.
    if (!opts.allowPrivate) {
      let host = '';
      try { host = new URL(url).hostname; } catch { host = ''; }
      const literal = /^\[?[0-9a-f.:]+\]?$/i.test(host) && (host.includes(':') || /^[\d.]+$/.test(host));
      if (!host || (literal && isPrivateAddress(host))) {
        done({ ok: false, error: `callbackUrl points at a private address (${host || 'unparseable'})`, retryable: false });
        return;
      }
    }

    let req: ClientRequest;
    try {
      // `validateCallbackUrl` only ever admits http:// under the dev capability,
      // so this picks the matching transport rather than sending an https
      // handshake at a plain http receiver — which fails in a way that looks like
      // the receiver's fault.
      const send = url.startsWith('http://') ? httpRequest : httpsRequest;
      req = send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers },
        timeout: opts.timeoutMs ?? CALLBACK_TIMEOUT_MS,
        lookup: opts.allowPrivate ? undefined : guardedLookup
      }, (res) => {
        const status = res.statusCode ?? 0;
        // The body is drained and discarded: we asked the receiver to acknowledge,
        // not to tell us anything, and an unread response leaks the socket.
        res.resume();
        done({ ok: status >= 200 && status < 300, status, retryable: isRetryableStatus(status) });
      });
    } catch (e) {
      done({ ok: false, error: e instanceof Error ? e.message : String(e), retryable: false });
      return;
    }

    req.on('timeout', () => { req.destroy(new Error('callback timed out')); });
    req.on('error', (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      // A refused private address is a decision, not a transient fault — retrying
      // it just means trying to SSRF ourselves four more times.
      done({ ok: false, error: msg, retryable: !msg.includes('private address') });
    });
    req.end(body);
  });
}

/** `dns.lookup` with the resolved address vetted before the socket is used. */
const guardedLookup: NonNullable<Parameters<typeof httpsRequest>[1]['lookup']> = (hostname, options, callback) => {
  // Required lazily so this module stays importable in a bare test environment.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { lookup } = require('node:dns') as typeof import('node:dns');
  lookup(hostname, options as never, (err: NodeJS.ErrnoException | null, address: string | unknown, family?: number) => {
    if (err) { (callback as (e: NodeJS.ErrnoException | null) => void)(err); return; }
    const first = Array.isArray(address)
      ? (address[0] as { address?: string } | undefined)?.address ?? ''
      : String(address ?? '');
    if (isPrivateAddress(first)) {
      (callback as (e: NodeJS.ErrnoException | null) => void)(
        Object.assign(new Error(`callbackUrl resolved to a private address (${first})`), { code: 'EACCES' })
      );
      return;
    }
    (callback as (e: null, a: string | unknown, f?: number) => void)(null, address, family);
  });
};
