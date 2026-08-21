/**
 * Querying the hive event log (`<root>/log.jsonl`).
 *
 * The log has been append-only since the hive shipped, and the Activity tab read
 * it with `hiveLog(60)` — the last sixty lines, re-fetched every three seconds,
 * with no search, no filter and no way back past line sixty-one. Everything
 * needed to make it a real log was already on disk.
 *
 * The querying lives here rather than in hive.ts because it is pure: entries in,
 * page out. That is what makes the paging arithmetic and the agent extraction
 * testable without a hive root, a temp dir or an Electron main process.
 */

/** One line of log.jsonl. Deliberately open: `appendLog` takes an arbitrary
 *  record and the kinds have grown over time, so anything that assumes a closed
 *  shape here would silently drop the next one someone adds. */
export interface HiveLogEntry {
  ts?: number;
  kind?: string;
  [k: string]: unknown;
}

export interface EventQuery {
  /** Case-insensitive substring over the entry's own values (not its `ts`). */
  search?: string;
  /** Exact `kind` match. '' / undefined means every kind. */
  kind?: string;
  /** An agent id (or `from`/`to` party) the entry concerns. */
  agent?: string;
  /** How many rows to skip, counting from the NEWEST. */
  offset?: number;
  limit?: number;
}

/** A row as the UI sees it: the entry plus the line it came from. */
export type EventRow = HiveLogEntry & { seq: number };

export interface EventPage {
  rows: EventRow[];
  /** Matching entries across the whole scanned log, not just this page — this is
   *  what tells the UI whether a "load more" is worth offering. */
  total: number;
  offset: number;
  limit: number;
  /** Facets, computed over everything scanned rather than over the filtered set,
   *  so choosing a kind does not empty the agent dropdown underneath the user. */
  kinds: string[];
  agents: string[];
  /** How many lines were read, and whether older ones exist beyond the scan cap.
   *  Surfaced rather than swallowed: a log silently cut at N reads as "that is
   *  everything that ever happened", which is exactly the bug being fixed. */
  scanned: number;
  truncated: boolean;
}

/** Fields that name a party. `from`/`to` are not always agents — the scheduler
 *  and the human write mail too — but they belong in the same filter, because
 *  "everything involving X" is the question being asked. */
const PARTY_FIELDS = ['agentId', 'from', 'to', 'actor'] as const;

/** Every party an entry concerns, de-duplicated and in a stable order. */
export function eventAgents(e: HiveLogEntry): string[] {
  const out: string[] = [];
  for (const f of PARTY_FIELDS) {
    const v = e[f];
    if (typeof v === 'string' && v && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * The searchable text of an entry: its own values, not its JSON.
 *
 * `ts` is excluded on purpose — it is an epoch integer, and leaving it in means
 * a search for "17" matches almost every line in the log through the timestamp
 * rather than through anything the user can see.
 */
export function eventText(e: HiveLogEntry): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(e)) {
    if (k === 'ts') continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') parts.push(String(v));
    else if (v != null) { try { parts.push(JSON.stringify(v)); } catch { /* cyclic — skip */ } }
  }
  return parts.join(' ').toLowerCase();
}

/**
 * Filter, order and page the log.
 *
 * `all` arrives in FILE order (oldest first), which is why `seq` is taken before
 * anything is reversed: it is the entry's line number, so it stays the same as
 * the log grows and makes a stable React key. Output is newest-first, which is
 * the only order that makes sense for a feed whose interesting end is the last
 * line written.
 */
export function queryEvents(all: HiveLogEntry[], q: EventQuery = {}): EventPage {
  const limit = Math.max(1, Math.min(500, Math.trunc(q.limit ?? 60)));
  const offset = Math.max(0, Math.trunc(q.offset ?? 0));
  const search = (q.search ?? '').trim().toLowerCase();
  const kind = (q.kind ?? '').trim();
  const agent = (q.agent ?? '').trim();

  const kinds = new Set<string>();
  const agents = new Set<string>();
  const matched: EventRow[] = [];

  for (let i = all.length - 1; i >= 0; i--) {
    const e = all[i];
    if (typeof e.kind === 'string' && e.kind) kinds.add(e.kind);
    for (const a of eventAgents(e)) agents.add(a);

    if (kind && e.kind !== kind) continue;
    if (agent && !eventAgents(e).includes(agent)) continue;
    if (search && !eventText(e).includes(search)) continue;
    matched.push({ ...e, seq: i });
  }

  return {
    rows: matched.slice(offset, offset + limit),
    total: matched.length,
    offset,
    limit,
    kinds: [...kinds].sort(),
    agents: [...agents].sort(),
    scanned: all.length,
    truncated: false
  };
}

/**
 * One line of an entry, for the collapsed row.
 *
 * Every kind `appendLog` actually writes today is spelled out; anything else
 * falls back to its own fields rather than to `JSON.stringify(e)`, which is what
 * the old Activity tab printed and which rendered a raw object — braces, quotes,
 * the epoch timestamp — into a list of otherwise readable sentences.
 */
export function describeEvent(e: HiveLogEntry): string {
  const s = (k: string): string => (typeof e[k] === 'string' ? (e[k] as string) : '');
  const n = (k: string): number | undefined => (typeof e[k] === 'number' ? (e[k] as number) : undefined);
  switch (e.kind) {
    case 'spawn':
      return `spawned ${s('name') || s('agentId')}${e.isGod ? ' (god)' : ''}`;
    case 'message':
      return `${s('from')} → ${s('to')}: ${s('subject') || s('act') || 'message'}`;
    case 'drain':
      return `${s('agentId')} drained ${n('count') ?? 0} message(s)`;
    case 'drop':
      return `dropped ${s('from')} → ${s('to')} (${s('reason') || 'unknown reason'})`;
    case 'session':
      return `${s('agentId')} session ${s('sessionId').slice(0, 8)}`;
    case 'archive':
      return `${s('agentId')} ${e.archived === false ? 'restored' : 'archived'}`;
    case 'edit':
      return `${s('agentId')} edited${s('role') ? ` · ${s('role')}` : ''}`;
    case 'tasks':
      return `board saved — ${n('count') ?? 0} card(s)`;
    case 'cwd_invalid':
      return `${s('agentId')} cwd unusable (${s('issue') || 'unknown'}): ${s('cwd')}`;
    case 'terminal-handoff':
      return `${s('from')} → ${s('to')} handed off in the terminal`;
    case 'voice_action':
      return `voice: ${s('verb')} ${s('target')}`.trim();
    case 'voice_action_error':
      return `voice ${s('verb')} failed: ${s('error')}`;
    case 'webhook_callback':
      return e.ok
        ? `callback delivered to ${s('target')} for ${s('taskId')}`
        : `callback to ${s('target') || '?'} failed for ${s('taskId')}: ${s('error') || `HTTP ${n('status') ?? 0}`}`;
    default: {
      // An unknown kind is a kind someone added without touching this file. Show
      // its own fields so it is still readable, and keep it searchable.
      const rest = Object.entries(e)
        .filter(([k]) => k !== 'ts' && k !== 'kind' && k !== 'seq')
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        .join(' ');
      return rest || String(e.kind ?? 'event');
    }
  }
}
