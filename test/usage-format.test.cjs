'use strict';

/**
 * The readout's job is to keep three different facts apart: "no signal",
 * "tokens known but the model has no price", and "measured". Collapsing any two
 * of them back into "$0" is the bug the whole per-provider usage seam exists to
 * remove, and formatting is the last place it can happen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  formatTokens, formatUsd, capProgress, usageSourceNote, USAGE_SOURCE_LABEL
} = loadTs('src/shared/usageFormat.ts');

test('the three not-a-number outcomes never collapse into each other', () => {
  assert.equal(formatUsd({ totalTokens: 0, usd: null, source: 'none' }), 'unknown');
  assert.equal(formatUsd({ totalTokens: 36_000_000, usd: null, source: 'sqlite' }), '$? unpriced',
    'real tokens against an unpriced model is NOT unknown, and NOT free');
  assert.equal(formatUsd({ totalTokens: 10, usd: 1.234, source: 'otlp' }), '$1.23');
});

test('a measured zero is allowed to say zero — nothing else may', () => {
  assert.equal(formatUsd({ totalTokens: 0, usd: 0, source: 'transcript' }), '$0.00');
  // Sub-cent spend must not render as $0.00, which would read as the very zero
  // the seam is built to avoid.
  assert.equal(formatUsd({ totalTokens: 900, usd: 0.004, source: 'otlp' }), '<$0.01');
});

test('token counts stay readable at every scale', () => {
  assert.equal(formatTokens(0), '0');
  assert.equal(formatTokens(812), '812');
  assert.equal(formatTokens(1200), '1.2k');
  assert.equal(formatTokens(36_000), '36k', 'whole thousands do not need a decimal');
  assert.equal(formatTokens(294_850), '295k');
  assert.equal(formatTokens(1_400_000), '1.4M');
  assert.equal(formatTokens(36_937_599), '37M');
  assert.equal(formatTokens(NaN), '—');
});

test('the per-agent cap overrides the floor budget — that is what it is for', () => {
  const p = capProgress(500, 1000, 100_000);
  assert.equal(p.cap, 1000);
  assert.equal(p.pct, 50);
  assert.equal(p.over, false);
  assert.equal(p.label, '500 / 1k');
});

test('no cap anywhere means no meter, not a meter against an invented number', () => {
  assert.equal(capProgress(500, undefined, undefined), null);
  assert.equal(capProgress(500, 0, 0), null);
  // A floor budget with no per-agent override still meters.
  assert.equal(capProgress(50_000, undefined, 100_000).pct, 50);
});

test('the bar clamps at the cap but the over flag still fires', () => {
  const p = capProgress(250_000, 100_000, undefined);
  assert.equal(p.fraction, 1, 'a bar cannot be 250% full');
  assert.equal(p.over, true, 'but the caller must still be able to say so');
  assert.equal(capProgress(100_000, 100_000, undefined).over, true, 'exactly at the cap is over');
});

test('every source has a label and a note a user can act on', () => {
  for (const source of ['otlp', 'transcript', 'sqlite', 'none']) {
    assert.ok(USAGE_SOURCE_LABEL[source], `${source} has a label`);
    assert.ok(usageSourceNote({ totalTokens: 0, usd: null, source }).length > 10, `${source} has a note`);
  }
  assert.match(usageSourceNote({ totalTokens: 0, usd: null, source: 'none' }), /unknown, not zero/);
});
