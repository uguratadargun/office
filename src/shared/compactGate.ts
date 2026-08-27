/**
 * Should the cadenced `/compact` fire at all?
 *
 * The cadence is a bare timer: it fires every `everyMs` whether or not anyone on
 * the floor did anything since the last one. On a quiet floor that is pure waste,
 * and not the harmless kind — the compaction lands in the ORCHESTRATOR's terminal
 * too, and the orchestrator is the one agent that never sleeps, so an overnight of
 * empty cadences is an overnight of full-context turns spent compacting a context
 * that nothing added to.
 *
 * The predicate is therefore "did anyone OTHER than the orchestrator move since the
 * last compaction?". The orchestrator is excluded on purpose: its own context grows
 * from scheduled mail it sends itself (the hourly standup), so counting it would
 * make the gate self-satisfying — the very loop this is meant to break.
 *
 * Pure and node-testable; the main process supplies the mtimes.
 */

/** One agent's activity, as main can observe it without asking the renderer. */
export interface CompactActivityRow {
  id: string;
  /** True for the orchestrator (god). Its own movement never opens the gate. */
  isGod: boolean;
  /**
   * Newest coordination-file mtime — inbox, inbox/.done, outbox, outbox/.sent,
   * memory.md. FILES ONLY, deliberately: PTY output is not a signal here, however
   * tempting, because the compaction we just sent PRODUCES PTY output. Counting it
   * would make every compaction manufacture the activity that justifies the next
   * one — a self-feeding loop with a real CLI, which answers a redundant `/compact`
   * with "not enough messages to compact" and prints that too.
   *
   * The cost of the narrower signal is honest and bounded: an agent grinding on one
   * long task without touching mail or memory is not compacted until the floor
   * coordinates again. Deferred, never skipped — the next real message opens the
   * gate and the pressure bar then decides. And on an install with no hive open at
   * all there are no rows, which fails open to the old unconditional behaviour.
   */
  lastCoordinationAt: number;
}

/**
 * Has any non-orchestrator agent moved since `since`?
 *
 * PARKED AGENTS COUNT, deliberately. A hibernated agent that coordinated ten
 * minutes before it went to sleep is real activity, and the alternative is worse:
 * overnight, every worker hibernates, so filtering parked agents out would leave
 * the orchestrator alone on the floor — read as "no reading", fail open, and the
 * gate would be disabled in exactly the situation it exists for.
 *
 * FAILS OPEN only when there is no non-god row at ALL: a hive that is not open
 * yet, or a registry that failed to parse. "We cannot see anyone" must not be read
 * as "nobody is there" — the same fail-open choice the context-pressure gate makes
 * for agents that report no telemetry.
 */
export function hasNonGodActivitySince(rows: CompactActivityRow[], since: number): boolean {
  const floor = rows.filter((r) => !r.isGod);
  if (floor.length === 0) return true;
  return floor.some((r) => (r.lastCoordinationAt ?? 0) > since);
}

/** One line for the main-process log when the cadence is skipped, so a quiet
 *  night reads as a decision in the log rather than as a missing timer. */
export function compactSkipLog(rows: CompactActivityRow[], since: number): string {
  const floor = rows.filter((r) => !r.isGod);
  const mins = Math.max(0, Math.round((Date.now() - since) / 60_000));
  return `[triggers] compact skipped — no non-god activity in ${mins}m `
    + `across ${floor.length} agent(s) on the floor`;
}
