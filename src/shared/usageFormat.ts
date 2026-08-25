/**
 * How a usage reading is written down.
 *
 * The whole point of the per-provider usage work is that "$0" and "we cannot
 * see" are different facts, so the formatting is where that distinction either
 * survives or quietly dies. Three outcomes, three strings, no overlap:
 *
 *   source 'none'          → "unknown"      we have no signal at all
 *   usd === null, tokens   → "$? unpriced"  tokens are real, the model has no price row
 *   usd is a number        → "$1.23"        measured, including a true $0.00
 *
 * A real $0.00 only ever appears on the third branch, where it means the spend
 * really was zero — never as a stand-in for either of the first two.
 */

export interface UsageLike {
  totalTokens: number;
  usd: number | null;
  source: 'otlp' | 'transcript' | 'sqlite' | 'none';
}

/** Compact token count: 812, 36k, 1.4M. Whole thousands stay whole (36k, not
 *  36.0k) because the extra digit is noise at that scale. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)}k`;
  }
  const m = n / 1_000_000;
  return `${m < 10 ? m.toFixed(1).replace(/\.0$/, '') : Math.round(m)}M`;
}

/** Cost, or the honest reason there isn't one. Sub-cent spend reads "<$0.01"
 *  rather than "$0.00", which would look like the very zero this avoids. */
export function formatUsd(u: UsageLike): string {
  if (u.source === 'none') return 'unknown';
  if (u.usd === null) return '$? unpriced';
  if (u.usd === 0) return '$0.00';
  if (u.usd < 0.01) return '<$0.01';
  return `$${u.usd.toFixed(2)}`;
}

/** Where the number came from, in the words a user can act on. */
export const USAGE_SOURCE_LABEL: Record<UsageLike['source'], string> = {
  otlp: 'live telemetry',
  transcript: 'transcript on disk',
  sqlite: 'engine database',
  none: 'no signal'
};

/** Long-form for a tooltip: what we know and how we know it. */
export function usageSourceNote(u: UsageLike): string {
  switch (u.source) {
    case 'otlp': return 'Live telemetry from the running agent.';
    case 'transcript': return 'Read from the transcript this engine writes to disk. Updates as it works.';
    case 'sqlite': return "Read from this engine's own database. Updates as it works.";
    case 'none': return 'No usage signal on this machine for this engine — unknown, not zero. The agent may well be working.';
  }
}

export interface CapProgress {
  /** 0..1, clamped. 1 means at or over the cap. */
  fraction: number;
  pct: number;
  over: boolean;
  /** The cap actually applied, after the per-agent override and the floor fallback. */
  cap: number;
  label: string;
}

/**
 * Cap progress for one agent. The per-agent cap wins over the floor budget —
 * that is what `agentTokenCaps` means — and a floor with no budget set has no
 * meter to show at all rather than a made-up denominator.
 */
export function capProgress(
  used: number,
  agentCap: number | undefined,
  floorCap: number | undefined
): CapProgress | null {
  const cap = agentCap && agentCap > 0 ? agentCap : (floorCap && floorCap > 0 ? floorCap : 0);
  if (cap <= 0) return null;
  const fraction = Math.min(1, Math.max(0, used / cap));
  return {
    fraction,
    pct: Math.round(fraction * 100),
    over: used >= cap,
    cap,
    label: `${formatTokens(used)} / ${formatTokens(cap)}`
  };
}

/**
 * A cumulative token number and a context-window number are different facts,
 * and on a card they end up two rows apart. Andy's card read "context 75k" with
 * "1.2M" next to it and the honest reading of that pair is "the context
 * calculation is broken" — it was not. Both numbers were exact: the thread had
 * really billed 1,270,846 tokens across 21 requests whose window never exceeded
 * 83,382, because 93% of the bill is CACHE READS — the same window re-sent on
 * every single turn.
 *
 * So the fix is not arithmetic, it is that a bare number must never be printed
 * beside a context gauge. Everything below exists so that one word and one
 * wording are shared by every place that prints the cumulative figure.
 */

/** The word that always precedes a cumulative token count. */
export const TOKENS_BILLED_LABEL = 'billed';

/** One wording for what the cumulative number is — every call site, because
 *  two tooltips drift and then disagree in front of the user. */
export const TOKENS_BILLED_TIP =
  'sum of input+output+cache over every request this thread; context is the gauge';

export interface BilledTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

/**
 * The chip text for a roster card. Never a bare number: the label is part of
 * the value, so no caller can accidentally render the figure on its own.
 */
export function billedChipText(totalTokens: number): string {
  return `${TOKENS_BILLED_LABEL} ${formatTokens(totalTokens)}`;
}

/**
 * Why "billed" dwarfs the context gauge, in the words that answer the question
 * actually being asked. Names the cache share, because that IS the whole gap.
 */
export function billedVsContextNote(t: BilledTotals, contextTokens?: number | null): string {
  const cached = t.cacheReadTokens + t.cacheWriteTokens;
  const share = t.totalTokens > 0 ? Math.round((cached / t.totalTokens) * 100) : 0;
  const head = `BILLED ${formatTokens(t.totalTokens)} — ${TOKENS_BILLED_TIP}.`;
  const why = cached > 0 && share > 0
    ? ` ${share}% of it is cache: every turn re-sends the whole conversation, so the window is billed again on each request.`
    : '';
  const ctx = typeof contextTokens === 'number' && contextTokens > 0
    ? ` The context window itself is ${formatTokens(contextTokens)} right now — this is not that number.`
    : ' This is not the context window.';
  return head + why + ctx;
}
