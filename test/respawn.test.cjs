'use strict';

/**
 * Bringing back an agent that has no process.
 *
 * The ARCHIVED list's only action was permanent delete, so closing a tab was a
 * one-way door — the agent's memory.md, its hive registry entry and every
 * tasks.json card assigned to it stayed on disk, addressed to an id nothing
 * could bring back.
 *
 * Restore is a SPAWN, not a flag flip, and these are the two halves of it that
 * touch no process: the recipe, and the card it produces. What matters in both
 * is that the agent comes back as ITSELF — same id, same engine, same effort,
 * same checkout — because everything else on disk already points at that id.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { planRespawn, respawnedRecord } = loadTs('src/renderer/src/store/respawn.ts');

/** An archived record with the shape store.ts's archiveAgent actually writes:
 *  the live run-state cleared, everything durable kept. */
const archived = (over = {}) => ({
  id: 'yakup-mt2y1a',
  name: 'Yakup',
  character: 'jim',
  accent: 'lemon',
  description: 'the frontend one',
  project: 'munder-difflin',
  tmuxTarget: '',
  cwd: '/Users/u/Projects/munder-difflin',
  status: 'idle',
  action: 'archived',
  progress: 0,
  archived: true,
  ptyId: undefined,
  currentStation: undefined,
  carrying: undefined,
  provider: 'claude',
  model: 'claude-opus-4-8[1m]',
  effort: 'xhigh',
  command: 'claude --model claude-opus-4-8[1m] --effort xhigh',
  note: 'do not lose this',
  ...over
});

const CONFIG = { defaultCommand: 'claude', autoMode: false, defaultModel: undefined };

test('the recorded command wins — it is what this agent actually ran', () => {
  const plan = planRespawn(archived(), CONFIG);
  assert.equal(plan.exe, 'claude');
  assert.deepEqual(plan.args, ['--model', 'claude-opus-4-8[1m]', '--effort', 'xhigh']);
  assert.equal(plan.provider, 'claude');
  assert.equal(plan.baseCwd, '/Users/u/Projects/munder-difflin');
});

test('a record with no command is rebuilt, and keeps its model AND its effort', () => {
  // The pre-`command` case. Dropping effort here would silently bring the agent
  // back at the engine default — a quieter, cheaper agent than the one archived.
  const plan = planRespawn(archived({ command: undefined }), CONFIG);
  assert.equal(plan.exe, 'claude');
  assert.ok(plan.args.includes('--effort'), 'effort flag survives the rebuild');
  assert.equal(plan.args[plan.args.indexOf('--effort') + 1], 'xhigh');
  assert.equal(plan.args[plan.args.indexOf('--model') + 1], 'claude-opus-4-8[1m]');
});

test('no recipe and no config is a stated reason, never a silent no-op', () => {
  assert.deepEqual(planRespawn(archived({ command: undefined }), null), { error: 'no saved command' });
  // A missing cwd used to be reported as "no saved command", which sent the
  // reader looking at the wrong field.
  assert.deepEqual(planRespawn(archived({ cwd: '' }), CONFIG), { error: 'no working directory' });
});

test('the pty id is the agent’s own, so its session and registry entry reattach', () => {
  assert.equal(planRespawn(archived({ ptyId: 'pty-yakup-mt2y1a' }), CONFIG).ptyId, 'pty-yakup-mt2y1a');
  // Archiving clears ptyId; the derived one is stable for the same agent.
  assert.equal(planRespawn(archived(), CONFIG).ptyId, 'pty-yakup-mt2y1a');
});

test('the restored card is the SAME agent, live', () => {
  const a = archived();
  const plan = planRespawn(a, CONFIG);
  const back = respawnedRecord(a, plan, { now: 1_700_000_000_000 });

  // Identity and everything keyed off it — memory.md, the hive inbox and every
  // tasks.json assignee already point at this id.
  assert.equal(back.id, a.id);
  assert.equal(back.name, 'Yakup');
  assert.equal(back.character, 'jim');
  assert.equal(back.accent, 'lemon');
  assert.equal(back.model, 'claude-opus-4-8[1m]');
  assert.equal(back.effort, 'xhigh');
  assert.equal(back.note, 'do not lose this');

  // ...and it is on the floor, not in the archive.
  assert.equal(back.archived, false);
  assert.equal(back.ptyId, 'pty-yakup-mt2y1a');
  assert.equal(back.action, 'starting up');
  assert.equal(back.currentStation, 'desk');
  assert.equal(back.recentTextTs, 1_700_000_000_000);
});

test('a worktree that is gone is said out loud, and stops being probed', () => {
  const a = archived({ worktreePath: '/Users/u/HarnessAgents/worktrees/yakup' });
  const plan = planRespawn(a, CONFIG);
  assert.equal(plan.worktreePath, '/Users/u/HarnessAgents/worktrees/yakup', 'the caller probes it');

  const back = respawnedRecord(a, plan, { worktreeGone: true, now: 1 });
  // The agent still comes back — into the base repo — but the card says why it
  // is not where it was, because its uncommitted work there went with it.
  assert.equal(back.action, 'worktree gone — using base repo');
  assert.equal(back.worktreePath, undefined, 'a dead path is not carried into the next restore');

  const intact = respawnedRecord(a, plan, { now: 1 });
  assert.equal(intact.action, 'starting up');
  assert.equal(intact.worktreePath, '/Users/u/HarnessAgents/worktrees/yakup');
});
