'use strict';

/**
 * MD-125 — long ids and Windows paths must not set the width of a row.
 *
 * The human ran the packaged app on Windows and the modern Agents list came
 * apart: rows carried `C:\Users\ugur\HarnessAgents\worktrees\worker-md91-toby`
 * in full, the status and Working chips were pushed out of the viewport, and
 * the page stopped fitting. It had never shown on macOS, where the paths are
 * shorter and made of `/`.
 *
 * Two failures, and only one of them is CSS:
 *   - `split('/')` is not a basename. It was how `project` was derived, and on
 *     a backslash path it matches nothing and returns the path entire — so the
 *     "short label" in the roster WAS the long string, before any DOM existed.
 *   - `truncate` without `min-w-0` on every flex ancestor does nothing: a flex
 *     item will not shrink below its content, and `\` offers no line-break
 *     opportunity for the content to shrink at.
 *
 * The first half is a pure function and is tested as one. The second is a
 * SHAPE, and this file parses the JSX nesting for it rather than grepping —
 * a `truncate` and a `min-w-0` both being present in a file says nothing about
 * whether the second is an ancestor of the first.
 *
 * There is no jsdom or Playwright in this project's test dependencies, so the
 * "chips still in the viewport at 1024px" half is verified live against the
 * packaged app and reported with the screenshots, not from here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-ts.cjs');
const { baseName, pathLabel, clampLabel } = load('src/shared/pathLabel.ts');

const WIN = 'C:\\Users\\ugur\\HarnessAgents\\worktrees\\worker-md91-toby';

/* ── the value, before any CSS ─────────────────────────────────────────── */

test('baseName finds the last segment with either separator', () => {
  assert.equal(baseName(WIN), 'worker-md91-toby');
  assert.equal(baseName('/Users/ugur/Projects/office'), 'office');
  // The bug verbatim: this is what the old derivation returned on Windows.
  assert.equal(WIN.split('/').pop(), WIN);
  assert.notEqual(baseName(WIN), WIN);
});

test('baseName survives the shapes a config file actually holds', () => {
  assert.equal(baseName('C:\\repos\\fd\\'), 'fd');
  assert.equal(baseName('/repos/fd//'), 'fd');
  assert.equal(baseName('fd'), 'fd');
  assert.equal(baseName(''), '');
  assert.equal(baseName('C:\\'), 'C:');
  assert.equal(baseName(undefined), '');
});

test('pathLabel puts the distinguishing half FIRST', () => {
  // Truncation cuts from the end, so a label led by the parent truncates away
  // the only part that says which worktree this is.
  assert.ok(pathLabel(WIN).startsWith('worker-md91-toby'));
  assert.equal(pathLabel(WIN), 'worker-md91-toby — C:\\Users\\ugur\\HarnessAgents\\worktrees');
  assert.equal(pathLabel('/fd'), 'fd');
  assert.equal(pathLabel('fd'), 'fd');
});

test('clampLabel bounds text that no CSS can reach', () => {
  const long = 'bash -lc ' + 'x'.repeat(300);
  assert.ok(clampLabel(long, 42).length <= 43);
  assert.ok(clampLabel(long, 42).endsWith('…'));
  assert.equal(clampLabel('short', 42), 'short');
  // A word boundary near the cut is preferred, so the result reads as a phrase.
  assert.equal(clampLabel('one two three four five', 12), 'one two…');
});

/* ── the derivations that write the label ──────────────────────────────── */

const SRC = path.join(__dirname, '..', 'src', 'renderer', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

test('nobody derives an agent project with split(\'/\') any more', () => {
  for (const rel of ['modern/agents/AddAgentDialog.tsx', 'components/AddAgentModal.tsx']) {
    const src = read(rel);
    assert.ok(!/project:\s*\w*[Cc]wd\.split\('\/'\)/.test(src), `${rel}: split('/') is not a basename`);
    assert.match(src, /baseName/, `${rel}: must use the shared basename`);
  }
});

/* ── the shape that makes truncate work ────────────────────────────────── */

/** Walk the JSX tags of a file, tracking the open-element stack, and report
 *  every element carrying `truncate` together with the classes of its
 *  ancestors. Deliberately coarse — it does not parse expressions, only the
 *  nesting, which is exactly the thing a grep cannot see. */
function truncatedElements(src) {
  const out = [];
  const stack = [];
  const tag = /<(\/)?([A-Za-z][\w.]*)((?:[^<>'"]|'[^']*'|"[^"]*"|\{(?:[^{}]|\{[^{}]*\})*\})*?)(\/)?>/g;
  for (const m of src.matchAll(tag)) {
    const [, closing, name, attrs, selfClose] = m;
    if (closing) { stack.pop(); continue; }
    const classes = (/className=(?:"([^"]*)"|\{([\s\S]*?)\}(?=\s|$))/.exec(attrs) || [])
      .slice(1).filter(Boolean).join(' ');
    const node = { name, classes, line: src.slice(0, m.index).split('\n').length };
    if (/\btruncate\b/.test(classes)) out.push({ ...node, ancestors: [...stack] });
    if (!selfClose) stack.push(node);
  }
  return out;
}

test('the JSX walker actually sees nesting (a test for the test)', () => {
  const found = truncatedElements(
    '<div className="flex min-w-0"><span className="truncate">x</span></div>'
  );
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].ancestors.map((a) => a.classes), ['flex min-w-0']);
});

for (const rel of [
  'modern/agents/AgentList.tsx',
  'modern/agents/AgentDetail.tsx',
  'modern/agents/AgentsOverview.tsx'
]) {
  test(`${rel}: every truncated cell can actually shrink`, () => {
    const src = read(rel);
    const offenders = [];
    for (const el of truncatedElements(src)) {
      // Only a FLEX child is at risk: that is where min-width:auto refuses to
      // shrink below the content. A truncate inside a plain block is bounded by
      // the block already.
      const parent = el.ancestors[el.ancestors.length - 1];
      if (!parent || !/\bflex\b/.test(parent.classes)) continue;
      const ok = /\bmin-w-0\b/.test(el.classes)
        // A fixed max-width bounds the item without needing to shrink.
        || /\bmax-w-\[/.test(el.classes) || /\bw-\d/.test(el.classes);
      if (!ok) offenders.push(`${rel}:${el.line} <${el.name} className="${el.classes}">`);
      // …and the flex row itself must be allowed to shrink inside ITS parent.
      const row = el.ancestors.filter((a) => /\bflex\b/.test(a.classes)).pop();
      if (row && !/\bmin-w-0\b/.test(row.classes) && !/\bflex-wrap\b/.test(row.classes)) {
        offenders.push(`${rel}:${row.line} flex row without min-w-0: "${row.classes}"`);
      }
    }
    assert.deepEqual(offenders, [], 'add min-w-0 — truncate alone does nothing in a flex row');
  });
}

test('a roster ALREADY holding a Windows path still renders a short label', () => {
  // The reported bug came from a machine whose roster.json was written by the
  // broken derivation, so fixing the derivation fixes nobody who already has
  // one. The render side has to be safe on its own.
  const { rowSubtitle } = load('src/renderer/src/modern/agents/agentsModel.ts');
  const row = rowSubtitle({ status: 'idle', project: WIN, sleeping: true });
  assert.ok(row.startsWith('worker-md91-toby'), `got ${row}`);
  assert.equal(rowSubtitle({ status: 'idle', project: 'hive', sleeping: true }), 'hive');
  // A live agent's action still wins — this must not have eaten MD-114's rule.
  assert.equal(rowSubtitle({ status: 'working', action: 'edit App.tsx', ptyId: 'p' }), 'edit App.tsx');
  assert.ok(rowSubtitle({ status: 'working', action: 'edit App.tsx', project: WIN }).startsWith('worker-md91-toby'));
});

test('a raw cwd is never rendered without a basename-first label', () => {
  // The restorable list is where a worktree path is longest, and it is the one
  // place the raw value used to reach the DOM.
  const view = read('modern/agents/AgentsOverview.tsx');
  assert.match(view, /pathLabel\(a\.cwd \|\| a\.project\)/);
  assert.match(view, /title=\{a\.cwd \|\| a\.project\}/, 'the full path belongs in the title');
});

test('every Agents ScrollArea overrides Radix\'s shrink-to-fit content box', () => {
  // The subtlest half of MD-125, and the one that makes every `truncate` in
  // this area a no-op when it is missing. Radix's viewport child is
  // `display: table; min-width: 100%` so that content CAN be wider than the
  // viewport — which is the opposite of what a roster row wants: the table
  // grows to the longest id, `w-full` then measures against the table, and
  // nothing is ever asked to shrink. Both of this area's scroll areas must opt
  // out; if one is added later without this, its rows will clip instead of
  // ellipsize and the reason will not be visible in the row's own classes.
  const OVERRIDE = /\[&>\[data-slot=scroll-area-viewport\]>div\]:!block/;
  for (const rel of ['modern/agents/AgentList.tsx', 'modern/agents/AgentsOverview.tsx']) {
    const src = read(rel);
    for (const m of src.matchAll(/<ScrollArea className="([^"]*)"/g)) {
      assert.match(m[1], OVERRIDE, `${rel}: <ScrollArea className="${m[1]}"> will shrink-to-fit its content`);
    }
  }
});

test('the floor bubble is bounded — a canvas has no CSS truncation', () => {
  const src = read('scene/office/OfficeFloor.tsx');
  assert.match(src, /clampLabel\(agent\.action \|\| '', 42\)/);
});
