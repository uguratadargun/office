/**
 * The idle inbox-wake nudge — one string, shared so the queue can recognise it.
 *
 * It is queued the moment mail lands but typed only once the terminal is free,
 * and an agent's Stop hook usually drains the inbox before that happens. Stacked
 * copies therefore arrive against an already-empty inbox: the floor saw three in
 * a row on 2026-08-21. The text lives here so `enqueueMessage` can enforce
 * one-pending-per-agent without importing renderer code, exactly as it already
 * does for `/compact`.
 */
export const INBOX_NUDGE_TEXT =
  'You have new hive inbox message(s) — read your inbox, act on them now, and move handled ones to inbox/.done/. Act autonomously; only message god if you genuinely need a decision.';

/** True when `text` is the inbox-wake nudge. Compared on the leading sentence so
 *  a trailing tweak to the guidance half does not silently disable the dedupe. */
export function isInboxNudge(text: string): boolean {
  return text.trim().startsWith('You have new hive inbox message(s)');
}
