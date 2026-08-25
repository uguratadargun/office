'use strict';

/**
 * The modern IDE's editor state has to survive a navigation, and a failed save
 * has to leave the edits reachable. Both were S1s in MD-94.
 *
 * 1. `AppShell` keys its `ViewBoundary` on the nav id, so leaving the IDE
 *    UNMOUNTS the view. While tabs and buffers lived in `useState`, clicking
 *    Agents and coming back discarded every open tab and every unsaved edit,
 *    silently. `ideStore` moves them outside React, so the round trip is a
 *    no-op — which is exactly what "unmount, then read the snapshot again"
 *    asserts here.
 *
 * 2. `settleSave` used to mark the buffer saved from `e[key].content`, so
 *    keystrokes typed WHILE the write was in flight were recorded as written
 *    and never sent; and a failed write flipped the buffer to `status: error`,
 *    which replaced the editor with the error text and dropped the dirty dot.
 *    Both lose work that only exists in that buffer.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const loadTs = require('./load-ts.cjs');
const store = loadTs('src/renderer/src/modern/ide/ideStore.ts');

const ROOT_A = '/tmp/repo-a';
const ROOT_B = '/tmp/repo-b';
const ready = (content, original) => ({ content, original, status: 'ready' });

function openDirtyTab(root, rel, typed) {
  const key = store.tabKey('edit', rel);
  store.update(root, (s) => ({
    ...s,
    tabs: [...s.tabs, { key, rel, mode: 'edit' }],
    activeKey: key,
    edits: { ...s.edits, [key]: ready(typed, 'on disk') }
  }));
  return key;
}

test.beforeEach(() => { store.__resetIdeStore(); });

test('tabs and unsaved edits survive leaving the view and coming back', () => {
  const key = openDirtyTab(ROOT_A, 'src/math.ts', 'typed but not saved');

  // The navigation. Nothing to tear down — that is the point: the component
  // unmounting takes no state with it.
  const afterNav = store.getSession(ROOT_A);

  assert.equal(afterNav.tabs.length, 1, 'the tab is still open');
  assert.equal(afterNav.activeKey, key, 'and still the active one');
  assert.equal(afterNav.edits[key].content, 'typed but not saved', 'the edit is intact');
  assert.equal(store.isDirty(afterNav.edits[key]), true, 'and still marked dirty');
});

test('each workspace keeps its own buffers across a switch and back', () => {
  const a = openDirtyTab(ROOT_A, 'a.ts', 'A edit');
  const b = openDirtyTab(ROOT_B, 'b.ts', 'B edit');

  assert.equal(store.getSession(ROOT_A).edits[a].content, 'A edit');
  assert.equal(store.getSession(ROOT_B).edits[b].content, 'B edit');
  assert.equal(store.getSession(ROOT_A).tabs.length, 1, 'A did not inherit B’s tabs');
});

test('an unknown root reads the shared empty session, by identity', () => {
  assert.equal(store.getSession('/nope'), store.EMPTY_SESSION);
  assert.equal(store.getSession(null), store.EMPTY_SESSION);
});

test('every commit notifies; other roots drop the render themselves', () => {
  openDirtyTab(ROOT_A, 'a.ts', 'A edit');
  let fired = 0;
  const seenByB = [];
  store.subscribe(() => {
    fired += 1;
    seenByB.push(store.getSession(ROOT_B)); // what a B-mounted hook would re-read
  });

  store.update(ROOT_A, (s) => ({ ...s, rail: 'search' }));

  assert.equal(fired, 1, 'the subscriber ran');
  // Object.is on the snapshot is what makes an unconditional notify safe — the
  // lesson from MD-84e's theme store.
  assert.equal(seenByB[0], store.EMPTY_SESSION, 'B’s snapshot is unchanged, so React skips it');
});

test('a session with unsaved work is never evicted, however old', () => {
  openDirtyTab('/tmp/dirty', 'keep.ts', 'precious');
  // Push well past MAX_SESSIONS with clean sessions, all touched later.
  for (let i = 0; i < 20; i += 1) {
    store.update(`/tmp/clean-${i}`, (s) => ({ ...s, rail: 'changes' }));
  }
  assert.equal(
    store.getSession('/tmp/dirty').edits[store.tabKey('edit', 'keep.ts')].content,
    'precious',
    'the dirty session is still there'
  );
});

test('a failed save keeps the buffer editable, dirty, and carrying the message', () => {
  const buf = ready('my edits', 'on disk');
  const after = store.settleSave(buf, 'my edits', { ok: false, error: 'EACCES: permission denied' });

  assert.equal(after.status, 'ready', 'the editor is NOT replaced by the error');
  assert.equal(after.content, 'my edits', 'the edits are still in the buffer');
  assert.equal(store.isDirty(after), true, 'and still dirty, so the close guard still fires');
  assert.match(after.saveError, /EACCES/);
  assert.equal(after.saving, false);
});

test('a save settles against what was WRITTEN, not what is typed meanwhile', () => {
  const sent = 'first draft';
  // The write is in flight; the user keeps typing.
  const buf = ready('first draft plus more', 'on disk');
  const after = store.settleSave(buf, sent, { ok: true });

  assert.equal(after.original, sent, 'only the written text counts as on disk');
  assert.equal(
    store.isDirty(after), true,
    'the keystrokes typed mid-write are still unsaved, not silently marked saved'
  );
  assert.equal(after.saveError, undefined);
});

test('a clean save clears a previous save error', () => {
  const failed = store.settleSave(ready('x', 'y'), 'x', { ok: false, error: 'EACCES' });
  const ok = store.settleSave(failed, 'x', { ok: true });
  assert.equal(ok.saveError, undefined);
  assert.equal(store.isDirty(ok), false);
});

test('a revdiff tab key is pinned to both revisions', () => {
  const k1 = store.tabKey('revdiff', 'src/a.ts', 'abc^', 'abc');
  const k2 = store.tabKey('revdiff', 'src/a.ts', 'def^', 'def');
  assert.notEqual(k1, k2, 'two commits touching one file are two tabs, not one');
  assert.notEqual(k1, store.tabKey('edit', 'src/a.ts'), 'and neither collides with the editor tab');
});
