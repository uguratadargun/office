/**
 * When an agent's conversation may be thrown away.
 *
 * Nothing ever cleared a thread, so a worker's transcript grew for the life of
 * the hive and every restart or hibernate-wake re-attached it with `--resume`.
 * At 6–12 MB that is the single biggest line on the bill: 98% of billed tokens
 * are cache reads of a history the agent no longer needs, because everything
 * durable already lives in git, the card, and the agent's memory.md.
 *
 * The whole risk is clearing a thread an agent was still using, so — like
 * `shouldHibernate` — every guard here is a reason to KEEP the conversation,
 * and the answer is true only when all of them agree the agent is between
 * cards. Sign-off, not self-report, is the trigger: a card reaching `done` is
 * god's decision, and it is the only moment the work is provably finished.
 */

/**
 * Clear-on-done ships ON.
 *
 * The alternative is what every agent on this floor actually lived: five or six
 * cards in one session, each one starting from the compaction summaries of the
 * ones before it. That tail is never free — the whole context is re-sent on every
 * turn — and it is never useful either, because nothing in it is about the card
 * now in hand. A fresh card should start from the ~32k prefix (the harness
 * prompt, the protocol, the roster) and re-orient from memory.md, which is
 * where the durable half was written down on purpose.
 *
 * It is ON rather than opt-in because the guards below already make the unsafe
 * case unreachable: clearing happens only at a sign-off god issued, only when
 * nothing else of the agent's is in flight, and only once per card. An operator
 * who wants the long thread back turns this off; it is a real off switch, not a
 * very large number.
 */
export const DEFAULT_CLEAR_ON_DONE = true;

/**
 * The two reasons to KEEP a thread that the ledger cannot see.
 *
 * Both are about the terminal, not the card, which is why they arrive from the
 * caller: `shouldClearThread` is pure and the ledger is the only thing it reads.
 */
export interface ClearThreadGuards {
  /**
   * Unread mail in this agent's inbox that ASKS for something — the
   * `@shared/actionableMail` predicate, not raw inbox depth.
   *
   * The hazard is a sequence, not a message: mail lands, the nudge tells the
   * agent to go read its inbox, and the `/clear` queued behind it wipes the
   * instruction it was just given. The message itself survives on disk either
   * way; what does not survive is the agent knowing it was asked. And the mail
   * that lands right after a sign-off is usually the NEXT card, so this is the
   * common case rather than the exotic one. Waiting costs one tick.
   */
  actionableMail?: number;
  /**
   * The circuit breaker holds a level for this agent — it is mid-incident.
   *
   * A breaker steer says "you are looping — stop, summarise what you tried, and
   * follow this". Every word of that answer is in the thread we would be about
   * to throw away, so clearing here destroys the evidence at exactly the moment
   * somebody asked for it.
   */
  breakerArmed?: boolean;
}

export interface ThreadTask {
  id?: string;
  assignee?: string;
  status?: string;
}

/** A card that is genuinely work in progress. `todo` is not: an unstarted card
 *  has nothing in the thread yet, so it must not hold a stale one open. */
const IN_FLIGHT = new Set(['doing', 'blocked']);

const cardsFor = (tasks: ThreadTask[], agentId: string): ThreadTask[] =>
  tasks.filter((t) => t?.assignee === agentId);

/**
 * True when `agentId` just had a card signed off and has nothing else running.
 *
 * `prev` is the ledger as it was on the previous tick. Comparing against it is
 * what makes this fire exactly ONCE per card: on the next tick the card reads
 * `done` in both snapshots, so there is no transition left to see. It is also
 * why the caller must baseline (skip the first tick) — without a `prev` every
 * card that was already done at boot would look like it had just landed.
 */
export function shouldClearThread(
  agentId: string,
  tasks: ThreadTask[],
  prev: ThreadTask[],
  isGod = false,
  guards: ClearThreadGuards = {}
): boolean {
  // God orchestrates the floor from one continuous thread — the board, who is
  // on what, what the human last said. Clearing him is not a saving, it is
  // amnesia at the one desk that cannot afford it.
  if (isGod) return false;
  // Terminal-side reasons to wait. Checked before the ledger work because they
  // are the cheap reads, and because a `return false` here is not "this card
  // never clears" — the transition is still in `prev` on the next tick only if
  // the card moved on this one, so a card signed off while mail is waiting is
  // simply not cleared. Deliberate: a missed clear costs one long thread, a
  // wrong clear costs the work.
  if ((guards.actionableMail ?? 0) > 0) return false;
  if (guards.breakerArmed) return false;
  const before = new Map(prev.map((t) => [t?.id, t?.status] as const));
  const mine = cardsFor(tasks, agentId);
  const signedOff = mine.some((t) => t.status === 'done' && before.get(t.id) !== 'done');
  if (!signedOff) return false;
  // A second card still open means the thread is still the working context for
  // it. Wait for that one to be signed off too.
  return !mine.some((t) => IN_FLIGHT.has(t.status ?? ''));
}

/** Every agent whose thread this tick should clear. Assignees are read from the
 *  CURRENT ledger — an agent with no card left in it has nothing to transition. */
export function agentsToClearThread(
  tasks: ThreadTask[],
  prev: ThreadTask[],
  isGod: (agentId: string) => boolean = () => false,
  guardsFor: (agentId: string) => ClearThreadGuards = () => ({})
): string[] {
  const assignees = [...new Set(tasks.map((t) => t?.assignee).filter((a): a is string => !!a))];
  return assignees.filter((id) => shouldClearThread(id, tasks, prev, isGod(id), guardsFor(id)));
}
