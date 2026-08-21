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

/**
 * Usage for a non-Claude agent, or null when this machine holds no signal for it.
 * Claude is deliberately absent: transcript.ts already owns that path.
 */
export function readProviderUsage(provider: string, cwd: string, home = homedir()): ProviderUsage | null {
  switch (provider) {
    case 'codex': return readCodex(cwd, home);
    case 'antigravity':
    case 'gemini': return readGemini(cwd, home);
    default: return null; // see UNMEASURED_PROVIDERS
  }
}
