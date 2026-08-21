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
