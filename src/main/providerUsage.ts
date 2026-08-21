/**
 * Per-provider usage — the seam that makes cost and budgets real off Claude.
 *
 * Claude usage comes from its transcript (see transcript.ts). Every other engine
 * the app wraps writes its own thing somewhere else, and because nothing read
 * those, 7 of 11 providers reported $0 — which made `costCapUsd` and the
 * breaker's cost arm decorative for most of the roster. A cap that silently
 * never fires is worse than no cap.
 *
 * The contract that matters: **no signal means null, never zero.** A caller that
 * cannot tell must render "unknown". $0 is indistinguishable from a free model
 * and from a broken parser, and that ambiguity is the whole bug.
 *
 * Each parser is verify-first — the shapes below were read off this machine's
 * actual files, not from documentation.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { priceUsd } from '../shared/pricing';

/** Mirrors transcript.ts's AgentUsage, except cost may be genuinely unknown. */
export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** null = tokens are known but the model has no price row. Show "unknown". */
  estimatedCostUsd: number | null;
  model?: string;
  /** Newest mtime seen, or 0. Same meaning as AgentUsage.lastActivityMs. */
  lastActivityMs: number;
}

const zero = (): ProviderUsage => ({
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
  estimatedCostUsd: null, lastActivityMs: 0
});

/** Providers with no usage signal we can read on disk today. Listed explicitly
 *  so "unknown" is a stated fact rather than a parser that quietly returns 0. */
export const UNMEASURED_PROVIDERS = ['grok', 'kimi', 'copilot', 'pi', 'crush'] as const;

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Every `*.jsonl` under a dir tree, newest first, capped. */
function jsonlFiles(root: string, cap = 200): string[] {
  const out: Array<{ f: string; m: number }> = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 5 || out.length > 5000) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full, depth + 1);
      else if (e.endsWith('.jsonl')) out.push({ f: full, m: st.mtimeMs });
    }
  };
  walk(root, 0);
  return out.sort((a, b) => b.m - a.m).slice(0, cap).map((x) => x.f);
}

/**
 * Codex — `~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl`.
 *
 * Usage arrives as `event_msg` payloads of type `token_count`, whose
 * `info.total_token_usage` is CUMULATIVE for the session. So the last one wins;
 * summing them would multiply the true figure by the number of turns.
 */
export function parseCodexRollout(text: string): ProviderUsage | null {
  let seen = false;
  const u = zero();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let rec: Record<string, unknown>;
    try { rec = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    const payload = rec.payload as Record<string, unknown> | undefined;
    if (!payload) continue;
    // The model lives on `turn_context` payloads (a top-level record type), and
    // sometimes on session_meta. Verified against real rollouts — session_meta
    // carries `model_provider`, NOT the model id, so reading only that leaves
    // every codex agent unpriced.
    if (rec.type === 'turn_context' || rec.type === 'session_meta') {
      const model = payload.model;
      if (typeof model === 'string' && model) u.model = model;
    }
    if (payload.type !== 'token_count') continue;
    const info = payload.info as Record<string, unknown> | undefined;
    const total = info?.total_token_usage as Record<string, unknown> | undefined;
    if (!total) continue;
    seen = true;                       // cumulative: overwrite, never accumulate
    u.inputTokens = num(total.input_tokens);
    u.outputTokens = num(total.output_tokens) + num(total.reasoning_output_tokens);
    u.cacheReadTokens = num(total.cached_input_tokens);
    u.cacheWriteTokens = num(total.cache_write_input_tokens);
  }
  if (!seen) return null;
  u.estimatedCostUsd = priceUsd(u.model, u);
  return u;
}

/** The `cwd` a codex rollout was recorded in, or null. */
export function codexRolloutCwd(text: string): string | null {
  for (const line of text.split('\n')) {
    if (!line.includes('session_meta')) continue;
    try {
      const rec = JSON.parse(line) as { payload?: { cwd?: string } };
      if (typeof rec.payload?.cwd === 'string') return rec.payload.cwd;
    } catch { /* keep looking */ }
  }
  return null;
}

/**
 * Gemini / Antigravity — `~/.gemini/tmp/<project>/chats/session-*.json`.
 *
 * Each assistant message carries its own `tokens` block, and unlike codex these
 * are PER-MESSAGE, so they sum. `thoughts` is reasoning output and is billed as
 * output; `cached` is a cache read.
 */
export function parseGeminiChat(json: unknown): ProviderUsage | null {
  const d = json as { messages?: Array<{ tokens?: Record<string, unknown>; model?: string }> };
  if (!Array.isArray(d?.messages)) return null;
  let seen = false;
  const u = zero();
  for (const m of d.messages) {
    if (!m?.tokens) continue;
    seen = true;
    u.inputTokens += num(m.tokens.input);
    u.outputTokens += num(m.tokens.output) + num(m.tokens.thoughts);
    u.cacheReadTokens += num(m.tokens.cached);
    if (typeof m.model === 'string' && m.model) u.model = m.model;
  }
  if (!seen) return null;
  u.estimatedCostUsd = priceUsd(u.model, u);
  return u;
}

/** Sum of several sessions' usage. Cost is null unless EVERY part was priced —
 *  a partial total silently understates spend, which is the failure mode this
 *  whole module exists to remove. */
export function sumUsage(parts: ProviderUsage[]): ProviderUsage | null {
  if (!parts.length) return null;
  const u = zero();
  let priced = true;
  for (const p of parts) {
    u.inputTokens += p.inputTokens;
    u.outputTokens += p.outputTokens;
    u.cacheReadTokens += p.cacheReadTokens;
    u.cacheWriteTokens += p.cacheWriteTokens;
    if (p.lastActivityMs > u.lastActivityMs) { u.lastActivityMs = p.lastActivityMs; u.model = p.model ?? u.model; }
    if (p.estimatedCostUsd === null) priced = false;
  }
  u.estimatedCostUsd = priced ? parts.reduce((s, p) => s + (p.estimatedCostUsd ?? 0), 0) : null;
  return u;
}

/** Codex usage for the agent working in `cwd`. */
function readCodex(cwd: string, home: string): ProviderUsage | null {
  const root = join(home, '.codex', 'sessions');
  if (!existsSync(root)) return null;
  const parts: ProviderUsage[] = [];
  for (const f of jsonlFiles(root)) {
    let text: string;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    if (codexRolloutCwd(text) !== cwd) continue;
    const u = parseCodexRollout(text);
    if (!u) continue;
    try { u.lastActivityMs = statSync(f).mtimeMs; } catch { /* keep 0 */ }
    parts.push(u);
  }
  return sumUsage(parts);
}

/** Gemini usage for the agent working in `cwd`.
 *
 *  ponytail: matches the chats folder by basename(cwd). Gemini also writes
 *  hash-named folders under ~/.gemini/tmp for some projects; those are skipped
 *  rather than guessed at, so they read "unknown" instead of wrong. */
function readGemini(cwd: string, home: string): ProviderUsage | null {
  const dir = join(home, '.gemini', 'tmp', basename(cwd), 'chats');
  if (!existsSync(dir)) return null;
  const parts: ProviderUsage[] = [];
  let files: string[];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return null; }
  for (const f of files) {
    const full = join(dir, f);
    let u: ProviderUsage | null;
    try { u = parseGeminiChat(JSON.parse(readFileSync(full, 'utf8'))); } catch { continue; }
    if (!u) continue;
    try { u.lastActivityMs = statSync(full).mtimeMs; } catch { /* keep 0 */ }
    parts.push(u);
  }
  return sumUsage(parts);
}

/* ── OpenCode — its own SQLite, not a transcript ──────────────────────────── */

/**
 * OpenCode keeps everything in one SQLite db (`opencode.db`) instead of per-session
 * files, and it does the pricing itself: `session` carries first-class `cost` and
 * `tokens_*` columns alongside the `directory` the session ran in.
 *
 * Two things were checked against the copy installed on this machine rather than
 * assumed, because both change the design:
 *
 *   1. The join is just `session.directory = cwd`. There is no need to walk
 *      project_directory → project → session; `directory` is right there on the
 *      session row and is the agent cwd verbatim.
 *   2. `session.tokens_input/output` equal the sum of that session's per-message
 *      `data` JSON exactly — checked on three sessions of 61, 70 and 49 messages.
 *      So the session row is not an approximation of the messages, it IS them,
 *      and parsing hundreds of JSON blobs to rediscover the same number would be
 *      slower and no more true.
 */
export interface OpenCodeSessionRow {
  directory?: unknown;
  cost?: unknown;
  tokens_input?: unknown;
  tokens_output?: unknown;
  tokens_reasoning?: unknown;
  tokens_cache_read?: unknown;
  tokens_cache_write?: unknown;
  model?: unknown;
  time_updated?: unknown;
}

/** Minimal surface of a sqlite driver. better-sqlite3 in the app, node:sqlite in
 *  the tests — the native module is built against Electron's ABI, so `node --test`
 *  cannot dlopen it (the same reason PersistStore takes a driver factory). */
export interface SqliteLike {
  prepare(sql: string): { all: (...params: unknown[]) => unknown[] };
  close(): void;
}

/** Columns the reader reads. This IS the schema fingerprint: opencode's own
 *  migrations move fast, and a hash of the whole schema would refuse to read a
 *  db that gained an unrelated table. Asking only "are the columns I use still
 *  here, spelled this way" fails exactly when it should — and when it fails the
 *  answer is null (unknown), never a partial sum. */
export const OPENCODE_REQUIRED_COLUMNS = [
  'directory', 'cost', 'tokens_input', 'tokens_output',
  'tokens_cache_read', 'tokens_cache_write', 'model', 'time_updated'
] as const;

/** Whether a `session` table we found can answer the question we are asking. */
export function opencodeSchemaOk(columns: string[]): boolean {
  const have = new Set(columns);
  return OPENCODE_REQUIRED_COLUMNS.every((c) => have.has(c));
}

/** `session.model` is a JSON blob — `{"id":"...","providerID":"...","variant":"..."}` —
 *  not the plain string every other parser here yields. Flattened to
 *  `providerID/id` so the longest-prefix price match still finds a known family,
 *  and left undefined (→ unpriced → "unknown") when it is neither. */
export function opencodeModelId(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const m = JSON.parse(raw) as { id?: unknown; providerID?: unknown };
    if (typeof m?.id !== 'string' || !m.id) return undefined;
    return typeof m.providerID === 'string' && m.providerID ? `${m.providerID}/${m.id}` : m.id;
  } catch { return raw; }  // an older/plainer schema may already store the id
}

/**
 * Fold session rows into one usage figure.
 *
 * Cost is a ladder, and the rungs matter: opencode's own `cost` wins when it is
 * positive, because opencode priced the call at the time with the rate it was
 * actually charged. A `cost` of exactly 0 is NOT a free session — it is what a
 * self-hosted or unpriced model records, so it falls through to our own price
 * table, and to null when that table has no row. Taking the 0 at face value is
 * the exact bug this module exists to remove.
 */
export function parseOpenCodeSessions(rows: OpenCodeSessionRow[]): ProviderUsage | null {
  const parts: ProviderUsage[] = [];
  for (const r of rows) {
    const u = zero();
    u.inputTokens = num(r.tokens_input);
    // Reasoning tokens are billed as output, same as gemini's `thoughts`.
    u.outputTokens = num(r.tokens_output) + num(r.tokens_reasoning);
    u.cacheReadTokens = num(r.tokens_cache_read);
    u.cacheWriteTokens = num(r.tokens_cache_write);
    u.model = opencodeModelId(r.model);
    u.lastActivityMs = num(r.time_updated);
    const own = num(r.cost);
    u.estimatedCostUsd = own > 0 ? own : priceUsd(u.model, u);
    parts.push(u);
  }
  return sumUsage(parts);
}

/** `opencode.db` under the XDG data dir, which is where opencode puts it on every
 *  platform it ships for (verified: `~/.local/share/opencode/opencode.db`). */
export function opencodeDbPath(home: string, env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_DATA_HOME;
  return join(xdg && xdg.trim() ? xdg : join(home, '.local', 'share'), 'opencode', 'opencode.db');
}

/** Lazy, and lazy on purpose: a top-level import of the native module would make
 *  this whole file unloadable under `node --test`, taking the codex and gemini
 *  parsers' coverage down with it. */
function openBetterSqlite(file: string): SqliteLike {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3') as new (f: string, o?: object) => SqliteLike;
  return new Database(file, { readonly: true, fileMustExist: true });
}

/** OpenCode usage for the agent working in `cwd`. Read-only, and every failure —
 *  no db, a db locked by a running opencode, a schema we no longer recognise —
 *  ends at null so the fleet row says "unknown" rather than inventing a zero. */
export function readOpenCode(
  cwd: string,
  home: string,
  open: (file: string) => SqliteLike = openBetterSqlite
): ProviderUsage | null {
  const file = opencodeDbPath(home);
  if (!existsSync(file)) return null;
  let db: SqliteLike | null = null;
  try {
    db = open(file);
    const cols = (db.prepare('PRAGMA table_info(session)').all() as Array<{ name?: unknown }>)
      .map((c) => String(c?.name ?? ''));
    if (!opencodeSchemaOk(cols)) return null;
    const rows = db.prepare(
      `SELECT ${OPENCODE_REQUIRED_COLUMNS.join(', ')}, tokens_reasoning
         FROM session WHERE directory = ?`
    ).all(cwd) as OpenCodeSessionRow[];
    return parseOpenCodeSessions(rows);
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* already gone */ }
  }
}

/**
 * Usage for a non-Claude agent, or null when this machine holds no signal for it.
 * Claude is deliberately absent: transcript.ts already owns that path.
 */
export function readProviderUsage(provider: string, cwd: string, home = homedir()): ProviderUsage | null {
  switch (provider) {
    case 'codex': return readCodex(cwd, home);
    case 'antigravity':
    case 'gemini': return readGemini(cwd, home);
    case 'opencode': return readOpenCode(cwd, home);
    default: return null; // see UNMEASURED_PROVIDERS
  }
}
