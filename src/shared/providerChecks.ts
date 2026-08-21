/**
 * Provider Doctor — the third-party facts this app asserts, as executable checks.
 *
 * The engine presets and the MCP catalog encode a lot of things that are true of
 * somebody else's software: flag names, model ids, package names, env vars. They
 * were written from documentation and they rot silently. When one is wrong the
 * failure is never "wrong flag" — it is an agent that won't start, or one that
 * starts and quietly ignores auto-mode, or a model picker offering ids the CLI
 * no longer accepts.
 *
 * Every `// TODO-verify` in the codebase should map to a check here, so "we are
 * not sure about this" becomes a thing the app can go and find out.
 *
 * The table is PURE — no spawning, no fs. The runner (main/providerDoctor.ts)
 * executes it. That split is what lets the parsers be tested against fixture
 * `--help` output captured from the real binaries.
 */

/** What a check looks at. */
export type CheckKind =
  /** Is the engine's binary on PATH at all? Gates every other check for it. */
  | 'binary'
  /** Does `<bin> --help` mention this flag? */
  | 'flag'
  /** Does `<bin> --help` mention this env var? */
  | 'env';

export interface ProviderCheck {
  /** Stable id — referenced from the code the check discharges. */
  id: string;
  /** Provider preset id, or 'mcp' for catalog facts. */
  engine: string;
  kind: CheckKind;
  /** Human sentence: what we currently CLAIM. */
  claim: string;
  /** The flag/env token to look for; unused for 'binary'. */
  token?: string;
  /** Where the claim lives, so a mismatch points at the line to fix. */
  source: string;
}

/** A check's outcome. `unverifiable` is a first-class answer, not a failure:
 *  plenty of facts (a model id, an npm package name) cannot be settled by
 *  reading `--help`, and pretending otherwise would be the same sin as the
 *  TODO-verify comments. */
export type CheckStatus = 'ok' | 'mismatch' | 'not-installed' | 'unverifiable';

export interface CheckResult {
  id: string;
  engine: string;
  status: CheckStatus;
  /** What we actually observed — the evidence, not a verdict. */
  detail: string;
  /** Epoch ms. */
  ts: number;
}

/**
 * The checks.
 *
 * Deliberately narrow: only facts a local `--help` can actually settle. Model
 * ids and MCP package names are recorded as `unverifiable` rather than guessed
 * at — see UNVERIFIABLE_FACTS.
 */
export const PROVIDER_CHECKS: ProviderCheck[] = [
  { id: 'claude/binary',  engine: 'claude',      kind: 'binary', claim: 'the `claude` binary is installed', source: 'agentProvider.ts claude.defaultCommand' },
  { id: 'codex/binary',   engine: 'codex',       kind: 'binary', claim: 'the `codex` binary is installed', source: 'agentProvider.ts codex.defaultCommand' },
  { id: 'agy/binary',     engine: 'antigravity', kind: 'binary', claim: 'the `agy` binary is installed', source: 'agentProvider.ts antigravity.defaultCommand' },
  { id: 'grok/binary',    engine: 'grok',        kind: 'binary', claim: 'the `grok` binary is installed', source: 'agentProvider.ts grok.defaultCommand' },
  { id: 'kimi/binary',    engine: 'kimi',        kind: 'binary', claim: 'the `kimi` binary is installed', source: 'agentProvider.ts kimi.defaultCommand' },
  { id: 'qwen/binary',    engine: 'qwen',        kind: 'binary', claim: 'the `qwen` binary is installed', source: 'agentProvider.ts qwen.defaultCommand' },
  { id: 'opencode/binary', engine: 'opencode',   kind: 'binary', claim: 'the `opencode` binary is installed', source: 'agentProvider.ts opencode.defaultCommand' },
  { id: 'crush/binary',   engine: 'crush',       kind: 'binary', claim: 'the `crush` binary is installed', source: 'agentProvider.ts crush.defaultCommand' },
  { id: 'pi/binary',      engine: 'pi',          kind: 'binary', claim: 'the `pi` binary is installed', source: 'agentProvider.ts pi.defaultCommand' },
  { id: 'copilot/binary', engine: 'copilot',     kind: 'binary', claim: 'the `copilot` binary is installed', source: 'agentProvider.ts copilot.defaultCommand' },

  // The flag facts that were carrying a TODO-verify.
  { id: 'qwen/auto-flag', engine: 'qwen', kind: 'flag', token: '--yolo',
    claim: 'qwen auto-approves with --yolo (gemini-cli heritage)',
    source: 'agentProvider.ts qwen.autoModeFlag / autoFlag' },
  { id: 'qwen/initial-prompt', engine: 'qwen', kind: 'flag', token: '--prompt-interactive',
    claim: 'qwen orients an interactive session with -i / --prompt-interactive',
    source: 'agentProvider.ts qwen.initialPromptFlag' },
  { id: 'qwen/resume', engine: 'qwen', kind: 'flag', token: '--resume',
    claim: 'qwen has NO resume flag (resumeFlag: undefined)',
    source: 'agentProvider.ts qwen.resumeFlag' },
  { id: 'qwen/model-flag', engine: 'qwen', kind: 'flag', token: '--model',
    claim: 'qwen takes --model', source: 'agentProvider.ts qwen.modelFlag' },
  { id: 'agy/auto-flag', engine: 'antigravity', kind: 'flag', token: '--dangerously-skip-permissions',
    claim: 'agy auto-approves with --dangerously-skip-permissions',
    source: 'agentProvider.ts antigravity.autoModeFlag' },
  { id: 'agy/initial-prompt', engine: 'antigravity', kind: 'flag', token: '-i',
    claim: 'agy orients an interactive session with -i',
    source: 'agentProvider.ts antigravity.initialPromptFlag' },
  { id: 'codex/model-flag', engine: 'codex', kind: 'flag', token: '--model',
    claim: 'codex takes --model', source: 'agentProvider.ts codex.modelFlag' },
  // NB: the preset says --auto-approve, and kimi really does take it
  // (`--yolo,--yes,--auto-approve,-y`). An earlier draft of this check asserted
  // `--auto` and reported the preset as broken — the CHECK was wrong. This table
  // asserts third-party facts too, and is no more trustworthy than the presets.
  { id: 'kimi/auto-flag', engine: 'kimi', kind: 'flag', token: '--auto-approve',
    claim: 'kimi auto-approves with --auto-approve', source: 'agentProvider.ts kimi.autoFlag' },
  { id: 'opencode/prompt-flag', engine: 'opencode', kind: 'flag', token: '--prompt',
    claim: 'opencode orients with --prompt', source: 'agentProvider.ts opencode.initialPromptFlag' },
];

/**
 * Facts that genuinely cannot be settled locally, listed so they are ADMITTED
 * rather than silently assumed.
 *
 * A model id needs a live API call with the user's credentials; an npm/uvx
 * package name needs a registry lookup. Both are network calls this app does not
 * make. The honest answer is "unverified", and the Doctor says so out loud
 * instead of leaving a comment nobody reads.
 */
export const UNVERIFIABLE_FACTS: Array<{ id: string; claim: string; source: string; why: string }> = [
  { id: 'codex/model-id', claim: 'gpt-5-codex is a valid codex model id', source: 'agentProvider.ts:227', why: 'needs a live API call with the user’s credentials' },
  { id: 'qwen/model-id', claim: 'qwen3-coder-plus is a valid qwen model id', source: 'agentProvider.ts:333', why: 'needs a live API call' },
  { id: 'qwen/base-url-env', claim: 'qwen reads OPENAI_BASE_URL for its upstream', source: 'agentProvider.ts:327', why: 'not documented in --help; only an intercepted request proves it' },
  { id: 'mcp/postgres-package', claim: 'the Postgres MCP server package name', source: 'mcpCatalog.ts:130', why: 'needs a registry lookup' },
  { id: 'mcp/gsuite-package', claim: 'the Gmail/Calendar MCP server package name', source: 'mcpCatalog.ts:145', why: 'needs a registry lookup' },
  { id: 'mcp/brave-package', claim: 'the Brave Search MCP server package name', source: 'mcpCatalog.ts:154', why: 'needs a registry lookup' },
  { id: 'models/live-slugs', claim: 'the model id lists offered in the picker', source: 'store/config.ts:222,233,253,270,283', why: 'they drift per provider; needs a live models call per engine' }
];

/** Strip ANSI escapes before matching. Several of these CLIs render help through
 *  a styling library (kimi via Rich/Click, for one), and an escape sequence
 *  landing mid-token makes a flag that IS offered look absent. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');
}

/** Did the CLI cut its own flag list short? Rich/Click-style box output elides
 *  with `…` when the terminal is narrow, and absence-of-token in elided text
 *  proves nothing. */
export function looksTruncated(text: string): boolean {
  return /(--…|…\s*│|,--…)/.test(stripAnsi(text));
}

/** Does the output look like a flag list at all?
 *
 *  A CLI can "succeed" and print something that is not help: a broken npm
 *  wrapper printing an ENOENT for its own vendored binary (observed here with
 *  `codex`), or a top-level usage banner that defers every flag to a
 *  subcommand. Concluding "the flag is wrong" from that is worse than admitting
 *  we could not tell — one sends someone to edit a correct preset. */
export function looksLikeHelp(text: string): boolean {
  return /(^|\s)--[a-z][a-z0-9-]*/i.test(stripAnsi(text));
}

/** Does this `--help` output offer `token` as a flag?
 *
 *  Matched on a word boundary so `--model` does not match `--model-fallback`,
 *  and `-i` does not match every word containing an i. Help text wraps and
 *  aligns in columns, so anchoring to line starts would miss real flags. */
export function helpMentionsFlag(helpText: string, token: string): boolean {
  if (!token) return false;
  const text = stripAnsi(helpText);
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A flag is followed by whitespace, '=', ',' or end — never by another
  // word character or '-', which is what separates --model from --model-x.
  return new RegExp(`(^|[\\s,(\\[])${esc}([\\s,=)\\]]|$)`, 'm').test(text);
}

/** Turn one check + its evidence into a result. Pure, so the classification is
 *  testable without spawning anything. */
export function classify(
  check: ProviderCheck,
  evidence: { installed: boolean; helpText?: string; error?: string },
  now: number
): CheckResult {
  const base = { id: check.id, engine: check.engine, ts: now };
  if (!evidence.installed) {
    return { ...base, status: 'not-installed', detail: `${check.engine}: binary not found on PATH` };
  }
  if (check.kind === 'binary') return { ...base, status: 'ok', detail: 'found on PATH' };
  const present = helpMentionsFlag(evidence.helpText ?? '', check.token ?? '');
  if (!evidence.helpText) {
    // Installed but we could not read its help — unknown, NOT ok.
    return { ...base, status: 'unverifiable', detail: evidence.error || 'could not read --help output' };
  }
  // A flag column that was elided cannot prove absence. Only claim a mismatch
  // when the token is genuinely missing from output that was not cut short.
  if (!present && looksTruncated(evidence.helpText)) {
    return {
      ...base, status: 'unverifiable',
      detail: `--help output looks truncated; cannot prove ${check.token} is absent`
    };
  }
  if (!looksLikeHelp(evidence.helpText)) {
    return {
      ...base, status: 'unverifiable',
      detail: 'ran, but printed no flag list (broken install, or flags live under a subcommand)'
    };
  }
  // A claim of ABSENCE ("has NO resume flag") is satisfied by the token being
  // missing, so the expected polarity comes from the claim itself.
  const expectsAbsence = /\bNO\b/.test(check.claim);
  const matches = expectsAbsence ? !present : present;
  return {
    ...base,
    status: matches ? 'ok' : 'mismatch',
    detail: present
      ? `--help offers ${check.token}`
      : `--help does not mention ${check.token}`
  };
}
