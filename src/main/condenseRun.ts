/**
 * Run one engine command, capture one answer, get out.
 *
 * This replaces hiddenClaude.ts, which drove a hidden INTERACTIVE Claude TUI
 * through a PTY: boot-quiet detection, a bracketed-paste prompt, an idle-settle
 * timer, then digging the reply back out of the session transcript on disk —
 * 215 lines of timing heuristics to read one string. A non-interactive one-shot
 * writes that string to stdout, so this is a spawn and a buffer.
 *
 * The trade it makes is deliberate and worth stating: the PTY existed so calls
 * drew on the user's interactive plan quota rather than API credit. Against that
 * it required the Claude CLI on every machine regardless of which engine the
 * floor actually ran, and its spend appeared in no transcript the usage seam
 * reads — so the app's own budgets could not see it. Per-engine one-shots cost
 * where the agent already costs, and are visible where the agent already is.
 */
import { spawn } from 'node:child_process';
import { resolveCommand, userShellPath } from './shellEnv';
import { ensureKilled } from './procKill';
import type { CondensePlan } from '../shared/condense';

export interface CondenseRunResult {
  ok: boolean;
  text?: string;
  error?: string;
}

/**
 * Spawn `plan` and resolve with its stdout.
 *
 * No shell: argv is passed as an array, so a prompt containing quotes, newlines
 * or backticks is data rather than syntax. And the prompt is not in argv at all
 * — it is written to the child's stdin, because argv is parsed for FLAGS before
 * anything reads it for meaning, and a prompt beginning with `--` is read as
 * one. See CondensePlan.stdin.
 *
 * The stream is written once and CLOSED immediately, which keeps the guard
 * condense.ts relies on: an engine that decides to edit a file mid-answer meets
 * an approval prompt on a stdin that is already at EOF, so it gives up instead
 * of writing.
 *
 * On timeout the process tree is killed — a wedged engine must not hold the
 * reflect loop, which is serialized.
 */
export function runCondense(
  plan: CondensePlan,
  opts: { cwd: string; env?: Record<string, string>; timeoutMs?: number }
): Promise<CondenseRunResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(resolveCommand(plan.bin), plan.args, {
        cwd: opts.cwd,
        env: { ...process.env, PATH: userShellPath(), ...(opts.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }

    // Write the prompt, then EOF. An engine that exits before reading it all
    // (a bad flag, a missing key) makes this write fail with EPIPE; that is not
    // the interesting error — the one the user needs is on stderr, and `close`
    // is about to deliver it — so swallow it rather than resolving early with
    // a plumbing message that hides the real one.
    child.stdin?.on('error', () => { /* see close/error handlers */ });
    try {
      child.stdin?.end(plan.stdin);
    } catch { /* same */ }

    let out = '';
    let err = '';
    let done = false;
    const finish = (r: CondenseRunResult): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(() => {
      // Kill the TREE: these CLIs are wrappers, and killing the launcher alone
      // leaves the real process holding the pipe open forever.
      ensureKilled(child.pid);
      finish({ ok: false, error: `condense: timed out after ${opts.timeoutMs ?? 180_000}ms` });
    }, opts.timeoutMs ?? 180_000);

    child.stdout?.on('data', (d) => { out += String(d); });
    child.stderr?.on('data', (d) => { err += String(d); });
    // A missing binary arrives here, not as a throw from spawn().
    child.on('error', (e) => finish({ ok: false, error: e.message }));
    child.on('close', (code) => {
      if (code !== 0) {
        // stderr first: an engine that refuses a flag says so there, and that
        // message is the difference between "fix the flag" and "it just failed".
        finish({ ok: false, error: (err.trim() || `exited ${code}`).slice(0, 400) });
        return;
      }
      finish(out.trim() ? { ok: true, text: out } : { ok: false, error: 'condense: engine returned no output' });
    });
  });
}
