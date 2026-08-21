'use strict';

/**
 * Voice hire builds the SAME command as the hire form.
 *
 * It used to build its own, from a hand-maintained `PROVIDER_COMMAND` map in
 * realtimeActions.ts that had drifted away from the presets:
 *   • antigravity → "antigravity", but the binary is `agy`
 *   • a `gemini` key for a provider id that does not exist
 *   • grok and kimi missing entirely, so "hire a grok agent" silently spawned
 *     Claude — the user heard the right thing and got the wrong engine
 *   • no --model and no auto-mode flag, ever
 *
 * The map is gone; both callers use buildSpawnCommand. These tests pin the
 * properties that let the copy rot unnoticed, so a future second copy fails
 * loudly instead.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { buildSpawnCommand } = loadTs('src/shared/spawnCommand.ts');
const { AGENT_PROVIDER_PRESETS, providerPreset } = loadTs('src/shared/agentProvider.ts');

const plain = { defaultCommand: 'claude', autoMode: false };
const auto = { defaultCommand: 'claude', autoMode: true };

test('every provider spawns the binary its own preset names', () => {
  // This is the invariant the old map broke. Derived from the presets, so a new
  // engine cannot be added without being covered.
  for (const p of AGENT_PROVIDER_PRESETS) {
    if (p.id === 'claude' || p.id === 'custom') continue; // both defer to the user's defaultCommand
    const cmd = buildSpawnCommand(plain, undefined, p.id);
    assert.equal(cmd.split(/\s+/)[0], p.defaultCommand, `${p.id} must spawn ${p.defaultCommand}`);
  }
});

test('antigravity spawns `agy`, not "antigravity"', () => {
  // The exact drift: the map said "antigravity", which is not a binary.
  assert.equal(providerPreset('antigravity').defaultCommand, 'agy');
  assert.equal(buildSpawnCommand(plain, undefined, 'antigravity').split(/\s+/)[0], 'agy');
});

test('grok and kimi build real commands — they were absent from the old map', () => {
  for (const id of ['grok', 'kimi']) {
    const cmd = buildSpawnCommand(plain, undefined, id);
    assert.equal(cmd.split(/\s+/)[0], providerPreset(id).defaultCommand);
    assert.notEqual(cmd.split(/\s+/)[0], 'claude', `${id} must not fall through to Claude`);
  }
});

test('there is no "gemini" provider id — the old map invented one', () => {
  assert.equal(AGENT_PROVIDER_PRESETS.some((p) => p.id === 'gemini'), false,
    'gemini ships as `antigravity`; a gemini key could never match');
});

test('a model override reaches the command line', () => {
  const cmd = buildSpawnCommand(plain, 'claude-sonnet-5', 'claude');
  assert.match(cmd, /--model claude-sonnet-5/);
});

test('a model containing spaces is quoted, so it stays one argument', () => {
  // agy takes display-name labels like "Gemini 3.1 Pro (High)".
  const cmd = buildSpawnCommand(plain, 'Gemini 3.1 Pro (High)', 'antigravity');
  assert.match(cmd, /--model "Gemini 3\.1 Pro \(High\)"/);
});

test('auto mode appends each provider\'s own skip-permissions flag', () => {
  for (const p of AGENT_PROVIDER_PRESETS) {
    if (!p.autoFlag) continue;
    assert.ok(buildSpawnCommand(auto, undefined, p.id).endsWith(p.autoFlag),
      `${p.id} must end with ${p.autoFlag} in auto mode`);
  }
  // ...and never when auto mode is off.
  assert.equal(buildSpawnCommand(plain, undefined, 'claude').includes('--dangerously'), false);
});

test('claude honours the user\'s configured defaultCommand; others ignore it', () => {
  const custom = { defaultCommand: '/opt/bin/claude', autoMode: false };
  assert.equal(buildSpawnCommand(custom, undefined, 'claude').split(/\s+/)[0], '/opt/bin/claude');
  assert.equal(buildSpawnCommand(custom, undefined, 'codex').split(/\s+/)[0], 'codex',
    'a non-Claude engine must work without Claude installed');
});
