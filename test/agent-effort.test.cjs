'use strict';

/**
 * Per-agent reasoning EFFORT (MD-42).
 *
 * The human asked to choose which effort an agent runs at. Effort is a spawn
 * ARGUMENT, so the only way to get it wrong is to pass a flag an engine does not
 * have — the agent then dies on an unknown argument, which looks like "the app
 * is broken", not "that flag isn't real".
 *
 * So these tests are derived from the presets table rather than pinning a list
 * of engines: adding an engine, or giving one an effortFlag, is covered the
 * moment the preset lands. What they pin is the RULE — a flag is emitted only
 * where the preset declares one AND the level is one the engine lists.
 *
 * Empirical basis (2026-08-21, each engine's own `--help`): claude offers
 * `--effort <low|medium|high|xhigh|max>`; kimi offers only a boolean
 * `--thinking/--no-thinking`; qwen/opencode/copilot offer nothing; codex could
 * not be read here (broken vendored binary) and agy/grok/crush/pi are not
 * installed, so their absence is unproven — see providerChecks.ts.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { buildSpawnCommand } = loadTs('src/shared/spawnCommand.ts');
const {
  AGENT_PROVIDER_PRESETS, providerPreset,
  effortLevelsFor, effortUnsupportedReason, isValidEffort
} = loadTs('src/shared/agentProvider.ts');
const { PROVIDER_CHECKS } = loadTs('src/shared/providerChecks.ts');

const plain = { defaultCommand: 'claude', autoMode: false };

test('an engine with an effortFlag splices every level it declares', () => {
  for (const p of AGENT_PROVIDER_PRESETS) {
    const levels = effortLevelsFor(p.id);
    if (!levels) continue;
    for (const level of levels) {
      const cmd = buildSpawnCommand(plain, undefined, p.id, level);
      assert.match(cmd, new RegExp(`${p.effortFlag} ${level}(\\s|$)`),
        `${p.id} must pass ${p.effortFlag} ${level}`);
    }
  }
});

test('an engine with NO effortFlag never gets an effort argument', () => {
  // The failure this prevents: a level persisted on an agent, then the user
  // switches its engine, and we splice a flag that engine has never heard of.
  for (const p of AGENT_PROVIDER_PRESETS) {
    if (effortLevelsFor(p.id)) continue;
    const cmd = buildSpawnCommand(plain, undefined, p.id, 'high');
    assert.doesNotMatch(cmd, /--effort|\bhigh\b/, `${p.id} must spawn without an effort flag`);
  }
});

test('an unknown level is dropped, not passed through', () => {
  // A level from another engine, or a hand-edited config, must not reach argv.
  for (const p of AGENT_PROVIDER_PRESETS) {
    const cmd = buildSpawnCommand(plain, undefined, p.id, 'ludicrous');
    assert.doesNotMatch(cmd, /ludicrous/, `${p.id} must reject an unlisted level`);
  }
});

test('no effort means no flag at all — the engine keeps its own default', () => {
  for (const p of AGENT_PROVIDER_PRESETS) {
    for (const value of [undefined, '']) {
      const cmd = buildSpawnCommand(plain, undefined, p.id, value);
      if (p.effortFlag) assert.doesNotMatch(cmd, new RegExp(p.effortFlag), `${p.id} must omit the flag`);
    }
  }
});

test('effort composes with model and auto mode instead of replacing them', () => {
  const cmd = buildSpawnCommand({ defaultCommand: 'claude', autoMode: true }, 'claude-opus-5', 'claude', 'xhigh');
  assert.match(cmd, /--model claude-opus-5/);
  assert.match(cmd, /--permission-mode bypassPermissions/);
  assert.match(cmd, /--effort xhigh/);
});

test('isValidEffort agrees with the levels the preset declares', () => {
  for (const p of AGENT_PROVIDER_PRESETS) {
    const levels = effortLevelsFor(p.id) ?? [];
    for (const level of levels) assert.equal(isValidEffort(p.id, level), true, `${p.id}/${level}`);
    assert.equal(isValidEffort(p.id, 'nope'), false);
    assert.equal(isValidEffort(p.id, undefined), false);
  }
});

test('every engine without effort levels can say why — the UI never shows a bare disabled control', () => {
  for (const p of AGENT_PROVIDER_PRESETS) {
    const reason = effortUnsupportedReason(p.id);
    if (effortLevelsFor(p.id)) {
      assert.equal(reason, null, `${p.id} supports effort, so there is no reason to show`);
    } else {
      assert.ok(reason && reason.length > 10, `${p.id} needs a human-readable reason`);
    }
  }
});

test('a declared effortFlag is backed by a Provider Doctor check', () => {
  // The MD-35 rule: a third-party flag this app asserts must be something the
  // app can go and verify. A flag with no check is a claim nobody rechecks.
  for (const p of AGENT_PROVIDER_PRESETS) {
    if (!p.effortFlag) continue;
    const check = PROVIDER_CHECKS.find((c) => c.engine === p.id && c.token === p.effortFlag);
    assert.ok(check, `${p.id} declares ${p.effortFlag} with no check in providerChecks.ts`);
    assert.equal(check.kind, 'flag');
  }
});

test('claude is the engine that actually has one, and its levels match its --help', () => {
  // Verbatim from `claude --help`: "--effort <level>  Effort level for the
  // current session (low, medium, high, xhigh, max)". Pinned because it is the
  // one engine whose control is enabled — if this drifts, the select offers
  // levels the CLI rejects.
  assert.equal(providerPreset('claude').effortFlag, '--effort');
  assert.deepEqual(effortLevelsFor('claude'), ['low', 'medium', 'high', 'xhigh', 'max']);
});
