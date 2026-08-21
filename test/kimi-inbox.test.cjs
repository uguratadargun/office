'use strict';

/**
 * Kimi: the flags it actually accepts, and why it can now be handed hive mail.
 *
 * Everything here was checked against kimi-cli 1.6 installed on this machine,
 * not against documentation. Two things the preset asserted were false:
 *
 *   - `--auto` does not exist. The CLI answers `No such option: --auto
 *     (Possible options: --agent, --auto-approve, --quiet)`, so every kimi agent
 *     spawned in auto mode died on a usage error before printing a line.
 *   - kimi has no lifecycle hooks. The only occurrence of "hook" in the whole
 *     installed package is PyInstaller's build hooks.
 *
 * It does not need hooks: routed mail reaches a non-inbox provider as a terminal
 * WORK ORDER typed into its live TUI, gated on idle, and the renderer's
 * provider-agnostic PTY-quiescence fallback supplies the idle. What it does need
 * is to boot at all, and to have its protocol seed typed in like Crush's.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  AGENT_PROVIDER_PRESETS, providerPreset, canReceiveInbox,
  inboxUnsupportedReason, inboxUnsupportedEngines
} = loadTs('src/shared/agentProvider.ts');

test('kimi never spawns with the flag the CLI rejects', () => {
  const kimi = providerPreset('kimi');
  for (const flag of [kimi.autoModeFlag, kimi.autoFlag]) {
    assert.equal(flag, '--auto-approve');
    // The exact string the installed CLI refuses. Guarding on the whole value
    // rather than a substring: '--auto-approve' contains '--auto'.
    assert.notEqual(flag, '--auto', 'the CLI answers "No such option: --auto"');
  }
});

test('kimi can be handed hive mail, and has a way to receive its protocol', () => {
  const kimi = providerPreset('kimi');
  assert.equal(canReceiveInbox('kimi'), true);
  // Without this, a kimi orchestrator boots with NO protocol: hive.ts falls
  // through every seed branch and spawns bare. canReceiveInbox makes kimi
  // selectable as the orchestrator, so the two must move together.
  assert.equal(kimi.seedDelivery, 'type-into-tui', 'an interactive TUI is seeded by typing');
  assert.equal(kimi.hiveAware, false, 'it has no --settings/--append-system-prompt');
});

/** Can hive.ts's buildSpawn actually hand this engine the protocol? Mirrors its
 *  branch order: --settings/--append-system-prompt, a prompt flag, a positional,
 *  or typed into the TUI after boot. None of those and it spawns BARE. */
const seedable = (p) =>
  p.hiveAware || !!p.initialPromptFlag || !!p.positionalInitialPrompt || p.seedDelivery === 'type-into-tui';

test('every inbox-capable engine can actually be given its protocol', () => {
  // The invariant behind the test above, applied to the whole roster: an engine
  // offered as an orchestrator must have SOME way to receive the brief, or it
  // boots knowing nothing about the hive it is supposed to be running.
  //
  // `pi` is a KNOWN, PRE-EXISTING violation and is excluded here rather than
  // silently passing. Its preset says `initialPromptFlag: undefined, // positional,
  // like codex: pi "<prompt>"` but never sets `positionalInitialPrompt`, so
  // buildSpawn falls through every branch and spawns it bare. The one-word fix is
  // what its own comment prescribes — but pi is not installed on this machine, and
  // asserting an argv shape for a CLI nobody here can run is how the wrong guess
  // ships. Reported instead; delete this exclusion when someone verifies pi.
  const KNOWN_UNSEEDED = new Set(['pi']);
  for (const p of AGENT_PROVIDER_PRESETS.filter((p) => p.canReceiveInbox)) {
    if (KNOWN_UNSEEDED.has(p.id)) {
      assert.ok(!seedable(p), `${p.id} is listed as a known violation but now seeds — drop it from KNOWN_UNSEEDED`);
      continue;
    }
    assert.ok(seedable(p), `${p.id} is offered as an orchestrator but has no seed path`);
  }
});

test('an engine that cannot orchestrate says why instead of vanishing', () => {
  assert.equal(inboxUnsupportedReason('claude'), null, 'a capable engine has no excuse to give');
  assert.equal(canReceiveInbox('copilot'), false);
  // Copilot's reason is about HOW it runs (a turn at a time, then exits), not
  // about whether it is installed — installing the CLI does not change it.
  assert.match(inboxUnsupportedReason('copilot'), /exits/);
  const listed = inboxUnsupportedEngines();
  assert.ok(listed.some((e) => /copilot/i.test(e.label)), 'copilot is named, not silently dropped');
  for (const e of listed) assert.ok(e.reason.length > 10, `${e.label} carries a real reason`);
});

test('kimi is no longer among the excluded', () => {
  assert.ok(!inboxUnsupportedEngines().some((e) => /kimi/i.test(e.label)));
});
