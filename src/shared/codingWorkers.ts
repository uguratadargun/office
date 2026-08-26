/**
 * MD-132 — how many agents the orchestrator may have WRITING CODE at once.
 *
 * A POLICY, not an enforcement, and the distinction is the whole design.
 * `maxConcurrentWorkers` is a resource backstop main applies itself by holding
 * spawn-requests in a queue. This one cannot work that way: "is this agent
 * coding" is a judgement about the WORK, not something main can read off a PTY.
 * So nothing here blocks anything. The number is published to god twice — in
 * the roster line injected into its turns, and in `fleet.json` on disk — and
 * god does the rationing.
 *
 * Said plainly so nobody later mistakes it for a limiter and wires a silent
 * block onto it: exceeding this number is possible, and when it happens it is
 * the orchestrator ignoring the policy, not the app failing to stop it. The
 * settings help text says the same thing to the human, for the same reason.
 *
 * Lives in `shared/` because main writes it, both UIs edit it and the tests
 * read it — one source, or the placeholder in a settings box and the number god
 * is told drift apart.
 */

export const DEFAULT_MAX_CODING_WORKERS = 3;
/** Below one is "nobody may code", which nobody means to set. */
export const MIN_MAX_CODING_WORKERS = 1;
/** Past eight the machine is the real limit, not the setting. */
export const MAX_MAX_CODING_WORKERS = 8;

/**
 * The effective policy, always a usable integer.
 *
 * CLAMPS rather than rejects: this is read on the way OUT to god's roster line,
 * and refusing an out-of-range value there would mean injecting no policy at
 * all — so a typo in a settings box would silently REMOVE the cap instead of
 * bending it. Absent or unreadable falls back to the default for the same
 * reason.
 */
export function maxCodingWorkers(cfg: { maxCodingWorkers?: number } | null | undefined): number {
  const raw = cfg?.maxCodingWorkers;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_MAX_CODING_WORKERS;
  return Math.min(MAX_MAX_CODING_WORKERS, Math.max(MIN_MAX_CODING_WORKERS, Math.round(raw)));
}
