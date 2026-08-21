'use strict';

/**
 * Provider Doctor.
 *
 * The presets and the MCP catalog assert facts about other people's CLIs — flag
 * names, model ids, env vars — written from documentation and marked
 * `// TODO-verify` by whoever could not check them. They rot silently, and the
 * symptom is never "wrong flag": it is an agent that will not start, or one that
 * starts and quietly ignores auto-mode.
 *
 * The fixtures below are REAL `--help` output captured from the binaries
 * installed on this machine, including their warts — kimi renders through a
 * box-drawing library that ELIDES the flag column at narrow widths, and a broken
 * npm wrapper can run while printing no flags at all. Both made an earlier draft
 * of this checker confidently wrong, which is what these tests exist to prevent.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  PROVIDER_CHECKS, UNVERIFIABLE_FACTS, classify,
  helpMentionsFlag, looksLikeHelp, looksTruncated, stripAnsi
} = loadTs('src/shared/providerChecks.ts');
const { AGENT_PROVIDER_PRESETS } = loadTs('src/shared/agentProvider.ts');

// Real qwen --help (trimmed).
const QWEN_HELP = [
  '  -m, --model               Model                                       [string]',
  '      --fallback-model      Fallback model(s) for capacity errors, repeatable',
  '  -p, --prompt              Prompt. Appended to input on stdin (if any). [string]',
  '  -i, --prompt-interactive  Execute the provided prompt and continue interactive',
  '      --safe-mode           Disable all customizations',
  '  -s, --sandbox             Run in sandbox?                            [boolean]',
  '  -c, --continue            Resume the most recent session',
  '  -r, --resume              Resume a specific session by its ID',
  '  -v, --version             Show version number                        [boolean]'
].join('\n');

// Real kimi --help at 80 columns: the flag column is CUT SHORT with an ellipsis.
const KIMI_HELP_TRUNCATED = [
  '╭─ Options ───────────╮',
  '│ --yolo,--yes,--…  -y      Automatically     │',
  '│                          approve all       │',
  '╰────────────────────╯'
].join('\n');

// The same kimi given a wide COLUMNS — now the flags are all there.
const KIMI_HELP_WIDE = [
  '│ --model                      -m     TEXT   LLM model to use.                 │',
  '│ --yolo,--yes,--auto-approve  -y            Automatically approve all actions. │'
].join('\n');

// A broken npm wrapper: it runs, and prints no flag list at all.
const CODEX_BROKEN = [
  'Error: spawn /Users/x/node_modules/@openai/codex-darwin-arm64/vendor/codex ENOENT',
  '    at ChildProcess._handle.onexit (node:internal/child_process:285:19)'
].join('\n');

const ESC = String.fromCharCode(27);

const check = (over) => ({ id: 't/x', engine: 'qwen', kind: 'flag', claim: 'c', source: 's', ...over });

// ── the spec table ──────────────────────────────────────────────────────────

test('every engine preset has a binary check — a new engine cannot slip in unchecked', () => {
  const checked = new Set(PROVIDER_CHECKS.filter((c) => c.kind === 'binary').map((c) => c.engine));
  for (const p of AGENT_PROVIDER_PRESETS) {
    if (p.id === 'custom') continue; // no fixed binary by definition
    assert.ok(checked.has(p.id), `${p.id} has no binary check`);
  }
});

test('check ids are unique and each says where its claim lives', () => {
  const ids = PROVIDER_CHECKS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate check id');
  for (const c of PROVIDER_CHECKS) assert.ok(c.source, `${c.id} does not say where the claim lives`);
});

test('facts that cannot be settled locally are ADMITTED, not checked', () => {
  // The temptation is to "verify" a model id by pattern-matching it. That would
  // be the same sin as the TODO-verify comments: a confident guess.
  assert.ok(UNVERIFIABLE_FACTS.length >= 6);
  for (const f of UNVERIFIABLE_FACTS) {
    assert.ok(f.why && f.source, `${f.id} must say why it cannot be checked, and where it lives`);
  }
});

// ── parsing ─────────────────────────────────────────────────────────────────

test('flag matching is word-bounded', () => {
  assert.equal(helpMentionsFlag(QWEN_HELP, '--resume'), true);
  assert.equal(helpMentionsFlag(QWEN_HELP, '--model'), true);
  assert.equal(helpMentionsFlag(QWEN_HELP, '--yolo'), false, 'qwen has no --yolo');
  assert.equal(helpMentionsFlag('  --fallback-model  only', '--model'), false);
  assert.equal(helpMentionsFlag('  --auto-approve  ', '--auto'), false,
    '--auto-approve does not prove --auto exists');
  assert.equal(helpMentionsFlag(KIMI_HELP_WIDE, '--auto-approve'), true,
    'comma-separated aliases still match');
});

test('ANSI styling does not hide a flag that is there', () => {
  const styled = ESC + '[1m  --resume' + ESC + '[0m   Resume a session';
  assert.equal(helpMentionsFlag(styled, '--resume'), true);
  assert.equal(stripAnsi(styled).includes(ESC), false);
});

test('truncated flag columns cannot prove a flag is ABSENT', () => {
  assert.equal(looksTruncated(KIMI_HELP_TRUNCATED), true);
  assert.equal(looksTruncated(KIMI_HELP_WIDE), false);
  assert.equal(looksTruncated(QWEN_HELP), false);
});

test('output with no flags at all is not a flag list', () => {
  assert.equal(looksLikeHelp(CODEX_BROKEN), false, 'an ENOENT stack trace is not help');
  assert.equal(looksLikeHelp(QWEN_HELP), true);
  assert.equal(looksLikeHelp(''), false);
});

// ── classification ──────────────────────────────────────────────────────────

test('a missing binary is not-installed — never ok, never a mismatch', () => {
  const r = classify(check({ kind: 'binary' }), { installed: false }, 1);
  assert.equal(r.status, 'not-installed');
  assert.notEqual(r.status, 'ok', 'an engine we cannot see must not report a clean bill');
});

test('a present flag is ok; a genuinely absent one is a mismatch', () => {
  assert.equal(classify(check({ token: '--resume' }), { installed: true, helpText: QWEN_HELP }, 1).status, 'ok');
  assert.equal(classify(check({ token: '--yolo' }), { installed: true, helpText: QWEN_HELP }, 1).status, 'mismatch');
});

test('a claim of ABSENCE inverts the test', () => {
  const absent = check({ token: '--resume', claim: 'qwen has NO resume flag' });
  assert.equal(classify(absent, { installed: true, helpText: QWEN_HELP }, 1).status, 'mismatch',
    '--resume IS offered, so the no-resume claim is wrong');
  assert.equal(classify(absent, { installed: true, helpText: '  --model x' }, 1).status, 'ok');
});

test('truncated or flagless output is unverifiable, never a mismatch', () => {
  // Reporting "your preset is wrong" from elided text sends someone to edit a
  // preset that was right. Both of these bit an earlier draft of this checker.
  const kimi = classify(check({ engine: 'kimi', token: '--auto-approve' }),
    { installed: true, helpText: KIMI_HELP_TRUNCATED }, 1);
  assert.equal(kimi.status, 'unverifiable');
  assert.match(kimi.detail, /truncated/);

  const codex = classify(check({ engine: 'codex', token: '--model' }),
    { installed: true, helpText: CODEX_BROKEN }, 1);
  assert.equal(codex.status, 'unverifiable');

  const noHelp = classify(check({ token: '--model' }), { installed: true, error: 'timed out' }, 1);
  assert.equal(noHelp.status, 'unverifiable');
  assert.match(noHelp.detail, /timed out/);
});

test('results carry the timestamp they were produced with', () => {
  assert.equal(classify(check({ kind: 'binary' }), { installed: true }, 4242).ts, 4242);
});

// ── the facts this card actually fixed ──────────────────────────────────────

test('the qwen preset now matches the installed qwen', () => {
  const qwen = AGENT_PROVIDER_PRESETS.find((p) => p.id === 'qwen');
  // --yolo does not exist on qwen; passing it made auto-mode spawns fail.
  assert.equal(qwen.autoModeFlag, '', 'qwen has no auto-approve flag');
  assert.equal(qwen.autoFlag, undefined);
  assert.equal(helpMentionsFlag(QWEN_HELP, '--yolo'), false);
  // qwen DOES resume; recording undefined meant restarts silently began anew.
  assert.equal(qwen.resumeFlag, '--resume');
  assert.equal(helpMentionsFlag(QWEN_HELP, '--resume'), true);
});
