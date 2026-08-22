// Who brings the boss a cup of tea, and when.
//
// The charm only works if it stays rare: roughly one tea run per agent per
// 5–15 minutes of IDLE time, and never two couriers at once. That is the whole
// policy, and it is pure — the scene owns the walking, this owns the clock.
//
// The countdown measures idle time, not wall clock: an agent that spends an
// hour working is not "due" the moment it finishes, it still owes its idle
// minutes. That is why `tick` takes an eligibility flag per agent instead of a
// list of ids — frozen agents keep their remaining time, absent ones are
// forgotten (no per-agent bookkeeping to clean up when a tab closes).

export const TEA_MIN_SECONDS = 300;   // 5 min of idle
export const TEA_MAX_SECONDS = 900;   // …to 15

export interface TeaSchedule {
  /** id → seconds of idle still owed before that agent's next tea run. */
  due: Record<string, number>;
  /** The one agent currently carrying a cup, or null. */
  busy: string | null;
}

/** An agent as the director sees it this frame. */
export interface TeaCandidate {
  id: string;
  /** Idle, on its feet, not already on a break/errand/coffee run. */
  eligible: boolean;
}

export const newTeaSchedule = (): TeaSchedule => ({ due: {}, busy: null });

/** Randomised gap so the floor never falls into a rhythm. */
export const teaGap = (rand: () => number = Math.random): number =>
  TEA_MIN_SECONDS + rand() * (TEA_MAX_SECONDS - TEA_MIN_SECONDS);

/**
 * Advance the schedule by `dt` seconds and return the id of an agent that
 * should set off with a cup right now, or null. Mutates `s`.
 *
 * `gap` supplies the next countdown (injected so tests are deterministic).
 */
export function tickTea(
  s: TeaSchedule,
  dt: number,
  agents: readonly TeaCandidate[],
  gap: () => number = teaGap,
): string | null {
  const due: Record<string, number> = {};
  let courier: string | null = null;
  for (const a of agents) {
    const left = s.due[a.id] ?? gap();
    if (!a.eligible) { due[a.id] = left; continue; }   // frozen while busy
    if (left - dt > 0 || s.busy !== null || courier) { due[a.id] = left - dt; continue; }
    courier = a.id;
    due[a.id] = gap();                                  // owes another 5–15 min
  }
  s.due = due;                                          // agents that left are forgotten
  if (courier) s.busy = courier;
  return courier;
}

/** The cup is delivered (or the run was cancelled) — the floor is free again. */
export function endTea(s: TeaSchedule, id: string): void {
  if (s.busy === id) s.busy = null;
}
