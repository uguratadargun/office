'use strict';

/**
 * endSessionAndArchive — the X in an agent's detail panel.
 *
 * MD-109: the modern (and pixel) handler opened with `if (!agent.ptyId) return;`
 * and then archived INSIDE `killPty(...).then(...)`. An agent parked on standby
 * has its `ptyId` cleared by `sleepAgent` (store.ts), so the guard fired first
 * and the confirmed, armed destructive press did nothing at all — the human
 * could not archive an idle agent.
 *
 * Archiving is a ROSTER edit, not a process edit: ending the session is the
 * optional half. These tests pin that order — kill only when there is something
 * to kill, archive always, including when the kill fails or throws.
 */
const test = require('node:test');
const assert = require('node:assert');
require('./load-ts.cjs');

const { endSessionAndArchive } = require('../src/shared/agentArchive.ts');

function spy() {
  const calls = [];
  const fn = (...args) => { calls.push(args); return fn.result; };
  fn.calls = calls;
  return fn;
}

function deps(killResult) {
  const killPty = spy();
  killPty.result = killResult;
  const disposeTerminal = spy();
  const archive = spy();
  return { killPty, disposeTerminal, archive };
}

test('an agent on standby (no ptyId) is archived, and nothing is killed', async () => {
  const d = deps(Promise.resolve({ ok: true }));
  await endSessionAndArchive({ id: 'munder-dev' }, d);
  assert.deepStrictEqual(d.killPty.calls, [], 'there is no process to end');
  assert.deepStrictEqual(d.disposeTerminal.calls, []);
  assert.deepStrictEqual(d.archive.calls, [['munder-dev']], 'archive still runs');
});

test('a live agent has its pty killed and disposed, then is archived', async () => {
  const d = deps(Promise.resolve({ ok: true }));
  await endSessionAndArchive({ id: 'a1', ptyId: 'pty-a1' }, d);
  assert.deepStrictEqual(d.killPty.calls, [['pty-a1']]);
  assert.deepStrictEqual(d.disposeTerminal.calls, [['pty-a1']]);
  assert.deepStrictEqual(d.archive.calls, [['a1']]);
});

test('a dead pty (kill reports not-ok) still archives the agent', async () => {
  const d = deps(Promise.resolve({ ok: false, error: 'unknown pty' }));
  await endSessionAndArchive({ id: 'a2', ptyId: 'stale-pty' }, d);
  assert.deepStrictEqual(d.killPty.calls, [['stale-pty']]);
  assert.deepStrictEqual(d.archive.calls, [['a2']], 'a failed kill must not strand the card');
});

test('a rejecting killPty still archives the agent and does not throw', async () => {
  const d = deps(Promise.reject(new Error('IPC gone')));
  await endSessionAndArchive({ id: 'a3', ptyId: 'pty-a3' }, d);
  assert.deepStrictEqual(d.archive.calls, [['a3']]);
});

test('the terminal is disposed before the card leaves the roster', async () => {
  const order = [];
  await endSessionAndArchive({ id: 'a4', ptyId: 'pty-a4' }, {
    killPty: () => { order.push('kill'); return Promise.resolve({ ok: true }); },
    disposeTerminal: () => order.push('dispose'),
    archive: () => order.push('archive')
  });
  assert.deepStrictEqual(order, ['kill', 'dispose', 'archive']);
});
