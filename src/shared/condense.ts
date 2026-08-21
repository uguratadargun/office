/**
 * How to ask an engine for one answer and get out.
 *
 * Memory condensation used to spawn a hidden INTERACTIVE `claude` session for
 * every agent on the floor, whatever engine that agent actually ran. Two costs
 * came with that. A floor of Codex or Qwen workers still needed the Claude CLI
 * installed just to bound its own memory — and on a machine without it, every
 * memory.md grew forever while the log said only `summarize-failed`. And the
 * spend was invisible: a hidden interactive session appears in no transcript the
 * usage seam reads, so it never reached the budgets this app otherwise tracks
 * meticulously.
 *
 * So: each agent's memory is condensed by the engine that agent already runs, in
 * that CLI's own non-interactive one-shot mode.
 *
 * VERIFY-FIRST, and the list below says which is which. Every entry marked
 * verified was checked against the binary installed on this machine — its own
 * `--help`, and for kimi by running it. An engine we could not check is NOT
 * guessed at: `condensePlan` returns null for it and the caller falls back to
 * the configured default engine. A guessed flag does not fail loudly; it spawns
 * something that exits 2, and the memory file silently never shrinks.
 *
 * NO ENGINE HERE IS GIVEN ITS AUTO-APPROVE FLAG — not `opencode --auto`, not
 * `kimi --yolo`, no `--permission-mode`. That omission IS the guard, and it is
 * the one guard every engine honors: condensation is a pure text transform, so
 * an engine that decides to edit a file mid-answer meets an approval prompt it
 * cannot answer (the runner closes stdin) instead of a write. Claude also gets
 * an explicit deny list, because it is the one with a verified flag for one.
 */

export interface CondensePlan {
  /** The binary to spawn (bare name; the caller resolves it on PATH). */
  bin: string;
  /** argv after the binary. The prompt is passed as an argument, not via a
   *  shell, so nothing here needs quoting. */
  args: string[];
}

/**
 * The model each engine condenses with. Hand-edited, no network — same contract
 * as pricing.ts. A cheap model is the right default: this is a bounded text
 * transform whose output is checked by a verify gate before anything is written.
 *
 * An empty string means "do not pass a model flag" — the engine uses whatever
 * the user configured. That is deliberate for engines whose model ids are
 * account-specific (opencode's `provider/model`) or drift often: naming a slug
 * we cannot check would fail at call time, while omitting the flag always works.
 */
export const CONDENSE_MODELS: Record<string, string> = {
  claude: 'claude-haiku-4-5',
  codex: '',
  antigravity: '',
  qwen: '',
  opencode: '',
  kimi: '',
  crush: '',
  grok: '',
  pi: '',
  copilot: ''
};

/** Engines whose one-shot form was checked against an installed binary. */
export const CONDENSE_VERIFIED: readonly string[] = ['claude', 'qwen', 'opencode', 'kimi'];

/**
 * The one-shot command for an engine, or null when we have not verified one.
 *
 * @param provider agent provider id
 * @param prompt   the full condensation prompt
 * @param model    override for CONDENSE_MODELS; '' or undefined omits the flag
 */
export function condensePlan(
  provider: string,
  prompt: string,
  model?: string
): CondensePlan | null {
  const m = (model ?? CONDENSE_MODELS[provider] ?? '').trim();
  switch (provider) {
    // `claude -p <prompt>`: "starts an interactive session by default, use
    // -p/--print for non-interactive output" (claude --help).
    case 'claude':
      return {
        bin: 'claude',
        args: [
          '-p', prompt,
          ...(m ? ['--model', m] : []),
          // Carried over from the hidden-session call this replaced.
          '--disallowedTools', 'Edit', 'Write', 'NotebookEdit', 'Bash'
        ]
      };
    // `qwen -p <prompt>`: "-p, --prompt  Prompt. Appended to input on stdin"
    // and "-prompt for non-interactive mode" (qwen --help).
    case 'qwen':
      return { bin: 'qwen', args: ['-p', prompt, ...(m ? ['-m', m] : [])] };
    // `opencode run <message>`: "run opencode with a message", model as
    // `-m provider/model` (opencode run --help).
    case 'opencode':
      return { bin: 'opencode', args: ['run', prompt, ...(m ? ['-m', m] : [])] };
    // `kimi --quiet -p <prompt>`: --quiet is documented as an alias for
    // `--print --output-format text --final-message-only`, i.e. exactly one
    // answer on stdout. Confirmed by running it.
    case 'kimi':
      return { bin: 'kimi', args: ['--quiet', '-p', prompt, ...(m ? ['-m', m] : [])] };
    default:
      // codex, antigravity, crush, grok, pi, copilot. Codex's headless form is
      // `codex exec`, referenced elsewhere in this repo, but the installed copy
      // here is broken (its vendored native binary is missing) so it could not be
      // run — and the rest are not installed at all. Unverified means null.
      return null;
  }
}

/** Whether an engine can condense its own memory, or needs the fallback. */
export function canCondenseNatively(provider: string): boolean {
  return condensePlan(provider, 'probe') !== null;
}
