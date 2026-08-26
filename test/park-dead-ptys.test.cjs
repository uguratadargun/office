'use strict';

/**
 * MD-114b — an agent whose PTY died while the app kept running.
 *
 * The floor produced six of these: `roster.json` entries with `sleeping: false`
 * AND `ptyId: 'pty-<id>'`, with nothing alive behind that id. They read as
 * healthy agents, so no surface offered a Wake — and a wake is only ever SENT
 * to an agent the store already believes is asleep, so Orcun sat on two unread
 * inbox messages nobody could get him to read.
 *
 * `reconcileWithLivePtys` could not fix this: it runs once, at boot, and it
 * REMOVES agents into `restorable`, which is the previous session's team behind
 * a button. These agents are on the team right now. So they are parked in
 * place, as sleeping, which is the one processless state the hive already knows
 * how to end by itself.
 *
 * This drives the real store, so it pins the whole action rather than its text.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const agent = (over) => ({
  id: 'x', name: 'X', character: 'jim', accent: 'lemon', description: '', project: '',
  tmuxTarget: '', cwd: '/tmp', status: 'idle', action: '', progress: 0, ...over
});

const ls = {};
const writes = [];
global.window = {
  localStorage: {
    getItem: (k) => (k in ls ? ls[k] : null),
    setItem: (k, v) => { ls[k] = String(v); },
    removeItem: (k) => { delete ls[k]; }
  },
  addEventListener() {},
  cth: {
    rosterReadSync: () => null,
    rosterRead: async () => null,
    rosterWrite: async (snap) => { writes.push(snap); return { ok: true }; }
  }
};
global.localStorage = global.window.localStorage;

const loadTs = require('./load-ts.cjs');
const { useStore } = loadTs('src/renderer/src/store/store.ts');

const seed = () => {
  const s = useStore.getState();
  for (const a of s.agents) s.removeAgent(a.id);
  // The floor as god read it off disk.
  s.addAgent(agent({ id: 'jim', ptyId: 'pty-jim', status: 'working' }));
  s.addAgent(agent({ id: 'orcun', ptyId: 'pty-orcun', status: 'idle', action: 'reading inbox' }));
  s.addAgent(agent({ id: 'ryan', sleeping: true, action: 'sleeping' }));
};

test('a parked agent KEEPS its card — it is on the team, not last session’s team', () => {
  seed();
  const before = useStore.getState().restorableAgents.length;
  useStore.getState().parkDeadAgents(['orcun']);
  const s = useStore.getState();
  assert.ok(s.agents.some((a) => a.id === 'orcun'), 'parking must never remove the card');
  assert.equal(s.restorableAgents.length, before, 'restorable is the previous SESSION, behind a button');
  assert.ok(!s.archivedAgents.some((a) => a.id === 'orcun'), 'nobody asked to archive it');
});

test('it is marked sleeping with its ptyId cleared — the state a wake can end', () => {
  seed();
  useStore.getState().parkDeadAgents(['orcun']);
  const o = useStore.getState().agents.find((a) => a.id === 'orcun');
  assert.equal(o.sleeping, true, 'main only broadcasts hive:agentWake for a SLEEPING agent');
  assert.equal(o.ptyId, undefined, 'a cleared ptyId is what routes the wake through planRespawn');
  assert.equal(o.status, 'idle');
  assert.equal(o.action, 'session ended', 'this session DIED; it was not put down by the idle rule');
  assert.equal(o.carrying, undefined, 'run-state belongs to the session that ended');
});

test('only the named agents move; everything else is byte-identical', () => {
  seed();
  const before = useStore.getState().agents;
  const jimBefore = before.find((a) => a.id === 'jim');
  useStore.getState().parkDeadAgents(['orcun']);
  const after = useStore.getState().agents;
  assert.equal(after.find((a) => a.id === 'jim'), jimBefore,
    'a live agent must keep its identity, or every poll re-renders the whole roster');
  assert.equal(after.length, before.length);
});

test('parking an agent that is already asleep changes nothing at all', () => {
  seed();
  const before = useStore.getState().agents;
  useStore.getState().parkDeadAgents(['ryan']);
  assert.equal(useStore.getState().agents, before,
    'the same array back: no persist, no re-render, no rewriting `action` every 15s');
});

test('parking is idempotent — the poll runs forever', () => {
  seed();
  useStore.getState().parkDeadAgents(['orcun']);
  const once = useStore.getState().agents;
  useStore.getState().parkDeadAgents(['orcun']);
  assert.equal(useStore.getState().agents, once);
});

test('an id that is not on the roster is ignored rather than invented', () => {
  seed();
  const before = useStore.getState().agents;
  useStore.getState().parkDeadAgents(['ghost']);
  assert.equal(useStore.getState().agents, before);
});
