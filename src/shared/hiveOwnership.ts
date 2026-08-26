/**
 * Who is allowed to write to a hive, and what "this agent is gone" actually means.
 *
 * MD-139. A second copy of the app was launched against a scratch profile whose
 * fresh config still pointed at the REAL harnessHome. Forty seconds later it ran
 * its boot sweep and archived Pam, Andy and Jim — because the sweep's rule was
 * "archived:false with no live PTY is a stale carry-over", and from inside a
 * process that had just started, NOBODY has a live PTY. The instance that
 * actually owned those terminals then read its own agents back as archived and
 * stopped hibernating them, so three agents sat awake forever.
 *
 * Two mistakes, and they are different in kind:
 *
 *   1. A boot-time sweep inferred global state from LOCAL state. "I have no PTY
 *      for this agent" only means "not mine" — it never meant "nobody's". The
 *      cure is ownership: exactly one instance may mutate a hive, and everyone
 *      else reads.
 *   2. Hibernation keyed on a persisted FLAG (`registry.archived`) instead of on
 *      the fact the flag was trying to describe. A flag can be wrong — another
 *      process wrote it, a crash left it stale — but a live PTY mapped to the
 *      agent is not an opinion. Prefer the fact.
 *
 * Pure on purpose: the fs-and-pid half lives in `main/instanceLock.ts`, and
 * these are the decisions, so they can be tested without a second app.
 */

/** The subset of a registry entry these decisions read. */
export interface OwnershipAgent {
  archived?: boolean;
  isGod?: boolean;
}

export interface OrphanSweepInput {
  /** id → registry entry. */
  agents: Record<string, OwnershipAgent>;
  /** The orchestrator is never archived. */
  godId?: string | null;
  /** Does THIS instance hold a live PTY for the agent? */
  hasLivePty: (id: string) => boolean;
  /** Does this instance own the hive? A reader must never archive anything. */
  isOwner: boolean;
}

/**
 * Which agents this boot may archive as stale carry-overs.
 *
 * Returns nothing at all when we do not own the hive — that is the whole fix.
 * The sweep is only sound for an instance that is the sole writer, because only
 * then does "no live PTY here" mean "no live PTY anywhere".
 */
export function orphansToArchive(input: OrphanSweepInput): string[] {
  if (!input.isOwner) return [];
  const out: string[] = [];
  for (const [id, a] of Object.entries(input.agents)) {
    if (a.archived) continue;              // already archived — nothing to do
    if (id === input.godId) continue;      // god is never archived
    if (input.hasLivePty(id)) continue;    // genuinely active in THIS instance
    out.push(id);
  }
  return out;
}

/**
 * May this agent be put to sleep?
 *
 * The caller has already found a live PTY mapped to the agent, and that is the
 * point: a running terminal is proof of life, so a stale `archived: true` (which
 * is exactly what MD-139 wrote into three live agents) must not veto it. The
 * flag is a record of a past event; the PTY is the present tense.
 */
export function hibernateEligible(agent: OwnershipAgent | undefined, hasLivePty: boolean): boolean {
  if (!agent) return false;   // not a hive agent — a plain terminal
  return hasLivePty;
}

/**
 * Background work that WRITES to the shared hive — the outbox router, the boot
 * sweep, the hibernate reaper, the PR watcher's routing of findings into
 * inboxes. A second instance must run none of it, or two processes fight over
 * the same registry, the same inboxes and the same worktrees.
 *
 * Reading stays open to everyone: a non-owner window still shows the floor.
 */
export function mayMutateHive(isOwner: boolean): boolean {
  return isOwner;
}

/**
 * What a read-only window has to say after the headline, so "why is nothing
 * happening?" is answered AND actionable in the same breath.
 *
 * Here rather than in a component because both front-ends draw this banner and
 * only the skin differs. Two copies of a sentence about ownership is how the
 * two windows end up telling a user two different things about the same lock.
 */
export const OWNERSHIP_BANNER_HINT =
  'Agents here keep running, but this window does not orchestrate them — close the other '
  + 'instance and reopen this workspace to take over.';

/** The banner a non-owning window shows, so "why is nothing happening?" has a
 *  visible answer rather than being diagnosed from a log days later. */
export function ownershipBanner(heldByPid: number | null): string {
  return heldByPid
    ? `Another Office instance (pid ${heldByPid}) owns this workspace — this window is read-only.`
    : 'Another Office instance owns this workspace — this window is read-only.';
}
