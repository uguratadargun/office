/**
 * Building the usage digest: walk the transcripts, price each turn, attribute
 * it to whatever asked for it.
 *
 * `transcript.ts` already reads these files, but it sums a whole folder into one
 * lifetime total — it throws away the timestamp, the context size and the user
 * message that caused each turn, which is precisely the three things the digest
 * buckets on. So this parses the same JSONL a second way rather than widening
 * that hot path, which is called from the ~30s cost beat for every agent.
 *
 * Same incremental cache shape as `readFileUsage`: transcripts are append-only,
 * so a parsed byte range's turns never change and a repeat call stats the file
 * and parses only the tail. The cache holds the per-turn RECORDS (about 40 bytes
 * each) rather than a total, because the window the UI asks for changes between
 * calls and re-reading multi-MB transcripts on every tab switch would not do.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';
import { projectDir } from './transcript';
import { estimateCostUsd, normalizeModel } from './pricing';
import {
  classifyTrigger, emptyAgentDigest, foldTurns, resolveRange, totalsOf,
  type RangeId, type TriggerKind, type TurnRecord, type UsageDigest
} from '../shared/usageDigest';

/** Same bound and reasoning as transcript.ts's SEEN_IDS_CAP: Claude Code writes
 *  one line per CONTENT BLOCK of a single response, each carrying the same
 *  `message.id` and a verbatim copy of that request's usage. Counting lines
 *  bills one request two or three times. */
const SEEN_IDS_CAP = 256;

interface FileTurnsEntry {
  size: number;
  mtimeMs: number;
  offset: number;
  turns: TurnRecord[];
  seen: Set<string>;
  /** The trigger of the last user message seen, carried across tail reads so a
   *  turn written after the boundary is still attributed to its prompt. */
  trigger: TriggerKind;
}

const turnsCache = new Map<string, FileTurnsEntry>();
/** Soft bound, same as the usage cache. Entries rebuild on demand. */
const TURNS_CACHE_MAX = 512;

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** The text of a user message, whatever shape `content` came in.
 *  A message whose content is only tool_results is the harness feeding the model
 *  back its own tool output — not a prompt, and counting it as one would make
 *  every agent look like it was mostly triggered by "other". */
function userText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  let text = '';
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: unknown; text?: unknown };
    if (b.type === 'tool_result') return null;
    if (b.type === 'text' && typeof b.text === 'string') text += `${b.text} `;
  }
  return text.trim() || null;
}

/** Parse complete JSONL lines into `entry`, in file order. */
function parseTurnLines(text: string, entry: FileTurnsEntry): void {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: {
      type?: unknown;
      timestamp?: unknown;
      message?: { id?: unknown; model?: unknown; content?: unknown; usage?: Record<string, unknown> };
    };
    try { rec = JSON.parse(trimmed); } catch { continue; }

    if (rec.type === 'user') {
      const t = userText(rec.message?.content);
      // A tool_result-only turn leaves the trigger where it was: the turns that
      // follow it belong to the prompt that started the tool loop, which is the
      // whole point of attributing by trigger rather than by message.
      if (t) entry.trigger = classifyTrigger(t);
      continue;
    }
    if (rec.type !== 'assistant') continue;
    const u = rec.message?.usage;
    if (!u) continue;
    const id = typeof rec.message?.id === 'string' ? rec.message.id : '';
    if (id) {
      if (entry.seen.has(id)) continue;
      entry.seen.add(id);
      if (entry.seen.size > SEEN_IDS_CAP) {
        for (const old of entry.seen) { entry.seen.delete(old); if (entry.seen.size <= SEEN_IDS_CAP) break; }
      }
    }
    const model = typeof rec.message?.model === 'string' ? normalizeModel(rec.message.model) : undefined;
    const inputTokens = num(u.input_tokens);
    const outputTokens = num(u.output_tokens);
    const cacheWriteTokens = num(u.cache_creation_input_tokens);
    const cacheReadTokens = num(u.cache_read_input_tokens);
    const ts = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
    entry.turns.push({
      ts: Number.isFinite(ts) ? ts : 0,
      tokens: inputTokens + outputTokens + cacheWriteTokens + cacheReadTokens,
      usd: estimateCostUsd(model, { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }),
      // What the request CARRIED, not what it produced — this is the number the
      // compaction bars are set against.
      contextTokens: inputTokens + cacheReadTokens + cacheWriteTokens,
      trigger: entry.trigger
    });
  }
}

/**
 * Parse a whole transcript's text into turns. The incremental reader below is
 * the same logic with a byte offset in front of it; this is the seam the tests
 * drive, so the dedup and the attribution can be pinned without a file on disk
 * (and without writing into the user's real `~/.claude`).
 */
export function parseTranscriptTurns(text: string): TurnRecord[] {
  const entry: FileTurnsEntry = {
    size: 0, mtimeMs: 0, offset: 0, turns: [], seen: new Set<string>(), trigger: 'other'
  };
  parseTurnLines(text, entry);
  return entry.turns;
}

/** Read one transcript's turns, parsing only what has been appended since last
 *  time. Null when the file vanished. */
function readFileTurns(dir: string, file: string): FileTurnsEntry | null {
  const key = `${dir}|${file}`;
  const full = path.join(dir, file);
  let st: { size: number; mtimeMs: number };
  try { st = statSync(full); } catch { turnsCache.delete(key); return null; }
  const cached = turnsCache.get(key);
  if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) return cached;
  const fromScratch = !cached || st.size < cached.offset;
  const entry: FileTurnsEntry = fromScratch
    ? { size: st.size, mtimeMs: st.mtimeMs, offset: 0, turns: [], seen: new Set<string>(), trigger: 'other' }
    : cached!;
  entry.size = st.size;
  entry.mtimeMs = st.mtimeMs;
  try {
    let text: string;
    if (entry.offset === 0) {
      text = readFileSync(full, 'utf8');
    } else {
      const len = st.size - entry.offset;
      if (len <= 0) { turnsCache.set(key, entry); return entry; }
      const buf = Buffer.allocUnsafe(len);
      const fd = openSync(full, 'r');
      try { readSync(fd, buf, 0, len, entry.offset); } finally { closeSync(fd); }
      text = buf.toString('utf8');
    }
    // Stop at the last newline so a half-written trailing line is re-read once
    // the writer finishes it, rather than being dropped or parsed torn.
    const cut = text.lastIndexOf('\n');
    if (cut === -1) { turnsCache.set(key, entry); return entry; }
    parseTurnLines(text.slice(0, cut), entry);
    entry.offset += Buffer.byteLength(text.slice(0, cut + 1), 'utf8');
  } catch {
    // Unreadable file — keep whatever was already parsed rather than throwing
    // the whole digest away for one bad transcript.
  }
  if (turnsCache.size > TURNS_CACHE_MAX) {
    let drop = Math.floor(turnsCache.size / 2);
    for (const k of turnsCache.keys()) { turnsCache.delete(k); if (--drop <= 0) break; }
  }
  turnsCache.set(key, entry);
  return entry;
}

/** One registered agent, as much of it as the digest needs. */
export interface DigestAgentInput {
  id: string;
  name: string;
  cwd: string;
  /** Current session id, when known. Claude Code names each transcript after its
   *  session, so this is what tells two agents sharing one folder apart. */
  sessionId?: string;
}

export interface DigestOptions {
  range?: RangeId;
  /** Injected in tests; defaults to the wall clock. */
  now?: number;
}

/**
 * Build the digest for a roster.
 *
 * Attribution, in order: a transcript file whose name matches a known session id
 * belongs to that agent; otherwise it belongs to the only agent registered in
 * that folder. When SEVERAL agents share a folder and the file matches none of
 * their session ids, the row is marked `shared` and named after all of them —
 * the numbers are real, they just belong to a folder rather than to one agent,
 * and saying so is better than silently attributing a night to whoever happens
 * to sort first.
 */
export function buildUsageDigest(agents: readonly DigestAgentInput[], opts: DigestOptions = {}): UsageDigest {
  const now = opts.now ?? Date.now();
  const range = opts.range ?? 'last-night';
  const { sinceMs, untilMs, label } = resolveRange(range, now);

  // sessionId → agent, and folder → the agents that live in it.
  const bySession = new Map<string, DigestAgentInput>();
  const byDir = new Map<string, DigestAgentInput[]>();
  for (const a of agents) {
    if (a.sessionId) bySession.set(a.sessionId, a);
    let dir: string;
    try { dir = projectDir(a.cwd); } catch { continue; }
    const list = byDir.get(dir);
    if (list) list.push(a); else byDir.set(dir, [a]);
  }

  const rows = new Map<string, ReturnType<typeof emptyAgentDigest>>();
  const pending = new Map<string, TurnRecord[]>();
  let filesRead = 0;

  const claim = (id: string, name: string, shared: boolean): TurnRecord[] => {
    let row = rows.get(id);
    if (!row) { row = emptyAgentDigest(id, name); if (shared) row.shared = true; rows.set(id, row); }
    let list = pending.get(id);
    if (!list) { list = []; pending.set(id, list); }
    return list;
  };

  for (const [dir, dirAgents] of byDir) {
    if (!existsSync(dir)) continue;
    let files: string[];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const file of files) {
      const entry = readFileTurns(dir, file);
      if (!entry) continue;
      filesRead++;
      const session = file.replace(/\.jsonl$/, '');
      const owner = bySession.get(session) ?? (dirAgents.length === 1 ? dirAgents[0] : undefined);
      const target = owner
        ? claim(owner.id, owner.name, false)
        : claim(`dir:${dir}`, dirAgents.map((a) => a.name).join(' + '), true);
      target.push(...entry.turns);
    }
  }

  for (const [id, turns] of pending) foldTurns(rows.get(id)!, turns, sinceMs, untilMs);
  // Rows that spent nothing in the window are dropped rather than listed as
  // zeros: a night's table should be the agents that were awake for it.
  const list = [...rows.values()].filter((r) => r.total.turns > 0).sort((a, b) => b.total.usd - a.total.usd);
  const { total, byHour, byTrigger, byContext } = totalsOf(list);
  return {
    generatedAt: now,
    range,
    rangeLabel: label,
    sinceMs,
    untilMs,
    rows: list,
    total,
    byHour,
    byTrigger,
    byContext,
    filesRead
  };
}
