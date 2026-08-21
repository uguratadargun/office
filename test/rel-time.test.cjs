'use strict';

/**
 * relSince — the "added 3d ago" line in the Knowledge Graph browser.
 *
 * The bucket boundaries are arithmetic nobody re-reads, and the malformed-stamp
 * path is the one that actually bites: `Date.parse('')` is NaN, and NaN through
 * the buckets renders "NaNm ago" in the UI instead of failing loudly.
 */
const test = require('node:test');
const assert = require('node:assert');
require('./load-ts.cjs');

const { relSince } = require('../src/shared/relTime.ts');

const NOW = Date.parse('2026-08-21T12:00:00.000Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

test('relSince buckets a delta into just-now / m / h / d', () => {
  assert.strictEqual(relSince(ago(0), NOW), 'just now');
  assert.strictEqual(relSince(ago(44_000), NOW), 'just now');
  assert.strictEqual(relSince(ago(5 * 60_000), NOW), '5m ago');
  assert.strictEqual(relSince(ago(59 * 60_000), NOW), '59m ago');
  assert.strictEqual(relSince(ago(3 * 3600_000), NOW), '3h ago');
  assert.strictEqual(relSince(ago(3 * 86_400_000), NOW), '3d ago');
});

test('relSince never emits NaN for a malformed or missing stamp', () => {
  assert.strictEqual(relSince('not-a-date', NOW), 'not-a-date');
  assert.strictEqual(relSince('', NOW), 'unknown');
});

test('relSince clamps a future stamp to just now rather than a negative age', () => {
  assert.strictEqual(relSince(new Date(NOW + 86_400_000).toISOString(), NOW), 'just now');
});
