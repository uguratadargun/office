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
 * MD-173 moved the last two rules of the same family in beside them, so there is
 * exactly one place to look and one place to change: {@link wakesHibernatedAgent}
 * (does this delivery justify a respawn) and {@link isBareAck} (is this reply
 * nothing but "got it"). Two consumers each read a different combination of the
 * four, which is precisely why they must not be four different copies.
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
 * `request`/`query`/`propose` ask for something, and since MD-170 that is the
 * ONLY place the obligation lives: `hive.normalize` no longer infers
 * `requires_reply` from the act, so the flag is a pure opt-in escalation — a
 * caller setting it by hand on an `inform` it genuinely needs answered.
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
 * The sender is deliberately NOT consulted, which is the one place this differs
 * from {@link messageIsActionable}: a `request` from the scheduler must not
 * respawn a parked orchestrator (that gate's job), but mail already addressed to
 * a specific agent is that agent's work whoever wrote it.
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
 * MD-170 — the longest body an "ack" may have, in characters.
 *
 * Length is the only signal that separates "got it, thanks" from a substantive
 * follow-up that happens to be phrased as an `inform`. 300 is generous: the
 * acks measured in live traffic ran well under 200, and anything approaching a
 * real update clears it easily. Erring long keeps a genuine reply out of the
 * archive at the price of carrying a few short ones.
 */
export const ACK_BODY_MAX = 300;

/**
 * Is `msg` a bare ACK — a reply whose only content is that the FYI arrived?
 *
 * 845 messages of live traffic held 125 replies written to `inform`s that had
 * asked for none. Each cost the recipient a wake and a full read turn to learn
 * nothing, and the recipient was usually god, whose context is the most
 * expensive on the floor. Three conditions, all narrow:
 *
 *  1. `parent` is terminal — an `inform` that did not ask for a reply. A reply
 *     to a `request`/`query`/`propose`, or to an `inform` explicitly flagged
 *     `requires_reply`, is the answer somebody is waiting on;
 *  2. `msg` asks for nothing itself — see {@link wakesHibernatedAgent}. A short
 *     `request` hanging off an FYI is still a request;
 *  3. its body is under {@link ACK_BODY_MAX} characters.
 *
 * `parent` null means the message it replies to could not be found, and the
 * answer is false: an unknown parent is delivered normally. Losing mail is far
 * worse than carrying an ack that could have been archived.
 */
export function isBareAck(
  msg: { in_reply_to?: string | null; body?: string; act?: string; requires_reply?: boolean },
  parent: { act?: string; requires_reply?: boolean } | null | undefined
): boolean {
  if (!msg?.in_reply_to) return false;
  if (!parent) return false;
  if (parent.act !== 'inform' || parent.requires_reply === true) return false;
  if (wakesHibernatedAgent(msg)) return false;
  return (msg.body ?? '').length < ACK_BODY_MAX;
}
