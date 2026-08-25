'use strict';

/**
 * MD-106 — the modern Agents list puts WORKING first, then idle, then asleep.
 *
 * This tier deliberately contradicts `@shared/agentOrder`, which groups only
 * awake/sleeping precisely because `status` churns. So the two properties that
 * make the churn survivable are the ones worth pinning: the live tier is COARSE
 * (parser flips inside it move nothing), and the comparator is a pure group
 * rank (rows keep the order the user dragged them into).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const m = loadTs('src/renderer/src/modern/agents/agentsModel.ts');

const a = (id, status, extra = {}) => ({ id, status, ...extra });
const ids = (list) => m.sortAgentsForModernList(list).map((x) => x.id);

test('a mixed roster sorts working → idle → asleep', () => {
  const roster = [
    a('idle-1', 'idle'),
    a('asleep-1', 'idle', { sleeping: true }),
    a('busy-1', 'working'),
    a('idle-2', 'success'),
    a('busy-2', 'thinking')
  ];
  assert.deepEqual(ids(roster), ['busy-1', 'busy-2', 'idle-1', 'idle-2', 'asleep-1']);
});

test('the god stays where it is — first — however idle it is', () => {
  const roster = [a('god', 'idle', { isGod: true }), a('busy', 'working'), a('idle', 'idle')];
  assert.deepEqual(ids(roster), ['god', 'busy', 'idle']);
  // Even asleep, the boss is an address, not a status.
  const napping = [a('busy', 'working'), a('god', 'idle', { isGod: true, sleeping: true })];
  assert.deepEqual(ids(napping), ['god', 'busy']);
});

test('an agent stopped ON something is live work, not idle', () => {
  // `blocked` is waiting for the HUMAN — the last row that should sink.
  assert.equal(m.agentListRank(a('x', 'blocked')), m.RANK_LIVE);
  assert.equal(m.agentListRank(a('x', 'waiting')), m.RANK_LIVE);
  assert.equal(m.agentListRank(a('x', 'compacting')), m.RANK_LIVE);
  assert.equal(m.agentListRank(a('x', 'looping')), m.RANK_LIVE);
});

test('the live tier is coarse, so a parser flip inside it reorders nothing', () => {
  const before = [a('one', 'working'), a('two', 'thinking'), a('three', 'compacting')];
  const after = [a('one', 'thinking'), a('two', 'working'), a('three', 'looping')];
  assert.deepEqual(ids(before), ['one', 'two', 'three']);
  assert.deepEqual(ids(after), ['one', 'two', 'three'], 'rows must not hop while you click one');
});

test('order within a tier is the order it was given — never re-ranked', () => {
  // The store order IS the user's drag-reorder. A tiebreak here would silently
  // overwrite it on every poll.
  const dragged = [a('zeta', 'idle'), a('alpha', 'idle'), a('mid', 'idle')];
  assert.deepEqual(ids(dragged), ['zeta', 'alpha', 'mid']);
});

test('sleeping wins over whatever stale status is underneath it', () => {
  // `sleeping` survives a boot; the `status` field beneath it does not.
  assert.equal(m.agentListRank(a('x', 'working', { sleeping: true })), m.RANK_ASLEEP);
});

test('the input array is never sorted in place', () => {
  const roster = [a('idle', 'idle'), a('busy', 'working')];
  const out = m.sortAgentsForModernList(roster);
  assert.deepEqual(roster.map((x) => x.id), ['idle', 'busy'], 'the store array is shared state');
  assert.notEqual(out, roster);
});

test('an unknown status is idle, never live — a wrong guess must not float a row', () => {
  assert.equal(m.agentListRank(a('x', 'ghost')), m.RANK_IDLE);
  assert.equal(m.agentListRank(a('x', 'something-new')), m.RANK_IDLE);
});
