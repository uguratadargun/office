/**
 * The idle inbox-wake nudge and the policy around it — one module, shared so
 * main and renderer decide the same way and a test can drive both without
 * Electron.
 *
 * The nudge is queued the moment mail lands but typed only once the terminal is
 * free, and an agent's Stop hook usually drains the inbox before that happens.
 * Stacked copies therefore arrive against an already-empty inbox: the floor saw
 * three in a row on 2026-08-21. The text lives here so `enqueueMessage` can
 * enforce one-pending-per-agent without importing renderer code, exactly as it
 * already does for `/compact`.
 *
 * MD-163 adds the two rules that make a burst cost ONE wake instead of N. Every
 * nudge is a full model turn against a context of 130k+ tokens, so the question
 * is never "is this message worth delivering" (it is already delivered — it is
 * sitting in the inbox) but "is it worth interrupting for". Three answers:
 *   - {@link wakesHibernatedAgent} — only mail that asks for something wakes a
 *     PARKED agent; an FYI waits for the next real wake.
 *   - {@link shouldNudgeForMail} — the scheduler's own beats do not nudge an
 *     idle floor.
 *   - {@link inboxNudgeDebounceMs} — inside one window an agent is nudged once,
 *     and that nudge names how many messages are waiting.
 */

/** The nudge, in its one-message form. Kept EXACTLY as it was: `isInboxNudge`,
 *  the queue's one-pending rule and the first-wake announce (MD-146) all match
 *  on the leading sentence, and `test/wake-announce.test.cjs` pins the announce
 *  call site to this constant. */
export const INBOX_NUDGE_TEXT =
  'You have new hive inbox message(s) — read your inbox, act on them now, and move handled ones to inbox/.done/. Act autonomously; only message god if you genuinely need a decision.';

/**
 * The nudge for `count` waiting messages.
 *
 * A burst that was debounced into one wake must SAY it was a burst, or the
 * agent reads the first message, answers it and parks again with two unread
 * behind it — which is the stall the debounce would otherwise introduce.
 *
 * The count is spliced into the existing lead sentence rather than replacing
 * it, because that sentence is the dedupe key everywhere else (`isInboxNudge`,
 * the queue's one-pending-per-agent rule). Change its opening and the batching
 * silently switches off.
 */
export function inboxNudgeText(count: number): string {
  if (!Number.isFinite(count) || count <= 1) return INBOX_NUDGE_TEXT;
  return INBOX_NUDGE_TEXT.replace(
    'You have new hive inbox message(s) —',
    `You have new hive inbox message(s) — ${Math.floor(count)} of them —`
  );
}

/** True when `text` is the inbox-wake nudge. Compared on the leading sentence so
 *  a trailing tweak to the guidance half — or the batch count — does not
 *  silently disable the dedupe. */
export function isInboxNudge(text: string): boolean {
  return text.trim().startsWith('You have new hive inbox message(s)');
}

/** Senders whose mail is the scheduler's OWN noise (heartbeat beats, ops-standup
 *  via 'scheduler', breaker steers, generic 'system') — never a reason to wake
 *  god. Everything else (a worker agent id, 'webhook', a human reply) is real
 *  mail god must act on. Kept narrow so any future real sender counts by default.
 *
 *  Lives here rather than in main because the renderer's nudge loop needs the
 *  same list: main's inbox-aware re-engage was already skipping these beats
 *  while the renderer nudged god for every one of them, so the count that
 *  decided "nothing to do" and the count that woke him up disagreed. */
export const SYSTEM_SENDERS: ReadonlySet<string> = new Set([
  'heartbeat', 'scheduler', 'breaker', 'system'
]);

/** True for the scheduler's own mail — see {@link SYSTEM_SENDERS}. */
export function isSystemSender(from: string | undefined): boolean {
  return !!from && SYSTEM_SENDERS.has(from);
}

/** The acts that need someone. `request`/`query`/`propose` ask for something;
 *  `done` is a finished card waiting to be closed or merged, which is work for
 *  the recipient however it is phrased. `inform` — and the `agree`/`refuse` that
 *  close a proposal — are the record of something that already happened, and
 *  keep until the agent is up anyway. */
const ACTIONABLE_ACTS = new Set(['request', 'query', 'propose', 'done']);

/**
 * Should this delivery wake a HIBERNATED agent?
 *
 * A parked agent is woken by respawning its CLI with `--resume`, which re-sends
 * the whole transcript as a fresh cache-write prefix and then types the nudge —
 * a full model turn to read an FYI. Only mail that actually asks for something
 * is worth that: `request`/`query`/`propose`, a `done` report that leaves the
 * recipient a card to close, or anything explicitly flagged `requires_reply`
 * (a card assignment arrives as a `request`, so the act alone covers it). An
 * `inform` stays in the inbox and is read at the next real wake — nothing is
 * lost, because the nudge always says "read your inbox", not "read this
 * message".
 *
 * An agent that is already awake is unaffected: the renderer ignores the wake
 * for it, and the nudge loop still notices the new mail on its next tick.
 */
export function wakesHibernatedAgent(
  msg: { act?: string; requires_reply?: boolean } | null | undefined
): boolean {
  if (!msg) return false;
  if (msg.requires_reply === true) return true;
  return ACTIONABLE_ACTS.has(msg.act ?? '');
}

/**
 * Should fresh mail produce a nudge at all?
 *
 * Actionable mail always does. Mail that is only the scheduler talking to
 * itself nudges only while the floor is actually working — on an idle floor the
 * hourly standup was the single thing turning a silent night into a full-context
 * turn every hour, and the digest it carries is worth nothing when no agent has
 * moved since the last one.
 */
export function shouldNudgeForMail(
  fresh: ReadonlyArray<{ from?: string }>,
  floorBusy: boolean
): boolean {
  if (!fresh.length) return false;
  if (fresh.some((m) => !isSystemSender(m.from))) return true;
  return floorBusy;
}

/** Seconds an agent is nudged at most once, however much mail arrives. */
export const DEFAULT_INBOX_NUDGE_DEBOUNCE_SECONDS = 60;

/** Debounce window in ms. 0 (or a negative/NaN setting) turns batching OFF —
 *  every message nudges, which is the pre-MD-163 behaviour and the escape hatch
 *  if batching ever hides mail. */
export function inboxNudgeDebounceMs(seconds: number | undefined): number {
  const s = seconds ?? DEFAULT_INBOX_NUDGE_DEBOUNCE_SECONDS;
  if (!Number.isFinite(s) || s <= 0) return 0;
  return Math.round(s * 1000);
}

/**
 * Is this agent still inside the window of its last nudge?
 *
 * Held mail is deliberately NOT marked as seen by the caller, so it is
 * reconsidered on the next tick and nudged — with its full count — the moment
 * the window closes. The burst costs one wake; nothing waits forever.
 */
export function nudgeHeld(lastNudgeAt: number | undefined, now: number, windowMs: number): boolean {
  if (windowMs <= 0) return false;
  if (!lastNudgeAt) return false;
  return now - lastNudgeAt < windowMs;
}
