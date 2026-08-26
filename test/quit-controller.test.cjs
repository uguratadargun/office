'use strict';

/**
 * MD-137 — quitting must finish.
 *
 * The contract this pins, in the human's words: "the app must be GONE 5 seconds
 * after quit is requested". Split in two, because only one half is the machine's
 * to hurry:
 *
 *   • The wait for a HUMAN is unbounded. While the quit dialog is up and the
 *     renderer has confirmed it is showing, no clock runs.
 *   • The wait for the MACHINE is QUIT_DEADLINE_MS from the moment the exit is
 *     DECIDED — kill & quit pressed, a signal arrived, or nobody could be asked.
 *     PTY kills, service teardown and the final flush all live inside that one
 *     budget, and when it expires the process exits regardless.
 *
 * Every route that used to hang forever gets a case here: no renderer at all,
 * a renderer that never answers, a signal, a second Cmd-Q, and a PTY that
 * ignores every signal while teardown blocks.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { createQuitController, liveOnly, QUIT_DEADLINE_MS, QUIT_ASK_TIMEOUT_MS, QUIT_KILL_GRACE_MS } = loadTs('src/shared/quit.ts');

/** A controller plus a log of every effect it caused. */
function harness(over = {}) {
  const calls = { asked: [], teardown: 0, hardExit: 0, phases: [], watchdog: [] };
  const ctl = createQuitController({
    livePtyCount: over.livePtyCount ?? (() => 2),
    askRenderer: over.askRenderer ?? ((n) => { calls.asked.push(n); return true; }),
    teardown: over.teardown ?? (() => { calls.teardown++; }),
    hardExit: () => { calls.hardExit++; },
    armWatchdog: (ms) => calls.watchdog.push(ms),
    onPhase: (p) => calls.phases.push(p),
    deadlineMs: over.deadlineMs,
    askTimeoutMs: over.askTimeoutMs
  });
  return { ctl, calls };
}

test('the shared budget is one number, and it is 5 seconds', () => {
  assert.equal(QUIT_DEADLINE_MS, 5000);
  assert.ok(QUIT_ASK_TIMEOUT_MS < QUIT_DEADLINE_MS, 'asking must be cheaper than the whole exit');
  // The tree sweep runs synchronously on quit: the process ends milliseconds
  // later, so a deferred sweep would simply never happen and a child ignoring
  // SIGHUP would outlive the app.
  assert.equal(QUIT_KILL_GRACE_MS, 0, 'no deferred sweep on a path that is about to exit');
});

test('live PTYs → the renderer is asked and the quit is held (only then)', () => {
  const { ctl, calls } = harness({ livePtyCount: () => 3 });
  assert.equal(ctl.request('quit'), 'ask');
  assert.deepEqual(calls.asked, [3], 'the dialog is told the LIVE count');
  assert.equal(calls.teardown, 0, 'nothing is torn down while the user decides');
});

test('a dialog the user is looking at is an UNBOUNDED wait — no deadline runs', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { ctl, calls } = harness();
  assert.equal(ctl.request('quit'), 'ask');
  ctl.dialogShown();                       // renderer: "it's on screen"
  t.mock.timers.tick(60_000);              // a minute of the user thinking
  assert.equal(calls.teardown, 0);
  assert.equal(calls.hardExit, 0);
  assert.ok(!ctl.isExiting(), 'still theirs to decide');
});

test('no renderer to ask → the exit is decided at once, never held', () => {
  const { ctl, calls } = harness({ askRenderer: () => false });
  assert.equal(ctl.request('quit'), 'exit', 'the caller must NOT preventDefault');
  assert.equal(calls.teardown, 1);
  assert.ok(ctl.isExiting());
});

test('a renderer that throws counts as no renderer', () => {
  const { ctl, calls } = harness({ askRenderer: () => { throw new Error('destroyed'); } });
  assert.equal(ctl.request('quit'), 'exit');
  assert.equal(calls.teardown, 1);
});

test('asked but never acked → main decides for itself after the grace', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { ctl, calls } = harness();
  assert.equal(ctl.request('quit'), 'ask');
  t.mock.timers.tick(QUIT_ASK_TIMEOUT_MS - 1);
  assert.equal(calls.teardown, 0, 'still inside the grace');
  t.mock.timers.tick(1);
  assert.equal(calls.teardown, 1, 'headless / crashed renderer no longer wedges quit');
  assert.ok(ctl.isExiting());
});

test('a PTY that ignores every signal still yields an exit within the deadline', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // Teardown blocks forever on a child that will not die: it returns, but the
  // process would stay alive. The deadline is the only thing that saves us.
  const { ctl, calls } = harness({ teardown: () => { calls.teardown++; /* never completes */ } });
  ctl.confirm();
  assert.equal(calls.hardExit, 0);
  t.mock.timers.tick(QUIT_DEADLINE_MS - 1);
  assert.equal(calls.hardExit, 0, 'not one tick early');
  t.mock.timers.tick(1);
  assert.equal(calls.hardExit, 1, 'app.exit(0) — gone at 5s no matter what is alive');
});

test('the deadline is armed BEFORE teardown, so a throwing teardown cannot disarm it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { ctl, calls } = harness({ teardown: () => { throw new Error('socket wedged'); } });
  ctl.confirm();
  t.mock.timers.tick(QUIT_DEADLINE_MS);
  assert.equal(calls.hardExit, 1);
});

test('SIGINT decides immediately — no dialog, no renderer round-trip', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { ctl, calls } = harness();
  assert.equal(ctl.request('signal'), 'exit');
  assert.deepEqual(calls.asked, [], 'the terminal that sent it is already waiting');
  assert.equal(calls.teardown, 1);
  t.mock.timers.tick(QUIT_DEADLINE_MS);
  assert.equal(calls.hardExit, 1);
});

test('a repeated signal does not restart the sequence', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { ctl, calls } = harness();
  ctl.request('signal');
  ctl.request('signal');
  ctl.request('signal');
  assert.equal(calls.teardown, 1, 'teardown is idempotent');
  t.mock.timers.tick(QUIT_DEADLINE_MS);
  assert.equal(calls.hardExit, 1, 'one deadline, not three');
});

test('a second Cmd-Q with the dialog up is a confirmation, not a second block', () => {
  const { ctl, calls } = harness();
  assert.equal(ctl.request('quit'), 'ask');
  ctl.dialogShown();
  assert.equal(ctl.request('quit'), 'exit', 'asking twice IS an answer');
  assert.equal(calls.teardown, 1);
  assert.deepEqual(calls.asked, [2], 'and it does not re-ask');
});

test('"keep them running" clears the pending request — the next Cmd-Q asks again', () => {
  const { ctl, calls } = harness();
  ctl.request('quit');
  ctl.dialogShown();
  ctl.cancel();
  assert.equal(ctl.request('quit'), 'ask', 'not treated as a second Cmd-Q');
  assert.deepEqual(calls.asked, [2, 2]);
  assert.equal(calls.teardown, 0);
});

test('cancel also stops the un-acked grace timer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { ctl, calls } = harness();
  ctl.request('quit');
  ctl.cancel();
  t.mock.timers.tick(QUIT_ASK_TIMEOUT_MS * 5);
  assert.equal(calls.teardown, 0, 'a cancelled request must never fire the exit later');
});

test('no live PTYs: Cmd-Q exits under the cap, the red-X just closes the window', () => {
  const quit = harness({ livePtyCount: () => 0 });
  assert.equal(quit.ctl.request('quit'), 'exit');
  assert.deepEqual(quit.calls.asked, [], 'nothing to warn about');
  assert.equal(quit.calls.teardown, 1, 'a hung service must not outlive the goodbye either');

  const close = harness({ livePtyCount: () => 0 });
  assert.equal(close.ctl.request('close'), 'allow', 'closing the last window is not quitting the app');
  assert.equal(close.calls.teardown, 0);
});

test('once exiting, every further request passes straight through', () => {
  const { ctl, calls } = harness();
  ctl.confirm();
  // teardown re-enters app.quit(), which re-emits before-quit: it must not be
  // intercepted a second time (MD-105's prevented-event trap).
  assert.equal(ctl.request('quit'), 'allow');
  assert.equal(ctl.request('close'), 'allow');
  assert.equal(ctl.request('signal'), 'allow');
  assert.equal(calls.teardown, 1);
});

test('dialogShown after the exit is decided is inert', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { ctl, calls } = harness();
  ctl.confirm();
  ctl.dialogShown();          // a late ACK from a renderer that is going away
  t.mock.timers.tick(QUIT_DEADLINE_MS);
  assert.equal(calls.hardExit, 1, 'a stale ACK cannot cancel the deadline');
});

test('the closing-time conclusion exits under the same budget', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // The graceful route ends in confirm() too — one cap for every way out.
  const { ctl, calls } = harness({ teardown: () => { calls.teardown++; } });
  ctl.confirm();
  assert.equal(calls.teardown, 1);
  t.mock.timers.tick(QUIT_DEADLINE_MS);
  assert.equal(calls.hardExit, 1);
});

// ─── the count itself: LIVE processes, never the registry ────────────────────

test('a PTY record whose process is gone is not a running agent', () => {
  const registry = [
    { id: 'a', pid: 101 },
    { id: 'wedged', pid: 202 },   // slept through, node-pty never fired onExit
    { id: 'b', pid: 303 }
  ];
  const alive = (pid) => pid !== 202;
  assert.deepEqual(liveOnly(registry, alive).map((p) => p.id), ['a', 'b']);
  assert.equal(liveOnly(registry, alive).length, 2, 'this is the number the dialog states');
});

test('the phantom "1 agent still running": one record, no process, zero agents', () => {
  assert.equal(liveOnly([{ id: 'ghost', pid: 999 }], () => false).length, 0);
});

test('a record with no usable pid never counts as live', () => {
  const alwaysAlive = () => true;
  assert.equal(liveOnly([{ id: 'x' }], alwaysAlive).length, 0, 'undefined pid');
  assert.equal(liveOnly([{ id: 'x', pid: 0 }], alwaysAlive).length, 0, 'pid 0 is not a child');
  assert.equal(liveOnly([{ id: 'x', pid: -1 }], alwaysAlive).length, 0, 'negative is a group, not a pid');
});

test('all live → nothing is dropped', () => {
  const rows = [{ pid: 1 }, { pid: 2 }, { pid: 3 }];
  assert.equal(liveOnly(rows, () => true).length, 3);
});

test('the out-of-loop watchdog is armed on every decided exit, exactly once', () => {
  const { ctl, calls } = harness();
  ctl.request('quit');
  assert.deepEqual(calls.watchdog, [], 'not while the user is still deciding');
  ctl.confirm();
  assert.deepEqual(calls.watchdog, [QUIT_DEADLINE_MS], 'the JS timer alone can be starved');
  ctl.confirm();
  ctl.request('signal');
  assert.deepEqual(calls.watchdog, [QUIT_DEADLINE_MS], 'one exit, one watchdog');
});

test('a watchdog that cannot be armed does not stop the exit', () => {
  const calls = { teardown: 0, hardExit: 0 };
  const ctl = createQuitController({
    livePtyCount: () => 1,
    askRenderer: () => true,
    teardown: () => { calls.teardown++; },
    hardExit: () => { calls.hardExit++; },
    armWatchdog: () => { throw new Error('no worker_threads here'); }
  });
  ctl.confirm();
  assert.equal(calls.teardown, 1, 'teardown still runs');
});
