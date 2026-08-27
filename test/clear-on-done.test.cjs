'use strict';

/**
 * Clearing a thread is destructive and unrecoverable, so — as with hibernation —
 * each test here pins ONE reason the conversation is KEPT, plus the fire-once
 * property that stops a settled ledger from clearing the same agent every tick.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { shouldClearThread, agentsToClearThread, DEFAULT_CLEAR_ON_DONE } = loadTs('src/shared/clearThread.ts');

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

/* ── MD-175: on by default, with the two terminal-side KEEP reasons ────────── */

test('the feature ships ON — a new card starts from the prefix, not from yesterday', () => {
  assert.equal(DEFAULT_CLEAR_ON_DONE, true);
});

test('config fills clearOnDone only when unset — an explicit false survives', () => {
  const src = require('node:fs').readFileSync('src/main/config.ts', 'utf8');
  // The whole migration is `{ ...DEFAULTS, ...parsed }`: a key absent from disk
  // takes the default, a key present on disk (including `false`) wins. Pin that
  // the key IS in DEFAULTS, or an existing install would read `undefined` and
  // fall back per call site instead of once, in the one place that documents it.
  assert.match(src, /clearOnDone: DEFAULT_CLEAR_ON_DONE/);
  assert.match(src, /\{ \.\.\.DEFAULTS, \.\.\.parsed \}/);
});

test('unread actionable mail keeps the thread — the /clear would wipe the ask', () => {
  const prev = [card('MD-1', 'jim', 'doing')];
  const now = [card('MD-1', 'jim', 'done')];
  assert.equal(shouldClearThread('jim', now, prev, false, { actionableMail: 1 }), false);
  // An empty inbox (or only FYIs, which countActionable already drops) clears.
  assert.equal(shouldClearThread('jim', now, prev, false, { actionableMail: 0 }), true);
});

test('an armed circuit breaker keeps the thread — the steer asks about what is in it', () => {
  const prev = [card('MD-1', 'jim', 'doing')];
  const now = [card('MD-1', 'jim', 'done')];
  assert.equal(shouldClearThread('jim', now, prev, false, { breakerArmed: true }), false);
  assert.equal(shouldClearThread('jim', now, prev, false, { breakerArmed: false }), true);
});

test('guards are per agent — one agent mid-incident does not hold another thread open', () => {
  const prev = [card('MD-1', 'jim', 'doing'), card('MD-2', 'andy', 'doing')];
  const now = [card('MD-1', 'jim', 'done'), card('MD-2', 'andy', 'done')];
  const guardsFor = (id) => (id === 'jim' ? { breakerArmed: true } : {});
  assert.deepEqual(agentsToClearThread(now, prev, () => false, guardsFor), ['andy']);
});

test('the guards are optional — every pre-MD-175 call site still clears', () => {
  const prev = [card('MD-1', 'jim', 'doing')];
  const now = [card('MD-1', 'jim', 'done')];
  assert.equal(shouldClearThread('jim', now, prev), true);
  assert.deepEqual(agentsToClearThread(now, prev), ['jim']);
});

test('main gates the sweep on clearOnDone but still advances the baseline', () => {
  const src = require('node:fs').readFileSync('src/main/index.ts', 'utf8');
  const tick = src.slice(src.indexOf('function clearThreadTick'), src.indexOf('function armHeartbeat'));
  // Order is the point: `prevThreadTasks = tasks` runs BEFORE the off-switch
  // return, so turning the feature on mid-session does not read every card that
  // landed while it was off as having just been signed.
  assert.ok(tick.indexOf('prevThreadTasks = tasks') < tick.indexOf('if (!on) return'),
    'the baseline must advance before the clearOnDone gate returns');
  assert.match(tick, /countActionable\(hive\.inbox\(id\)\)/);
  assert.match(tick, /breaker\.levelFor\(id\) !== 'healthy'/);
});
