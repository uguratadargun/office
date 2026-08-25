'use strict';

/**
 * Clearing a thread is destructive and unrecoverable, so — as with hibernation —
 * each test here pins ONE reason the conversation is KEPT, plus the fire-once
 * property that stops a settled ledger from clearing the same agent every tick.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { shouldClearThread, agentsToClearThread } = loadTs('src/shared/clearThread.ts');

const card = (id, assignee, status) => ({ id, assignee, status });

test('a card signed off with nothing else in flight clears the thread', () => {
  const prev = [card('MD-1', 'jim', 'doing')];
  const now = [card('MD-1', 'jim', 'done')];
  assert.equal(shouldClearThread('jim', now, prev), true);
});

test('another card still doing keeps the thread — it is that card\'s context too', () => {
  const prev = [card('MD-1', 'jim', 'doing'), card('MD-2', 'jim', 'doing')];
  const now = [card('MD-1', 'jim', 'done'), card('MD-2', 'jim', 'doing')];
  assert.equal(shouldClearThread('jim', now, prev), false);
});

test('a blocked card (waiting on the human) keeps the thread', () => {
  const prev = [card('MD-1', 'jim', 'doing'), card('MD-2', 'jim', 'blocked')];
  const now = [card('MD-1', 'jim', 'done'), card('MD-2', 'jim', 'blocked')];
  assert.equal(shouldClearThread('jim', now, prev), false);
});

test('a todo card does NOT hold the thread open — nothing of it is in there yet', () => {
  const prev = [card('MD-1', 'jim', 'doing'), card('MD-2', 'jim', 'todo')];
  const now = [card('MD-1', 'jim', 'done'), card('MD-2', 'jim', 'todo')];
  assert.equal(shouldClearThread('jim', now, prev), true);
});

test('god is never cleared', () => {
  const prev = [card('MD-1', 'god', 'doing')];
  const now = [card('MD-1', 'god', 'done')];
  assert.equal(shouldClearThread('god', now, prev, true), false);
});

test('the same card sitting at done fires exactly once', () => {
  const prev = [card('MD-1', 'jim', 'doing')];
  const now = [card('MD-1', 'jim', 'done')];
  assert.equal(shouldClearThread('jim', now, prev), true);
  // Next tick: `now` becomes the baseline, so there is no transition left.
  assert.equal(shouldClearThread('jim', now, now), false);
});

test('someone else\'s sign-off never clears this agent', () => {
  const prev = [card('MD-1', 'andy', 'doing'), card('MD-2', 'jim', 'doing')];
  const now = [card('MD-1', 'andy', 'done'), card('MD-2', 'jim', 'doing')];
  assert.deepEqual(agentsToClearThread(now, prev), ['andy']);
});

test('agentsToClearThread honours the isGod predicate and dedupes assignees', () => {
  const prev = [card('MD-1', 'god', 'doing'), card('MD-2', 'jim', 'doing'), card('MD-3', 'jim', 'doing')];
  const now = [card('MD-1', 'god', 'done'), card('MD-2', 'jim', 'done'), card('MD-3', 'jim', 'done')];
  assert.deepEqual(agentsToClearThread(now, prev, (id) => id === 'god'), ['jim']);
});

test('an unassigned card never clears anyone', () => {
  const prev = [card('MD-1', undefined, 'doing')];
  const now = [card('MD-1', undefined, 'done')];
  assert.deepEqual(agentsToClearThread(now, prev), []);
});
