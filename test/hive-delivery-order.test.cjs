'use strict';

/**
 * Outbox delivery order.
 *
 * Two failures observed on the floor 2026-08-21, both from the same cause —
 * readdirSync returns NAME order, and outbox files are named descriptively
 * ("md5-done.json", "cancel-yakup.json"), not by timestamp:
 *
 *   1. Two messages written 48s apart were delivered together, in the wrong
 *      order.
 *   2. A cancel written AFTER a dispatch arrived BEHIND it, so the recipient
 *      read the dispatch and started work that had already been called off.
 *
 * Order is therefore decided by write time, with cancels preempting.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { orderOutbox, isPreemptive } = loadTs('src/main/hive.ts');

const item = (f, mtime, act = 'request') => ({ f, mtime, msg: { act } });
const names = (items) => orderOutbox(items).map((i) => i.f);

test('isPreemptive: only a cancel jumps the queue', () => {
  assert.equal(isPreemptive({ act: 'cancel' }), true);
  for (const act of ['request', 'inform', 'propose', 'query', 'agree', 'refuse', 'done']) {
    assert.equal(isPreemptive({ act }), false, `${act} must not preempt`);
  }
});

test('delivery follows write time, not filename', () => {
  // "aaa" sorts first by name but was written last.
  const out = names([
    item('aaa-second.json', 2000),
    item('zzz-first.json', 1000)
  ]);
  assert.deepEqual(out, ['zzz-first.json', 'aaa-second.json']);
});

test('a cancel preempts an unread dispatch written before it', () => {
  // The exact floor incident: dispatch at t=0, cancel at t=48s.
  const out = names([
    item('dispatch-md4.json', 0, 'request'),
    item('cancel-md4.json', 48_000, 'cancel')
  ]);
  assert.deepEqual(out, ['cancel-md4.json', 'dispatch-md4.json'],
    'the cancel must be read first even though it was written 48s later');
});

test('two cancels keep write order between themselves', () => {
  const out = names([
    item('cancel-b.json', 2000, 'cancel'),
    item('cancel-a.json', 1000, 'cancel'),
    item('work.json', 500, 'request')
  ]);
  assert.deepEqual(out, ['cancel-a.json', 'cancel-b.json', 'work.json']);
});

test('equal mtimes fall back to filename, so order is deterministic', () => {
  const out = names([item('b.json', 5), item('a.json', 5), item('c.json', 5)]);
  assert.deepEqual(out, ['a.json', 'b.json', 'c.json']);
});

test('orderOutbox does not mutate its input', () => {
  const items = [item('b.json', 2), item('a.json', 1)];
  const before = items.map((i) => i.f);
  orderOutbox(items);
  assert.deepEqual(items.map((i) => i.f), before);
});
