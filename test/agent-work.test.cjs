'use strict';

/**
 * What one agent has in flight, for the detail panel's "Working on" section.
 *
 * The ordering is the whole point and is easy to get subtly wrong: a blocked
 * card is the one the human can unstick, so it must not sit under three healthy
 * `doing` cards. Everything else here guards the ledger being a hand-written
 * file — a missing closedAt, an unparseable date, a card assigned to a NAME
 * instead of an id.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { selectAgentWork, parseTasks, RECENT_DONE_LIMIT } =
  loadTs('src/renderer/src/store/taskLedger.ts');

/** Cards go through parseTasks first, exactly as the panel feeds them, so the
 *  selector is never tested against a shape the real reader cannot produce. */
const cards = (...tasks) => parseTasks({ tasks });

const ids = (list) => list.map((t) => t.id);

test('only this agent\'s doing/blocked cards are in flight', () => {
  const t = cards(
    { id: 'a', title: 'mine doing', assignee: 'andy', status: 'doing' },
    { id: 'b', title: 'mine todo', assignee: 'andy', status: 'todo' },
    { id: 'c', title: 'mine done', assignee: 'andy', status: 'done' },
    { id: 'd', title: 'theirs', assignee: 'jim', status: 'doing' },
    { id: 'e', title: 'nobody', status: 'doing' }
  );
  const { active } = selectAgentWork(t, 'andy');
  assert.deepEqual(ids(active), ['a']);
});

test('blocked sorts above doing — the stalled card is the actionable one', () => {
  const t = cards(
    { id: 'd1', title: 'doing', assignee: 'andy', status: 'doing', priority: 'high' },
    { id: 'b1', title: 'blocked', assignee: 'andy', status: 'blocked', priority: 'low' },
    { id: 'd2', title: 'doing 2', assignee: 'andy', status: 'doing', priority: 'high' }
  );
  // Note the blocked card has the LOWEST priority: status wins over priority,
  // otherwise a low-priority stall hides behind busy work forever.
  assert.deepEqual(ids(selectAgentWork(t, 'andy').active), ['b1', 'd1', 'd2']);
});

test('within a status: priority desc, then oldest first', () => {
  const t = cards(
    { id: 'lo', title: 'lo', assignee: 'andy', status: 'doing', priority: 'low', createdAt: '2026-08-01T00:00:00Z' },
    { id: 'new', title: 'new', assignee: 'andy', status: 'doing', priority: 'high', createdAt: '2026-08-20T00:00:00Z' },
    { id: 'old', title: 'old', assignee: 'andy', status: 'doing', priority: 'high', createdAt: '2026-08-02T00:00:00Z' }
  );
  assert.deepEqual(ids(selectAgentWork(t, 'andy').active), ['old', 'new', 'lo']);
});

test('recently finished is newest-closed first and capped', () => {
  const t = cards(
    { id: 'r1', title: 'r1', assignee: 'andy', status: 'done', closedAt: '2026-08-01T00:00:00Z' },
    { id: 'r2', title: 'r2', assignee: 'andy', status: 'done', closedAt: '2026-08-04T00:00:00Z' },
    { id: 'r3', title: 'r3', assignee: 'andy', status: 'done', closedAt: '2026-08-03T00:00:00Z' },
    { id: 'r4', title: 'r4', assignee: 'andy', status: 'done', closedAt: '2026-08-02T00:00:00Z' }
  );
  const { recent } = selectAgentWork(t, 'andy');
  assert.equal(recent.length, RECENT_DONE_LIMIT);
  assert.deepEqual(ids(recent), ['r2', 'r3', 'r4']);
});

test('a done card with no closedAt still appears, dated by creation', () => {
  const t = cards(
    { id: 'stamped', title: 's', assignee: 'andy', status: 'done', closedAt: '2026-08-01T00:00:00Z' },
    { id: 'bare', title: 'b', assignee: 'andy', status: 'done', createdAt: '2026-08-05T00:00:00Z' }
  );
  assert.deepEqual(ids(selectAgentWork(t, 'andy').recent), ['bare', 'stamped']);
});

test('an unparseable stamp sorts last instead of unsorting the list', () => {
  // Date.parse('soon') is NaN, and a NaN comparator returns 0 for every pair —
  // which leaves the WHOLE list in input order, not just the bad card.
  const t = cards(
    { id: 'junk', title: 'j', assignee: 'andy', status: 'done', closedAt: 'soon' },
    { id: 'early', title: 'e', assignee: 'andy', status: 'done', closedAt: '2026-08-01T00:00:00Z' },
    { id: 'late', title: 'l', assignee: 'andy', status: 'done', closedAt: '2026-08-09T00:00:00Z' }
  );
  assert.deepEqual(ids(selectAgentWork(t, 'andy').recent), ['late', 'early', 'junk']);
});

test('archived cards are in neither list — the board they link to hides them', () => {
  const t = cards(
    { id: 'a', title: 'a', assignee: 'andy', status: 'doing', archived: true },
    { id: 'b', title: 'b', assignee: 'andy', status: 'done', archived: true }
  );
  assert.deepEqual(selectAgentWork(t, 'andy'), { active: [], recent: [] });
});

test('an empty agent id matches nothing, never every unassigned card', () => {
  const t = cards(
    { id: 'u', title: 'unassigned', status: 'doing' },
    { id: 'e', title: 'empty assignee', assignee: '', status: 'doing' }
  );
  assert.deepEqual(selectAgentWork(t, '').active, []);
});

test('matching is by ledger id, not display name', () => {
  const t = cards({ id: 'a', title: 'a', assignee: 'andy-mt2ykkfq', status: 'doing' });
  assert.deepEqual(selectAgentWork(t, 'Andy').active, []);
  assert.deepEqual(ids(selectAgentWork(t, 'andy-mt2ykkfq').active), ['a']);
});
