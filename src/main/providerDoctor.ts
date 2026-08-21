/**
 * Provider Doctor — runs the checks in shared/providerChecks.ts.
 *
 * Why this exists: the presets and the MCP catalog assert facts about other
 * people's CLIs — flag names, model ids, env vars — written from documentation
 * and carrying `// TODO-verify` comments that nothing ever acted on. When one
 * rots the symptom is never "wrong flag": it is an agent that will not start, or
 * one that starts and silently ignores auto-mode.
 *
 * The runner only reads `--help`. It never spawns an agent, never touches the
 * network, and never writes to a provider's config.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { resolveCommand, userShellPath } from './shellEnv';
import {
  PROVIDER_CHECKS, classify, type CheckResult
} from '../shared/providerChecks';
import { providerPreset, AGENT_PROVIDER_PRESETS } from '../shared/agentProvider';

/** A `--help` that has not answered in this long is not going to. Bounded so a
 *  hung CLI cannot wedge the whole run.
 *
 *  Generous on purpose: this is a manual, user-triggered sweep, not a hot path,
 *  and several of these CLIs are npm wrappers that resolve a vendored binary
 *  before printing anything. At 5s the same install reported `mismatch` on one
 *  run and `timed out` on the next while six spawns contended — a flaky verdict
 *  about someone's config is worse than a slow one. */
const HELP_TIMEOUT_MS = 15_000;

export interface DoctorReport {
  ranAt: number;
  results: CheckResult[];
}

/** Read `<bin> --help`, or say why we could not. Never throws, never inherits
 *  stdio — a CLI that decides to be interactive must not capture the app. */
function readHelp(bin: string): Promise<{ installed: boolean; helpText?: string; error?: string }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(resolveCommand(bin), ['--help'], {
        // COLUMNS matters more than it looks. CLIs that render help through a
        // box-drawing library (kimi via Rich/Click) TRUNCATE the flag column to
        // the terminal width — at 80 columns kimi's auto flag prints as
        // `--yolo,--yes,--…`, so a checker would report "--auto is missing"
        // when the real answer is "the output was elided". A verdict about
        // someone's config must not depend on terminal width.
        env: { ...process.env, PATH: userShellPath(), COLUMNS: '400', TERM: 'dumb', NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (e) {
      resolve({ installed: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
    let out = '';
    let settled = false;
    const done = (r: { installed: boolean; helpText?: string; error?: string }): void => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* already gone */ }
      resolve(r);
    };
    const timer = setTimeout(() => done({ installed: true, error: `--help timed out after ${HELP_TIMEOUT_MS}ms` }), HELP_TIMEOUT_MS);
    // Many CLIs print help to stderr; read both.
    child.stdout?.on('data', (d) => { out += String(d); });
    child.stderr?.on('data', (d) => { out += String(d); });
    child.on('error', (e) => { clearTimeout(timer); done({ installed: false, error: e.message }); });
    // 'exit', not 'close'. Several of these CLIs are npm wrappers that spawn a
    // vendored binary; the grandchild can keep the inherited pipes open long
    // after the wrapper is gone, so 'close' never fires and a CLI that in fact
    // answered instantly is reported as a timeout. Observed here with `codex`,
    // whose wrapper exits 1 immediately with an ENOENT for its own vendored
    // binary — a broken install that read as "hung".
    child.on('exit', () => {
      clearTimeout(timer);
      // Give any buffered output a moment to arrive, then decide.
      setTimeout(() => {
        // A non-zero exit is fine — plenty of CLIs exit 1 after printing help.
        done(out.trim() ? { installed: true, helpText: out } : { installed: true, error: 'no --help output' });
      }, 150);
    });
  });
}

/** The binary a check's engine spawns, from the preset — never a second copy of
 *  that mapping (see MD-19: a hand-maintained duplicate is how these drift). */
function binaryFor(engine: string): string | null {
  const preset = AGENT_PROVIDER_PRESETS.find((p) => p.id === engine);
  return preset ? providerPreset(preset.id).defaultCommand : null;
}

/**
 * Run every check. One `--help` per engine, reused across that engine's checks,
 * so the whole sweep costs at most one spawn per installed CLI.
 */
export async function runDoctor(now = Date.now()): Promise<DoctorReport> {
  const engines = [...new Set(PROVIDER_CHECKS.map((c) => c.engine))];
  const evidence = new Map<string, { installed: boolean; helpText?: string; error?: string }>();
  await Promise.all(engines.map(async (engine) => {
    const bin = binaryFor(engine);
    if (!bin) { evidence.set(engine, { installed: false, error: 'no preset for this engine' }); return; }
    evidence.set(engine, await readHelp(bin));
  }));
  const results = PROVIDER_CHECKS.map((c) =>
    classify(c, evidence.get(c.engine) ?? { installed: false }, now));
  return { ranAt: now, results };
}

/** Where the last report is cached, so the panel has something to show before
 *  the user ever presses "run again". */
export function reportPath(harnessHome: string): string {
  return join(harnessHome, 'doctor-report.json');
}

export function saveReport(harnessHome: string, report: DoctorReport): void {
  try {
    const p = reportPath(harnessHome);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(report, null, 2), 'utf8');
  } catch { /* a cache that cannot be written is not worth failing the run */ }
}

export function loadReport(harnessHome: string): DoctorReport | null {
  try {
    const p = reportPath(harnessHome);
    if (!existsSync(p)) return null;
    const d = JSON.parse(readFileSync(p, 'utf8')) as DoctorReport;
    return Array.isArray(d?.results) ? d : null;
  } catch {
    return null;
  }
}
