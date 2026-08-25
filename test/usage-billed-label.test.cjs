'use strict';

/**
 * MD-82. Andy's card showed "context 75k" with "1.2M" a row away and the meter
 * was reported as broken. Both numbers were exact — checked against the real
 * transcript, session fc1f3836: 21 requests, 1,270,846 billed, largest window
 * 83,382. The gap is entirely CACHE READS (1,181,476 + 71,718 = 93%): the same
 * window re-sent on every turn.
 *
 * Nothing to fix in the arithmetic, then. What has to be impossible is printing
 * that cumulative figure as a bare number next to a context gauge, which is why
 * the label lives inside the value and the explanation is one shared string.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  formatTokens, billedChipText, billedVsContextNote,
  TOKENS_BILLED_LABEL, TOKENS_BILLED_TIP
} = loadTs('src/shared/usageFormat.ts');

/** Andy's thread, as it actually stood when the report came in. */
const ANDY = {
  inputTokens: 40,
  outputTokens: 17_612,
  cacheReadTokens: 1_181_476,
  cacheWriteTokens: 71_718,
  totalTokens: 1_270_846
};
const ANDY_CONTEXT = 83_382;

test('the chip can never render the cumulative figure on its own', () => {
  const text = billedChipText(ANDY.totalTokens);
  // The pre-fix chip rendered exactly formatTokens(total) — "1.3M" — one row
  // above the context gauge. That bare string is the bug.
  assert.notEqual(text, formatTokens(ANDY.totalTokens));
  assert.ok(text.startsWith(`${TOKENS_BILLED_LABEL} `), `chip must lead with the label, got ${text}`);
  assert.ok(text.includes(formatTokens(ANDY.totalTokens)), 'the number must still be there');
});

test('the explanation names the cache share and denies being the context window', () => {
  const note = billedVsContextNote(ANDY, ANDY_CONTEXT);
  assert.ok(note.includes(TOKENS_BILLED_TIP), 'one shared wording, not a fourth variant');
  // 1,253,194 / 1,270,846 = 98.6% -> 99%. The number that answers "why 1.2M?".
  assert.match(note, /99% of it is cache/);
  assert.ok(note.includes(formatTokens(ANDY_CONTEXT)), 'must quote the real window beside the bill');
  assert.match(note, /not that number/);
});

test('with no context reading the note still refuses to be mistaken for one', () => {
  const note = billedVsContextNote(ANDY, undefined);
  assert.match(note, /not the context window/);
  assert.ok(!note.includes('undefined'));
});

test('a thread with no cache traffic gets no invented cache sentence', () => {
  const fresh = { inputTokens: 500, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 700 };
  const note = billedVsContextNote(fresh, 700);
  assert.ok(!note.includes('% of it is cache'), note);
  assert.ok(note.includes('billed 700') || note.includes('BILLED 700'), note);
});
