/**
 * Monitor — the arithmetic, kept out of the components (MD-90).
 *
 * Everything here is pure so it can be tested without a renderer (see
 * test/modern-monitor.test.cjs). The rules it encodes are the ones the pixel
 * Monitor earned the hard way and must not be regressed by a re-skin:
 *
 *   1. No budget set ⇒ NO meter. `capProgress` already returns null for that,
 *      and nothing in here invents a denominator to fill the gap — an agent
 *      with no cap is unbudgeted, not "0% of something".
 *   2. Cumulative spend and context-window headroom are two different facts
 *      (see the long note in src/shared/usageFormat.ts). They get two separate
 *      readings here and two separate columns in the table.
 *   3. A sparkline is only honest when the agent is actually burning tokens; a
 *      flat baseline is a mystery line, so `hasSpark` gates it.
 */
import type { AgentUsageSample, BreakerState } from '@/hooks/useTelemetry';
import type { ResolvedUsage } from '../../../../preload';
import { capProgress, type CapProgress } from '@shared/usageFormat';

/** Just the agent fields the Monitor reads — so a store change elsewhere in the
 *  app cannot silently break this module's tests. */
export interface MonitorAgent {
  id: string;
  name: string;
  status: string;
  isGod?: boolean;
  cwd: string;
  model?: string;
  contextTokens?: number;
  contextLimit?: number;
}

/** How loud the row should be. `warn` and `danger` map to the only two status
 *  colours DESIGN-MODERN.md allows past the neutrals. */
export type Tone = 'normal' | 'warn' | 'danger';

export interface FleetRow {
  agent: MonitorAgent;
  /** Cumulative billed tokens across every kind (input+output+both caches). */
  tokens: number;
  usd: number | null;
  /** Where the number came from — never hidden, so "no signal" ≠ "no spend". */
  source: ResolvedUsage['source'];
  /** tokens/min, live. */
  rate: number;
  spark: number[];
  hasSpark: boolean;
  lastTool?: string;
  toolCalls: number;
  /** null when no budget applies to this agent — render nothing, not an empty bar. */
  budget: CapProgress | null;
  /** The per-agent cap actually set by the user, if any (drives the editor). */
  agentCap?: number;
  /** Context window: a separate meter from `budget`, never merged with it. */
  context: { tokens: number; limit: number; pct: number; tone: Tone } | null;
  breaker?: BreakerState;
  /** constrained/stopped — the breaker has actually acted on this agent. */
  armed: boolean;
  tone: Tone;
}

export interface FleetInputs {
  agents: MonitorAgent[];
  samples: Record<string, AgentUsageSample>;
  usage: Record<string, ResolvedUsage>;
  spark: Record<string, number[]>;
  rate: Record<string, number>;
  lastTool: Record<string, string>;
  breakers: Record<string, BreakerState>;
  toolCounts: Record<string, number>;
  /** Floor-wide budget (config.costCapTokens). Undefined = no floor budget. */
  floorCap?: number;
  /** Per-agent ceilings (config.agentTokenCaps); wins over the floor. */
  agentCaps: Record<string, number>;
}

/** Total billed tokens on a live-telemetry sample. */
export function sampleTokens(s: AgentUsageSample | undefined): number {
  return s ? s.input + s.output + s.cacheRead + s.cacheCreation : 0;
}

/** ≥88% of the window is where compaction starts to loom; 75% is the warning. */
export function contextTone(pct: number): Tone {
  return pct >= 88 ? 'danger' : pct >= 75 ? 'warn' : 'normal';
}

/** Budget tone. An armed breaker outranks the percentage: the agent has already
 *  been acted on, so the row says danger even at 40%. */
export function budgetTone(budget: CapProgress | null, armed: boolean): Tone {
  if (armed) return 'danger';
  if (!budget) return 'normal';
  if (budget.over || budget.pct >= 90) return 'danger';
  return budget.pct >= 60 ? 'warn' : 'normal';
}

/**
 * One row per agent, merging the two usage ladders deliberately: the RESOLVED
 * usage (`usage:fleet`) is preferred because it answers for every engine, and
 * the OTel sample is the fallback that exists only for Claude. Reading only the
 * sample would print "no spend" for a codex agent that is spending.
 */
export function buildFleetRow(a: MonitorAgent, f: FleetInputs): FleetRow {
  const resolved = f.usage[a.id];
  const sample = f.samples[a.id];
  const fromSample = sampleTokens(sample);
  const tokens = resolved && resolved.source !== 'none' ? resolved.totalTokens : fromSample;
  const source: ResolvedUsage['source'] = resolved && resolved.source !== 'none'
    ? resolved.source
    : (sample ? 'otlp' : 'none');
  const usd = resolved && resolved.source !== 'none' ? resolved.usd : (sample ? sample.usd : null);

  const breaker = f.breakers[a.id];
  const armed = !!breaker && (breaker.level === 'constrained' || breaker.level === 'stopped');
  const agentCap = f.agentCaps[a.id];
  const budget = capProgress(tokens, agentCap, f.floorCap);
  const spark = f.spark[a.id] ?? [];

  const context = a.contextTokens !== undefined && a.contextLimit
    ? (() => {
        const pct = Math.min(100, Math.round((a.contextTokens! / a.contextLimit!) * 100));
        return { tokens: a.contextTokens!, limit: a.contextLimit!, pct, tone: contextTone(pct) };
      })()
    : null;

  return {
    agent: a,
    tokens,
    usd,
    source,
    rate: Math.round(f.rate[a.id] ?? 0),
    spark,
    hasSpark: spark.some((v) => v > 0),
    lastTool: f.lastTool[a.id],
    toolCalls: f.toolCounts[a.id] ?? 0,
    budget,
    agentCap: agentCap && agentCap > 0 ? agentCap : undefined,
    context,
    breaker,
    armed,
    tone: budgetTone(budget, armed)
  };
}

export interface FleetTotals {
  tokens: number;
  usd: number | null;
  /** Fresh + cached inputs, and the share of them served from cache. */
  inputs: number;
  cachePct: number;
  rate: number;
  /** How many agents contribute a real reading — the rest are "no signal". */
  measured: number;
  /** True when at least one row carries a cost we could not price. */
  unpriced: boolean;
}

export function fleetTotals(rows: FleetRow[], f: FleetInputs): FleetTotals {
  let tokens = 0, inputs = 0, cached = 0, rate = 0, measured = 0;
  let usd = 0, sawUsd = false, unpriced = false;
  for (const r of rows) {
    tokens += r.tokens;
    rate += r.rate;
    if (r.source !== 'none') measured++;
    if (r.usd !== null) { usd += r.usd; sawUsd = true; }
    else if (r.tokens > 0) unpriced = true;
    const s = f.samples[r.agent.id];
    if (s) {
      inputs += s.input + s.cacheRead + s.cacheCreation;
      cached += s.cacheRead;
    }
  }
  return {
    tokens,
    // A fleet total of $0 when nothing could be priced is the same lie
    // `formatUsd` refuses to tell for one agent.
    usd: sawUsd ? usd : null,
    inputs,
    cachePct: inputs > 0 ? Math.round((cached / inputs) * 100) : 0,
    rate: Math.round(rate),
    measured,
    unpriced
  };
}

/**
 * Sparkline as an SVG polyline in a 0..w × 0..h box, oldest→newest.
 * Returns '' for a series with nothing to say, so the caller renders nothing
 * rather than a flat line that reads as "idle" when it means "no data".
 */
export function sparkPoints(series: number[], w: number, h: number): string {
  if (series.length < 2) return '';
  const max = Math.max(...series);
  if (max <= 0) return '';
  const step = w / (series.length - 1);
  return series
    .map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(' ');
}
