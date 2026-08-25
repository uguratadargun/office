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
  isGod = false
): boolean {
  // God orchestrates the floor from one continuous thread — the board, who is
  // on what, what the human last said. Clearing him is not a saving, it is
  // amnesia at the one desk that cannot afford it.
  if (isGod) return false;
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
  isGod: (agentId: string) => boolean = () => false
): string[] {
  const assignees = [...new Set(tasks.map((t) => t?.assignee).filter((a): a is string => !!a))];
  return assignees.filter((id) => shouldClearThread(id, tasks, prev, isGod(id)));
}
