const test = require('node:test');
const assert = require('node:assert');
const loadTs = require('./load-ts.cjs');

const m = loadTs('src/renderer/src/modern/agents/agentsModel.ts');

test('blocked is the only status that earns destructive', () => {
  assert.equal(m.statusTone('blocked'), 'destructive');
  assert.equal(m.statusTone('working'), 'default');
  assert.equal(m.statusTone('idle'), 'secondary');
});

test('a sleeping agent reads `asleep` everywhere, from one source', () => {
  // The rail and the roster table each spelled `sleeping ? 'asleep' : status`
  // themselves; the agent-detail header did not, so the same agent read
  // `asleep` in the list and `idle` in the header two inches away (MD-97 fixed
  // the table only). All three now ask statusBadge, so they cannot disagree.
  const asleep = m.statusBadge({ status: 'idle', sleeping: true });
  assert.equal(asleep.label, 'asleep', 'sleeping wins over the raw status');
  assert.equal(asleep.tone, 'outline', 'asleep is not a state anything is happening in');

  // `sleeping` is a flag beside `status`, so a working agent must be unaffected.
  assert.deepEqual(m.statusBadge({ status: 'working' }), { label: 'working', tone: 'default' });
  assert.deepEqual(m.statusBadge({ status: 'blocked', sleeping: false }), { label: 'blocked', tone: 'destructive' });
});

test('context gauge escalates at 6/8 and 7/8, and clamps', () => {
  assert.equal(m.contextGauge(0).tone, 'normal');
  assert.equal(m.contextGauge(5).tone, 'normal');
  assert.equal(m.contextGauge(6).tone, 'warn');
  assert.equal(m.contextGauge(8).tone, 'danger');
  assert.equal(m.contextGauge(99).pct, 100);
  assert.equal(m.contextGauge(-4).pct, 0);
  assert.equal(m.contextGauge(NaN).pct, 0);
});

test('row subtitle is the action while working, the repo otherwise', () => {
  assert.equal(m.rowSubtitle({ status: 'working', action: 'rebasing', project: 'office' }), 'rebasing');
  assert.equal(m.rowSubtitle({ status: 'idle', action: 'rebasing', project: 'office' }), 'office');
  // a working agent with no action must not render an empty line where the repo would do
  assert.equal(m.rowSubtitle({ status: 'working', action: '  ', project: 'office' }), 'office');
});

test('billed chip is null for no signal — never a zero', () => {
  assert.equal(m.billedChip(undefined), null);
  assert.equal(m.billedChip({ totalTokens: 0, source: 'otlp' }), null);
  assert.equal(m.billedChip({ totalTokens: 5000, source: 'none' }), null);
  assert.match(m.billedChip({ totalTokens: 5000, source: 'otlp' }), /^billed /);
});

test('dispatch appends a picked agent as a suggestion, never as a target', () => {
  const plain = m.dispatchBody('  ship it  ');
  assert.equal(plain, 'ship it');
  const suggested = m.dispatchBody('ship it', { id: 'dev-1', name: 'Ada' });
  assert.match(suggested, /^ship it\n\n\(The human suggests Ada \(dev-1\)/);
  assert.match(suggested, /your call as orchestrator/);
});

test('a failed dispatch is sticky and quotes the reason; a success fades', () => {
  const bad = m.dispatchOutcome({ ok: false, error: 'hive offline' }, 'Michael');
  assert.equal(bad.sticky, true);
  assert.match(bad.text, /hive offline/);
  const worse = m.dispatchOutcome({ ok: false }, 'Michael');
  assert.match(worse.text, /unknown error/);
  const good = m.dispatchOutcome({ ok: true }, 'Michael', { id: 'dev-1', name: 'Ada' });
  assert.equal(good.sticky, false);
  assert.match(good.text, /sent to Michael \(suggesting Ada\)/);
});

test('Restart & Continue must hard-fail without a session; a model change falls back', () => {
  assert.equal(m.resumeIsOptional('continue'), false);
  assert.equal(m.resumeIsOptional('model-change'), true);
});
