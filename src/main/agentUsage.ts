/**
 * One ladder for "what has this agent spent", instead of three.
 *
 * The rungs — live OTLP first, then whatever that engine wrote to disk, then
 * nothing — were open-coded in `writeFleetSnapshot` and again in
 * `hive:agentDirectory`, and the second copy stopped at the first rung: no OTLP
 * meant `tokens: 0, usd: 0`. Since OTLP only ever arrives for Claude, every
 * codex / gemini / opencode agent read to the voice layer as an agent that had
 * never done anything, and a Claude agent read that way until its first export.
 * A third copy was about to be written for the usage readout, which is what
 * made this file worth having.
 *
 * The contract is providerUsage.ts's, unchanged: **no signal means null, never
 * zero.** `source` says which rung answered so the UI can distinguish "nothing
 * to report" from "reported nothing".
 */
import { readAgentCacheDays, readAgentUsage } from './transcript';
import type { CacheDay } from '../shared/cacheMiss';
import { readProviderUsage } from './providerUsage';
import { usageSinceBaseline, type UsageBaseline } from '../shared/usageBaseline';

/** Which rung produced the numbers. 'none' is UNKNOWN — not idle, not free. */
export type UsageSource = 'otlp' | 'transcript' | 'sqlite' | 'none';

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Sum of the four. What the cap meter measures. */
  totalTokens: number;
  /** null = we could not price it. NEVER 0 — a zero is indistinguishable from a
   *  free model and from a broken parser. */
  usd: number | null;
  source: UsageSource;
}

export interface ResolvedUsage extends UsageTotals {
  /**
   * The same numbers counted from the START OF THE CURRENT THREAD, i.e. lifetime
   * minus the baseline snapshotted when the agent last got a fresh conversation.
   *
   * The top-level fields stay LIFETIME and remain what the cap meter, the cost
   * ledger, the breaker and analytics read — real spend does not un-happen when
   * a thread is cleared. This field exists because the person looking at a card
   * after a `/clear` is asking a different question.
   */
  thread: UsageTotals;
  model: string | null;
  /** Epoch ms of the newest activity we can see, or null. */
  lastActivityMs: number | null;
  /**
   * MD-177 — prompt-cache write/read split per LOCAL day, newest first, capped
   * at `CACHE_DAYS_KEPT`.
   *
   * Deliberately NOT part of the ladder above. The ladder answers "which rung
   * could see this agent at all", and OTLP wins it — but OTLP reports a running
   * TOTAL, so it cannot say which day a cache write happened on. The day split
   * only ever comes from the transcript, and it is read alongside the ladder
   * rather than instead of it. Empty means "not asked for, or nothing on disk";
   * `cacheMissPct` turns an empty day into null, never 0.
   */
  cacheDays: CacheDay[];
}

/** The live-telemetry sample shape (telemetry.ts's AgentUsageSample). */
export interface OtlpSample {
  ts: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  model: string;
  usd: number;
}

/** What a disk reader returns — transcript.ts's AgentUsage and
 *  providerUsage.ts's ProviderUsage, which differ only in cost nullability. */
export interface DiskUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number | null;
  model?: string;
  lastActivityMs: number;
}

const NO_TOTALS: UsageTotals = {
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
  totalTokens: 0, usd: null, source: 'none'
};

export const NO_USAGE: ResolvedUsage = {
  ...NO_TOTALS, thread: NO_TOTALS, model: null, lastActivityMs: null, cacheDays: []
};

/** Attach the "since this thread started" view to a lifetime reading. Separate
 *  from resolveUsage so the ladder above stays about WHICH RUNG answered and
 *  this stays about WHICH SPAN is being asked for. */
export function withThread(u: ResolvedUsage, baseline: UsageBaseline | null | undefined): ResolvedUsage {
  if (u.source === 'none') return u; // nothing to subtract from; unknown stays unknown
  return { ...u, thread: { ...usageSinceBaseline(u, baseline), source: u.source } };
}

/**
 * OpenCode is the only engine whose on-disk signal is a database rather than a
 * transcript, and the readout says so — "sqlite" vs "transcript" is the
 * difference between "I read its ledger" and "I parsed its logs", which is worth
 * knowing when a number looks wrong.
 */
export function diskSourceFor(provider: string): UsageSource {
  return provider === 'opencode' ? 'sqlite' : 'transcript';
}

/** Fold whichever rung answered into one row. Pure — the reads happen above it. */
export function resolveUsage(
  sample: OtlpSample | undefined,
  disk: DiskUsage | null,
  provider: string
): ResolvedUsage {
  if (sample) {
    const total = sample.input + sample.output + sample.cacheRead + sample.cacheCreation;
    return {
      inputTokens: sample.input,
      outputTokens: sample.output,
      cacheReadTokens: sample.cacheRead,
      cacheWriteTokens: sample.cacheCreation,
      totalTokens: total,
      usd: typeof sample.usd === 'number' ? Number(sample.usd.toFixed(4)) : null,
      source: 'otlp',
      thread: NO_TOTALS, // replaced by withThread(); lifetime is the honest default
      model: sample.model || null,
      lastActivityMs: sample.ts || null,
      cacheDays: [] // attached by withCacheDays(); this function stays pure
    };
  }
  if (!disk) return NO_USAGE;
  const total = disk.inputTokens + disk.outputTokens + disk.cacheReadTokens + disk.cacheWriteTokens;
  // A disk read that found the files but no usage in them is still a real
  // reading of zero — the files exist, the agent has simply not spent yet. What
  // must never happen is calling a MISSING signal zero, and that is the branch
  // above: no disk read at all → NO_USAGE → source 'none' → the UI says unknown.
  return {
    inputTokens: disk.inputTokens,
    outputTokens: disk.outputTokens,
    cacheReadTokens: disk.cacheReadTokens,
    cacheWriteTokens: disk.cacheWriteTokens,
    totalTokens: total,
    usd: typeof disk.estimatedCostUsd === 'number' ? Number(disk.estimatedCostUsd.toFixed(4)) : null,
    source: diskSourceFor(provider),
    thread: NO_TOTALS, // replaced by withThread(); lifetime is the honest default
    model: disk.model ?? null,
    lastActivityMs: disk.lastActivityMs || null,
    cacheDays: [] // attached by withCacheDays(); this function stays pure
  };
}

/** Attach the per-day cache split. Separate from `resolveUsage` for the same
 *  reason `withThread` is: that function is about WHICH RUNG answered, this is
 *  about a fact only one source can ever supply. */
export function withCacheDays(u: ResolvedUsage, days: readonly CacheDay[]): ResolvedUsage {
  return days.length ? { ...u, cacheDays: [...days] } : u;
}

/** The on-disk rung. Claude has its transcript; everyone else has providerUsage
 *  (which returns null for the engines nothing can be read from). */
export function readDiskUsage(provider: string, cwd: string | undefined): DiskUsage | null {
  if (!cwd) return null;
  try {
    return provider === 'claude' ? readAgentUsage(cwd) : readProviderUsage(provider, cwd);
  } catch {
    return null; // a broken reader reports unknown, it does not crash the poll
  }
}

/** Both rungs, for one agent. */
export function agentUsage(
  sample: OtlpSample | undefined,
  provider: string,
  cwd: string | undefined,
  baseline?: UsageBaseline | null,
  opts: { cacheDays?: boolean } = {}
): ResolvedUsage {
  const resolved = withThread(
    resolveUsage(sample, sample ? null : readDiskUsage(provider, cwd), provider),
    baseline
  );
  // Opt-in, and only for Claude — it is the only engine that writes a
  // per-request cache split. The ~30s breaker/cost beat calls this for every
  // agent and does not want the extra stat-per-transcript; the Monitor's own
  // poll does, and asks.
  if (!opts.cacheDays || provider !== 'claude' || !cwd) return resolved;
  return withCacheDays(resolved, readAgentCacheDays(cwd));
}
