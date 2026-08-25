'use strict';

/**
 * God has to know the LIVE floor across its own restarts — a roster it read once
 * goes stale, and it then messages agents that were archived or killed. So the
 * roster is PUSHED into god's context (SessionStart + every prompt) rather than
 * pulled.
 *
 * Only one `additionalContext` may be returned per hook, so the roster and the
 * operator-steer path must MERGE — otherwise they silently displace each other.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

// hooks.ts pulls Notification from electron; outside Electron that resolve gives
// a path string, so seed the cache with the surface the server actually touches.
const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron,
  filename: electron,
  loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { HiveManager } = loadTs('src/main/hive.ts');
const { HookServer } = loadTs('src/main/hooks.ts');

const CONFIG = { notifications: false };

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'md-roster-inj-'));
}

async function floor(t, { steer } = {}) {
  const home = tmpHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god-1', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'jim-1', name: 'Jim', provider: 'claude', cwd: home });

  const control = steer
    ? { takeSteer: (id) => (id === 'god-1' ? steer : null), shouldHalt: () => false, toolDecision: () => ({ deny: false }) }
    : undefined;
  const server = new HookServer(hive, () => null, () => CONFIG, control, undefined);
  const fire = (agent_id, hook_event_name) => server.handle({ agent_id, hook_event_name, session_id: 's1' });
  return { home, hive, server, fire };
}

function snapshot(hive) {
  hive.writeFleetSnapshot({
    ts: Date.now() - 4000,
    agents: [
      { id: 'god-1', name: 'Michael', role: 'orchestrator', isGod: true, breaker: 'ok', tokens: 812_400, usd: 4.2199, lastActiveSecAgo: 6, inboxBacklog: 2 },
      { id: 'jim-1', name: 'Jim', role: 'agent', breaker: 'warn', tokens: 120_401, usd: 1.0231, lastActiveSecAgo: 240, inboxBacklog: 0 },
      { id: 'pam-1', name: 'Pam', role: 'agent', breaker: 'ok', tokens: 0, usd: 0, lastActiveSecAgo: null, inboxBacklog: 0 }
    ]
  });
}

const context = (res) => res?.hookSpecificOutput?.additionalContext ?? '';

test('the roster line carries the whole floor and its state', async (t) => {
  const { hive } = await floor(t);
  assert.equal(hive.rosterContext(), null, 'no snapshot yet — inject nothing rather than noise');

  snapshot(hive);
  const line = hive.rosterContext();

  assert.ok(!line.includes('\n'), 'must stay a single compact line');
  for (const id of ['god-1', 'jim-1', 'pam-1']) assert.ok(line.includes(id), `missing ${id}`);
  assert.match(line, /812k tok/);
  assert.match(line, /\$4\.22/);
  assert.match(line, /inbox 2/);
  assert.match(line, /breaker warn/);
  assert.match(line, /god-1[^;]*you/, 'god has to be able to spot itself');
  assert.match(line, /no activity yet/, 'an agent that never ran must not read as "active never"');
  assert.match(line, /SUPERSEDES/, 'the point is to override what god remembers');
  assert.ok(line.length < 1200, `too long for a 3-agent floor: ${line.length} chars`);
});

test('god gets the roster on SessionStart and whenever the floor CHANGES — nobody else does', async (t) => {
  const { hive, fire } = await floor(t);
  snapshot(hive);

  const start = await fire('god-1', 'SessionStart');
  assert.match(context(start), /LIVE ROSTER/);
  assert.equal(start.hookSpecificOutput.hookEventName, 'SessionStart');

  // (MD-61) The roster used to go in on EVERY prompt. Each copy stays in the
  // transcript and is re-read — and re-billed — by every request after it, so an
  // unchanged floor was paying for the same ~250 tokens over and over.
  assert.doesNotMatch(context(await fire('god-1', 'UserPromptSubmit')), /LIVE ROSTER/,
    'an unchanged floor is not news');

  hive.writeFleetSnapshot({
    ts: Date.now() - 4000,
    agents: [{ id: 'god-1', name: 'Michael', role: 'orchestrator', isGod: true, lastActiveSecAgo: 1 }]
  });
  assert.match(context(await fire('god-1', 'UserPromptSubmit')), /LIVE ROSTER/,
    'agents leaving the floor is exactly what this injection exists to tell god');

  assert.doesNotMatch(context(await fire('jim-1', 'SessionStart')), /LIVE ROSTER/);
  assert.doesNotMatch(context(await fire('jim-1', 'UserPromptSubmit')), /LIVE ROSTER/);
  assert.doesNotMatch(context(await fire('god-1', 'PostToolUse')), /LIVE ROSTER/,
    'prompt boundaries only — not once per tool call');
});

test('a queued operator steer is not swallowed by the roster', async (t) => {
  const steer = 'OPERATOR: stop and summarize.';
  const { hive, fire } = await floor(t, { steer });
  snapshot(hive);

  const ctx = context(await fire('god-1', 'UserPromptSubmit'));
  assert.match(ctx, /LIVE ROSTER/);
  assert.ok(ctx.includes(steer), 'only one additionalContext exists — the two must merge, not race');
});

test('a corrupt fleet.json degrades to no injection instead of throwing into a hook', async (t) => {
  const { home, hive, fire } = await floor(t);
  snapshot(hive);
  fs.writeFileSync(path.join(home, 'hive', 'fleet.json'), '{ not json');

  assert.equal(hive.rosterContext(), null);
  const res = await fire('god-1', 'SessionStart');
  assert.doesNotMatch(context(res), /LIVE ROSTER/);
});
