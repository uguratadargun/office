'use strict';

/**
 * MD-103 — the team vanished at boot.
 *
 * The renderer's store is built synchronously at module load and reads the
 * roster file through a blocking IPC round trip. That read returns `null` for
 * two very different things — "there is no roster" and "the read failed" — and
 * the store treated both as "start blank". A blank store then mirrored itself
 * over a file holding 8 agents and 3 archived entries.
 *
 * These tests drive the real store module with a `rosterReadSync` that fails
 * exactly as it did in the field, and assert the two halves of the fix:
 *   • the store retries asynchronously and folds what arrives back in, with the
 *     file's now-dead agents landing in `restorable` rather than nowhere;
 *   • until that succeeds it never claims `allowShrink`, so main refuses to let
 *     it drop anything.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const agent = (over) => ({
  id: 'x', name: 'X', character: 'jim', accent: 'lemon', description: '', project: '',
  tmuxTarget: '', cwd: '/tmp', status: 'idle', action: '', progress: 0, ...over
});

// The roster that is on disk and that the SYNC read fails to return — the 8+3
// floor from the incident, with god and seven workers.
const ON_DISK = {
  version: 1,
  savedAt: new Date(0).toISOString(),
  agents: [
    agent({ id: 'god', name: 'Michael', isGod: true, ptyId: 'pty-god' }),
    ...['pam', 'ryan', 'jim', 'dev', 'andy', 'orcun', 'toby'].map((id) =>
      agent({ id, name: id, ptyId: `pty-${id}` }))
  ],
  archived: [agent({ id: 'arch-1' }), agent({ id: 'arch-2' }), agent({ id: 'arch-3' })],
  restorable: [],
  queues: { pam: [{ id: 'q1', text: 'hi' }] },
  selectedId: 'god'
};

const writes = [];
const ls = {};
global.window = {
  localStorage: {
    getItem: (k) => (k in ls ? ls[k] : null),
    setItem: (k, v) => { ls[k] = String(v); },
    removeItem: (k) => { delete ls[k]; }
  },
  addEventListener() {},
  cth: {
    // The field failure: the synchronous read comes back empty even though the
    // file is right there and full.
    rosterReadSync: () => null,
    // Deliberately slow: the window between the failed sync read and the retry
    // landing is exactly when the old store wrote its blank mirror over the file.
    rosterRead: () => new Promise((r) => setTimeout(() => r(ON_DISK), 1200)),
    rosterWrite: async (snap, opts) => { writes.push({ snap, opts }); return { ok: true }; }
  }
};
global.localStorage = global.window.localStorage;

const loadTs = require('./load-ts.cjs');
const { useStore } = loadTs('src/renderer/src/store/store.ts');

const settle = () => new Promise((r) => setTimeout(r, 700)); // past the 500ms flush debounce

test('a store whose sync read failed boots empty but does NOT claim it may shrink', async () => {
  // Boot state: nothing loaded, because the read gave nothing.
  assert.equal(writes.length, 0, 'a blank store must not seed the file it could not read');

  // Anything it does write before the retry lands is marked unsafe-to-shrink.
  useStore.getState().addAgent(agent({ id: 'god', isGod: true }));
  await settle();
  assert.ok(writes.length > 0);
  assert.equal(writes[0].opts.allowShrink, false,
    'main must refuse to let an unhydrated renderer drop the roster it never read');
});

test('the async retry folds the file back in, and its dead agents become restorable', async () => {
  await settle();
  await settle();
  const s = useStore.getState();

  assert.equal(s.archivedAgents.length, 3, 'the archived entries came back');
  const restorable = s.restorableAgents.map((a) => a.id).sort();
  assert.deepEqual(restorable, ['andy', 'dev', 'jim', 'orcun', 'pam', 'ryan', 'toby'],
    'the seven workers from the dead session are restorable, not gone');
  assert.ok(!s.restorableAgents.some((a) => a.isGod), 'god respawns by itself');
  assert.ok(s.restorableAgents.every((a) => !a.ptyId), 'a restorable entry has no live PTY');
  assert.ok(s.agents.some((a) => a.id === 'god'), 'the god that spawned meanwhile is untouched');
});

test('once hydrated, the renderer is allowed to remove things again', async () => {
  useStore.getState().removeRestorableAgent('toby');
  await settle();
  const last = writes[writes.length - 1];
  assert.equal(last.opts.allowShrink, true,
    'a renderer that has read the file knows what it is deleting');
});

test('dead PTYs move agents to restorable rather than dropping them', async () => {
  const before = useStore.getState().restorableAgents.length;
  useStore.getState().addAgent(agent({ id: 'kevin', ptyId: 'pty-kevin' }));
  useStore.getState().reconcileWithLivePtys([]); // nothing survived the restart
  const s = useStore.getState();
  assert.ok(!s.agents.some((a) => a.id === 'kevin'), 'the dead agent left the floor');
  assert.equal(s.restorableAgents.length, before + 1);
  assert.ok(s.restorableAgents.some((a) => a.id === 'kevin'), 'and landed in restorable');
});
