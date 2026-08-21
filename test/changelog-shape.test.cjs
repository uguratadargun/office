'use strict';

// [Unreleased] had grown to FIFTEEN `###` headings for four kinds of change,
// because every merge appended its own `### Added` instead of merging into the
// one already there. Nothing failed — it just got quietly worse each time, which
// is why this is a test and not a one-off cleanup. The next merge that
// reintroduces a duplicate heading fails here instead.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const TEXT = readFileSync(join(__dirname, '..', 'CHANGELOG.md'), 'utf8');

/** Every `## ` release block → the `### ` headings under it, in file order. */
function blocks() {
  const out = new Map();
  let cur = null;
  for (const line of TEXT.split('\n')) {
    if (line.startsWith('## ')) { cur = line.trim(); out.set(cur, []); }
    else if (line.startsWith('### ') && cur) out.get(cur).push(line.slice(4).trim());
  }
  return out;
}

const UNRELEASED = '## [Unreleased]';
/** The four kinds [Unreleased] uses, in the order it presents them. Shipped
 *  releases are frozen history and use a wider vocabulary (Docs, Performance,
 *  Thanks…), so the two checks below are scoped to the block merges append to —
 *  failing CI over the shape of a release nobody can edit is noise. */
const ORDER = ['Added', 'Changed', 'Fixed', 'Removed'];

test('no release block repeats a section heading', () => {
  for (const [release, headings] of blocks()) {
    const seen = new Set();
    for (const h of headings) {
      assert.ok(!seen.has(h),
        `${release} has more than one "### ${h}" — fold your entries into the existing section instead of appending a second heading`);
      seen.add(h);
    }
  }
});

test('Unreleased exists, is not empty, and uses only the four known sections', () => {
  // The duplicate guard above is satisfied trivially by a block with no headings
  // at all, so pin what the other assertions assume is there.
  const headings = blocks().get(UNRELEASED);
  assert.ok(headings, 'CHANGELOG.md has no ## [Unreleased] block');
  assert.ok(headings.length > 0, '[Unreleased] has no sections');
  for (const h of headings) {
    assert.ok(ORDER.includes(h), `[Unreleased]: "### ${h}" is not one of ${ORDER.join(' / ')}`);
  }
});

test('Unreleased sections appear in the agreed order', () => {
  const ranks = blocks().get(UNRELEASED).map((h) => ORDER.indexOf(h));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b),
    `[Unreleased]: sections are out of order — expected ${ORDER.join(' / ')}`);
});
