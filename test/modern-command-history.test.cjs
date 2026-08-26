'use strict';

/**
 * MD-150 — modern can read the prompt log it has been writing.
 *
 * The asymmetry was the defect: `historyAdd` fires from the modern terminal on
 * every submitted prompt, and modern offered no way to list, search, export or
 * clear any of it. A front-end that feeds a forever-log and cannot open it is
 * worse than one that never recorded anything.
 *
 * What is pinned here is the arithmetic the panel does before it draws — above
 * all that a scoped view CANNOT show another agent's prompts — and the shape
 * rule that the three ways to lose or leak the log are all armed.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const {
  HISTORY_LIMIT, readLimit, scopeRows, firstLine, when, emptyCopy, clearCopy, exportJson
} = loadTs('src/renderer/src/modern/agents/historyModel.ts');

const row = (id, agentId, text, ts) => ({ id, agentId, ts: ts ?? 1, text });

/* ── scope: the one thing this panel must never get wrong ───────────────── */

test('a scoped view never shows another agent\'s prompts', () => {
  // historySearch has NO agent filter — it searches the whole floor — so the
  // scope is applied here or not at all.
  const mixed = [row(1, 'pam', 'mine'), row(2, 'toby', 'theirs'), row(3, 'pam', 'mine too')];
  assert.deepEqual(scopeRows(mixed, 'pam').map((r) => r.id), [1, 3]);
  // No scope means the floor, not an empty list.
  assert.equal(scopeRows(mixed, undefined).length, 3);
  assert.deepEqual(scopeRows(undefined, 'pam'), []);
});

test('a scoped SEARCH over-fetches, so a match is not crowded out by the floor', () => {
  // The trap: ask for 100 floor-wide matches, filter to one agent, get nothing —
  // while the prompt the user is looking for sits at position 140. A search box
  // saying "no prompt matches that" about a prompt that exists is the failure.
  assert.equal(readLimit(true, true), HISTORY_LIMIT * 5);
  // An unscoped search needs no help: the database already returned the page.
  assert.equal(readLimit(false, true), HISTORY_LIMIT);
  // Listing is filtered by the query itself — historyList takes the agentId.
  assert.equal(readLimit(true, false), HISTORY_LIMIT);
  assert.equal(readLimit(false, false), HISTORY_LIMIT);
});

/* ── rows: what a collapsed prompt says ─────────────────────────────────── */

test('the collapsed row shows the first line that has something on it', () => {
  assert.equal(firstLine('\n\n  fix the build\nand also this'), 'fix the build');
  // An all-whitespace prompt still gets a label, or its row is unclickable.
  assert.equal(firstLine('   \n  '), '(blank)');
  assert.equal(firstLine(''), '(blank)');
});

test('"now" is a parameter, so every row in one render agrees on it', () => {
  const t = 1_700_000_000_000;
  assert.equal(when(t, t + 20_000), 'just now');
  assert.equal(when(t, t + 12 * 60_000), '12m ago');
  assert.equal(when(t, t + 3 * 3_600_000), '3h ago');
  // Past a day it becomes a date rather than "48h ago".
  assert.match(when(t, t + 3 * 86_400_000), /\d/);
  assert.doesNotMatch(when(t, t + 3 * 86_400_000), /ago/);
});

/* ── empty state: three situations, three sentences ─────────────────────── */

test('an empty list says which of the three empties it is', () => {
  // "No prompts recorded yet" under an active search is a lie about the database.
  assert.equal(emptyCopy('deploy', true, 'Pam'), 'No prompt matches that.');
  assert.equal(emptyCopy('', true, 'Pam'), 'No prompts recorded for Pam yet.');
  assert.equal(emptyCopy('', false, 'Pam'), 'No prompts recorded yet.');
  // Whitespace is not a search.
  assert.equal(emptyCopy('   ', false), 'No prompts recorded yet.');
});

test('clear names what it destroys, and the scoped and floor cases differ', () => {
  const one = clearCopy(true, 'Pam');
  const all = clearCopy(false);
  assert.match(one.label, /Pam/);
  assert.match(one.consequence, /Pam/);
  assert.match(all.consequence, /any agent/);
  // Neither may say "confirm" — the armed label has to say what happens.
  for (const c of [one, all]) assert.doesNotMatch(c.confirm, /^confirm/i);
  // No undo anywhere: this is the one that must be said out loud.
  for (const c of [one, all]) assert.match(c.consequence, /no undo/i);
});

test('export is stable JSON with a trailing newline', () => {
  const out = exportJson([row(1, 'pam', 'hi', 5)]);
  assert.equal(out.endsWith('\n'), true, 'so a pasted file diffs cleanly');
  assert.deepEqual(JSON.parse(out), [{ id: 1, agentId: 'pam', ts: 5, text: 'hi' }]);
  assert.equal(exportJson([]), '[]\n');
});

/* ── shape: reachable, and nothing that loses the log is a bare button ───── */

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const SHEET = read('src/renderer/src/modern/agents/HistorySheet.tsx');
const DETAIL = read('src/renderer/src/modern/agents/AgentDetail.tsx');

test('all five operations are reachable from modern', () => {
  for (const call of ['historyList', 'historySearch', 'historyExport', 'historyDelete', 'historyClear']) {
    assert.match(SHEET, new RegExp(`window\\.cth\\.${call}\\(`), `${call} is wired`);
  }
  // The write side stays where it was — this card added a reader, not a second
  // writer. Guard on the CALL, not the bare name: the file's own header
  // explains where historyAdd fires, and a name-guard would forbid the comment
  // that keeps the reader honest (MD-141's lesson).
  assert.doesNotMatch(SHEET, /window\.cth\.historyAdd/);
  assert.match(DETAIL, /window\.cth\.historyAdd\(/);
});

test('the reader is mounted where the writing happens', () => {
  assert.match(DETAIL, /<HistorySheet\b/);
  assert.match(DETAIL, /<History \/>/, 'a header action opens it');
  // Opened from an agent ⇒ scoped to that agent.
  assert.match(DETAIL, /agentId=\{agent\.id\}/);
});

test('every way to lose or leak the log is armed, and none is a bare button', () => {
  // Three DestructiveButtons: delete one, export, clear.
  const armed = SHEET.match(/<DestructiveButton\b/g) ?? [];
  assert.equal(armed.length, 3, 'delete, export and clear are all armed');
  // Export destroys nothing but copies every prompt onto the system clipboard,
  // where the next paste takes all of it — so it arms too.
  assert.match(SHEET, /label="Export JSON"[\s\S]{0,200}consequence=/);
  // Each armed control must say what is about to happen.
  const consequences = SHEET.match(/consequence=/g) ?? [];
  assert.equal(consequences.length, 3, 'an armed prompt with no consequence is an empty dialog');
});

test('modern arms through the SAME machine as the pixel UI, not a second policy', () => {
  const BTN = read('src/renderer/src/modern/components/DestructiveButton.tsx');
  assert.match(BTN, /from '@\/components\/ui\/useDestructive'/);
  // The headless hook exists precisely so a non-pixel front-end does not pull
  // PixelButton into its chunk — so guard the IMPORT, not the word, which this
  // file's own header has to be free to explain.
  assert.doesNotMatch(BTN, /import[^\n]*PixelButton/);
  assert.doesNotMatch(BTN, /<PixelButton/);
  assert.match(BTN, /phase === 'armed'/);
  assert.match(BTN, /phase === 'pending'/);
});
