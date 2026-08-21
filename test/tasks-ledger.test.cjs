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

const { parseTasks, openQuestion, waitsOnHuman, toPriority, matchesQuery } = loadTs('src/renderer/src/store/taskLedger.ts');

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

test('priority reads the WORD the god writes, not just the number', () => {
  // The other half of the same schema mismatch: 38 of 42 live cards carry
  // 'high'/'medium'/'low', which parsed as NaN-ish and fell back to 3 — so the
  // priority dots showed an identical, confident 3/5 on the whole board.
  assert.equal(toPriority('high'), 4);
  assert.equal(toPriority('medium'), 3);
  assert.equal(toPriority('low'), 2);
  assert.equal(toPriority('HIGH'), 4, 'case is the ledger author\'s business, not ours');
  assert.equal(toPriority(' low '), 2);

  // The harness still writes numbers; they keep working, clamped to the 5 dots
  // PriorityDots can actually draw.
  assert.equal(toPriority(1), 1);
  assert.equal(toPriority(5), 5);
  assert.equal(toPriority(9), 5);
  assert.equal(toPriority(0), 1);
  assert.equal(toPriority(3.4), 3);

  // Anything unreadable stays on the old middling default rather than throwing:
  // a card with a typo'd priority is still a card.
  assert.equal(toPriority(undefined), 3);
  assert.equal(toPriority(null), 3);
  assert.equal(toPriority('whenever'), 3);
  assert.equal(toPriority(NaN), 3);

  // And it reaches the parsed card, which is the thing the dots read.
  assert.equal(parseTasks(wrap({ id: 'a', title: 'T', priority: 'high' }))[0].priority, 4);
});

test('the board filter matches the title, the shown name, and the raw id', () => {
  const [t] = parseTasks(wrap({ id: 'MD-41', title: 'Tasks tab UX deltas', assignee: 'jim-mt2yvlbg' }));

  // Empty query matches everything — that is what makes it safe to leave up.
  assert.equal(matchesQuery(t, 'Jim', ''), true);
  assert.equal(matchesQuery(t, 'Jim', '   '), true);

  assert.equal(matchesQuery(t, 'Jim', 'ux'), true, 'title, case-insensitively');
  assert.equal(matchesQuery(t, 'Jim', 'JIM'), true, 'the name the board shows');
  assert.equal(matchesQuery(t, 'Jim', 'mt2yvlbg'), true, 'the id the ledger stores');
  assert.equal(matchesQuery(t, 'Jim', ' ux '), true, 'stray spaces are the typist\'s, not a filter');

  assert.equal(matchesQuery(t, 'Jim', 'monitor'), false);
  // An unassigned card must not match every query by accident.
  const [u] = parseTasks(wrap({ id: 'x', title: 'Orphan' }));
  assert.equal(matchesQuery(u, undefined, 'jim'), false);
});
