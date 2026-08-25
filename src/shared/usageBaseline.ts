/**
 * "This conversation" vs "everything this agent has ever spent".
 *
 * Both usage rungs (OTLP's live sessions, and the transcript/db readers) sum
 * EVERY session an agent has ever had — that is what makes them the right input
 * for the cost ledger and the budget meters, and exactly what makes them wrong
 * on a card the user reads right after a `/clear`: the thread is empty and the
 * readout still says $4.10. So we keep the lifetime counters and subtract a
 * baseline snapshotted the moment a new thread started.
 *
 * Pure on purpose — the snapshotting lives in hive.ts (beside the session id it
 * is taken with) and the reading lives in agentUsage.ts.
 */

/** Lifetime counters as of the instant a thread began. `usd` may be null when
 *  the model had no price row — an unpriced baseline cannot be subtracted, so
 *  it degrades to "show the lifetime cost" rather than to a wrong number. */
export interface UsageBaseline {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  usd: number | null;
}

export interface UsageDelta extends UsageBaseline {
  totalTokens: number;
}

const TOKEN_FIELDS = [
  'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'
] as const;

function totals(u: UsageBaseline): UsageDelta {
  return { ...u, totalTokens: TOKEN_FIELDS.reduce((n, f) => n + (u[f] || 0), 0) };
}

/**
 * Lifetime minus baseline, or lifetime when there is nothing trustworthy to
 * subtract.
 *
 * The negative guard is the whole reason this is a function and not a `-`. The
 * lifetime series is not monotonic across an app restart: OTLP only knows the
 * sessions it has seen since boot, so an agent baselined against a 4M-token
 * transcript read can come back reporting 12k live tokens. Subtracting there
 * would print a negative spend, which is worse than the stale number it fixes.
 * A lifetime below its own baseline means the counters restarted, so the
 * baseline is meaningless and the lifetime IS the thread.
 */
export function usageSinceBaseline(
  lifetime: UsageBaseline,
  baseline: UsageBaseline | null | undefined
): UsageDelta {
  if (!baseline) return totals(lifetime);
  if (TOKEN_FIELDS.some((f) => (lifetime[f] || 0) < (baseline[f] || 0))) return totals(lifetime);
  const out: UsageBaseline = {
    inputTokens: lifetime.inputTokens - baseline.inputTokens,
    outputTokens: lifetime.outputTokens - baseline.outputTokens,
    cacheReadTokens: lifetime.cacheReadTokens - baseline.cacheReadTokens,
    cacheWriteTokens: lifetime.cacheWriteTokens - baseline.cacheWriteTokens,
    // An unpriced side on either end leaves the lifetime cost standing: a
    // subtraction with a hole in it is a guess, and this file's job is to not
    // guess about money.
    usd: lifetime.usd === null || baseline.usd === null
      ? lifetime.usd
      : Number(Math.max(0, lifetime.usd - baseline.usd).toFixed(4))
  };
  return totals(out);
}

/** The snapshot to store when a thread starts. Narrows any usage-shaped row to
 *  just the fields the subtraction needs, so a registry entry stays small. */
export function usageBaselineOf(u: UsageBaseline): UsageBaseline {
  return {
    inputTokens: u.inputTokens, outputTokens: u.outputTokens,
    cacheReadTokens: u.cacheReadTokens, cacheWriteTokens: u.cacheWriteTokens,
    usd: u.usd
  };
}
