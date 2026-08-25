'use strict';

/**
 * MD-105 — main lingered after a confirmed kill-all-and-quit.
 *
 * `will-quit` preventDefault()s, races the analytics flush against a timeout,
 * and calls `app.quit()` again. With no PostHog client (any build without a
 * POSTHOG_KEY) the flush resolves immediately, so the re-quit ran as a
 * MICROTASK — still inside Electron's emission of `will-quit`. Electron's
 * `Browser::Quit()` is a no-op while `is_quitting_` is set; the prevented
 * event then cleared the flag, and nothing ever quit again.
 *
 * The handler's contract, pinned here:
 *   • nothing to flush → the quit is not intercepted at all;
 *   • something to flush → preventDefault, and the re-quit is DEFERRED past
 *     the microtask queue (never inside the emit);
 *   • a hung flush is bounded by the timeout;
 *   • the second will-quit (the re-entered one) passes straight through.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { createWillQuitHandler } = loadTs('src/main/quit-flush.ts');

/** Drain the microtask queue several times without letting a macrotask run. */
async function drainMicrotasks() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function harness(over = {}) {
  const calls = { prevent: 0, quit: 0, deferred: [] };
  const e = { preventDefault: () => { calls.prevent++; } };
  const handler = createWillQuitHandler({
    needsFlush: () => true,
    endSession: async () => {},
    quit: () => { calls.quit++; },
    defer: (fn) => { calls.deferred.push(fn); },
    ...over
  });
  return { calls, e, handler };
}

test('nothing to flush → the quit is not intercepted', async () => {
  const { calls, e, handler } = harness({ needsFlush: () => false });
  handler(e);
  await drainMicrotasks();
  assert.equal(calls.prevent, 0, 'no preventDefault — Electron just quits');
  assert.equal(calls.quit, 0, 'and no re-quit either');
});

test('an instantly-resolved flush must NOT re-quit from a microtask', async () => {
  // The exact hang: endSession() resolving in the same tick.
  const { calls, e, handler } = harness();
  handler(e);
  assert.equal(calls.prevent, 1);
  await drainMicrotasks();
  assert.equal(calls.quit, 0, 'quit must not have run synchronously or from the microtask queue');
  assert.equal(calls.deferred.length, 1, 'it was handed to the macrotask scheduler instead');
  calls.deferred[0]();
  assert.equal(calls.quit, 1);
});

test('the real scheduler is a macrotask: quit lands after the emit, before 50ms', async () => {
  let quits = 0;
  const handler = createWillQuitHandler({
    needsFlush: () => true,
    endSession: async () => {},
    quit: () => { quits++; }
  });
  handler({ preventDefault() {} });
  await drainMicrotasks();
  assert.equal(quits, 0);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(quits, 1);
});

test('a hung flush is bounded by the timeout', async () => {
  const { calls, e, handler } = harness({
    endSession: () => new Promise(() => {}), // never resolves
    timeoutMs: 20
  });
  handler(e);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls.deferred.length, 1, 'the timeout won the race');
});

test('a failing flush still quits', async () => {
  const { calls, e, handler } = harness({ endSession: async () => { throw new Error('network'); } });
  handler(e);
  await drainMicrotasks();
  assert.equal(calls.deferred.length, 1);
});

test('the re-entered will-quit passes straight through', async () => {
  const { calls, e, handler } = harness();
  handler(e);
  handler(e); // the quit we re-entered
  assert.equal(calls.prevent, 1, 'only the first is intercepted');
});
