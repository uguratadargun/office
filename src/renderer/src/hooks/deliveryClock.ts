/**
 * THE DRAIN'S TWO CLOCKS, readable from outside the drain.
 *
 * `useHive`'s flush loop holds two per-agent timestamps: when it last typed
 * into an agent (the one-at-a-time cooldown) and how long that agent's boot
 * sequence still owns its prompt. Both hold a queued message, and both were
 * invisible: the composers polled the terminal block and the floor-wide pause
 * and reported "sending…" while one of these was quietly holding for seconds
 * (MD-155).
 *
 * These maps ARE the drain's state, not a copy of it — `useHive` initialises
 * its refs from them, so a reader here sees exactly what the gate reads. That
 * is deliberate: a mirrored copy is a second source of truth that drifts, and
 * the whole point is telling the operator something TRUE about why nothing is
 * moving. Nothing here writes; the drain remains the only writer.
 */

/** Per-agent timestamp of the last queued message typed in. */
export const lastFlushAt: Record<string, number> = {};

/** Per-agent timestamp until which auto-typers must leave the agent alone. */
export const bootGraceUntilAt: Record<string, number> = {};

/** One message per cooldown keeps delivery strictly one-by-one. The drain owns
 *  this number; it lives here so a label can say when the hold lifts. */
export const FLUSH_COOLDOWN_MS = 4500;

/** Milliseconds until this agent is off cooldown; 0 when it already is. */
export function cooldownMsLeft(agentId: string, now: number): number {
  const last = lastFlushAt[agentId] ?? 0;
  return Math.max(0, FLUSH_COOLDOWN_MS - (now - last));
}

/** Milliseconds until this agent's boot grace expires; 0 when it has. */
export function bootGraceMsLeft(agentId: string, now: number): number {
  return Math.max(0, (bootGraceUntilAt[agentId] ?? 0) - now);
}
