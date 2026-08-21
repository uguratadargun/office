'use strict';

/**
 * The task ledger reader.
 *
 * The Tasks UI parsed a schema the harness does not write. Checked against the
 * live ledger (42 cards): `description` present on 0, `dependsOn` on 0 — while
 * `note` was on 38, `deps` on 38 and `result` on all 42. So every card's detail
 * view rendered "(no description on this card)", the DEPENDS ON block never drew
 * a row, and the outcome of every finished task was written and never shown.
 *
 * The ledger is shared with the harness and stays read-only; the fix is in the
 * READER, and it accepts BOTH spellings so neither side can break the other.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { parseTasks, openQuestion, waitsOnHuman } = loadTs('src/renderer/src/store/taskLedger.ts');

const wrap = (...tasks) => ({ tasks });

test('the contract is read from `note` when there is no `description`', () => {
  const [t] = parseTasks(wrap({ id: 'a', title: 'T', note: 'the 4-part contract' }));
  assert.equal(t.description, 'the 4-part contract');
});

test('an explicit `description` still wins over `note`', () => {
  const [t] = parseTasks(wrap({ id: 'a', title: 'T', description: 'explicit', note: 'fallback' }));
  assert.equal(t.description, 'explicit');
});

test('dependencies are read from `deps` as well as `dependsOn`', () => {
  assert.deepEqual(parseTasks(wrap({ id: 'a', title: 'T', deps: ['x', 'y'] }))[0].dependsOn, ['x', 'y']);
  assert.deepEqual(parseTasks(wrap({ id: 'a', title: 'T', dependsOn: ['z'] }))[0].dependsOn, ['z']);
  assert.deepEqual(parseTasks(wrap({ id: 'a', title: 'T' }))[0].dependsOn, []);
  // Junk members are dropped rather than crashing the overlay.
  assert.deepEqual(parseTasks(wrap({ id: 'a', title: 'T', deps: ['ok', 3, null] }))[0].dependsOn, ['ok']);
});

test('result, origin and closedAt survive the parse', () => {
  const [t] = parseTasks(wrap({
    id: 'a', title: 'T', result: 'shipped it', origin: 'slack #eng', closedAt: '2026-08-21T10:00:00Z'
  }));
  assert.equal(t.result, 'shipped it');
  assert.equal(t.origin, 'slack #eng');
  assert.equal(t.closedAt, '2026-08-21T10:00:00Z');
});

test('closedAt falls back to doneAt — both spellings are in the live ledger', () => {
  const [t] = parseTasks(wrap({ id: 'a', title: 'T', doneAt: '2026-08-21T11:00:00Z' }));
  assert.equal(t.closedAt, '2026-08-21T11:00:00Z');
});

test('blank and non-string fields read as absent, not as empty content', () => {
  // A present-but-blank field must not make the overlay render an empty RESULT
  // heading over nothing.
  const [t] = parseTasks(wrap({ id: 'a', title: 'T', result: '   ', origin: null, note: '', description: 42 }));
  assert.equal(t.result, undefined);
  assert.equal(t.origin, undefined);
  assert.equal(t.description, undefined);
});

test('a card with none of the new fields still parses', () => {
  const [t] = parseTasks(wrap({ id: 'a', title: 'T' }));
  assert.equal(t.result, undefined);
  assert.equal(t.status, 'todo');
  assert.deepEqual(t.dependsOn, []);
});

test('the open-question helpers are unchanged by this', () => {
  const asked = { id: 'a', title: 'T', status: 'blocked', humanQA: [{ q: 'which one?' }] };
  assert.equal(openQuestion(parseTasks(wrap(asked))[0]).q, 'which one?');
  assert.equal(waitsOnHuman(parseTasks(wrap(asked))[0]), true);

  // Answered and dismissed both count as resolved.
  const answered = { ...asked, humanQA: [{ q: 'which one?', a: 'the left' }] };
  assert.equal(waitsOnHuman(parseTasks(wrap(answered))[0]), false);
  const dismissed = { ...asked, humanQA: [{ q: 'which one?', dismissedAt: 'now' }] };
  assert.equal(waitsOnHuman(parseTasks(wrap(dismissed))[0]), false);

  // Not blocked = not waiting on the human, whatever the trail says.
  assert.equal(waitsOnHuman(parseTasks(wrap({ ...asked, status: 'doing' }))[0]), false);
});
