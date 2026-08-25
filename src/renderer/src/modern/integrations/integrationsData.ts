/**
 * What the Integrations page says, decided in one pure place.
 *
 * The page is STATUS-ONLY (MD-88): it writes nothing but Start/Stop and
 * deep-links every edit into Settings. So the only real logic left is
 * "connected, or why not?" — and that is worth getting right in a function with
 * tests rather than in JSX, because the failure mode this page exists to prevent
 * is a bridge that quietly accepts nothing while looking fine.
 *
 * No imports on purpose: this module is loadable by the `.cjs` test harness,
 * which resolves relative and `@shared/` paths only.
 */

/** How an integration is doing, in the order the dot's colour ramps. */
export type IntegrationState =
  /** Running now. */
  | 'connected'
  /** Configured and could run, but is not running. */
  | 'stopped'
  /** Cannot run as configured — `blocker` says which field is missing. */
  | 'blocked'
  /** Switched off; nothing is wrong. */
  | 'off';

/** One row on the page. `detail` is non-secret by construction — it is built
 *  here, from booleans and counts, never from a credential. */
export interface IntegrationStatusRow {
  id: 'slack' | 'telegram' | 'webhooks' | 'rest';
  label: string;
  state: IntegrationState;
  /** One line of derived summary, or '' when there is nothing to add. */
  detail: string;
  /** Why it cannot run, naming the field to fix. Present iff state==='blocked'. */
  blocker?: string;
  /** Whether Start/Stop applies at all (the REST registry has no lifecycle). */
  lifecycle: boolean;
}

/** The subset of the renderer's HarnessConfig this page reads. Structural, and
 *  deliberately typed here rather than imported: `@/store/config` is the right
 *  source for the FULL config (preload's narrower copy omits the Telegram
 *  fields entirely), but naming only what we read keeps this module pure. */
export interface IntegrationsConfig {
  slackEnabled?: boolean;
  slackSigningSecret?: string;
  slackBotToken?: string;
  slackAppToken?: string;
  slackChannelId?: string;
  slackAllowedUserIds?: string;
  slackTransport?: 'events' | 'socket';
  slackProactivePosting?: boolean;
  telegramEnabled?: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
}

const set = (v: string | undefined): boolean => typeof v === 'string' && v.trim().length > 0;

/** How many ids an allowlist string carries. Comma OR whitespace separated —
 *  both spellings are in the wild, and counting ' ' as an id would report a
 *  populated allowlist for a string of spaces. */
export function allowlistCount(raw: string | undefined): number {
  return String(raw ?? '').split(/[,\s]+/).filter(Boolean).length;
}

/** Join the non-empty parts of a summary with the page's separator. */
function line(...parts: Array<string | false | undefined>): string {
  return parts.filter((p): p is string => !!p).join(' · ');
}

/**
 * Slack's row.
 *
 * The allowlist is the one that matters: it is REQUIRED, and blank means
 * ingestion refuses to start. Saying only "not running" there would send someone
 * hunting through four other fields, so an empty allowlist is named as the
 * blocker even though the token and secret are equally mandatory — those are
 * checked first, in the order the connect actually fails.
 */
export function slackRow(cfg: IntegrationsConfig, status: { running: boolean; transport?: 'events' | 'socket' }): IntegrationStatusRow {
  const transport = status.transport ?? cfg.slackTransport ?? 'events';
  const detail = line(
    status.running && `transport: ${transport}`,
    `${allowlistCount(cfg.slackAllowedUserIds)} allowed sender${allowlistCount(cfg.slackAllowedUserIds) === 1 ? '' : 's'}`,
    cfg.slackChannelId && `channel ${cfg.slackChannelId}`,
    cfg.slackProactivePosting ? 'proactive posting on' : 'proactive posting off'
  );
  if (status.running) return { id: 'slack', label: 'Slack', state: 'connected', detail, lifecycle: true };
  // NOT `detail: 'disabled'` — the row already says that beside the label, and
  // printing it twice reads as two different facts. Switched off is still worth
  // summarising: it is what you would be turning back on.
  if (!cfg.slackEnabled) return { id: 'slack', label: 'Slack', state: 'off', detail, lifecycle: true };
  const blocker = !set(cfg.slackBotToken) ? 'no bot token'
    : transport === 'socket' && !set(cfg.slackAppToken) ? 'no app token — Socket Mode needs one'
      : transport === 'events' && !set(cfg.slackSigningSecret) ? 'no signing secret'
        // Last, and the one worth spelling out: with no allowed senders the
        // bridge starts and then ingests nothing, which looks like it works.
        : allowlistCount(cfg.slackAllowedUserIds) === 0
          ? 'no allowed senders — nothing would be ingested'
          : undefined;
  return blocker
    ? { id: 'slack', label: 'Slack', state: 'blocked', detail, blocker, lifecycle: true }
    : { id: 'slack', label: 'Slack', state: 'stopped', detail, lifecycle: true };
}

/**
 * Telegram's row. Same fail-closed rule (MD-83 boundary, untouched): no allowed
 * chat id ⇒ nothing is ever accepted, so that is a blocker and not a warning.
 */
export function telegramRow(cfg: IntegrationsConfig, status: { running: boolean; username?: string }): IntegrationStatusRow {
  const detail = line(
    status.running && status.username && `@${status.username}`,
    set(cfg.telegramBotToken) ? 'token set' : 'token not set',
    set(cfg.telegramChatId) ? 'chat id set' : 'chat id not set'
  );
  if (status.running) return { id: 'telegram', label: 'Telegram', state: 'connected', detail, lifecycle: true };
  if (!cfg.telegramEnabled) return { id: 'telegram', label: 'Telegram', state: 'off', detail, lifecycle: true };
  const blocker = !set(cfg.telegramBotToken) ? 'no bot token'
    : !set(cfg.telegramChatId) ? 'no allowed chat id — nothing would be accepted'
      : undefined;
  return blocker
    ? { id: 'telegram', label: 'Telegram', state: 'blocked', detail, blocker, lifecycle: true }
    : { id: 'telegram', label: 'Telegram', state: 'stopped', detail, lifecycle: true };
}

/** The webhook server's row. Endpoints are counted, never listed here. */
export function webhooksRow(
  status: { running: boolean; url?: string; endpoints: { id: string; url: string }[] },
  configured: number
): IntegrationStatusRow {
  const live = status.endpoints.filter((e) => !!e.url).length;
  const detail = line(
    `${configured} endpoint${configured === 1 ? '' : 's'}`,
    // '' means the tunnel has not come up yet. Saying "waiting" is the honest
    // answer; printing an empty URL would read as a broken endpoint.
    status.running ? (live < configured ? 'waiting for tunnel' : `tunnel ${status.url ?? 'up'}`) : undefined
  );
  if (status.running) return { id: 'webhooks', label: 'Webhooks', state: 'connected', detail, lifecycle: true };
  return configured === 0
    ? { id: 'webhooks', label: 'Webhooks', state: 'off', detail: 'no endpoints configured', lifecycle: true }
    : { id: 'webhooks', label: 'Webhooks', state: 'stopped', detail, lifecycle: true };
}

/** One custom-REST integration, as much of it as this page reads. */
export interface RestRecord { id: string; label: string; enabled: boolean; hasSecret: boolean; authType?: string }

/** v1 grants every ENABLED integration to ALL workers, so "usable" is the whole
 *  worker story: enabled, and holding whatever secret its auth type needs. There
 *  is no per-integration worker scoping to surface. */
export function restUsable(r: RestRecord): boolean {
  return r.enabled && (r.authType === 'none' || r.hasSecret);
}

export function restRow(records: RestRecord[]): IntegrationStatusRow {
  const list = Array.isArray(records) ? records : [];
  const usable = list.filter(restUsable).length;
  return {
    id: 'rest',
    label: 'Custom REST',
    state: list.length === 0 ? 'off' : usable > 0 ? 'connected' : 'blocked',
    detail: list.length === 0 ? 'none configured' : `${list.length} configured · ${usable} usable`,
    blocker: list.length > 0 && usable === 0 ? 'every integration is disabled or missing its secret' : undefined,
    // The registry has no server to start; it is configuration, not a bridge.
    lifecycle: false
  };
}

/* ─── Provider Doctor ───────────────────────────────────────────────────────── */

export type DoctorStatus = 'ok' | 'mismatch' | 'not-installed' | 'unverifiable';

/**
 * Whether a Doctor row means "go fix something".
 *
 * ONLY `mismatch` does. `not-installed` and `unverifiable` are ANSWERS — an
 * engine you never installed is not a fault, and a fact that needs a network
 * call this app does not make is reported as unverified rather than assumed. A
 * page that paints all three red cries wolf and stops being read.
 */
export function isActionable(status: string): boolean {
  return status === 'mismatch';
}

/** The count that belongs next to "Doctor" — actionable rows only, for the same
 *  reason. Zero means nothing to do, even with a dozen unverifiable rows. */
export function actionableCount(results: Array<{ status: string }> | undefined | null): number {
  return (Array.isArray(results) ? results : []).filter((r) => isActionable(r?.status)).length;
}

/** Doctor rows sorted so the actionable ones are first; ties keep ledger order
 *  (a stable sort), because within a status the engine's own order is the most
 *  predictable thing we have. */
export function sortDoctorResults<T extends { status: string }>(results: T[]): T[] {
  return [...(Array.isArray(results) ? results : [])]
    .sort((a, b) => Number(isActionable(b.status)) - Number(isActionable(a.status)));
}
