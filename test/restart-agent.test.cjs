'use strict';

/**
 * Restart & Continue exists for exactly one situation — a session that already
 * died — so the two rules that make it work are the two easiest to lose in a
 * rewrite: a kill that answers "no pty" is SUCCESS, and a refused resume is a
 * hard failure rather than a quiet blank session.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const r = loadTs('src/shared/restartAgent.ts');

const config = { defaultCommand: 'claude', autoMode: false };
const base = {
  kind: 'continue',
  agent: { id: 'dev-1', ptyId: 'pty-dev-1', cwd: '/repo', name: 'Ada', description: 'builder' },
  provider: 'claude',
  model: undefined,
  config,
  bossName: 'Michael',
  cols: 100,
  rows: 30
};

test('an already-dead pty is the goal state, not a failure', () => {
  assert.equal(r.killWasFatal({ ok: true }), false);
  assert.equal(r.killWasFatal({ ok: false, error: 'no pty: pty-dev-1' }), false);
  assert.equal(r.killWasFatal({ ok: false, error: 'permission denied' }), true);
  assert.equal(r.killWasFatal({ ok: false }), true);
});

test('a refused resume fails Continue and is fine for a model change', () => {
  assert.equal(r.resumeWasRefused('continue', { resumed: true }), false);
  assert.equal(r.resumeWasRefused('continue', {}), true);
  assert.equal(r.resumeWasRefused('continue', { resumed: false }), true);
  assert.equal(r.resumeWasRefused('model-change', {}), false);
});

test('only Continue demands a resume', () => {
  assert.equal(r.buildRestartSpawn(base).requireResume, true);
  assert.equal(r.buildRestartSpawn({ ...base, kind: 'model-change' }).requireResume, false);
  assert.equal(r.buildRestartSpawn({ ...base, kind: 'model-change' }).resume, false);
});

test('a provider switch drops an effort level the new engine will not take', () => {
  // codex has no "think" level; splicing it on would pass an unknown flag.
  const dropped = r.effortForSpawn({ provider: 'codex', effort: 'think', agent: {} });
  assert.equal(dropped, undefined);
  const kept = r.effortForSpawn({ provider: 'claude', effort: undefined, agent: { effort: undefined } });
  assert.equal(kept, undefined);
});

test('god and the assistant keep their roles; everyone else carries their description', () => {
  assert.equal(r.hiveIdentity({ id: 'g', name: 'M', cwd: '/', isGod: true }, 'claude', 'Michael').role, 'orchestrator (god)');
  assert.match(r.hiveIdentity({ id: 'a', name: 'A', cwd: '/', isAssistant: true }, 'claude', 'Michael').role, /Michael's prep assistant/);
  assert.equal(r.hiveIdentity(base.agent, 'claude', 'Michael').role, 'builder');
});

test('the model is recorded even on a resume, or the next restore relaunches the old command', () => {
  const patch = r.restartPatch({ ...base, model: 'opus-5' }, 'claude');
  assert.equal(patch.model, 'opus-5');
  assert.equal(patch.action, 'continuing…');
  assert.match(patch.command, /claude/);
  const switched = r.restartPatch({ ...base, kind: 'model-change', provider: 'codex' }, 'claude');
  assert.match(switched.action, /switching to/);
});

/* ── MD-97: plain Restart ────────────────────────────────────────────────── */

test('a plain Restart starts CLEAN and never demands a resume', () => {
  const fresh = r.buildRestartSpawn({ ...base, kind: 'fresh' });
  assert.equal(fresh.resume, false, 'a plain restart is the one that drops the conversation');
  assert.equal(fresh.requireResume, false);
  // Nothing to refuse — only Continue can fail this way.
  assert.equal(r.resumeWasRefused('fresh', { resumed: false }), false);
});

test('a plain Restart says what it did, so it is not mistaken for Continue', () => {
  const patch = r.restartPatch({ ...base, kind: 'fresh' }, 'claude');
  assert.equal(patch.action, 'restarting clean…');
  // A model change on the same engine keeps its own wording.
  assert.equal(r.restartPatch({ ...base, kind: 'model-change' }, 'claude').action, 'restarting…');
  assert.equal(r.restartPatch({ ...base, kind: 'continue' }, 'claude').action, 'continuing…');
});

test('a plain Restart still carries the engine flags — it is clean, not default', () => {
  const spawn = r.buildRestartSpawn({
    ...base, kind: 'fresh', provider: 'claude', model: 'claude-opus-5', effort: 'high'
  });
  assert.match(spawn.command, /claude-opus-5/);
  assert.equal(spawn.effort, 'high');
});
