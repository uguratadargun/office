'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeReflect } = require('./load-ts.cjs')('src/shared/reflectSummary.ts');
const { condenseRetryDelayMs, CONDENSE_RETRY_CAP_MS } =
  require('./load-ts.cjs')('src/shared/tokenDiet.ts');

test('an empty result reads as "nothing to condense", never as success', () => {
  const out = summarizeReflect([]);
  assert.match(out, /Nothing to condense/);
});

test('a condensed agent reports the size it actually saved', () => {
  const out = summarizeReflect([{ id: 'jim', condensed: true, reason: 'ok', oldBytes: 4096, newBytes: 512 }]);
  assert.equal(out, 'jim: condensed 4.0 KB → 512 B');
});

test('a skipped agent reports why, and each agent gets its own line', () => {
  const out = summarizeReflect([
    { id: 'jim', condensed: false, reason: 'under threshold' },
    // condensed:true but no byte counts must still not claim a saving.
    { id: 'pam', condensed: true, reason: 'ok' }
  ]);
  assert.equal(out, 'jim: unchanged (under threshold)\npam: unchanged (ok)');
});

// ─── (MD-164) the condense retry that ran all night ─────────────────────────
// A `condense-abort` is the VERIFIER rejecting the file's shape, and the file has
// not changed since — so the plain 30-minute retry spent 14 headless Haiku calls
// on one agent between 18:43 and 23:44 and changed nothing.

const HALF_HOUR = 30 * 60 * 1000;

test('a clean agent keeps the plain interval', () => {
  assert.equal(condenseRetryDelayMs(0, HALF_HOUR), HALF_HOUR);
});

test('each consecutive abort doubles the wait', () => {
  assert.equal(condenseRetryDelayMs(1, HALF_HOUR), HALF_HOUR * 2);
  assert.equal(condenseRetryDelayMs(2, HALF_HOUR), HALF_HOUR * 4);
  assert.equal(condenseRetryDelayMs(3, HALF_HOUR), HALF_HOUR * 8);
});

test('the backoff turns a 14-call night into four attempts', () => {
  // Same window the log recorded: 18:43 → 23:44, five hours.
  const WINDOW = 5 * 60 * 60 * 1000;
  let elapsed = 0, calls = 0;
  while (elapsed < WINDOW) { elapsed += condenseRetryDelayMs(calls, HALF_HOUR); calls++; }
  assert.ok(calls <= 4, `backoff still allows ${calls} calls in five hours`);
});

test('the wait is capped so a permanently-bad file is not retried in the year 2040', () => {
  assert.equal(condenseRetryDelayMs(99, HALF_HOUR), CONDENSE_RETRY_CAP_MS);
});
