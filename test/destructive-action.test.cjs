'use strict';

/**
 * The destructive-action policy, as a machine.
 *
 * The app had five different answers to "the user is about to destroy something",
 * and none of the two-step ones disarmed themselves — a half-pressed "sure?" sat
 * live on screen indefinitely. This is the one machine they all run on now, so the
 * transitions are worth pinning: an off-by-one in the phase table means either a
 * confirm that never fires or a delete that fires on the first click.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  reduce, secondsLeft, IDLE, ARM_TIMEOUT_MS, UNDO_WINDOW_MS
} = loadTs('src/renderer/src/components/ui/destructive.ts');

const T0 = 1_000_000;
const press = (now) => ({ type: 'press', now });

/** Walk a list of events from idle, collecting the effects. */
function run(events, opts) {
  let state = IDLE;
  const effects = [];
  for (const e of events) {
    const step = reduce(state, e, opts);
    state = step.state;
    effects.push(step.effect);
  }
  return { state, effects };
}

test('one press arms, it does not fire — the whole point of the policy', () => {
  const { state, effects } = run([press(T0)]);
  assert.equal(state.phase, 'armed');
  assert.deepEqual(effects, ['none'], 'nothing was destroyed by a single click');
});

test('a second press runs it', () => {
  const { state, effects } = run([press(T0), press(T0 + 500)]);
  assert.equal(state.phase, 'idle');
  assert.deepEqual(effects, ['none', 'run']);
});

test('an armed action stands down on its own', () => {
  // This is the defect every existing two-step in the app shared: a "sure?" left
  // live forever, waiting for a stray click on a button that no longer says delete.
  const armed = reduce(IDLE, press(T0), {}).state;
  assert.equal(armed.deadline, T0 + ARM_TIMEOUT_MS);
  const step = reduce(armed, { type: 'expire' }, {});
  assert.equal(step.state.phase, 'idle');
  assert.equal(step.effect, 'none', 'standing down destroys nothing');
});

test('an irreversible action never stands down', () => {
  // A prompt that vanishes while the user is reading what they are about to lose
  // is worse than one that waits for a real answer.
  const armed = reduce(IDLE, press(T0), { autoDisarm: false }).state;
  assert.equal(armed.phase, 'armed');
  assert.equal(armed.deadline, 0, 'no deadline means no timer and no countdown');
  assert.equal(secondsLeft(armed, T0 + 60_000), 0);
  // …and it still fires on the second press.
  assert.equal(reduce(armed, press(T0 + 60_000), { autoDisarm: false }).effect, 'run');
});

test('a reversible action defers instead of running', () => {
  const { state, effects } = run([press(T0), press(T0 + 500)], { undoable: true });
  assert.equal(state.phase, 'pending');
  assert.deepEqual(effects, ['none', 'none'], 'confirming an undoable action runs nothing yet');
  assert.equal(state.deadline, T0 + 500 + UNDO_WINDOW_MS);
});

test('the undo window closing is what actually performs it', () => {
  const pending = run([press(T0), press(T0)], { undoable: true }).state;
  const step = reduce(pending, { type: 'expire' }, { undoable: true });
  assert.equal(step.effect, 'run');
  assert.equal(step.state.phase, 'idle');
});

test('undo means it never happened — no compensating write to get wrong', () => {
  const pending = run([press(T0), press(T0)], { undoable: true }).state;
  // The only button on screen during `pending` is "undo", so a press takes it back
  // rather than firing a second delete.
  const step = reduce(pending, press(T0 + 100), { undoable: true });
  assert.equal(step.effect, 'abort');
  assert.equal(step.state.phase, 'idle');
});

test('a full undoable round trip never reaches run', () => {
  const { state, effects } = run(
    [press(T0), press(T0 + 100), press(T0 + 200)],
    { undoable: true }
  );
  assert.equal(state.phase, 'idle');
  assert.ok(!effects.includes('run'), 'nothing was destroyed');
  assert.deepEqual(effects, ['none', 'none', 'abort']);
});

test('cancel stands an armed action down and takes a pending one back', () => {
  const armed = reduce(IDLE, press(T0), {}).state;
  const fromArmed = reduce(armed, { type: 'cancel' }, {});
  assert.equal(fromArmed.state.phase, 'idle');
  assert.equal(fromArmed.effect, 'none');

  const pending = run([press(T0), press(T0)], { undoable: true }).state;
  const fromPending = reduce(pending, { type: 'cancel' }, { undoable: true });
  assert.equal(fromPending.state.phase, 'idle');
  assert.equal(fromPending.effect, 'abort');
});

test('unmounting honours a confirmed action and drops an unconfirmed one', () => {
  // Otherwise the user presses delete, watches the row go, closes the panel, and
  // finds it back on the next visit.
  const pending = run([press(T0), press(T0)], { undoable: true }).state;
  assert.equal(reduce(pending, { type: 'flush' }, { undoable: true }).effect, 'run');

  const armed = reduce(IDLE, press(T0), {}).state;
  assert.equal(reduce(armed, { type: 'flush' }, {}).effect, 'none');
  assert.equal(reduce(IDLE, { type: 'flush' }, {}).effect, 'none');
});

test('an expire that arrives in idle is inert', () => {
  // A timer can outlive its phase by a tick; it must not resurrect anything.
  const step = reduce(IDLE, { type: 'expire' }, { undoable: true });
  assert.equal(step.state.phase, 'idle');
  assert.equal(step.effect, 'none');
});

test('the countdown counts down, and rounds up so it never shows 0s while live', () => {
  const armed = reduce(IDLE, press(T0), {}).state;
  assert.equal(secondsLeft(armed, T0), ARM_TIMEOUT_MS / 1000);
  assert.equal(secondsLeft(armed, T0 + 1500), 3);
  assert.equal(secondsLeft(armed, T0 + ARM_TIMEOUT_MS), 0);
  assert.equal(secondsLeft(armed, T0 + 99_999), 0, 'never negative');
  assert.equal(secondsLeft(IDLE, T0), 0);
});

test('reduce is pure — it never mutates the state it was handed', () => {
  const before = { phase: 'armed', deadline: T0 + ARM_TIMEOUT_MS };
  const snapshot = { ...before };
  reduce(before, press(T0 + 1), { undoable: true });
  reduce(before, { type: 'expire' }, {});
  reduce(before, { type: 'flush' }, {});
  assert.deepEqual(before, snapshot);
});

// ─── one policy, no private copies (MD-152) ─────────────────────────────────

const fs = require('node:fs');
const path = require('node:path');
const readSrc = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

test('the modern reset row runs this machine instead of its own timer', () => {
  const src = readSrc('src/renderer/src/modern/settings/GeneralSection.tsx');
  // Scoped to ResetRow's own body: the same file still hand-rolls a per-ROW arm
  // for the registered-projects list, whose resting state is a hover icon
  // rather than a button. Collapsing that one changes how the row looks, so it
  // was left alone deliberately (MD-152) — and this guard must not pretend
  // otherwise by passing on the whole file.
  const body = src.slice(src.indexOf('function ResetRow'));
  const reset = body.slice(0, body.indexOf('\n}\n') + 3);
  assert.ok(reset.length > 100 && reset.length < 2000, 'found ResetRow, not the rest of the file');
  assert.match(reset, /<DestructiveButton/, 'armed through the shared control');
  // The fork this replaced: a private ARM_MS constant with its own setTimeout.
  assert.doesNotMatch(src, /const ARM_MS/, 'no private arm window constant left');
  assert.doesNotMatch(reset, /setTimeout/, 'no private timer');
  assert.doesNotMatch(reset, /useState/, 'no private phase state');
});

test('a bulk delete on the classic board is armed and says what it destroys', () => {
  const src = readSrc('src/renderer/src/components/TasksKanban.tsx');
  assert.match(src, /<DestructiveAction/, 'not a bare button');
  assert.match(src, /consequence=/, 'an armed prompt with no consequence is an empty dialog');
  assert.match(src, /There is no undo\./);
  // ONE ledger write for the whole selection — not N, which would let the god
  // append a card between a read and a write.
  assert.match(src, /window\.cth\.hiveDeleteTasks\(ids\)/);
  // The counts come from the shared model, not from counting the array again.
  assert.match(src, /from '@\/modern\/tasks\/bulkDelete'/);
});
