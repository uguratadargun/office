'use strict';

/**
 * "This conversation" vs "everything this agent ever spent".
 *
 * Both usage rungs sum EVERY session an agent has had, so after a `/clear` the
 * card still read $4.10 for a thread that had spent nothing. The fix subtracts a
 * baseline snapshotted when a new session id appears; these tests pin the four
 * cases that decide whether that subtraction is safe to show a human.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { usageSinceBaseline, usageBaselineOf } = loadTs('src/shared/usageBaseline.ts');
const { withThread, NO_USAGE } = loadTs('src/main/agentUsage.ts');
const { isClearCommand } = loadTs('src/shared/providerAutomation.ts');

const at = (i, o, cr, cw, usd) => ({
  inputTokens: i, outputTokens: o, cacheReadTokens: cr, cacheWriteTokens: cw, usd
});

test('fresh spawn: the baseline is taken from the lifetime that already existed, so the thread reads zero', () => {
  const lifetime = at(1000, 200, 50, 10, 4.10);
  const d = usageSinceBaseline(lifetime, usageBaselineOf(lifetime));
  assert.equal(d.totalTokens, 0);
  assert.equal(d.inputTokens, 0);
  assert.equal(d.usd, 0);
});

test('after a clear: the thread counts only what was spent since', () => {
  const baseline = at(1000, 200, 50, 10, 4.10);
  const d = usageSinceBaseline(at(1300, 260, 90, 10, 4.85), baseline);
  assert.deepEqual(
    [d.inputTokens, d.outputTokens, d.cacheReadTokens, d.cacheWriteTokens],
    [300, 60, 40, 0]
  );
  assert.equal(d.totalTokens, 400);
  assert.equal(d.usd, 0.75);
});

test('resume keeps the thread numbers — same baseline, so growth accumulates instead of resetting', () => {
  const baseline = at(1000, 200, 50, 10, 4.10);
  const before = usageSinceBaseline(at(1300, 260, 90, 10, 4.85), baseline);
  const after = usageSinceBaseline(at(1500, 300, 90, 10, 5.10), baseline);
  assert.equal(before.totalTokens, 400);
  assert.equal(after.totalTokens, 640); // grew; did NOT restart at the resume
  assert.ok(after.usd > before.usd);
});

test('negative guard: a lifetime below its own baseline means the counters restarted, so lifetime IS the thread', () => {
  // OTLP only knows the sessions it has seen since boot, so an agent baselined
  // against a big transcript read comes back reporting a handful of live tokens.
  const baseline = at(4_000_000, 900_000, 100, 100, 42);
  const d = usageSinceBaseline(at(12_000, 3_000, 0, 0, 0.04), baseline);
  assert.equal(d.totalTokens, 15_000);
  assert.equal(d.usd, 0.04);
  assert.ok(d.inputTokens >= 0 && d.outputTokens >= 0);
});

test('an unpriced side leaves the lifetime cost standing rather than guessing', () => {
  assert.equal(usageSinceBaseline(at(10, 10, 0, 0, null), at(5, 5, 0, 0, 1)).usd, null);
  assert.equal(usageSinceBaseline(at(10, 10, 0, 0, 2), at(5, 5, 0, 0, null)).usd, 2);
});

test('no baseline at all = the whole lifetime is the thread', () => {
  const d = usageSinceBaseline(at(7, 3, 1, 1, 0.5), null);
  assert.equal(d.totalTokens, 12);
  assert.equal(d.usd, 0.5);
});

test('withThread leaves the lifetime fields — what the budget and the cost ledger read — untouched', () => {
  const lifetime = {
    inputTokens: 1300, outputTokens: 260, cacheReadTokens: 90, cacheWriteTokens: 10,
    totalTokens: 1660, usd: 4.85, source: 'transcript', model: 'claude-opus-5', lastActivityMs: 1
  };
  const out = withThread(lifetime, at(1000, 200, 50, 10, 4.10));
  assert.equal(out.totalTokens, 1660);
  assert.equal(out.usd, 4.85);
  assert.equal(out.thread.totalTokens, 400);
  assert.equal(out.thread.source, 'transcript');
});

test('unknown stays unknown: nothing is subtracted from a reading we do not have', () => {
  assert.equal(withThread(NO_USAGE, at(9, 9, 9, 9, 9)).thread.source, 'none');
  assert.equal(withThread(NO_USAGE, at(9, 9, 9, 9, 9)).thread.totalTokens, 0);
});

test('the clear verb is per provider — /new engines zeroed nothing while the gauge stayed pinned', () => {
  assert.equal(isClearCommand('/clear', 'claude'), true);
  assert.equal(isClearCommand('  /CLEAR ', 'claude'), true);
  assert.equal(isClearCommand('/new', 'opencode'), true);
  assert.equal(isClearCommand('/clear', 'opencode'), false);
  assert.equal(isClearCommand('/new', 'grok'), true);
  assert.equal(isClearCommand('/clear', 'crush'), false); // no trustworthy verb
});
