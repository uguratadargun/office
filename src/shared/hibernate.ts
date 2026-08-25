/**
 * When an idle agent may be put to sleep.
 *
 * Six idle sessions cost ~3 GB of RAM doing nothing, so a worker that has been
 * quiet long enough is shut down and respawned when work arrives. The whole
 * risk of that trade is hibernating an agent that was NOT actually finished —
 * so every guard below is a reason to keep a session alive, and the function
 * only ever returns true when all of them agree there is nothing in flight.
 *
 * Idle is measured from terminal activity, never wall clock: an agent that has
 * been printing for an hour is busy, not old.
 */

export const DEFAULT_IDLE_HIBERNATE_MINUTES = 10;

export interface HibernateCandidate {
  id: string;
  /** God orchestrates the floor; sleeping him would stop the hive. Never true. */
  isGod?: boolean;
  /** Cards in tasks.json assigned to this agent with status doing|blocked. */
  activeCards: number;
  /** Undrained files in the agent's inbox. */
  inboxCount: number;
  /** Epoch ms of the most recent terminal byte, out OR in. */
  lastActivityAt: number;
  /** The circuit breaker holds a level for this agent — it is mid-incident. */
  breakerArmed: boolean;
}

/** Config minutes → the idle window in ms. 0 (or absent/negative) = feature off. */
export function idleHibernateMs(minutes: number | undefined): number {
  const m = minutes ?? DEFAULT_IDLE_HIBERNATE_MINUTES;
  return m > 0 ? m * 60_000 : 0;
}

/**
 * True when this agent can be put to sleep right now.
 *
 * `idleMs` of 0 turns the feature off entirely, which is what makes the setting
 * a real off switch rather than a very large number.
 */
export function shouldHibernate(a: HibernateCandidate, now: number, idleMs: number): boolean {
  if (idleMs <= 0) return false;
  if (a.isGod) return false;
  if (a.activeCards > 0) return false;
  if (a.inboxCount > 0) return false;
  if (a.breakerArmed) return false;
  return now - a.lastActivityAt >= idleMs;
}

/**
 * True when an agent still has a terminal surface worth opening.
 *
 * Hibernation clears `ptyId` (the card stays on the team; only the process is
 * gone), so `!ptyId` STOPPED meaning "not a real agent" the moment sleeping
 * existed. Every view that used that test as its filter silently dropped
 * sleeping agents — the fullscreen view closed itself when the agent it was
 * showing fell asleep, and its toggle could not target one at all. One
 * predicate, so the docked and fullscreen views cannot diverge again.
 */
export function hasTerminalSurface(a: { ptyId?: string; sleeping?: boolean }): boolean {
  return !!a.ptyId || !!a.sleeping;
}
