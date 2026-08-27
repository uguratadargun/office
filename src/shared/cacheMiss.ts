/**
 * MD-177 — prompt-cache MISS rate, per agent per day.
 *
 * A Claude request either re-sends the conversation prefix as a cache WRITE
 * (`cache_creation_input_tokens`) or is served it as a cache READ
 * (`cache_read_input_tokens`). A write costs 1.25× the input rate and a read
 * 0.1×, so the same prefix is ~12× more expensive when the cache has expired.
 * Measured on this floor, cache writes were 12% of total spend — almost all of
 * it prefix that had simply gone cold.
 *
 * It goes cold on a TTL: the 5-minute ephemeral window is the default, and a
 * wake more than that after the agent's last turn pays the full prefix again.
 * A 130k-token context is therefore not a fixed cost per wake — it is a cheap
 * wake or an expensive one depending only on WHEN it lands. That is the number
 * this module makes visible, and the rule in `inboxNudge` acts on.
 *
 * The metric is deliberately WRITE / (WRITE + READ) — the share of cacheable
 * input that missed. `input_tokens` (the genuinely new text of the turn) is
 * excluded: it was never a candidate for the cache, and folding it in would
 * make a long user message look like a cache problem.
 *
 * Pure; main reads the transcripts, the renderer renders. Node-testable.
 */

/** One day's cache accounting for one agent. `day` is a LOCAL calendar date —
 *  see {@link dayKey} for why local rather than UTC. */
export interface CacheDay {
  /** `YYYY-MM-DD`, local time. */
  day: string;
  /** Prefix re-sent because the cache had expired (`cache_creation`). */
  cacheWriteTokens: number;
  /** Prefix served from a warm cache (`cache_read`). */
  cacheReadTokens: number;
  /** Assistant responses counted into this day — the denominator for "per wake". */
  turns: number;
}

export function emptyCacheDay(day: string): CacheDay {
  return { day, cacheWriteTokens: 0, cacheReadTokens: 0, turns: 0 };
}

/**
 * The LOCAL calendar date of `ms`, as `YYYY-MM-DD`.
 *
 * Local rather than UTC because the question being asked is "how did today go",
 * and the person asking it is looking at a wall clock. A UTC key would split
 * one evening's work across two rows for most of the world.
 */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Share of cacheable input that MISSED, as a whole percent, or null.
 *
 * Null — never 0 — when nothing cacheable was seen at all, following the same
 * rule the usage ladder already enforces (`agentUsage.ts`): a missing signal
 * must not be reported as a measured zero. An agent with no transcript and an
 * agent with a perfect cache are not the same fact.
 */
export function cacheMissPct(d: Pick<CacheDay, 'cacheWriteTokens' | 'cacheReadTokens'> | null | undefined): number | null {
  if (!d) return null;
  const write = Math.max(0, d.cacheWriteTokens || 0);
  const read = Math.max(0, d.cacheReadTokens || 0);
  const total = write + read;
  if (total <= 0) return null;
  return Math.round((write / total) * 100);
}

/**
 * How loud a miss rate should read.
 *
 * A healthy agent working continuously re-writes its prefix only when the
 * context actually grows, which lands in the low single digits. 15% is where
 * the pattern stops being growth and starts being cold wakes; 30% means the
 * majority of the bill is re-sending context somebody already paid for.
 */
export function cacheMissTone(pct: number | null): 'normal' | 'warn' | 'danger' {
  if (pct === null) return 'normal';
  if (pct >= 30) return 'danger';
  return pct >= 15 ? 'warn' : 'normal';
}

/** Days newest-first, so "the day this agent last worked" is `[0]`. */
export function sortDaysDesc(days: readonly CacheDay[]): CacheDay[] {
  return [...days].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

/**
 * The day to PUT ON THE ROW: today when the agent has worked today, otherwise
 * the most recent day it did.
 *
 * Showing only today would blank the column for every agent that has been idle
 * since last night, which reads as "no data" when the honest answer is "not
 * today" — so the caller is told which day it got (`isToday`) and can say so.
 */
export function latestCacheDay(
  days: readonly CacheDay[] | null | undefined,
  nowMs: number
): { day: CacheDay; isToday: boolean } | null {
  const sorted = sortDaysDesc(days ?? []);
  const newest = sorted[0];
  if (!newest) return null;
  return { day: newest, isToday: newest.day === dayKey(nowMs) };
}

/** Fold many days into one reading — the fleet band's denominator. */
export function sumCacheDays(days: readonly CacheDay[] | null | undefined): CacheDay {
  const acc = emptyCacheDay('');
  for (const d of days ?? []) {
    acc.cacheWriteTokens += d.cacheWriteTokens;
    acc.cacheReadTokens += d.cacheReadTokens;
    acc.turns += d.turns;
  }
  return acc;
}

/**
 * How many days of history ride over IPC with every usage poll.
 *
 * The Monitor shows one day; the rest are here so a trend is answerable without
 * a second round trip. Bounded because this payload is re-sent on every poll for
 * every agent — an unbounded history would grow the poll forever, which is
 * exactly the kind of quiet cost this card exists to remove.
 */
export const CACHE_DAYS_KEPT = 7;
