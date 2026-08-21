'use strict';

/**
 * Acting on a task card.
 *
 * The pure half of store/taskActions.ts: the humanQA transforms, the message
 * bodies, and the multi-select click semantics. The async wrappers are three
 * lines of IPC each and are not worth a fake `window.cth`; everything that can
 * actually be wrong in them — WHICH entry gets answered, WHO gets told, what a
 * shift-click selects — is decided by the functions tested here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  MICHAEL_DECIDES, EMPTY_SELECTION,
  withAnswer, withDismissal,
  answerMessage, assignMessage, assignNoticeMessage, decideMessage, nudgeMessage,
  nextSelection, pruneSelection
} = loadTs('src/renderer/src/store/taskActions.ts');

const task = (over = {}) => ({
  id: 'MD-1', title: 'Do the thing', status: 'blocked', dependsOn: [], priority: 3,
  createdAt: '2026-08-21T00:00:00Z', ...over
});

test('answering marks the OPEN entry and leaves the history alone', () => {
  const open = { q: 'which one?', askedAt: 'a' };
  const t = task({ humanQA: [{ q: 'earlier?', a: 'yes' }, open] });
  const qa = withAnswer(t, open, 'the left one', 'NOW');

  assert.equal(qa[1].a, 'the left one');
  assert.equal(qa[1].answeredAt, 'NOW');
  assert.equal(qa[1].askedAt, 'a', 'the ask itself is not rewritten');
  assert.deepEqual(qa[0], { q: 'earlier?', a: 'yes' }, 'answered history is untouched');
});

test('answering matches by TEXT when the object identity is stale', () => {
  // The board re-parses tasks.json every 5s, so the entry a component is holding
  // is routinely not the object inside the freshly parsed task.
  const t = task({ humanQA: [{ q: 'which one?' }] });
  const staleButEqual = { q: 'which one?' };
  const qa = withAnswer(t, staleButEqual, 'the left one', 'NOW');
  assert.equal(qa[0].a, 'the left one');
});

test('an already-answered entry with the same question is not overwritten', () => {
  // The god can ask the same thing twice; answering the second must not rewrite
  // the first, or the decision history stops being a history.
  const t = task({ humanQA: [{ q: 'ship it?', a: 'not yet' }, { q: 'ship it?' }] });
  const qa = withAnswer(t, { q: 'ship it?' }, 'yes now', 'NOW');
  assert.equal(qa[0].a, 'not yet');
  assert.equal(qa[1].a, 'yes now');
});

test('dismissing marks, never deletes — and fabricates no answer', () => {
  const open = { q: 'which one?' };
  const t = task({ humanQA: [open] });
  const qa = withDismissal(t, open, 'NOW');
  assert.equal(qa.length, 1, 'the question stays on the card');
  assert.equal(qa[0].dismissedAt, 'NOW');
  assert.equal(qa[0].a, undefined, 'a dismissal is not an answer');
});

test('a card with no humanQA survives both transforms', () => {
  assert.deepEqual(withAnswer(task(), { q: 'x' }, 'y', 'NOW'), []);
  assert.deepEqual(withDismissal(task(), { q: 'x' }, 'NOW'), []);
});

test('every message names the card id, so a reply can be traced back', () => {
  const t = task();
  for (const m of [
    answerMessage(t, 'which one?', 'the left'),
    assignMessage([t], 'Jim'),
    assignNoticeMessage([t], 'Jim'),
    decideMessage([t]),
    nudgeMessage(t)
  ]) {
    assert.ok(m.body.includes('MD-1'), `${m.subject} lost the id`);
    assert.ok(m.subject.length > 0);
  }
});

test('the god is told the HUMAN assigned it, not to re-assign', () => {
  const notice = assignNoticeMessage([task()], 'Jim');
  assert.equal(notice.to, 'god');
  assert.match(notice.body, /do not re-assign/i);
  // And the agent's own copy says where it came from, since it did not arrive
  // through the god's usual dispatch.
  assert.match(assignMessage([task()], 'Jim').body, /human assigned/i);
});

test('"Michael decides" asks the god to choose and claims no assignee', () => {
  assert.equal(MICHAEL_DECIDES, '');
  const m = decideMessage([task(), task({ id: 'MD-2', title: 'Other' })]);
  assert.equal(m.to, 'god');
  assert.equal(m.act, 'request');
  assert.match(m.body, /deliberately did not choose/i);
  assert.ok(m.body.includes('MD-1') && m.body.includes('MD-2'));
});

test('a plain click toggles and sets the anchor', () => {
  const ordered = ['a', 'b', 'c'];
  const one = nextSelection(EMPTY_SELECTION, 'b', false, ordered);
  assert.deepEqual(one, { ids: ['b'], anchor: 'b' });

  const off = nextSelection(one, 'b', false, ordered);
  assert.deepEqual(off, { ids: [], anchor: null }, 'deselecting drops the anchor with it');
});

test('shift-click takes the run in SCREEN order, in either direction', () => {
  const ordered = ['a', 'b', 'c', 'd'];
  const anchored = nextSelection(EMPTY_SELECTION, 'c', false, ordered);

  assert.deepEqual(nextSelection(anchored, 'a', true, ordered).ids, ['c', 'a', 'b'],
    'backwards from the anchor still covers a..c');
  assert.deepEqual(nextSelection(anchored, 'd', true, ordered).ids, ['c', 'd']);

  // The run unions with what was already picked rather than replacing it.
  const plus = nextSelection({ ids: ['z', 'c'], anchor: 'c' }, 'd', true, ordered);
  assert.ok(plus.ids.includes('z'));
  assert.deepEqual([...new Set(plus.ids)], plus.ids, 'no duplicates');
});

test('shift-click with no usable anchor degrades to a plain toggle', () => {
  const ordered = ['a', 'b'];
  assert.deepEqual(nextSelection(EMPTY_SELECTION, 'b', true, ordered), { ids: ['b'], anchor: 'b' });
  // Anchor filtered off the board since the last click.
  assert.deepEqual(nextSelection({ ids: [], anchor: 'gone' }, 'a', true, ordered), { ids: ['a'], anchor: 'a' });
});

test('the selection is pruned to what is still on the board', () => {
  const sel = { ids: ['a', 'b', 'c'], anchor: 'c' };
  const pruned = pruneSelection(sel, ['a', 'c']);
  assert.deepEqual(pruned.ids, ['a', 'c']);
  assert.equal(pruned.anchor, 'c');

  assert.equal(pruneSelection(sel, ['a', 'b', 'c']), sel,
    'unchanged selections return the SAME object — a new one every 5s poll would re-render the board');
  assert.equal(pruneSelection(sel, ['a', 'b']).anchor, null, 'an anchor that left the board is dropped');
});
