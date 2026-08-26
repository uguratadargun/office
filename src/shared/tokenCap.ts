/**
 * PER-AGENT TOKEN BUDGETS — the `agentTokenCaps` map the breaker enforces.
 *
 * The map itself is old (the breaker reads it, the Command Center card edits
 * it); what moved here is the arithmetic every WRITER has to get right, so a
 * second Add-Agent form cannot invent a third reading of "what does an empty
 * field mean" (MD-151).
 *
 * Nothing here touches the breaker: this decides the NUMBER, and the caller
 * persists it through `updateConfig`.
 */

/**
 * The cap to store for a newly hired agent.
 *
 * The typed field WINS over a manifest's `tokenCap` — the human just looked at
 * it — but only when it is a real, positive number. An empty field is not a cap
 * of zero (which would strangle the agent on its first turn); it means "no cap
 * typed", so a manifest's value stands and, failing that, no entry is written
 * at all.
 */
export function resolveTokenCap(typed: string, fromManifest?: number): number | undefined {
  const digits = Number(typed.replace(/[^0-9]/g, ''));
  if (Number.isFinite(digits) && digits > 0) return digits;
  if (fromManifest && fromManifest > 0) return fromManifest;
  return undefined;
}

/** The `agentTokenCaps` patch for one agent, merged onto what config already
 *  holds — an update must never be a replacement, or hiring one agent would
 *  uncap every other. */
export function withAgentCap(
  caps: Record<string, number> | undefined,
  agentId: string,
  cap: number
): Record<string, number> {
  return { ...(caps ?? {}), [agentId]: cap };
}

/** "2,000,000" — a budget is long enough that unseparated digits are a hazard
 *  when you are checking what you typed. */
export function formatTokenCap(cap: number): string {
  return cap.toLocaleString('en-US');
}
