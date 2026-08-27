/**
 * MemoryReflector — the missing CONDENSE half of the janitor.
 *
 * The janitor flags an oversized `agents/<id>/memory.md` ("Needs condensing.")
 * but never shrinks it. This service finishes that job: on an in-process timer it
 * finds memory files that crossed a size/section threshold and rewrites them into
 * a bounded 3-region shape — pinned durable facts (never touched), one rolling
 * recursive summary, and the newest K verbatim sections — summarizing the evicted
 * tail with a single headless call to the engine THAT AGENT already runs
 * (`shared/condense.ts` owns the per-engine one-shot forms).
 *
 * Why in-process (Electron main), NOT launchd: launchd-spawned shells are blocked
 * by macOS TCC from `~/Documents`; only this process has the folder grant. So the
 * loop lives alongside `memory.start()` — never a cron.
 *
 * Safety is layered so a bad LLM pass can NEVER lose data:
 *   backup-first (lossless cold copy) → verify-don't-trust gate → atomic swap.
 * If any check fails the original file is left byte-for-byte untouched and the
 * only side effect is a `condense-abort` log line. The miner re-indexes the new
 * file automatically on the next tick because its mtime changed (memory.ts).
 *
 * Runs in the Electron main process.
 */
import {
  existsSync, statSync, readdirSync, readFileSync, writeFileSync,
  mkdirSync, copyFileSync, renameSync, openSync, fsyncSync, closeSync
} from 'node:fs';
import { join, dirname } from 'node:path';
import { runCondense } from './condenseRun';
import { condensePlan, type CondensePlan } from '../shared/condense';
import { condenseRetryDelayMs } from '../shared/tokenDiet';

/** Total memory.md budget — mirrors the janitor's CONTEXT_BUDGET_BYTES (128 KB). */
const BUDGET_BYTES = 131_072;
/** The engine used when an agent's own CLI has no verified one-shot form. Its
 *  model comes from the same table as everyone else's. Never a hidden
 *  interactive session — that was the thing being removed. */
const FALLBACK_PROVIDER = 'claude';
/** Hard cap so a wedged headless run can't stall the reflect loop. */
const DEFAULT_TIMEOUT_MS = 180_000;

/** The fixed region headings of the bounded memory shape (the stable contract). */
const PINNED_HEADING = '## 📌 Durable facts (pinned — never condensed)';
const CONDENSED_HEADING = '## 🗜 Condensed history';
const RECENT_HEADING = '## Recent';

/** Instruction prefix — kept byte-identical across calls (no dates/ids spliced
 *  in) so Claude Code prompt-caches it; the dynamic content goes in the tail. */
const CONDENSE_SYSTEM = [
  "You are compacting one AI agent's long-term memory file. You will receive:",
  '(A) the current CONDENSED summary, (B) older RECENT sections being evicted,',
  '(C) the PINNED durable-facts block (for context only — do not rewrite it).',
  'Produce STRICT JSON: {"condensed": "<text>", "hoist": ["<line>", ...]}.',
  'RULES:',
  '- "condensed" = a single bounded summary of (A)+(B). Re-summarize (A) together',
  '  with (B) so the result does not grow unbounded. Target <= 1500 words. Preserve',
  '  every decision, root cause, protocol, file path, commit SHA, and numeric result.',
  '  Drop routine standup chatter, resolved blockers, and superseded plans.',
  '- "hoist" = any NEW high-importance durable fact found in (B) that belongs in the',
  '  pinned block and is not already in (C). Lines only; may be empty.',
  '- Output ONLY the JSON object. No prose, no code fence.'
].join('\n');

export interface ReflectSettings {
  enabled: boolean;
  /** How often to scan for oversized memory files. */
  intervalMs: number;
  /** Condense when bytes exceed this percent of BUDGET_BYTES. */
  byteTriggerPct: number;
  /** ...OR when `## ` section count exceeds this (AND bytes > minBytes). */
  sectionTrigger: number;
  /** Newest K verbatim `## ` sections always kept untouched. */
  recentKeep: number;
  /** Never condense a file smaller than this — both a "don't waste an LLM call"
   *  guard and the byte floor for the section-count trigger. */
  minBytes: number;
  /** Engine used when the agent's OWN engine has no verified one-shot form.
   *  Unset (or set to an engine we have no plan for) means `claude`. */
  condenseProvider?: string;
  /** Per-engine model override, e.g. `{ claude: 'claude-haiku-4-5' }`. An entry
   *  set to '' means "pass no model flag" — the engine uses the user's own. */
  condenseModels?: Record<string, string>;
}

/** A `## ` section: its heading line and the body text beneath it. */
interface Section { heading: string; body: string }

/** A parsed memory.md split into the three regions. `pinned`/`condensed` are null
 *  for legacy (un-structured) files — they're created on first condense. */
interface Parsed {
  header: string;            // the `# Memory …` H1 + any preamble before the first `##`
  pinned: string | null;     // body under the pinned heading (no heading line)
  condensed: string | null;  // body under the condensed heading
  recent: Section[];         // every other `## ` section, in file order (oldest→newest)
}

/** Outcome of one agent's reflect attempt — surfaced to the manual IPC + tests. */
export interface ReflectResult {
  id: string;
  condensed: boolean;        // did we actually rewrite the file?
  reason: string;            // why (skipped/aborted/done), for logging + UI
  oldBytes?: number;
  newBytes?: number;
}

/** What the last scan did, and when the next one is due. The condenser rewrites
 *  the user's agent memory unattended; without this it does so invisibly, which
 *  is most of why it needed an off switch in the first place. */
export interface ReflectStatus {
  enabled: boolean;
  /** Epoch ms of the last completed scan, or null if none this session. */
  lastRunMs: number | null;
  /** Epoch ms the next scheduled scan is due, or null when not scheduled. */
  nextRunMs: number | null;
  /** True while a scan is in flight. */
  running: boolean;
  /** What the last scan actually changed — only the agents it touched. */
  lastChanged: ReflectResult[];
  /** How many agents the last scan looked at (touched or not). */
  lastScanned: number;
}

export class MemoryReflector {
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  /** True while a reflectNow() pass is in flight — serializes the loop (a slow
   *  LLM pass must not overlap the next interval tick), mirroring MemoryManager. */
  private reflecting = false;
  /** Last-scan record for the UI. Session-scoped on purpose: it answers "is this
   *  thing running and what did it just do to my files", not "what happened last
   *  month" — the hive log already keeps the durable history. */
  private lastRunMs: number | null = null;
  private lastChanged: ReflectResult[] = [];
  private lastScanned = 0;
  /** The interval the live timer was armed with, so a settings change can be
   *  noticed without restarting the app. */
  private armedIntervalMs = 0;
  private nextRunMs: number | null = null;
  /** agentId → consecutive `condense-abort`s, and the epoch ms before which the
   *  scheduled loop must not try that agent again (MD-164). An abort is almost
   *  never transient — the verifier rejected the file's SHAPE, and the file has
   *  not changed — so retrying on the plain interval burned 14 headless calls on
   *  one agent in a single night. Session-scoped: a restart is a fair reason to
   *  try once more. */
  private retry = new Map<string, { aborts: number; nextAttemptMs: number }>();

  /**
   * @param getHome      Lazily resolve harnessHome so reflection follows config.
   * @param getCommand   The base `claude` command (only its binary name is used).
   * @param getMemoryEnv Extra env (the shared MemPalace path) merged into the call.
   * @param getSettings  Reflect tunables (interval + thresholds), read each tick.
   * @param appendLog    Sink for `condense`/`condense-abort` events (hive log.jsonl).
   * @param getProvider  The engine an agent actually runs, so its own memory is
   *                     condensed by its own CLI rather than by a Claude session
   *                     the user may not even have installed.
   * @param isFloorIdle  True when nothing on the floor has moved recently. The
   *                     SCHEDULED loop skips entirely then (MD-164): nobody is
   *                     writing memory, so there is nothing new to condense and
   *                     every call is a headless LLM process for no reason. The
   *                     manual button ignores it.
   */
  constructor(
    private getHome: () => string | null,
    private getCommand: () => string,
    private getMemoryEnv: () => Record<string, string>,
    private getSettings: () => ReflectSettings,
    private appendLog: (event: Record<string, unknown>) => void,
    private getProvider: (id: string) => string = () => FALLBACK_PROVIDER,
    private isFloorIdle: () => boolean = () => false
  ) {}

  // — lifecycle (mirrors MemoryManager) —

  start(): void {
    if (this.started) return;
    if (!this.getSettings().enabled) return;
    if (!this.getHome()) return;
    this.started = true;
    // First scan one interval out, not on boot, so launch isn't competing with an
    // LLM call (and a freshly-restored home isn't condensed before it's mined).
    this.arm(Math.max(60_000, this.getSettings().intervalMs));
  }

  private arm(ms: number): void {
    if (this.timer) clearInterval(this.timer);
    this.armedIntervalMs = ms;
    this.nextRunMs = Date.now() + ms;
    this.timer = setInterval(() => {
      this.nextRunMs = Date.now() + ms;
      void this.reflectNow(undefined, { scheduled: true });
    }, ms);
  }

  /**
   * Re-read the settings and make the live loop match them. Called when config
   * changes, so switching the condenser off stops it NOW rather than at the next
   * app launch — an off switch that takes effect on restart is not an off switch,
   * and this one governs a subsystem that rewrites files unattended.
   */
  applySettings(): void {
    const s = this.getSettings();
    if (!s.enabled) {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      this.started = false;
      this.nextRunMs = null;
      return;
    }
    if (!this.getHome()) return;
    if (!this.started) { this.start(); return; }
    const ms = Math.max(60_000, s.intervalMs);
    if (ms !== this.armedIntervalMs) this.arm(ms);
  }

  /** Everything the UI needs to say whether this is running and what it did. */
  status(): ReflectStatus {
    return {
      enabled: this.getSettings().enabled,
      lastRunMs: this.lastRunMs,
      nextRunMs: this.timer ? this.nextRunMs : null,
      running: this.reflecting,
      lastChanged: this.lastChanged,
      lastScanned: this.lastScanned
    };
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.started = false;
  }

  // — scan —

  /** Reflect every agent whose memory crossed a threshold (or just `onlyId`),
   *  one at a time. Serialized via `reflecting` so a slow pass can't overlap the
   *  next tick. Returns the per-agent outcomes (used by the manual IPC + tests). */
  async reflectNow(onlyId?: string, opts: { scheduled?: boolean } = {}): Promise<ReflectResult[]> {
    const home = this.getHome();
    if (!home) return [];
    // The switch gates the AUTONOMOUS loop, not the button. A user who turns the
    // condenser off is saying "stop rewriting my files behind my back", not
    // "refuse when I ask" — and gating the manual path too would leave an
    // oversized memory.md with no way to shrink it at all.
    if (opts.scheduled && !this.getSettings().enabled) return [];
    // An idle floor writes no memory, so there is nothing new to condense — but
    // the loop still spawned a headless model per oversized file, every tick, all
    // night. The manual path is deliberately exempt (MD-164).
    if (opts.scheduled && this.isFloorIdle()) return [];
    if (this.reflecting) return [];
    const agentsDir = join(home, 'hive', 'agents');
    if (!existsSync(agentsDir)) return [];
    const settings = this.getSettings();
    let ids: string[];
    try { ids = readdirSync(agentsDir); } catch { return []; }
    if (onlyId) ids = ids.filter((id) => id === onlyId);
    // An archived agent's memory.md is frozen — condensing it can only ever be
    // busywork, and the scan was walking every retired agent the hive ever had.
    else { const gone = this.archivedIds(home); ids = ids.filter((id) => !gone.has(id)); }

    this.reflecting = true;
    const results: ReflectResult[] = [];
    try {
      for (const id of ids) {
        const mem = join(agentsDir, id, 'memory.md');
        if (!existsSync(mem)) continue;
        // Still inside this agent's abort backoff — the file's shape is what the
        // verifier rejected, and it has not changed since. (Manual calls bypass.)
        if (!onlyId && Date.now() < (this.retry.get(id)?.nextAttemptMs ?? 0)) continue;
        let bytes = 0;
        let text = '';
        try {
          bytes = statSync(mem).size;
          // A manual single-agent call condenses on demand (skips the trigger);
          // the autonomous loop honors the threshold.
          if (!onlyId && !this.shouldCondense(bytes, mem, settings)) continue;
          text = readFileSync(mem, 'utf8');
        } catch { continue; }
        results.push(await this.condense(home, id, mem, text, settings));
      }
    } finally {
      this.reflecting = false;
    }
    this.lastRunMs = Date.now();
    this.lastScanned = ids.length;
    // Only the agents it actually rewrote: a list of forty "skipped" rows buries
    // the one line that matters, which is which file just changed under you.
    this.lastChanged = results.filter((r) => r.condensed);
    return results;
  }

  /** The dual trigger (DECIDED): bytes > pct% of budget, OR many-section sprawl
   *  above the byte floor. The floor doubles as the "never burn an LLM call on a
   *  tiny file" guard, so it gates BOTH paths. */
  private shouldCondense(bytes: number, mem: string, s: ReflectSettings): boolean {
    if (bytes < s.minBytes) return false;
    if (bytes > (BUDGET_BYTES * s.byteTriggerPct) / 100) return true;
    let sections = 0;
    try { sections = countSections(readFileSync(mem, 'utf8')); } catch { return false; }
    return sections > s.sectionTrigger;
  }

  // — condense one file —

  private async condense(
    home: string, id: string, mem: string, text: string, s: ReflectSettings
  ): Promise<ReflectResult> {
    const oldBytes = Buffer.byteLength(text, 'utf8');
    const parsed = parseMemory(text);
    // Split recent into KEEP (newest K, verbatim) and EVICT (older — summarized).
    const keepCount = Math.max(1, s.recentKeep);
    const keep = parsed.recent.slice(-keepCount);
    const evict = parsed.recent.slice(0, Math.max(0, parsed.recent.length - keepCount));
    if (evict.length === 0) {
      return { id, condensed: false, reason: 'nothing-to-evict', oldBytes };
    }

    // 1) BACK UP first — a lossless cold copy makes every later step recoverable.
    const stamp = utcStamp();
    const backup = join(home, 'hive', 'backups', stamp, id, 'memory.md');
    try {
      mkdirSync(dirname(backup), { recursive: true });
      copyFileSync(mem, backup);
    } catch (e) {
      this.logAbort(id, 'backup-failed', String(e));
      return { id, condensed: false, reason: 'backup-failed', oldBytes };
    }

    // 2) SUMMARIZE the (condensed + evicted) tail via headless Haiku.
    let summary: { condensed: string; hoist: string[] };
    try {
      summary = await this.summarize(home, id, parsed.condensed, evict, parsed.pinned);
    } catch (e) {
      this.logAbort(id, 'summarize-failed', String(e));
      return { id, condensed: false, reason: 'summarize-failed', oldBytes };
    }

    // 3) REBUILD into the 3-region shape.
    const oldPinnedLines = pinnedLines(parsed.pinned);
    const mergedPinned = mergePinned(oldPinnedLines, summary.hoist);
    const rebuilt = rebuild(parsed.header, mergedPinned, summary.condensed, keep);
    const newBytes = Buffer.byteLength(rebuilt, 'utf8');

    // 4) VERIFY-DON'T-TRUST — reject the rewrite unless every check holds.
    const verdict = verify({
      rebuilt, newBytes, oldBytes, oldPinnedLines, mergedPinned,
      condensed: summary.condensed, keep
    });
    if (!verdict.ok) {
      this.logAbort(id, verdict.reason, undefined, { oldBytes, newBytes });
      return { id, condensed: false, reason: verdict.reason, oldBytes, newBytes };
    }

    // 5) ATOMIC SWAP — write a temp sibling, fsync, rename over the original.
    try {
      atomicWrite(mem, rebuilt);
    } catch (e) {
      this.logAbort(id, 'swap-failed', String(e), { oldBytes, newBytes });
      return { id, condensed: false, reason: 'swap-failed', oldBytes, newBytes };
    }

    try {
      this.appendLog({
        kind: 'condense', agentId: id, oldBytes, newBytes,
        evicted: evict.length, kept: keep.length, hoisted: summary.hoist.length, backup
      });
    } catch { /* logging is best-effort */ }
    // A clean pass clears the abort backoff — whatever the verifier objected to
    // is gone, so the next oversized file gets the normal cadence again.
    this.retry.delete(id);
    // The miner re-indexes within its next cycle — mtime changed, no extra wiring.
    return { id, condensed: true, reason: 'condensed', oldBytes, newBytes };
  }

  /** Log the abort AND widen this agent's retry window. Both live here so a new
   *  abort path can never be added that logs but keeps retrying every tick. */
  private logAbort(id: string, reason: string, detail?: string, extra?: Record<string, unknown>): void {
    const aborts = (this.retry.get(id)?.aborts ?? 0) + 1;
    const base = Math.max(60_000, this.getSettings().intervalMs);
    const wait = condenseRetryDelayMs(aborts, base);
    this.retry.set(id, { aborts, nextAttemptMs: Date.now() + wait });
    try {
      this.appendLog({
        kind: 'condense-abort', agentId: id, reason,
        ...(detail ? { detail } : {}), ...extra,
        aborts, retryInMs: wait
      });
    } catch { /* best-effort */ }
  }

  /** Retired agent ids. A frozen memory.md has nothing left to condense, and the
   *  scan was walking every agent the hive ever had. Read once per scan — an
   *  unreadable registry yields an empty set, i.e. the old behaviour. */
  private archivedIds(home: string): Set<string> {
    try {
      const reg = JSON.parse(readFileSync(join(home, 'hive', 'registry.json'), 'utf8'));
      const agents = (reg?.agents ?? {}) as Record<string, { archived?: boolean }>;
      return new Set(Object.entries(agents).filter(([, a]) => a?.archived).map(([id]) => id));
    } catch { return new Set(); }
  }

  // — the headless LLM call (the only non-deterministic step) —

  /**
   * Which engine condenses THIS agent's memory, and with what model.
   *
   * The agent's own engine when that engine has a verified one-shot form —
   * a floor of Codex or Qwen workers should not need the Claude CLI installed to
   * bound its own memory, and the spend belongs on the account the agent already
   * spends from. Engines whose headless form we could not check fall back to the
   * configured default rather than being guessed at: a guessed flag doesn't fail
   * loudly, it exits 2 and the file silently never shrinks.
   */
  private planFor(id: string, prompt: string): { plan: CondensePlan; provider: string } | null {
    const models = this.getSettings().condenseModels ?? {};
    const own = this.getProvider(id);
    const fallback = this.fallbackProvider();
    for (const provider of [own, fallback]) {
      const plan = condensePlan(provider, prompt, models[provider]);
      if (!plan) continue;
      // Honor a user-configured `claude` binary (defaultCommand may be a wrapper
      // or an absolute path); every other engine is spawned by its own name.
      if (provider === 'claude') {
        const bin = (this.getCommand() || 'claude').trim().split(/\s+/)[0];
        if (bin) plan.bin = bin;
      }
      return { plan, provider };
    }
    return null;
  }

  /** The configured fallback engine, ignoring a value we have no plan for. */
  private fallbackProvider(): string {
    const configured = (this.getSettings().condenseProvider ?? '').trim();
    return configured && condensePlan(configured, 'probe') ? configured : FALLBACK_PROVIDER;
  }

  private async summarize(
    home: string, id: string, condensed: string | null, evict: Section[], pinned: string | null
  ): Promise<{ condensed: string; hoist: string[] }> {
    const evictText = evict.map((s) => `${s.heading}\n${s.body}`).join('\n\n').trim();
    const prompt = [
      CONDENSE_SYSTEM,
      '',
      '--- INPUT ---',
      '(A) CURRENT CONDENSED SUMMARY:',
      condensed?.trim() || '(none yet)',
      '',
      '(B) OLDER SECTIONS BEING EVICTED:',
      evictText || '(none)',
      '',
      '(C) PINNED DURABLE FACTS (context only — do not rewrite):',
      pinned?.trim() || '(none)'
    ].join('\n');

    const chosen = this.planFor(id, prompt);
    if (!chosen) throw new Error('condense: no engine with a verified one-shot mode');

    const result = await runCondense(chosen.plan, {
      cwd: home,
      env: this.getMemoryEnv(),
      timeoutMs: DEFAULT_TIMEOUT_MS
    });

    if (!result.ok || !result.text) {
      // Name the engine: "summarize-failed" alone can't tell a missing CLI from
      // a refused flag from a model that answered with prose.
      throw new Error(`${chosen.plan.bin}: ${result.error ?? 'returned no text'}`);
    }
    const parsed = parseSummary(result.text);
    if (!parsed) throw new Error('condense: response contained no parseable JSON');
    return parsed;
  }
}

// ─── pure helpers (the deterministic, unit-testable half) ────────────────────

/** Count level-2 (`## `) headings — `# ` H1 and `### ` deeper headings excluded. */
export function countSections(text: string): number {
  return (text.match(/^##\s/gm) ?? []).length;
}

/** Split a memory.md into header + the three regions. A legacy flat file (no
 *  pinned/condensed headings) parses with those null and every `## ` section in
 *  `recent`; the structured blocks are created on first condense. */
export function parseMemory(text: string): Parsed {
  const lines = text.split('\n');
  let firstSection = lines.findIndex((l) => /^##\s/.test(l));
  if (firstSection === -1) firstSection = lines.length;
  const header = lines.slice(0, firstSection).join('\n').replace(/\s+$/, '');

  // Carve the remaining lines into `## ` sections (heading + body until next `##`).
  const sections: Section[] = [];
  let cur: Section | null = null;
  for (let i = firstSection; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) {
      if (cur) sections.push(cur);
      cur = { heading: line, body: '' };
    } else if (cur) {
      cur.body += (cur.body ? '\n' : '') + line;
    }
  }
  if (cur) sections.push(cur);

  let pinned: string | null = null;
  let condensed: string | null = null;
  const recent: Section[] = [];
  for (const s of sections) {
    const h = s.heading.trim();
    if (h.startsWith('## 📌')) pinned = s.body.replace(/\s+$/, '');
    else if (h.startsWith('## 🗜')) condensed = s.body.replace(/\s+$/, '');
    else if (h === RECENT_HEADING) { /* divider — its siblings ARE the recent list */ }
    else recent.push(s);
  }
  return { header, pinned, condensed, recent };
}

/** Non-empty, trimmed lines of the pinned block (the set we must never lose). */
export function pinnedLines(pinned: string | null): string[] {
  if (!pinned) return [];
  return pinned.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** Append hoisted durable facts to the pinned set, skipping any already present. */
export function mergePinned(oldLines: string[], hoist: string[]): string[] {
  const have = new Set(oldLines);
  const out = [...oldLines];
  for (const raw of hoist) {
    const line = (raw ?? '').trim();
    if (line && !have.has(line)) { have.add(line); out.push(line); }
  }
  return out;
}

/** Reassemble the canonical 3-region file. */
export function rebuild(header: string, pinned: string[], condensed: string, keep: Section[]): string {
  const parts: string[] = [];
  if (header.trim()) parts.push(header.trim());
  parts.push(PINNED_HEADING);
  parts.push(pinned.length ? pinned.join('\n') : '_(none yet)_');
  parts.push(CONDENSED_HEADING);
  parts.push(condensed.trim());
  parts.push(RECENT_HEADING);
  for (const s of keep) parts.push(`${s.heading}\n${s.body}`.replace(/\s+$/, ''));
  return parts.join('\n\n') + '\n';
}

/** The verify-don't-trust gate. The rewrite is rejected — original kept verbatim
 *  — unless ALL checks pass. The lossless backup makes a rejection a pure no-op. */
export function verify(args: {
  rebuilt: string; newBytes: number; oldBytes: number;
  oldPinnedLines: string[]; mergedPinned: string[];
  condensed: string; keep: Section[];
}): { ok: true } | { ok: false; reason: string } {
  const { rebuilt, newBytes, oldBytes, oldPinnedLines, mergedPinned, condensed, keep } = args;
  // 6) Valid summary JSON already enforced upstream (parseSummary). Here: structure.
  // 1) Parses back into the 3-region structure.
  const re = parseMemory(rebuilt);
  if (re.pinned === null || re.condensed === null) return { ok: false, reason: 'structure-missing-region' };
  // 4) Non-empty + sane.
  if (newBytes <= 200) return { ok: false, reason: 'too-small' };
  if (!condensed.trim()) return { ok: false, reason: 'empty-condensed' };
  // 3) Actually smaller (a no-op condense is a failure).
  if (!(newBytes < oldBytes * 0.95)) return { ok: false, reason: 'not-smaller' };
  // 2) Pinned preserved: every old pinned line survives (hoist only adds).
  const newPinned = new Set(pinnedLines(re.pinned));
  for (const line of oldPinnedLines) if (!newPinned.has(line)) return { ok: false, reason: 'pinned-line-dropped' };
  for (const line of mergedPinned) if (!newPinned.has(line)) return { ok: false, reason: 'pinned-merge-mismatch' };
  // 5) Recent integrity: the kept newest sections round-trip byte-for-byte.
  if (re.recent.length !== keep.length) return { ok: false, reason: 'recent-count-mismatch' };
  for (let i = 0; i < keep.length; i++) {
    const a = `${keep[i].heading}\n${keep[i].body}`.replace(/\s+$/, '');
    const b = `${re.recent[i].heading}\n${re.recent[i].body}`.replace(/\s+$/, '');
    if (a !== b) return { ok: false, reason: 'recent-section-altered' };
  }
  return { ok: true };
}

/** Pull `{condensed, hoist}` out of `claude -p --output-format json` output.
 *  Two layers: the CLI envelope `{result: "<text>"}`, then the model's strict
 *  JSON (tolerating an accidental ```json fence). Returns null on any failure. */
export function parseSummary(stdout: string): { condensed: string; hoist: string[] } | null {
  const raw = stdout.trim();
  if (!raw) return null;
  let inner = raw;
  try {
    const env = JSON.parse(raw) as { result?: unknown; text?: unknown };
    if (typeof env.result === 'string') inner = env.result;
    else if (typeof env.text === 'string') inner = env.text;
  } catch { /* not the CLI envelope — treat stdout itself as the model output */ }
  inner = inner.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const obj = JSON.parse(inner) as { condensed?: unknown; hoist?: unknown };
    if (typeof obj.condensed !== 'string' || !obj.condensed.trim()) return null;
    const hoist = Array.isArray(obj.hoist) ? obj.hoist.filter((x): x is string => typeof x === 'string') : [];
    return { condensed: obj.condensed, hoist };
  } catch { return null; }
}

/** `20260606T110912Z` — matches the janitor's backup-dir stamp format. */
function utcStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Write `text` to `path` atomically: temp sibling → fsync → rename over target. */
function atomicWrite(path: string, text: string): void {
  const tmp = `${path}.tmp-${Math.random().toString(36).slice(2, 10)}`;
  writeFileSync(tmp, text, 'utf8');
  try {
    const fd = openSync(tmp, 'r+');
    try { fsyncSync(fd); } finally { closeSync(fd); }
  } catch { /* fsync best-effort; rename is the durability guarantee */ }
  renameSync(tmp, path);
}
