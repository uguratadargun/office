/**
 * How the app reaches the public internet — and whether that address survives a
 * restart.
 *
 * Default behaviour opens an anonymous tunnelmole tunnel, which is assigned a
 * RANDOM subdomain per connection. So every restart handed Slack and every
 * webhook caller a new URL, silently breaking whatever the user had pasted into
 * Slack, GitHub or GitLab. Nothing told them; the endpoint simply stopped
 * working.
 *
 * One setting covers the two honest ways out, and requires neither:
 *   • a full URL  → the user already runs cloudflared / ngrok / nginx at a fixed
 *     hostname. We start NO tunnel and use theirs. Free, stable, no account.
 *   • a bare host → a reserved tunnelmole subdomain, passed through as `domain`.
 *     Stable if their tunnelmole API key is set (via the tunnelmole CLI — never
 *     via `tunnelmole({setApiKey})`, which calls process.exit).
 *   • blank       → today's ephemeral tunnel, now labelled as ephemeral.
 */
export type PublicUrlMode =
  /** No setting: anonymous tunnel, new address every restart. */
  | { kind: 'ephemeral' }
  /** The user's own fixed endpoint. We open no tunnel at all. */
  | { kind: 'external'; url: string }
  /** A reserved tunnelmole subdomain, handed to the client as `domain`. */
  | { kind: 'reserved'; domain: string };

/** Trailing slashes make `${base}/hook/x` produce a double slash, which some
 *  receivers treat as a different path. Normalise once, here. */
function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

/**
 * Interpret the user's `publicUrl` setting.
 *
 * A value carrying a scheme (or a path, or a port) is THEIR endpoint — we must
 * not try to reserve it as a subdomain. A bare hostname is a tunnelmole domain.
 * Anything unusable falls back to ephemeral rather than throwing: a malformed
 * setting must never stop the server from starting, it just doesn't make the
 * address stable.
 */
export function resolvePublicUrl(raw: string | undefined | null): PublicUrlMode {
  const value = (raw ?? '').trim();
  if (!value) return { kind: 'ephemeral' };

  if (/^https?:\/\//i.test(value)) {
    const url = trimSlash(value);
    // Reject a scheme with nothing after it ("https://").
    return /^https?:\/\/[^/\s]+/i.test(url) ? { kind: 'external', url } : { kind: 'ephemeral' };
  }

  // A bare host. Reject anything with a path, port, whitespace or credentials —
  // those are endpoints the user pasted without a scheme, not subdomains, and
  // handing them to tunnelmole as `domain` would fail confusingly.
  if (/[\s/:@]/.test(value)) return { kind: 'ephemeral' };
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/i.test(value)) return { kind: 'ephemeral' };
  return { kind: 'reserved', domain: value.toLowerCase() };
}

/** Is this address the same after a restart? Drives the UI label — a user who
 *  cannot tell will paste an ephemeral URL into Slack and lose it. */
export function isStable(mode: PublicUrlMode): boolean {
  return mode.kind !== 'ephemeral';
}

/** One line explaining the current address, for Settings. */
export function describePublicUrl(mode: PublicUrlMode): string {
  switch (mode.kind) {
    case 'external':
      return `Using your own endpoint — ${mode.url}. No tunnel is started; forward it to this app's port.`;
    case 'reserved':
      return `Reserving ${mode.domain} on tunnelmole. Needs a tunnelmole API key set via their CLI.`;
    case 'ephemeral':
      return 'A new public address is generated every restart, so anything you paste into Slack or GitHub stops working when the app restarts.';
  }
}
