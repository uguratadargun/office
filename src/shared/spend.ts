/**
 * What a card cost, and when a night got expensive.
 *
 * A circuit breaker stops a runaway agent. It does not tell you that the floor
 * quietly spent forty dollars between 23:00 and 06:00 while nobody was awake to
 * see it — the measured MD-164 case. Budgets and alarms are the other half:
 * attribute spend to the work that caused it, and say something out loud when an
 * idle stretch crosses a threshold.
 *
 * Everything here is pure. The cost ledger's shape is the trap (see
 * `spendInWindow`), so it is pinned by tests rather than by hoping.
 */

/** One row of `<hive>/cost-ledger.jsonl`. Snake_case because the file is written
 *  to map 1:1 onto the reserved SQLite columns. */
export interface LedgerRow {
  agent_id: string;
  session_id: string | null;
  ts: number;
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
  model?: string;
  usd: number;
}

/** Money and billed tokens for some slice of time. */
export interface SpendTotals { usd: number; tokens: number }

/** Per-agent breakdown plus the sum of it. */
export interface SpendBreakdown {
  total: SpendTotals;
  byAgent: Record<string, SpendTotals>;
}

const ZERO: SpendTotals = { usd: 0, tokens: 0 };

/** Separator for the (agent, session) composite key. NUL, because an agent id is
 *  free text and any printable separator could occur inside one — written as an
 *  escape so this file stays plain text (a raw NUL makes git treat it binary). */
const KEY_SEP = '\u0000';

/** Billed tokens on one row — input + output + both cache legs, the same total
 *  the fleet snapshot and the usage chip report. */
function rowTokens(r: LedgerRow): number {
  return (r.input || 0) + (r.output || 0) + (r.cache_read || 0) + (r.cache_creation || 0);
}

/**
 * Spend between `from` and `to` (epoch ms, inclusive), per agent.
 *
 * THE TRAP: ledger rows are CUMULATIVE running totals per (agent, session), not
 * per-sample deltas — Claude Code exports usage cumulatively and the ledger
 * records the snapshot. Summing `usd` across rows re-adds the whole running
 * total on every beat and reports a number several times the truth (the same
 * mistake MD-78 fixed one rung up).
 *
 * So: group by (agent, session), and count only the GROWTH observed inside the
 * window. A series' first in-window row is its baseline, never its contribution.
 * That matters because two sources write here — a live OTLP session, and a
 * transcript fallback for an agent with no live PTY whose value is the WHOLE
 * transcript. One stray fallback row said $38.76 for an agent whose live session
 * said $2.52; counted from zero it would dump a lifetime of spend into whichever
 * night it landed in, and added to the live series it would double-count. Growth
 * only makes a lone row worth exactly nothing, which is what it tells us.
 *
 * A DECREASE inside a series is a restart (a new process re-reading from zero),
 * so the new value is fresh spend rather than negative spend.
 */
export function spendInWindow(rows: LedgerRow[], from: number, to: number): SpendBreakdown {
  const series = new Map<string, LedgerRow[]>();
  for (const r of rows) {
    if (!r || typeof r.ts !== 'number' || r.ts < from || r.ts > to) continue;
    const key = `${r.agent_id}${KEY_SEP}${r.session_id ?? ''}`;
    const list = series.get(key);
    if (list) list.push(r); else series.set(key, [r]);
  }

  const byAgent: Record<string, SpendTotals> = {};
  for (const [key, list] of series) {
    const agent = key.slice(0, key.indexOf(KEY_SEP));
    list.sort((a, b) => a.ts - b.ts);
    let usd = 0;
    let tokens = 0;
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      const du = cur.usd - prev.usd;
      const dt = rowTokens(cur) - rowTokens(prev);
      // A drop means the counter restarted; the whole current value is new spend.
      usd += du >= 0 ? du : cur.usd;
      tokens += dt >= 0 ? dt : rowTokens(cur);
    }
    const acc = byAgent[agent] ?? (byAgent[agent] = { usd: 0, tokens: 0 });
    acc.usd += usd;
    acc.tokens += tokens;
  }

  const total = Object.values(byAgent).reduce(
    (a, b) => ({ usd: a.usd + b.usd, tokens: a.tokens + b.tokens }), { ...ZERO }
  );
  return { total, byAgent };
}

/** Just one agent's slice, or zero when it did not appear. */
export function agentSpend(rows: LedgerRow[], agentId: string, from: number, to: number): SpendTotals {
  return spendInWindow(rows, from, to).byAgent[agentId] ?? { ...ZERO };
}

// ─── card attribution ───────────────────────────────────────────────────────

/** The card fields this module reads. Structural, so `src/shared` stays free of
 *  any import from `src/main`. */
export interface SpanCard {
  status: string;
  assignee?: string;
  createdAt?: string;
  /** First time this card entered `doing`. */
  startedAt?: string;
  /** When it last left `doing`. Absent while it is still in flight. */
  endedAt?: string;
}

/**
 * Stamp `startedAt` / `endedAt` from a card's CURRENT status.
 *
 * Deliberately derived from the card alone rather than from a diff against a
 * previous snapshot: tasks.json is edited by the app, by god, and by `hivectl`,
 * and a rule that only fires on one of those paths records half the spans. This
 * is idempotent, so every writer and a periodic reconcile can all run it.
 *
 * Re-opening a done card keeps the original `startedAt` and clears `endedAt` —
 * the span is "how long this card was being worked", and a card sent back to
 * `doing` is still the same work.
 */
export function stampTaskSpans<T extends SpanCard>(
  cards: T[], nowIso: string
): { cards: T[]; changed: boolean } {
  let changed = false;
  const out = cards.map((card) => {
    if (!card || typeof card !== 'object') return card;
    if (card.status === 'doing') {
      if (!card.startedAt) { changed = true; return { ...card, startedAt: nowIso, endedAt: undefined }; }
      if (card.endedAt) { changed = true; return { ...card, endedAt: undefined }; }
      return card;
    }
    if (card.startedAt && !card.endedAt) { changed = true; return { ...card, endedAt: nowIso }; }
    return card;
  });
  return { cards: changed ? out : cards, changed };
}

/**
 * The window a card's cost is attributed over: the time it spent in `doing`.
 *
 * A card that never started has no window at all — reporting its assignee's
 * whole-day spend against it would be worse than reporting nothing.
 */
export function taskSpendWindow(card: SpanCard, nowMs: number): { from: number; to: number } | null {
  if (!card?.startedAt) return null;
  const from = Date.parse(card.startedAt);
  if (!Number.isFinite(from)) return null;
  const ended = card.endedAt ? Date.parse(card.endedAt) : NaN;
  const to = Number.isFinite(ended) ? ended : nowMs;
  return to >= from ? { from, to } : null;
}

/** What one card cost: its assignee's spend across the window it was worked. */
export function taskSpend(rows: LedgerRow[], card: SpanCard, nowMs: number): SpendTotals | null {
  if (!card?.assignee) return null;
  const w = taskSpendWindow(card, nowMs);
  if (!w) return null;
  return agentSpend(rows, card.assignee, w.from, w.to);
}

// ─── the night window ───────────────────────────────────────────────────────

/** When the quiet hours start and end, local time. 22:00 → 08:00. */
export const NIGHT_START_HOUR = 22;
export const NIGHT_END_HOUR = 8;

/** Is this local timestamp inside the quiet hours? */
export function isNightHour(d: Date, startHour = NIGHT_START_HOUR, endHour = NIGHT_END_HOUR): boolean {
  const h = d.getHours();
  // The window wraps midnight, so it is a union, not a range.
  return startHour > endHour ? (h >= startHour || h < endHour) : (h >= startHour && h < endHour);
}

/** Local midnight-anchored `YYYY-MM-DD` of the DAY THE NIGHT STARTED, so both
 *  23:30 and the following 02:00 belong to the same night. This is the
 *  once-per-night key: an alarm id built from it cannot fire twice. */
export function nightKey(d: Date, startHour = NIGHT_START_HOUR): string {
  const anchor = new Date(d.getTime());
  if (anchor.getHours() < startHour) anchor.setDate(anchor.getDate() - 1);
  const y = anchor.getFullYear();
  const m = String(anchor.getMonth() + 1).padStart(2, '0');
  const day = String(anchor.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * The stretch the alarm measures over — the time nobody was watching.
 *
 * Two different stretches, and using the wrong one is a real misreport: during
 * the quiet hours it is "since 22:00", but a floor that goes quiet at 14:00 has
 * not been unattended since last night, and measuring from 22:00 there would
 * bill a whole working day to "nobody was driving this". So the quiet-floor case
 * measures from the last thing that actually happened.
 *
 * Returns null when neither applies, or when the window has no width.
 */
export function alarmWindow(
  now: Date, quietFloor: boolean, lastActivityMs: number | null, startHour = NIGHT_START_HOUR,
  endHour = NIGHT_END_HOUR
): { from: number; to: number } | null {
  const to = now.getTime();
  let from: number;
  if (isNightHour(now, startHour, endHour)) from = nightStartMs(now, startHour);
  else if (quietFloor && typeof lastActivityMs === 'number' && Number.isFinite(lastActivityMs)) from = lastActivityMs;
  else return null;
  return from < to ? { from, to } : null;
}

/** Epoch ms of the moment the current night began (local `startHour`). */
export function nightStartMs(d: Date, startHour = NIGHT_START_HOUR): number {
  const start = new Date(d.getTime());
  if (start.getHours() < startHour) start.setDate(start.getDate() - 1);
  start.setHours(startHour, 0, 0, 0);
  return start.getTime();
}

/**
 * Should the nightly spend alarm fire right now?
 *
 * `quietFloor` is the MD-164 signal: an hour with no human, Slack or agent
 * activity is a quiet hour whatever the clock says, and that is when unattended
 * spend is worth interrupting someone about. Either condition opens the window;
 * the threshold and the once-per-night key decide the rest.
 *
 * A threshold of 0 (or less) disables the alarm entirely.
 */
export function shouldRaiseSpendAlarm(args: {
  now: Date;
  quietFloor: boolean;
  spentUsd: number;
  thresholdUsd: number;
  lastAlarmKey?: string;
  startHour?: number;
  endHour?: number;
}): boolean {
  const { now, quietFloor, spentUsd, thresholdUsd, lastAlarmKey } = args;
  if (!(thresholdUsd > 0)) return false;
  if (!isNightHour(now, args.startHour, args.endHour) && !quietFloor) return false;
  if (spentUsd <= thresholdUsd) return false;
  return lastAlarmKey !== nightKey(now, args.startHour);
}

/** Compact money for the alarm text. Sub-cent reads `<$0.01`, never `$0.00` —
 *  a zero here would look like the alarm misfired. */
export function usd(n: number): string {
  if (!Number.isFinite(n)) return '$?';
  if (n > 0 && n < 0.01) return '<$0.01';
  return `$${n.toFixed(2)}`;
}

/**
 * The one message the human gets. Names the number, the threshold, the window
 * and WHO spent it — a bare "you spent a lot last night" cannot be acted on, and
 * the per-agent line is the whole reason to send this rather than log it.
 */
export function formatSpendAlarm(args: {
  spentUsd: number;
  thresholdUsd: number;
  byAgent: Record<string, SpendTotals>;
  now: Date;
  /** Start of the stretch measured. Defaults to the night's 22:00 — but a
   *  quiet-floor alarm by day measures from the last activity, and the text has
   *  to say which, or the number cannot be checked. */
  since?: number;
  nameFor?: (id: string) => string;
  startHour?: number;
}): string {
  const { spentUsd, thresholdUsd, byAgent, now } = args;
  const name = args.nameFor ?? ((id: string) => id);
  const start = new Date(args.since ?? nightStartMs(now, args.startHour));
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const lines = Object.entries(byAgent)
    .filter(([, s]) => s.usd > 0 || s.tokens > 0)
    .sort((a, b) => b[1].usd - a[1].usd)
    .map(([id, s]) => `• ${name(id)}: ${usd(s.usd)} (${Math.round(s.tokens).toLocaleString()} tokens)`);
  return [
    `Overnight spend alarm: ${usd(spentUsd)} since ${hhmm(start)} — over your ${usd(thresholdUsd)} limit.`,
    '',
    lines.length ? lines.join('\n') : '(no per-agent breakdown available)',
    '',
    'Nobody was driving the floor for this. Answer with what you want done — for example:',
    'a: leave it, this was expected',
    'b: pause the floor now',
    'c: raise the limit (say the new number)'
  ].join('\n');
}
