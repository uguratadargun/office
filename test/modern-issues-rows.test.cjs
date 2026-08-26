'use strict';

/**
 * MD-144 — the Issues list and the PRs list are two segments of ONE screen, so
 * a row is separated the same way in both.
 *
 * This is a source-shape test on purpose. What went wrong was not a wrong value
 * a pure function could return — it was that one list grew a divider and the
 * other never did, because each list wrote its own wrapper. So what is pinned
 * is the SHAPE: the divider is declared once, in ListRow, and neither list
 * spells it out for itself. A future segment that hand-rolls `border-b pb-3`
 * has re-created exactly the drift this card removed, and fails here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const VIEW = read('src/renderer/src/modern/issues/IssuesView.tsx');
const ROW = read('src/renderer/src/modern/issues/ListRow.tsx');

test('the row divider is declared exactly once, in ListRow', () => {
  assert.match(ROW, /const ROW_DIVIDER = 'border-b pb-3 last:border-b-0'/);
  // The colour comes from the `*` base rule in modern.css, not from a hue
  // spelled here — the same reason modern-theme-contrast rejects `bg-amber-500`.
  assert.doesNotMatch(ROW, /border-(slate|zinc|neutral|gray)-/);
});

test('neither list spells its own separation', () => {
  // `border-b` survives in the view's HEADER (a different divider, above the
  // list); what must not come back is a row wrapper carrying its own.
  assert.doesNotMatch(VIEW, /className="flex flex-col gap-2 border-b pb-3/);
  assert.doesNotMatch(VIEW, /border-b pb-3 last:border-b-0/);
});

test('both lists render their rows through ListRow', () => {
  // Issues: an <article>, because an issue is a self-contained thing.
  assert.match(VIEW, /<ListRow as="article" key=\{issue\.number\}/);
  // PRs: the default <div>, wrapping the railed row rather than replacing it —
  // the neutral hairline and the coloured verdict rail are two different facts
  // and must not share a border box.
  assert.match(VIEW, /<ListRow key=\{pr\.number\}>/);
  assert.match(VIEW, /railClass\(railTone\(record, running\)\)/);
  // The old hand-rolled wrappers are gone, both of them.
  assert.doesNotMatch(VIEW, /<article key=\{issue\.number\}/);
  assert.doesNotMatch(VIEW, /<div\s+key=\{pr\.number\}/);
});

test('the rail stays on its own element, so the divider cannot round with it', () => {
  // `rounded-md` belongs to the railed inner box. If it ever migrates onto the
  // ListRow the hairline curves up at both ends to meet the rail.
  assert.doesNotMatch(ROW, /rounded/);
});
