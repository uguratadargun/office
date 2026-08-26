'use strict';

// The per-engine one-shot forms memory condensation spawns. These asserts exist
// because the failure mode here is silent: a wrong flag doesn't throw, it exits
// non-zero inside a best-effort catch and the memory file just never shrinks
// while the log says only `summarize-failed`.

const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const { condensePlan, canCondenseNatively, CONDENSE_VERIFIED, CONDENSE_MODELS } =
  load('src/shared/condense.ts');
const { AGENT_PROVIDER_PRESETS } = load('src/shared/agentProvider.ts');

test('every verified engine produces a plan, and every unverified one produces null', () => {
  for (const id of CONDENSE_VERIFIED) {
    assert.ok(condensePlan(id, 'hi'), `${id} is listed verified but has no plan`);
  }
  // Derived from the presets, so adding an engine forces a decision here rather
  // than letting it silently inherit the fallback.
  for (const p of AGENT_PROVIDER_PRESETS) {
    if (CONDENSE_VERIFIED.includes(p.id)) continue;
    assert.equal(condensePlan(p.id, 'hi'), null,
      `${p.id} returns a plan but is not in CONDENSE_VERIFIED — verify it against the installed binary or drop the plan`);
  }
});

test('the prompt travels on stdin, verbatim and nowhere else', () => {
  // The prompt carries a whole memory.md: quotes, backticks, newlines, `$(...)`.
  // If it were ever joined into a shell string this is the test that breaks.
  // It is not in argv at all any more — argv is parsed for flags before anything
  // reads it as a prompt, and a prompt may legally begin with `--`. See
  // test/pr-review-argv.test.cjs.
  const nasty = 'a "quote" and `tick` and $(rm -rf /) and\nnewline';
  for (const id of CONDENSE_VERIFIED) {
    const plan = condensePlan(id, nasty);
    assert.equal(plan.stdin, nasty, `${id}: prompt must reach stdin verbatim`);
    assert.ok(!plan.args.includes(nasty), `${id}: prompt must not be in argv`);
  }
});

test('no engine is handed its auto-approve flag', () => {
  // Not passing one IS the guard: condensation is a pure text transform, so an
  // engine that decides to write a file must meet a prompt it cannot answer.
  const AUTO = ['--auto', '--yolo', '--yes', '-y', '--auto-approve',
    '--dangerously-skip-permissions', '--permission-mode', '--sandbox'];
  for (const id of CONDENSE_VERIFIED) {
    for (const flag of condensePlan(id, 'hi').args) {
      assert.ok(!AUTO.includes(flag), `${id} passes ${flag} — condensation must not auto-approve tools`);
    }
  }
});

test('claude keeps the deny list the hidden session used to carry', () => {
  const args = condensePlan('claude', 'hi').args;
  assert.ok(args.includes('--disallowedTools'));
  for (const tool of ['Edit', 'Write', 'NotebookEdit', 'Bash']) {
    assert.ok(args.includes(tool), `claude must still deny ${tool}`);
  }
});

test('a model is passed when there is one to pass, and omitted when there is not', () => {
  assert.deepEqual(condensePlan('claude', 'hi').args.slice(0, 3),
    ['-p', '--model', CONDENSE_MODELS.claude]);
  // '' means "use whatever the user configured for that engine" — naming a slug
  // we cannot check would fail at call time; omitting the flag always works.
  assert.equal(CONDENSE_MODELS.opencode, '');
  assert.ok(!condensePlan('opencode', 'hi').args.includes('-m'));
  // An explicit override wins over the table for engines that default to none.
  assert.deepEqual(condensePlan('opencode', 'hi', 'anthropic/claude-haiku-4-5').args,
    ['run', '-m', 'anthropic/claude-haiku-4-5']);
});

test('canCondenseNatively agrees with condensePlan', () => {
  for (const p of AGENT_PROVIDER_PRESETS) {
    assert.equal(canCondenseNatively(p.id), condensePlan(p.id, 'probe') !== null, p.id);
  }
  assert.equal(canCondenseNatively('not-an-engine'), false);
});
