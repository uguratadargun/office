/**
 * The usage digest — what the floor spent, split by WHEN, by WHAT ASKED FOR IT,
 * and by HOW FULL the context was at the time.
 *
 * The fleet table answers "what has this agent cost". After a release whose
 * whole point was that an idle floor stopped billing overnight, the question
 * that matters is a different one: which hours, and on whose behalf. A total
 * cannot tell a busy day from a quiet night spent answering timers, and it was
 * exactly that blind spot — 8M tokens a night, none of it work — that took a
 * hand-run script to find. This is that script's arithmetic, kept.
 *
 * Everything here is pure and free of `fs`/`electron` so the classification and
 * the bucket edges can be pinned in tests without a transcript on disk. The
 * file walking and the pricing live in `src/main/usageDigest.ts`.
 */

/** Who asked for the turn. Derived from the text of the user message that
 *  preceded it — the only provenance a transcript carries. */
export type TriggerKind =
  /** The hourly ops standup beat. */
  | 'standup'
  /** An inbox nudge — mail arriving for a parked or idle agent. */
  | 'inbox-nudge'
  /** A circuit-breaker steer/constrain. */
  | 'breaker'
  /** The system/orientation prompt a fresh spawn opens with. */
  | 'spawn-prompt'
  /** A person typed it. */
  | 'human'
  /** Everything else — a reply in a thread, a queued command, an unknown beat. */
  | 'other';

/** Presentation order, coarsest-cost-first is deliberately NOT used: this is the
 *  order the reader thinks in — machine beats, then mail, then people. */
export const TRIGGER_KINDS: TriggerKind[] = [
  'standup', 'inbox-nudge', 'breaker', 'spawn-prompt', 'human', 'other'
];

export const TRIGGER_LABEL: Record<TriggerKind, string> = {
  standup: 'standup',
  'inbox-nudge': 'nudge',
  breaker: 'breaker',
  'spawn-prompt': 'spawn',
  human: 'human',
  other: 'other'
};

/**
 * Classify one user message by what appears to have sent it.
 *
 * Text matching, because that is all there is: a transcript records what was
 * typed into the agent, not which timer typed it. The markers are the literal
 * strings this harness sends — they are asserted in the tests, so a reworded
 * nudge fails there rather than silently reclassifying a night's cost as
 * "other". Order matters: the spawn prompt contains the protocol text that also
 * mentions the inbox, so the more specific beats are tested first.
 */
export function classifyTrigger(text: string): TriggerKind {
  const t = text.trim();
  if (!t) return 'other';
  const lower = t.toLowerCase();
  if (t.includes('Hourly ops standup') || lower.includes('ops standup')) return 'standup';
  if (t.includes('new hive inbox message')) return 'inbox-nudge';
  if (t.includes('Circuit breaker')) return 'breaker';
  if (t.startsWith('You are') || t.includes('HIVE PROTOCOL')) return 'spawn-prompt';
  if (t.includes('HUMAN ANSWER') || t.includes('Task from the human')) return 'human';
  return 'other';
}

/** Context-size bands, in tokens. The edges are the ones the compaction rule
 *  reasons about: 100k is half a 200k window, 200k is a full one, and past 400k
 *  an agent is on a 1M window that has been allowed to grow. */
export type ContextBucket = '<100k' | '100–200k' | '200–400k' | '>400k';

export const CONTEXT_BUCKETS: ContextBucket[] = ['<100k', '100–200k', '200–400k', '>400k'];

/** Which band a turn's context size falls in. `tokens` is what the request
 *  actually carried — input + cache read + cache write — not the reply. */
export function contextBucket(tokens: number): ContextBucket {
  if (!(tokens > 0)) return '<100k';
  if (tokens < 100_000) return '<100k';
  if (tokens < 200_000) return '100–200k';
  if (tokens < 400_000) return '200–400k';
  return '>400k';
}

/** One measured quantity, wherever it is bucketed. */
export interface UsageCell {
  turns: number;
  tokens: number;
  usd: number;
}

export function emptyCell(): UsageCell {
  return { turns: 0, tokens: 0, usd: 0 };
}

export function addCell(into: UsageCell, turns: number, tokens: number, usd: number): void {
  into.turns += turns;
  into.tokens += tokens;
  into.usd += usd;
}

/** One assistant turn, reduced to what the digest buckets on. Produced by the
 *  main-process parser; the aggregation below is the only thing that reads it. */
export interface TurnRecord {
  /** Epoch ms of the turn. 0 when the transcript carried no timestamp. */
  ts: number;
  /** Billed tokens for the turn (input + output + both cache halves). */
  tokens: number;
  usd: number;
  /** What the request carried as context — input + cache read + cache write. */
  contextTokens: number;
  /** The trigger of the most recent user message before this turn. */
  trigger: TriggerKind;
}

export interface UsageDigestAgent {
  agentId: string;
  name: string;
  /** True when several registered agents share this row's transcript folder and
   *  the files could not be told apart by session id — the numbers are the
   *  folder's, not one agent's, and the UI says so rather than implying
   *  precision it does not have. */
  shared?: boolean;
  total: UsageCell;
  /** 24 cells, indexed by LOCAL hour of day. */
  byHour: UsageCell[];
  byTrigger: Record<TriggerKind, UsageCell>;
  byContext: Record<ContextBucket, UsageCell>;
}

export interface UsageDigest {
  /** When main built it, epoch ms. */
  generatedAt: number;
  range: RangeId;
  rangeLabel: string;
  sinceMs: number;
  untilMs: number;
  /** One row per agent that spent something, ordered by cost. Deliberately NOT
   *  the roster order the rest of the app renders agents in: this list's whole
   *  job is to put the expensive one first. */
  rows: UsageDigestAgent[];
  total: UsageCell;
  byHour: UsageCell[];
  byTrigger: Record<TriggerKind, UsageCell>;
  byContext: Record<ContextBucket, UsageCell>;
  /** Transcript files that were read. 0 with a non-zero total is impossible and
   *  is what tells "nothing spent" apart from "nothing found". */
  filesRead: number;
}

export type RangeId = 'last-night' | 'today' | '24h' | 'all';

export const RANGE_IDS: RangeId[] = ['last-night', 'today', '24h', 'all'];

export const RANGE_LABEL: Record<RangeId, string> = {
  'last-night': 'last night',
  today: 'today',
  '24h': 'last 24h',
  all: 'all time'
};

/** The night starts here, local time. Chosen over midnight because the burn
 *  being looked for begins when the last person stops typing, not at 00:00. */
export const NIGHT_START_HOUR = 20;
/** …and ends here, which is when someone is plausibly back at the machine. */
export const NIGHT_END_HOUR = 8;

export interface ResolvedRange {
  sinceMs: number;
  untilMs: number;
  label: string;
}

/**
 * Turn a preset into an absolute window.
 *
 * "Last night" is the most recent 20:00 → 08:00 stretch. Before 08:00 that
 * stretch is still running, so it ends at `now` — a night in progress is the
 * one you most want to look at, and reporting it as empty until breakfast would
 * be the opposite of useful. `now` is injected so the boundaries can be tested
 * without waiting for one.
 */
export function resolveRange(range: RangeId, now: number): ResolvedRange {
  const d = new Date(now);
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const HOUR = 3_600_000;
  switch (range) {
    case 'today':
      return { sinceMs: midnight, untilMs: now, label: RANGE_LABEL.today };
    case '24h':
      return { sinceMs: now - 24 * HOUR, untilMs: now, label: RANGE_LABEL['24h'] };
    case 'all':
      return { sinceMs: 0, untilMs: now, label: RANGE_LABEL.all };
    case 'last-night':
    default: {
      const endToday = midnight + NIGHT_END_HOUR * HOUR;
      // Past this morning's 08:00, "last night" is the night that just finished;
      // before it, we are still inside it.
      const untilMs = now >= endToday ? endToday : now;
      const sinceMs = midnight - (24 - NIGHT_START_HOUR) * HOUR;
      return { sinceMs, untilMs, label: RANGE_LABEL['last-night'] };
    }
  }
}

function emptyTriggerMap(): Record<TriggerKind, UsageCell> {
  return Object.fromEntries(TRIGGER_KINDS.map((k) => [k, emptyCell()])) as Record<TriggerKind, UsageCell>;
}

function emptyContextMap(): Record<ContextBucket, UsageCell> {
  return Object.fromEntries(CONTEXT_BUCKETS.map((k) => [k, emptyCell()])) as Record<ContextBucket, UsageCell>;
}

export function emptyAgentDigest(agentId: string, name: string): UsageDigestAgent {
  return {
    agentId,
    name,
    total: emptyCell(),
    byHour: Array.from({ length: 24 }, emptyCell),
    byTrigger: emptyTriggerMap(),
    byContext: emptyContextMap()
  };
}

/**
 * Fold one agent's turns into a digest row, keeping only what falls in the
 * window. `hourOf` is injected so the tests can pin bucket edges without being
 * at the mercy of the machine's timezone.
 */
export function foldTurns(
  row: UsageDigestAgent,
  turns: readonly TurnRecord[],
  sinceMs: number,
  untilMs: number,
  hourOf: (ts: number) => number = (ts) => new Date(ts).getHours()
): UsageDigestAgent {
  for (const t of turns) {
    // A turn with no timestamp cannot be placed in time. It is counted in "all
    // time" (where the window is everything) and dropped from any narrower
    // window rather than being parked in an arbitrary hour.
    if (!t.ts) {
      if (sinceMs === 0) addCell(row.total, 1, t.tokens, t.usd);
      continue;
    }
    if (t.ts < sinceMs || t.ts > untilMs) continue;
    addCell(row.total, 1, t.tokens, t.usd);
    const h = hourOf(t.ts);
    if (h >= 0 && h < 24) addCell(row.byHour[h], 1, t.tokens, t.usd);
    addCell(row.byTrigger[t.trigger], 1, t.tokens, t.usd);
    addCell(row.byContext[contextBucket(t.contextTokens)], 1, t.tokens, t.usd);
  }
  return row;
}

/** Sum agent rows into the digest's own totals. */
export function totalsOf(rows: readonly UsageDigestAgent[]): {
  total: UsageCell;
  byHour: UsageCell[];
  byTrigger: Record<TriggerKind, UsageCell>;
  byContext: Record<ContextBucket, UsageCell>;
} {
  const total = emptyCell();
  const byHour = Array.from({ length: 24 }, emptyCell);
  const byTrigger = emptyTriggerMap();
  const byContext = emptyContextMap();
  for (const a of rows) {
    addCell(total, a.total.turns, a.total.tokens, a.total.usd);
    for (let h = 0; h < 24; h++) addCell(byHour[h], a.byHour[h].turns, a.byHour[h].tokens, a.byHour[h].usd);
    for (const k of TRIGGER_KINDS) addCell(byTrigger[k], a.byTrigger[k].turns, a.byTrigger[k].tokens, a.byTrigger[k].usd);
    for (const k of CONTEXT_BUCKETS) addCell(byContext[k], a.byContext[k].turns, a.byContext[k].tokens, a.byContext[k].usd);
  }
  return { total, byHour, byTrigger, byContext };
}

/** Share of a total, 0-1. Zero denominator is 0, never NaN — a NaN reaches the
 *  DOM as a blank cell and reads as "no data" rather than "nothing spent". */
export function share(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

/**
 * The one sentence the digest is for: which hour cost the most, and what was
 * asking. Returns null when there is nothing to say, so the UI can stay silent
 * rather than print a headline about zero.
 */
export function digestHeadline(d: UsageDigest): string | null {
  if (d.total.turns === 0) return null;
  let peak = 0;
  for (let h = 1; h < 24; h++) if (d.byHour[h].usd > d.byHour[peak].usd) peak = h;
  if (d.byHour[peak].turns === 0) return null;
  let top: TriggerKind = 'other';
  for (const k of TRIGGER_KINDS) if (d.byTrigger[k].usd > d.byTrigger[top].usd) top = k;
  const pct = Math.round(share(d.byTrigger[top].usd, d.total.usd) * 100);
  const hh = String(peak).padStart(2, '0');
  return `Busiest hour ${hh}:00 · ${TRIGGER_LABEL[top]} is ${pct}% of the spend`;
}
