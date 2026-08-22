'use strict';

/**
 * Bringing Michael a cup of tea.
 *
 * The whole feature is a charm, and a charm that fires too often is a parade:
 * the scheduler is the part that keeps it rare. Three rules carry it — the
 * countdown measures IDLE time (a working agent owes the same minutes when it
 * finishes), only one agent is ever carrying a cup, and delivering one buys
 * another 5–15 minutes of quiet.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  newTeaSchedule, tickTea, endTea, teaGap, TEA_MIN_SECONDS, TEA_MAX_SECONDS,
} = loadTs('src/renderer/src/scene/office/teaRun.ts');

const idle = (...ids) => ids.map((id) => ({ id, eligible: true }));
const gap = (s) => () => s;   // deterministic countdown

test('nobody sets off before their idle countdown runs out', () => {
  const s = newTeaSchedule();
  for (let i = 0; i < 9; i++) {
    assert.equal(tickTea(s, 1, idle('jim'), gap(10)), null);
  }
  assert.equal(tickTea(s, 1, idle('jim'), gap(10)), 'jim');
});

test('a working agent is frozen, not merely skipped', () => {
  const s = newTeaSchedule();
  // Ten seconds idle, then a long stretch of work.
  for (let i = 0; i < 5; i++) tickTea(s, 1, idle('pam'), gap(10));
  for (let i = 0; i < 100; i++) {
    assert.equal(tickTea(s, 1, [{ id: 'pam', eligible: false }], gap(10)), null);
  }
  // Back to idle, it still owes the other five seconds — no instant tea run.
  for (let i = 0; i < 4; i++) assert.equal(tickTea(s, 1, idle('pam'), gap(10)), null);
  assert.equal(tickTea(s, 1, idle('pam'), gap(10)), 'pam');
});

test('never two couriers at once — the second waits for the floor', () => {
  const s = newTeaSchedule();
  const floor = idle('jim', 'dwight');
  let first = null;
  for (let i = 0; i < 10 && !first; i++) first = tickTea(s, 1, floor, gap(10));
  assert.equal(first, 'jim');
  // Dwight is overdue too, but Jim is still walking (a courier is not idle).
  const walking = [{ id: 'jim', eligible: false }, { id: 'dwight', eligible: true }];
  for (let i = 0; i < 60; i++) assert.equal(tickTea(s, 1, walking, gap(10)), null);
  endTea(s, 'jim');
  assert.equal(tickTea(s, 1, walking, gap(10)), 'dwight');
});

test('delivering buys another full countdown', () => {
  const s = newTeaSchedule();
  for (let i = 0; i < 10; i++) tickTea(s, 1, idle('jim'), gap(10));
  endTea(s, 'jim');
  for (let i = 0; i < 9; i++) assert.equal(tickTea(s, 1, idle('jim'), gap(10)), null);
  assert.equal(tickTea(s, 1, idle('jim'), gap(10)), 'jim');
});

test('endTea only frees the floor for the agent that was actually on it', () => {
  const s = newTeaSchedule();
  for (let i = 0; i < 10; i++) tickTea(s, 1, idle('jim'), gap(10));
  assert.equal(s.busy, 'jim');
  endTea(s, 'dwight');          // a cancelled run for someone who never went
  assert.equal(s.busy, 'jim');
});

test('an agent that leaves the floor is forgotten', () => {
  const s = newTeaSchedule();
  tickTea(s, 1, idle('temp'), gap(10));
  assert.ok('temp' in s.due);
  tickTea(s, 1, idle('jim'), gap(10));
  assert.deepEqual(Object.keys(s.due), ['jim']);
});

test('the real gap stays inside 5–15 minutes', () => {
  assert.equal(teaGap(() => 0), TEA_MIN_SECONDS);
  assert.equal(teaGap(() => 1), TEA_MAX_SECONDS);
  for (let i = 0; i < 200; i++) {
    const g = teaGap();
    assert.ok(g >= TEA_MIN_SECONDS && g <= TEA_MAX_SECONDS, `gap out of range: ${g}`);
  }
});
