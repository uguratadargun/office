'use strict';

/**
 * The compaction pressure gate, and — the point of MD-167 — WHY it fired.
 *
 * MD-162 moved the shipped bars to 25%/12% at a 30m cadence, but the gate had
 * only ever been exercised against synthetic numbers: on a floor where hook
 * telemetry never arrived, `passesContextPressure` returned a silent `true` and
 * compaction ran on cadence alone, which is indistinguishable from a gate that is
 * working. `contextPressureDecision` returns the REASON so the caller can say
 * which of the two happened, and these pin each reason to the state that produces
 * it — a silent fail-open is exactly the regression that hides for months.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  contextPressureDecision, CONTEXT_TELEMETRY_STALE_MS, LARGE_CONTEXT_WINDOW,
  DEFAULT_CONTEXT_TRIGGER
} = loadTs('src/shared/triggers.ts');

const RULE = DEFAULT_CONTEXT_TRIGGER.compact;
const NOW = 1_800_000_000_000;
const fresh = (over = {}) => ({ updatedAt: NOW - 60_000, ...over });

test('the shipped bars are the ones MD-162 landed', () => {
  assert.equal(RULE.minContextPct, 25);
  assert.equal(RULE.minContextPctLargeWindow, 12);
  assert.equal(RULE.everyMs, 1_800_000);
});

test('a fresh reading at or over the bar opens the gate, and says so', () => {
  const d = contextPressureDecision(fresh({ tokens: 50_000, limit: 200_000 }), RULE, NOW);
  assert.deepEqual([d.fire, d.reason, d.bar], [true, 'above-bar', 25]);
  assert.equal(Math.round(d.pct), 25);
});

test('a fresh reading under the bar is the ONLY branch that holds fire', () => {
  const d = contextPressureDecision(fresh({ tokens: 40_000, limit: 200_000 }), RULE, NOW);
  assert.deepEqual([d.fire, d.reason], [false, 'below-bar']);
  assert.equal(Math.round(d.pct), 20);
});

test('a large window is judged against the lower bar', () => {
  const big = { tokens: 130_000, limit: 1_000_000 };
  assert.ok(big.limit >= LARGE_CONTEXT_WINDOW);
  const d = contextPressureDecision(fresh(big), RULE, NOW);
  assert.deepEqual([d.fire, d.reason, d.bar], [true, 'above-bar', 12]);
  // …and the same 13% would be far under the small-window bar.
  assert.equal(contextPressureDecision(fresh({ tokens: 26_000, limit: 200_000 }), RULE, NOW).fire, false);
});

test('no reading at all fires on cadence alone, flagged as such', () => {
  const d = contextPressureDecision({}, RULE, NOW);
  assert.deepEqual([d.fire, d.reason, d.pct], [true, 'no-telemetry', null]);
});

test('a reading older than the stale window fires on cadence alone, and reports the number it distrusted', () => {
  const stale = { tokens: 2_000, limit: 200_000, updatedAt: NOW - CONTEXT_TELEMETRY_STALE_MS - 1 };
  const d = contextPressureDecision(stale, RULE, NOW);
  assert.deepEqual([d.fire, d.reason], [true, 'stale-telemetry']);
  assert.equal(Math.round(d.pct), 1, 'the distrusted percentage is still carried out, for the log line');
  // One second younger and the same reading is believed — and blocks the compact.
  stale.updatedAt = NOW - CONTEXT_TELEMETRY_STALE_MS + 1_000;
  assert.deepEqual(
    [contextPressureDecision(stale, RULE, NOW).fire, contextPressureDecision(stale, RULE, NOW).reason],
    [false, 'below-bar']);
});

test('a reading of unknown age is treated as stale, never as fresh', () => {
  // A restored agent keeps its last context numbers but not their provenance.
  // Believing them would let a months-old 1% block compaction forever.
  const d = contextPressureDecision({ tokens: 2_000, limit: 200_000 }, RULE, NOW);
  assert.deepEqual([d.fire, d.reason], [true, 'stale-telemetry']);
});

test('a zero bar switches the gate off entirely', () => {
  const off = { ...RULE, minContextPct: 0 };
  const d = contextPressureDecision(fresh({ tokens: 1, limit: 200_000 }), off, NOW);
  assert.deepEqual([d.fire, d.reason, d.bar], [true, 'gate-off', 0]);
});

test('tokens without a window infer one from the model, rather than being thrown away', () => {
  // The transcript poll backfills tokens only; the status line is what carries
  // the real window. 60k of an inferred 200k is over the bar…
  assert.equal(contextPressureDecision(fresh({ tokens: 60_000 }), RULE, NOW).reason, 'above-bar');
  // …and the same 60k on a 1M model is not.
  const d = contextPressureDecision(fresh({ tokens: 60_000, model: 'claude-sonnet-4-5-1m' }), RULE, NOW);
  assert.deepEqual([d.fire, d.reason, d.bar], [false, 'below-bar', 25]);
});

test('a zero-token reading is a reading, not a missing one', () => {
  // Set by a delivered /clear. It must READ as below-bar, so the agent that was
  // just cleared is not compacted on the very next tick.
  const d = contextPressureDecision(fresh({ tokens: 0, limit: 200_000 }), RULE, NOW);
  assert.deepEqual([d.fire, d.reason, d.pct], [false, 'below-bar', 0]);
});
