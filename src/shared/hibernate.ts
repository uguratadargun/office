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

/**
 * The orchestrator's own idle window, deliberately LONGER than a worker's.
 *
 * Sleeping a worker costs one respawn. Sleeping the orchestrator parks the agent
 * every other agent reports to, so the bar for "clearly finished" has to be
 * higher — and unlike a worker it has no card of its own to prove it is idle. 30
 * minutes is long enough that a floor between two pieces of work does not park
 * its boss, and short enough that a night is spent asleep rather than answering
 * its own timers.
 */
export const DEFAULT_GOD_IDLE_HIBERNATE_MINUTES = 30;

export interface HibernateCandidate {
  id: string;
  /** God orchestrates the floor and answers on a different set of conditions —
   *  `shouldHibernate` always says no for him; `shouldHibernateGod` decides. */
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
 * The orchestrator's idle window in ms.
 *
 * Its OWN setting, not a multiple of the worker one: an operator who wants
 * workers parked aggressively at 2 minutes almost never wants their boss parked
 * at 2 minutes, and the reverse (workers awake, boss asleep) is a legitimate
 * choice too. Absent → the 30-minute default. 0 = never sleep the orchestrator,
 * which is the pre-MD-165 behaviour and stays available as a real off switch.
 */
export function godIdleHibernateMs(minutes: number | undefined): number {
  const m = minutes ?? DEFAULT_GOD_IDLE_HIBERNATE_MINUTES;
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
  if (a.isGod) return false; // → shouldHibernateGod, which asks a harder question
  if (a.activeCards > 0) return false;
  if (a.inboxCount > 0) return false;
  if (a.breakerArmed) return false;
  return now - a.lastActivityAt >= idleMs;
}

/** What the orchestrator needs to be true before it can be parked. */
export interface GodHibernateCandidate {
  /** Cards in tasks.json assigned to the orchestrator with status doing|blocked. */
  activeCards: number;
  /**
   * Unread mail that would WAKE it — see `@shared/actionableMail`. NOT the raw
   * inbox depth `HibernateCandidate` uses: the orchestrator's inbox always holds
   * scheduler beats, so a raw count is never 0 and the gate would never open.
   */
  wakingMail: number;
  /**
   * Non-god sessions still alive: worker agents AND ephemeral Slack/webhook
   * workers. One awake worker is one agent that may report at any moment, and
   * the orchestrator has to be there to receive it.
   */
  awakeWorkers: number;
  /** Epoch ms of the most recent terminal byte, out OR in. */
  lastActivityAt: number;
  /** The circuit breaker holds a level for it — mid-incident, keep it up. */
  breakerArmed: boolean;
}

/**
 * True when the orchestrator can be parked right now.
 *
 * Every clause is a reason to STAY awake, same as the worker rule. The one that
 * carries this card is `awakeWorkers`: with the whole floor asleep there is
 * nobody left who can generate work, so the only thing still writing to the
 * orchestrator's terminal is the harness's own timers — and each of those costs a
 * full-context turn on the single largest context in the hive.
 *
 * `idleMs` of 0 turns it off, which is the pre-MD-165 behaviour and the real
 * off switch for an operator who wants the boss up no matter what.
 */
export function shouldHibernateGod(g: GodHibernateCandidate, now: number, idleMs: number): boolean {
  if (idleMs <= 0) return false;
  if (g.awakeWorkers > 0) return false;
  if (g.activeCards > 0) return false;
  if (g.wakingMail > 0) return false;
  if (g.breakerArmed) return false;
  return now - g.lastActivityAt >= idleMs;
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
