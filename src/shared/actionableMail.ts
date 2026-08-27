/**
 * Which inbox message is worth interrupting an agent for.
 *
 * Two different questions get asked of a hive message and they are easy to
 * confuse, so both live here:
 *   - who SENT it — the scheduler's own beats are the harness talking to itself,
 *     never a reason to spend a turn;
 *   - what it ASKS — `inform`/`done` is a notification, and it can wait in the
 *     inbox until the agent is up anyway, while `request`/`query`/`propose` (and
 *     anything explicitly flagged `requires_reply`) is somebody waiting.
 *
 * The pair is what makes it safe to let the ORCHESTRATOR sleep: a floor that is
 * entirely asleep still has timers running, and every one of them writes mail.
 * Without this predicate the first scheduled beat would respawn the very agent
 * that just parked, which is the loop that costs a full-context turn an hour all
 * night for nothing.
 *
 * Pure and node-testable; main supplies the messages.
 */

/** Senders that are the harness itself. Kept NARROW on purpose: any sender not
 *  named here is a real agent, a webhook or a human, and counts by default. */
export const SYSTEM_SENDERS: ReadonlySet<string> = new Set([
  'heartbeat', 'scheduler', 'breaker', 'system'
]);

/**
 * Acts that leave the recipient something to do.
 *
 * `request`/`query`/`propose` ask for something — `hive.normalize` already
 * defaults `requires_reply` to true for exactly those three, so the two halves of
 * the test agree; the flag is checked as well because a caller may set it by hand
 * on an `inform` it genuinely needs answered.
 *
 * `done` is here for MD-163's reason and it is a good one: a finished card is
 * waiting to be closed or merged, which is work for the recipient however it is
 * phrased. `inform` — and the `agree`/`refuse` that close a proposal — are the
 * record of something that already happened and keep until the agent is up anyway.
 */
export const ACTIONABLE_ACTS: ReadonlySet<string> = new Set(['request', 'query', 'propose', 'done']);

/** The fields of a hive message this module reads. Deliberately a structural
 *  subset — main's `HiveMessage` satisfies it without this module importing it. */
export interface MailLike {
  from?: string;
  act?: string;
  requires_reply?: boolean;
}

export function isSystemSender(from: string | undefined): boolean {
  return SYSTEM_SENDERS.has((from ?? '').trim());
}

/**
 * Is this message a reason to wake (or interrupt) its recipient?
 *
 * The sender test comes first and is absolute: a `request` from the scheduler is
 * still the harness talking to itself, and the hourly standup is precisely that
 * shape. An `inform` from a real agent stays in the inbox — it is not lost, it is
 * read on the next wake the agent has for its own reasons.
 */
export function messageIsActionable(m: MailLike | null | undefined): boolean {
  if (!m) return false;
  if (isSystemSender(m.from)) return false;
  return m.requires_reply === true || ACTIONABLE_ACTS.has((m.act ?? '').trim());
}

export function countActionable(list: readonly MailLike[] | null | undefined): number {
  return (list ?? []).filter(messageIsActionable).length;
}
