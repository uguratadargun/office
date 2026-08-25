/**
 * Slack ingestion — receive Slack messages and hand them to the harness, over
 * either of the two transports Slack offers.
 *
 * `SlackEventRouter` holds ALL the decision logic (who triggers, dedup, thread
 * activation, the bot's own user id) and knows nothing about how the payload
 * arrived. The two transports are thin shells around it:
 *
 *   SlackWebhookServer     Events API over HTTP. Needs a PUBLIC URL, so it also
 *                          opens a tunnel; the signing secret authenticates
 *                          every request.
 *   SlackSocketModeClient  Socket Mode over an outbound WebSocket. Needs NO
 *                          public URL and no tunnel — Slack authenticates the
 *                          connection itself against an app-level token, and
 *                          every frame on it is by construction from Slack, so
 *                          there is no per-message signature to verify.
 *
 * Same events, same router, same onMessage. Which one runs is the user's
 * `slackTransport` setting; see resolveSlackTransport.
 *
 * ── SlackWebhookServer ──
 *
 * A bare `node:http` server (no @slack/bolt) that implements just enough of the
 * Slack Events API to let the user pipe a channel's messages into Michael's
 * message queue:
 *   - verifies EVERY request with Slack's signing-secret HMAC over the RAW body
 *     plus a 5-minute replay-timestamp guard (403 on any failure),
 *   - answers the one-time `url_verification` challenge handshake,
 *   - on a plain `message` event, strips a leading bot mention and emits the
 *     text via `onMessage`.
 *
 * It also opens a `tunnelmole` tunnel so the local port is reachable from Slack's
 * servers; the tunnel URL is what the user pastes into their Slack app's Event
 * Subscriptions → Request URL. The tunnel is best-effort: the local handler is
 * the security boundary and stays up even if the tunnel can't be established.
 *
 * Runs in the Electron main process. Deliberately free of any `electron`
 * import so it can be unit-/smoke-tested as a plain Node module.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolvePublicUrl } from '../shared/publicUrl';
// NOTE: `tunnelmole` is an ESM-only package. The Electron main process is bundled
// as CommonJS, so a static `import` gets externalized into `require('tunnelmole')`
// and throws ERR_REQUIRE_ESM at load. It is imported dynamically inside
// `openTunnel()` instead — Rollup preserves dynamic import() in CJS output, which
// can load ESM. Do not hoist this back to a top-level import.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  shouldTrigger: _shouldTrigger,
  ActivatedThreads: _ActivatedThreads,
  SeenEvents: _SeenEvents,
  dedupKey: _dedupKey,
} = require('./slack-trigger.cjs') as {
    shouldTrigger: (
      ev: SlackPayload['event'],
      botUserId: string | null,
      channelId: string | undefined,
      activatedThreads: _IActivatedThreads
    ) => { trigger: boolean; text: string; files: _SlackEventFile[] };
    ActivatedThreads: new (maxSize?: number) => _IActivatedThreads;
    SeenEvents: new (maxSize?: number) => _ISeenEvents;
    dedupKey: (ev: SlackPayload['event']) => string;
  };

interface _IActivatedThreads {
  add(threadTs: string): void;
  has(threadTs: string): boolean;
  readonly size: number;
}

interface _ISeenEvents {
  seen(key: string): boolean;
  readonly size: number;
}

/** Raw Slack file metadata as received in the `files[]` array of a file_share event.
 *  Populated by slack-trigger.cjs; consumed and stripped by index.ts after download. */
export interface SlackEventFile {
  id?: string;
  url_private: string;
  name?: string;
  mimetype?: string;
  size?: number;
}
// Internal alias used within this module.
type _SlackEventFile = SlackEventFile;

export interface SlackWebhookServerOptions {
  /** Local TCP port the HTTP server binds to (and the tunnel forwards to). */
  port: number;
  /** The user's `publicUrl` setting, verbatim. Decides whether we open an
   *  ephemeral tunnel, reserve a tunnelmole subdomain, or start no tunnel at all
   *  because they brought their own endpoint. See shared/publicUrl.ts. */
  publicUrl?: string;

  /** Slack app signing secret (Basic Information → Signing Secret). Required. */
  signingSecret: string;
  /** Optional channel id filter — when set, events from other channels are dropped. */
  channelId?: string;
  /** Called once per accepted, de-mentioned message — with the Slack thread
   *  coordinates needed to reply back in the originating thread. May be async
   *  (e.g. to download file attachments before forwarding via IPC). */
  onMessage: (m: SlackInboundMessage) => void | Promise<void>;
}

/** A verified, de-mentioned inbound Slack message plus the coordinates needed to
 *  reply in-thread. `thread_ts` is the original message's thread (or its own ts
 *  when it isn't itself a reply), so office replies nest under the request.
 *
 *  `files` carries LOCAL file paths (post-download by index.ts); it is absent for
 *  text-only messages. `_rawFiles` is an INTERNAL transport field that index.ts
 *  reads to download attachments, then strips before forwarding via IPC — renderers
 *  never see it. */
export interface SlackInboundMessage {
  text: string;
  channel: string;
  ts: string;
  thread_ts: string;
  /** LOCAL paths of downloaded attachments (undefined for text-only messages). */
  files?: { path: string; name: string; mimetype: string }[];
  /** INTERNAL: raw Slack file metadata; consumed + stripped by index.ts onMessage. */
  _rawFiles?: SlackEventFile[];
}

/** Reject request bodies larger than this — Slack event payloads are tiny; the
 *  cap stops an unauthenticated peer from forcing unbounded memory use before
 *  we've even checked the signature. */
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
/** Slack's recommended replay window: reject timestamps more than 5 min off. */
const REPLAY_WINDOW_SECONDS = 60 * 5;
/** Cap how long we wait for the public tunnel before giving up (server stays up). */
const TUNNEL_START_TIMEOUT_MS = 10_000;

/**
 * Everything that decides what to do with a Slack Events API payload, with no
 * opinion about how it arrived. Both transports own one of these, so a change to
 * the trigger rules, the dedup window or the thread-activation behaviour applies
 * to both — the two transports differ ONLY in how the bytes reach `handle`.
 *
 * State is per-router (and therefore per-connection): the bot user id, the
 * activated threads and the dedup cache all belong to one ingestion session.
 */
export class SlackEventRouter {
  private readonly channelId?: string;
  private readonly onMessage: (m: SlackInboundMessage) => void | Promise<void>;
  /** Bot's own Slack user id — learned from `authorizations[].user_id` on the
   *  first event_callback. Used to detect <@BOTID> text mentions. */
  private botUserId: string | null = null;
  /** Thread roots where the bot was @-mentioned; subsequent replies in these
   *  threads also trigger onMessage. Bounded FIFO to prevent unbounded growth. */
  private readonly activatedThreads: _IActivatedThreads = new _ActivatedThreads();
  /** Idempotency cache of recently-forwarded message identities (channel:ts).
   *  Stops a single message from firing onMessage — and thus the ack reply —
   *  twice when the app subscribes to both `app_mention` and `message.*` (Slack
   *  sends both for one @-mention), and absorbs Slack's retry of un-acked events. */
  private readonly seenEvents: _ISeenEvents = new _SeenEvents();

  constructor(opts: {
    channelId?: string;
    onMessage: (m: SlackInboundMessage) => void | Promise<void>;
  }) {
    this.channelId = opts.channelId?.trim() || undefined;
    this.onMessage = opts.onMessage;
  }

  /**
   * Route ONE already-authenticated Events API payload. Authentication is the
   * transport's job — the HTTP server verifies the signature before calling
   * this; Socket Mode's WebSocket is authenticated once at connect — so by the
   * time a payload gets here it is trusted.
   *
   * Only @-mentions and replies in activated threads fire onMessage, never every
   * plain channel message.
   */
  handle(payload: SlackPayload): void {
    if (payload.type !== 'event_callback' || !payload.event) return;
    // Learn the bot's own user id on first sighting (present on every event_callback).
    const authUserId = payload.authorizations?.[0]?.user_id;
    if (authUserId && !this.botUserId) this.botUserId = authUserId;

    const ev = payload.event;
    const { trigger, text: rawText, files: rawFiles } = _shouldTrigger(
      ev, this.botUserId, this.channelId, this.activatedThreads
    );
    if (!trigger) return;

    const text = stripLeadingMention(rawText);
    const channel = typeof ev.channel === 'string' ? ev.channel : '';
    const ts = typeof ev.ts === 'string' ? ev.ts : '';
    const thread_ts = (typeof ev.thread_ts === 'string' && ev.thread_ts) || ts;
    // Fire when text is non-empty OR files are attached (file_share may have no caption).
    if ((!text && rawFiles.length === 0) || !channel || !ts) return;

    // Dedup: only ONE onMessage (and thus one ack) per logical message. When
    // the app subscribes to both `app_mention` and `message.*`, a single
    // @-mention arrives as TWO event_callbacks that share channel:ts; this
    // also absorbs Slack's retry of an un-acked event. Gated AFTER the
    // mention/thread filter, so non-triggering messages are unaffected.
    const dupKey = _dedupKey(ev);
    if (dupKey && this.seenEvents.seen(dupKey)) return;

    const msg: SlackInboundMessage = { text, channel, ts, thread_ts };
    if (rawFiles.length > 0) msg._rawFiles = rawFiles;
    try { void this.onMessage(msg); } catch { /* delivery is best-effort */ }
  }
}

export class SlackWebhookServer {
  private server: Server | null = null;
  private tunnelUrl: string | null = null;
  private readonly port: number;
  private readonly signingSecret: string;
  private readonly router: SlackEventRouter;
  private readonly publicUrlSetting?: string;

  constructor(opts: SlackWebhookServerOptions) {
    this.port = opts.port;
    this.publicUrlSetting = opts.publicUrl;
    this.signingSecret = opts.signingSecret;
    this.router = new SlackEventRouter({ channelId: opts.channelId, onMessage: opts.onMessage });
  }

  /**
   * Bind the local HTTP server, then open a public tunnel to it. The HTTP
   * handler (the security boundary) is live the instant `listen` resolves; the
   * tunnel is opened afterwards and is non-fatal — if it can't be established
   * (offline, loca.lt down, timed out) the server keeps running and we report
   * the tunnel error without a URL.
   */
  async start(): Promise<{ ok: boolean; url?: string; error?: string }> {
    if (this.server) return { ok: false, error: 'already running' };
    if (!this.signingSecret) return { ok: false, error: 'missing signing secret' };
    try {
      await this.listen();
    } catch (e) {
      this.stop();
      return { ok: false, error: `failed to bind port ${this.port}: ${errMsg(e)}` };
    }
    try {
      const url = await this.openTunnel();
      if (!url) throw new Error('tunnelmole returned empty URL');
      this.tunnelUrl = url;
      // tunnelmole runs in the background; there is no close handle to wire here.
      return { ok: true, url };
    } catch (e) {
      // Surface the tunnel failure rather than silently returning ok:true with no url.
      return { ok: false, error: `tunnel unavailable: ${errMsg(e)}` };
    }
  }

  /** Close the HTTP server. Idempotent and best-effort.
   *  Note: tunnelmole has no documented close handle; teardown is best-effort. */
  stop(): void {
    this.tunnelUrl = null;
    try { this.server?.close(); } catch { /* noop */ }
    this.server = null;
  }

  private listen(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => this.handleRequest(req, res));
      const onError = (e: Error): void => reject(e);
      server.once('error', onError);
      server.listen(this.port, () => {
        server.off('error', onError);
        this.server = server;
        resolve();
      });
    });
  }

  /**
   * Open the public tunnel — unless the user brought their own endpoint.
   *
   * `publicUrl` decides (see shared/publicUrl.ts):
   *   external  → their own cloudflared/ngrok/nginx hostname. We start NO tunnel
   *               and return their URL; they forward it to this port.
   *   reserved  → a tunnelmole subdomain, passed through as `domain` so the
   *               address survives a restart. Needs THEIR tunnelmole API key,
   *               set with the tunnelmole CLI.
   *   ephemeral → the old behaviour: a new random address every restart.
   *
   * SAFETY: tunnelmole calls process.exit(1) when the local port is FREE
   * (dist/src/tunnelmole.js). Started before our server is listening it would
   * kill the whole app with nothing to catch, so we refuse to call it in that
   * state rather than rely on callers happening to listen first.
   */
  private async openTunnel(): Promise<string> {
    const mode = resolvePublicUrl(this.publicUrlSetting);
    if (mode.kind === 'external') return mode.url;
    if (!this.server?.listening) {
      throw new Error('refusing to open a tunnel before the local server is listening (tunnelmole would exit the process)');
    }
    // Dynamic import keeps the ESM-only `tunnelmole` out of the CJS require graph.
    const { tunnelmole } = await import('tunnelmole');
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out')), TUNNEL_START_TIMEOUT_MS);
      tunnelmole(mode.kind === 'reserved' ? { port: this.port, domain: mode.domain } : { port: this.port })
        .then((url) => { clearTimeout(timer); resolve(url); })
        .catch((e) => { clearTimeout(timer); reject(e); });
    });
  }

  /** Buffer the raw body (needed verbatim for the HMAC) under a size cap, then
   *  verify + dispatch. Only POST is accepted. */
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (c: Buffer) => {
      if (aborted) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        res.writeHead(413); res.end();
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      this.handleBody(req, res, Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', () => {
      if (aborted) return;
      try { res.writeHead(400); res.end(); } catch { /* socket already gone */ }
    });
  }

  private handleBody(req: IncomingMessage, res: ServerResponse, rawBody: string): void {
    // 1) Authenticate over the RAW body BEFORE parsing. Any failure → 403.
    if (!this.verify(req, rawBody)) { res.writeHead(403); res.end(); return; }

    let payload: SlackPayload;
    try { payload = JSON.parse(rawBody) as SlackPayload; }
    catch { res.writeHead(400); res.end(); return; }

    // 2) URL verification handshake — echo the challenge back.
    if (payload.type === 'url_verification' && typeof payload.challenge === 'string') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ challenge: payload.challenge }));
      return;
    }

    // 3) Real events — the shared router decides (identical logic to Socket Mode).
    this.router.handle(payload);

    // Always 200 so Slack treats the event as delivered and doesn't retry.
    res.writeHead(200); res.end();
  }

  /**
   * Verify a request is genuinely from Slack: HMAC-SHA256 of `v0:<ts>:<rawBody>`
   * with the signing secret must equal the `X-Slack-Signature` header (compared
   * in constant time), AND the timestamp must be within the replay window.
   */
  private verify(req: IncomingMessage, rawBody: string): boolean {
    const sig = req.headers['x-slack-signature'];
    const ts = req.headers['x-slack-request-timestamp'];
    if (typeof sig !== 'string' || typeof ts !== 'string') return false;

    // Replay guard: reject stale or non-numeric timestamps (> 5 min skew).
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) return false;
    if (Math.abs(Date.now() / 1000 - tsNum) > REPLAY_WINDOW_SECONDS) return false;

    const expected = 'v0=' + createHmac('sha256', this.signingSecret)
      .update(`v0:${ts}:${rawBody}`)
      .digest('hex');
    const provided = Buffer.from(sig);
    const computed = Buffer.from(expected);
    // timingSafeEqual throws on length mismatch — guard, and a differing length
    // is itself a mismatch, so bail before the constant-time compare.
    if (provided.length !== computed.length) return false;
    return timingSafeEqual(provided, computed);
  }
}

/** Minimal shape of the Slack Events API payloads we handle. Identical on both
 *  transports — Socket Mode wraps exactly this in its envelope's `body`. */
export interface SlackPayload {
  type?: string;
  challenge?: string;
  /** Present on event_callback — contains the bot's own user_id so we can
   *  detect <@BOTID> text mentions without any extra API scope. */
  authorizations?: { user_id?: string }[];
  event?: {
    /** 'message' for regular channel messages; 'app_mention' for @-mentions. */
    type?: string;
    /** 'file_share' for file uploads; 'message_changed' / 'channel_join' etc. dropped. */
    subtype?: string;
    bot_id?: string;
    channel?: string;
    text?: string;
    /** Message timestamp — Slack's per-message id, used as the reply thread root. */
    ts?: string;
    /** Set when the message is itself a reply; the thread to post back into. */
    thread_ts?: string;
    /** Present on file_share events — the uploaded files' metadata. */
    files?: {
      id?: string;
      url_private?: string;
      name?: string;
      mimetype?: string;
      size?: number;
    }[];
  };
}

// ─── Socket Mode (no public URL) ─────────────────────────────────────────────

/** Which transport carries Slack events in. `events` is the original Events API
 *  over HTTP (needs a public URL + tunnel); `socket` is Socket Mode over an
 *  outbound WebSocket (needs neither). */
export type SlackTransport = 'events' | 'socket';

/** True for something shaped like a Slack APP-LEVEL token (Basic Information →
 *  App-Level Tokens, scope `connections:write`). Deliberately only checks the
 *  `xapp-` prefix and a plausible length: the point is to catch the common
 *  paste error — a BOT token (`xoxb-…`) or a signing secret in this field —
 *  not to model a format Slack may extend. */
export function isAppLevelToken(token: string | undefined): boolean {
  const t = token?.trim() ?? '';
  return t.startsWith('xapp-') && t.length >= 20;
}

/** The transport actually usable from a config, or why it isn't. Resolved in ONE
 *  place so main, the tunnel decision and the Settings copy cannot disagree
 *  about which mode is live. An unknown/absent `transport` means the Events API
 *  — the mode every existing install is already in. */
export function resolveSlackTransport(cfg: {
  transport?: string;
  appToken?: string;
  signingSecret?: string;
}): { kind: 'events'; signingSecret: string } | { kind: 'socket'; appToken: string } | { kind: 'invalid'; error: string } {
  if (cfg.transport === 'socket') {
    const appToken = cfg.appToken?.trim() ?? '';
    if (!appToken) return { kind: 'invalid', error: 'Socket Mode needs an app-level token (xapp-…)' };
    if (!isAppLevelToken(appToken)) {
      return { kind: 'invalid', error: 'that is not an app-level token — Socket Mode needs the xapp-… token, not the bot token or signing secret' };
    }
    return { kind: 'socket', appToken };
  }
  const signingSecret = cfg.signingSecret?.trim() ?? '';
  if (!signingSecret) return { kind: 'invalid', error: 'missing signing secret' };
  return { kind: 'events', signingSecret };
}

/** One frame off the Socket Mode WebSocket, as @slack/socket-mode emits it on
 *  its `slack_event` channel. Only the fields we consume. */
export interface SocketModeEnvelope {
  type?: string;
  envelope_id?: string;
  body?: unknown;
}

/**
 * The Events API payload inside a Socket Mode envelope, or null when the frame
 * carries nothing we handle.
 *
 * Slack wraps the SAME payload the HTTP endpoint receives in `body` — that is
 * what lets both transports share one router. `type` says which product sent
 * it: only `events_api` frames carry an Events API payload; the socket also
 * carries `hello`, `disconnect`, `slash_commands` and `interactive` frames,
 * which must be acked (the transport does that unconditionally) and then
 * dropped rather than fed to the event router.
 */
export function envelopeToPayload(envelope: SocketModeEnvelope | undefined | null): SlackPayload | null {
  if (!envelope || envelope.type !== 'events_api') return null;
  const body = envelope.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return body as SlackPayload;
}

export interface SlackSocketModeOptions {
  /** App-level token (xapp-…) with the `connections:write` scope. */
  appToken: string;
  /** Optional channel id filter — when set, events from other channels are dropped. */
  channelId?: string;
  /** Same callback, same shape, as the HTTP transport's. */
  onMessage: (m: SlackInboundMessage) => void | Promise<void>;
}

/**
 * Slack ingestion over Socket Mode — the same events as SlackWebhookServer with
 * no inbound HTTP at all, so no tunnel, no public URL and nothing to re-paste
 * into Slack after a restart.
 *
 * There is no per-message signature to verify here and that is not an omission:
 * the WebSocket is opened BY US to Slack and authenticated once with the
 * app-level token, so every frame on it is from Slack by construction. The
 * signing secret authenticates the OTHER direction (an inbound HTTP request
 * claiming to be Slack) and has no job in this mode.
 */
export class SlackSocketModeClient {
  private client: { disconnect: () => Promise<void> } | null = null;
  private readonly appToken: string;
  private readonly router: SlackEventRouter;

  constructor(opts: SlackSocketModeOptions) {
    this.appToken = opts.appToken;
    this.router = new SlackEventRouter({ channelId: opts.channelId, onMessage: opts.onMessage });
  }

  /** Open the WebSocket. Resolves once Slack has accepted the app-level token;
   *  a bad token fails HERE rather than silently never delivering. */
  async start(): Promise<{ ok: boolean; error?: string }> {
    if (this.client) return { ok: false, error: 'already running' };
    if (!isAppLevelToken(this.appToken)) return { ok: false, error: 'missing or malformed app-level token (xapp-…)' };
    try {
      // Imported dynamically so the socket-mode dependency tree (web-api,
      // undici) is only loaded for users who actually turned Socket Mode on —
      // an Events API install pays nothing for it.
      const { SocketModeClient } = await import('@slack/socket-mode');
      const client = new SocketModeClient({ appToken: this.appToken });
      // Ack FIRST and unconditionally — Slack redelivers anything un-acked
      // within 3s, and a frame we don't route (hello, slash command) still has
      // to be acknowledged or the socket gets torn down.
      client.on('slack_event', async ({ ack, ...envelope }: SocketModeEnvelope & { ack: () => Promise<void> }) => {
        try { await ack(); } catch { /* socket already gone; routing below is still worth attempting */ }
        const payload = envelopeToPayload(envelope);
        if (payload) this.router.handle(payload);
      });
      await client.start();
      this.client = client;
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `socket mode failed to connect: ${errMsg(e)}` };
    }
  }

  /** Close the WebSocket. Idempotent and best-effort. */
  stop(): void {
    const client = this.client;
    this.client = null;
    try { void client?.disconnect(); } catch { /* noop */ }
  }
}

/** Strip a single leading `<@BOTID>` app-mention so "@bot do X" enqueues "do X". */
function stripLeadingMention(text: string): string {
  return text.replace(/^\s*<@[A-Z0-9]+>\s*/i, '').trim();
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Post a reply into a Slack thread via `chat.postMessage` — a raw `node:https`
 * POST (no `@slack/*` dep), matching the repo's zero-SDK approach. The bot token
 * is passed in by the caller: it lives in main's config and never leaves the
 * main process, and is NEVER logged. Resolves Slack's `{ ok, error? }`.
 */
export function postSlackReply(opts: {
  botToken: string;
  channel: string;
  thread_ts: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (!opts.botToken) { resolve({ ok: false, error: 'missing bot token' }); return; }
    // CLAUSE-1 guard (fix-slack-integration): refuse any send that lacks an
    // EXPLICIT channel + thread target. A blank/whitespace thread_ts would post
    // to the channel root — an implicit destination the caller never named — so
    // every app/voice-initiated send must pass the thread it was explicitly given.
    // The Slack-origin done-reply poller and the loopback /reply endpoint always
    // pass concrete values, so this never fires for them (no behaviour change).
    if (!opts.channel?.trim() || !opts.thread_ts?.trim()) {
      resolve({ ok: false, error: 'missing explicit channel or thread_ts' }); return;
    }
    const body = JSON.stringify({ channel: opts.channel, thread_ts: opts.thread_ts, text: opts.text });
    const req = httpsRequest({
      method: 'POST',
      hostname: 'slack.com',
      path: '/api/chat.postMessage',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        authorization: `Bearer ${opts.botToken}`
      }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { ok?: boolean; error?: string };
          resolve({ ok: json.ok === true, error: json.error });
        } catch { resolve({ ok: false, error: 'bad response from Slack' }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: errMsg(e) }));
    req.write(body);
    req.end();
  });
}

/** Per-session shared secret + lazy bot-token accessor for the reply endpoint. */
export interface SlackReplyServerOptions {
  /** Secret the helper must echo in the `x-md-reply-token` header. */
  token: string;
  /** Deliver ONE reply to the destination named by `channel`. Injected by main
   *  (see `postReply` in index.ts) so this endpoint carries Slack and Telegram
   *  alike and never touches a credential itself. */
  post: (o: { channel: string; thread_ts: string; text: string }) => Promise<{ ok: boolean; error?: string }>;
  /** Fired with a thread_ts after an agent's DIRECT reply posts successfully through
   *  this loopback. Lets main record that the thread was already answered so the
   *  done-summary poller can skip it (the poller is a fallback, not a duplicator). */
  onReplied?: (thread_ts: string) => void;
}

/**
 * Loopback-only HTTP endpoint that lets a bundled helper script post a reply
 * (Slack or Telegram — main's injected `post` routes on `channel`) WITHOUT ever
 * seeing any bot token. It binds to `127.0.0.1` exclusively
 * and is NEVER placed behind the public tunnel (only the webhook port is
 * forwarded). Every request must carry the per-session `x-md-reply-token`
 * header; non-loopback peers are refused even though the bind already excludes
 * them (defense in depth). Main writes `{ port, token }` to
 * `<userData>/slack-reply.json` so the helper can find this socket.
 */
export class SlackReplyServer {
  private server: Server | null = null;
  private readonly token: string;
  private readonly post: SlackReplyServerOptions['post'];
  private readonly onReplied?: (thread_ts: string) => void;

  constructor(opts: SlackReplyServerOptions) {
    this.token = opts.token;
    this.post = opts.post;
    this.onReplied = opts.onReplied;
  }

  /** Bind a loopback port (0 ⇒ OS-assigned). Resolves the actual bound port. */
  start(preferredPort = 0): Promise<{ ok: boolean; port?: number; error?: string }> {
    return new Promise((resolve) => {
      if (this.server) { resolve({ ok: false, error: 'already running' }); return; }
      const server = createServer((req, res) => this.handle(req, res));
      const onError = (e: Error): void => { server.off('listening', onListening); resolve({ ok: false, error: errMsg(e) }); };
      const onListening = (): void => {
        server.off('error', onError);
        this.server = server;
        const addr = server.address();
        resolve({ ok: true, port: addr && typeof addr === 'object' ? addr.port : preferredPort });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      // '127.0.0.1' ONLY — the public tunnel forwards the webhook port, never this.
      server.listen(preferredPort, '127.0.0.1');
    });
  }

  /** Close the endpoint. Idempotent and best-effort. */
  stop(): void {
    try { this.server?.close(); } catch { /* noop */ }
    this.server = null;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    // Defense in depth: even bound loopback-only, refuse any non-loopback peer.
    if (!isLoopback(req.socket.remoteAddress ?? '')) { res.writeHead(403); res.end(); return; }
    if (req.method !== 'POST' || (req.url ?? '').split('?')[0] !== '/reply') {
      res.writeHead(404); res.end(); return;
    }
    if (!this.checkToken(req.headers['x-md-reply-token'])) { res.writeHead(401); res.end(); return; }

    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (c: Buffer) => {
      if (aborted) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) { aborted = true; res.writeHead(413); res.end(); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      let parsed: { channel?: string; thread_ts?: string; text?: string };
      try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'bad json' })); return; }
      if (!parsed.channel || !parsed.thread_ts || !parsed.text) {
        res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'channel, thread, text required' })); return;
      }
      const thread_ts = parsed.thread_ts;
      this.post({ channel: parsed.channel, thread_ts, text: parsed.text })
        .then((r) => {
          // A successful DIRECT reply means the agent already answered this thread —
          // tell main so the done-summary poller treats it as a fallback and skips it.
          if (r.ok) { try { this.onReplied?.(thread_ts); } catch { /* never break the reply */ } }
          res.writeHead(r.ok ? 200 : 502, { 'content-type': 'application/json' }); res.end(JSON.stringify(r));
        })
        .catch((e) => { res.writeHead(500); res.end(JSON.stringify({ ok: false, error: errMsg(e) })); });
    });
    req.on('error', () => { if (!aborted) { try { res.writeHead(400); res.end(); } catch { /* socket gone */ } } });
  }

  /** Constant-time match of the request's reply token against the session token. */
  private checkToken(provided: string | string[] | undefined): boolean {
    if (typeof provided !== 'string') return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(this.token);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}

/** True for IPv4 loopback (127.0.0.0/8) and IPv6 ::1 (incl. v4-mapped form). */
function isLoopback(addr: string): boolean {
  const a = addr.replace(/^::ffff:/, '');
  return a === '::1' || a.startsWith('127.');
}
