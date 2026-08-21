'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeReflect } = require('./load-ts.cjs')('src/shared/reflectSummary.ts');

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
