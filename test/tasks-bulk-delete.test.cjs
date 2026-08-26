'use strict';

/**
 * MD-136 — bulk delete on the modern Tasks board.
 *
 * The human asked to be able to clear a finished column in one go. The risk in
 * granting that is not the deleting; it is deleting MORE than was meant. Three
 * things guard against it and each is tested here:
 *   - select-all takes the cards VISIBLE in its column, so a filtered-away card
 *     can never ride along;
 *   - the dialog states what is about to go, by column, and says out loud when
 *     the selection contains work that is still moving;
 *   - the write is ONE batched ledger call, not N — a loop gives the god N
 *     chances to append a card between a read and a write, and that card is
 *     then lost by the next write in the batch.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-ts.cjs');

const {
  deleteSummary, columnPhrase, toggleColumn, columnSelectState
} = load('src/renderer/src/store/taskBulk.ts');
const { EMPTY_SELECTION, nextSelection } = load('src/renderer/src/store/taskActions.ts');

const card = (id, status, extra = {}) => ({
  id, title: id, status, dependsOn: [], humanQA: [], ...extra
});
const asking = (id, status) => card(id, status, { humanQA: [{ q: 'which way?', askedAt: '2026-08-26T00:00:00Z' }] });

/* ── what the dialog says ──────────────────────────────────────────────── */

test('the summary counts by column, in board order, dropping empty ones', () => {
  const s = deleteSummary([card('d1', 'done'), card('t1', 'todo'), card('d2', 'done')]);
  assert.equal(s.total, 3);
  assert.deepEqual(s.byColumn.map((c) => `${c.count} ${c.label}`), ['1 Todo', '2 Done'],
    'board order, not selection order — the dialog must read like the board looks');
  assert.equal(columnPhrase(s), '1 in Todo and 2 in Done');
});

test('one column reads as one clause, three as a list', () => {
  assert.equal(columnPhrase(deleteSummary([card('a', 'done')])), '1 in Done');
  assert.equal(
    columnPhrase(deleteSummary([card('a', 'todo'), card('b', 'doing'), card('c', 'done')])),
    '1 in Todo, 1 in Doing and 1 in Done'
  );
  assert.equal(columnPhrase(deleteSummary([])), '', 'no cards, no clause — never a dangling "in"');
});

test('a selection of finished work needs no extra warning', () => {
  // The whole point of the feature: clearing Done must not nag.
  const s = deleteSummary([card('a', 'done'), card('b', 'done'), card('c', 'todo')]);
  assert.equal(s.caution, '');
});

test('work an agent is holding is named out loud, not buried in a count', () => {
  const s = deleteSummary([card('a', 'done'), card('b', 'doing'), card('c', 'doing')]);
  assert.equal(s.doing, 2);
  assert.match(s.caution, /2 cards an agent is working on right now/);
  assert.match(s.caution, /^This includes/);
});

test('a question waiting on the human is named too, whatever its column', () => {
  // `openQuestion` is status-blind by design (MD-83) — an ask on a done card is
  // still an ask, and deleting it silently loses a question nobody answered.
  const s = deleteSummary([asking('a', 'done'), card('b', 'done')]);
  assert.equal(s.asking, 1);
  assert.match(s.caution, /1 card with a question waiting on you/);
});

test('an answered or dismissed question is not a caution', () => {
  const answered = card('a', 'done', { humanQA: [{ q: 'which?', a: 'that one', askedAt: 'x' }] });
  const dismissed = card('b', 'done', { humanQA: [{ q: 'which?', askedAt: 'x', dismissedAt: 'y' }] });
  assert.equal(deleteSummary([answered, dismissed]).caution, '');
});

test('both cautions read as one sentence, not two glued together', () => {
  const s = deleteSummary([card('a', 'doing'), asking('b', 'todo')]);
  assert.equal(s.caution,
    'This includes 1 card an agent is working on right now and 1 card with a question waiting on you.');
});

/* ── select all, per column ────────────────────────────────────────────── */

test('select-all takes the whole column and nothing else', () => {
  const sel = toggleColumn(EMPTY_SELECTION, ['d1', 'd2', 'd3']);
  assert.deepEqual(sel.ids, ['d1', 'd2', 'd3']);
  assert.equal(sel.anchor, 'd3', 'the last card is where a following shift-click measures from');
});

test('select-all NEVER reaches a card the filter is hiding', () => {
  // The caller passes the VISIBLE ids; this pins that the function adds nothing
  // of its own, which is the only way the guarantee can hold.
  const visibleInDone = ['d1', 'd3'];
  const sel = toggleColumn(EMPTY_SELECTION, visibleInDone);
  assert.deepEqual(sel.ids, ['d1', 'd3'], 'd2 was filtered away and must not be selected');
});

test('pressing it again clears that column and leaves the others alone', () => {
  const start = { ids: ['t1', 'd1', 'd2'], anchor: 'd2' };
  const off = toggleColumn(start, ['d1', 'd2']);
  assert.deepEqual(off.ids, ['t1'], 'the Todo selection survives clearing Done');
  assert.equal(off.anchor, null, 'an anchor inside the cleared column is no longer a fixed end');
});

test('a partly-selected column selects the REST rather than clearing it', () => {
  // The other reading — "toggle each" — would deselect d1 and select d2, which
  // is never what pressing "select all" on a half-selected column means.
  const sel = toggleColumn({ ids: ['d1'], anchor: 'd1' }, ['d1', 'd2']);
  assert.deepEqual(sel.ids, ['d1', 'd2']);
});

test('select-all does not duplicate ids already selected', () => {
  const sel = toggleColumn({ ids: ['d1'], anchor: 'd1' }, ['d1', 'd2', 'd1']);
  assert.deepEqual(sel.ids, ['d1', 'd2']);
});

test('an empty column is a no-op, not a selection reset', () => {
  const start = { ids: ['t1'], anchor: 't1' };
  assert.equal(toggleColumn(start, []), start);
});

test('the header control reports none / some / all', () => {
  assert.equal(columnSelectState(EMPTY_SELECTION, ['a', 'b']), 'none');
  assert.equal(columnSelectState({ ids: ['a'], anchor: 'a' }, ['a', 'b']), 'some');
  assert.equal(columnSelectState({ ids: ['a', 'b'], anchor: 'b' }, ['a', 'b']), 'all');
  assert.equal(columnSelectState({ ids: ['a'], anchor: 'a' }, []), 'none', 'an empty column is never "all"');
});

test('select-all composes with shift-click rather than fighting it', () => {
  // Select the Done column, then shift-click back up the board: the range must
  // extend from where select-all left the anchor.
  const ordered = ['t1', 't2', 'd1', 'd2'];
  const afterAll = toggleColumn(EMPTY_SELECTION, ['d1', 'd2']);
  const extended = nextSelection(afterAll, 't1', true, ordered);
  assert.deepEqual(extended.ids.sort(), ['d1', 'd2', 't1', 't2']);
});

/* ── the write ─────────────────────────────────────────────────────────── */

const SRC = path.join(__dirname, '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

test('the renderer deletes through ONE batched IPC call, never a loop', () => {
  const hook = read('renderer/src/modern/tasks/useLedger.ts');
  const body = /const removeMany = useCallback\(([\s\S]*?)\n  \}, \[refresh\]\);/.exec(hook);
  assert.ok(body, 'removeMany moved — re-point this test');
  assert.match(body[1], /window\.cth\.hiveDeleteTasks\(ids\)/, 'one call, with every id');
  assert.ok(!/hiveDeleteTask\(/.test(body[1]),
    'a loop over the single-delete IPC re-reads and rewrites the ledger per card — the god can lose a write in the gap');
  assert.ok(!/for \(|\.map\(.*await|forEach/.test(body[1]), 'no per-id iteration over the IPC');
});

test('the batch is one read-modify-write in main, and reports what was missing', () => {
  const hive = read('main/hive.ts');
  const fn = /deleteTasks\(ids: readonly string\[\]\)[\s\S]*?\n  \}/.exec(hive);
  assert.ok(fn, 'hive.deleteTasks moved — re-point this test');
  assert.equal((fn[0].match(/this\.writeTasks\(/g) || []).length, 1, 'exactly one write for the batch');
  assert.match(fn[0], /missing/, 'an id that had already gone is reported, not fatal');
  // The single-card path must not drift into a second implementation.
  assert.match(hive, /deleteTask\(id: string\): boolean \{\s*return this\.deleteTasks\(\[id\]\)/);
});

test('the batch handler refuses anything that is not a list of ids', () => {
  const main = read('main/index.ts');
  const handler = /ipcMain\.handle\('hive:deleteTasks'[\s\S]*?\n\}\);/.exec(main);
  assert.ok(handler, 'the hive:deleteTasks handler moved — re-point this test');
  assert.match(handler[0], /Array\.isArray\(ids\)/);
  assert.match(handler[0], /every\(\(id\) => typeof id === 'string'\)/,
    'one bad element in the array must not reach the ledger');
  assert.match(handler[0], /hive\.enabled\(\)/);
});

/* ── the dialog and the bar, as shapes ─────────────────────────────────── */

test('the dialog names the columns, warns, and says there is no undo', () => {
  const src = read('renderer/src/modern/tasks/DeleteTasksDialog.tsx');
  assert.match(src, /columnPhrase\(summary\)/, 'the counts by column are shown, not just a total');
  assert.match(src, /summary\.caution/, 'the doing / open-question line is rendered');
  assert.match(src, /This cannot be undone/, 'undo is out of scope and the copy must say so');
  assert.match(src, /AlertDialogCancel/, 'the confirm is escapable');
});

test('the selection bar binds Escape and always offers Clear', () => {
  const src = read('renderer/src/modern/components/SelectionBar.tsx');
  assert.match(src, /e\.key === 'Escape'/);
  assert.match(src, /window\.addEventListener\('keydown'/,
    'bound to the window — the hands are on the board, not on the bar');
  assert.match(src, /removeEventListener\('keydown'/, 'and unbound, or every board leaves one behind');
  assert.match(src, /if \(count <= 0\) return null/, 'it costs nothing while nothing is selected');
});

test('the board asks for the visible column ids, not the whole column', () => {
  const view = read('renderer/src/modern/tasks/TasksView.tsx');
  assert.match(view, /const cards = visible\.filter\(\(t\) => t\.status === col\.key\)/);
  assert.match(view, /const colIds = cards\.map\(\(t\) => t\.id\)/,
    'select-all must be fed the FILTERED column');
  assert.match(view, /toggleColumn\(sel, colIds\)/);
});

// ─── one column table, two skins (MD-153) ───────────────────────────────────

const { TASK_COLUMNS, taskColumn } = load('src/renderer/src/store/taskColumns.ts');

test('the shared column table carries order and words, and no styling at all', () => {
  // The reason the model had to be lifted: a class string on every row made the
  // whole module modern-only, so the classic board could not take the column
  // ORDER without pulling Tailwind into a UI that has none.
  assert.deepEqual(TASK_COLUMNS.map((c) => c.key), ['todo', 'doing', 'blocked', 'done']);
  assert.deepEqual(TASK_COLUMNS.map((c) => c.label), ['Todo', 'Doing', 'Blocked', 'Done']);
  for (const c of TASK_COLUMNS) {
    assert.deepEqual(Object.keys(c).sort(), ['key', 'label'], `${c.key}: nothing but identity`);
  }
  // Guard the LITERAL, not the file: the header has to stay free to explain
  // which classes were removed and why (the same trap as MD-141/MD-150).
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src/renderer/src/store/taskColumns.ts'), 'utf8');
  const literal = src.slice(src.indexOf('TASK_COLUMNS'), src.indexOf('];', src.indexOf('TASK_COLUMNS')));
  assert.ok(literal.includes("key: 'done'"), 'found the table, not a comment about it');
  assert.doesNotMatch(literal, /bg-|var\(--cth/, 'no skin leaked into the shared table');
});

test('a card with an unknown status still renders somewhere', () => {
  assert.equal(taskColumn('todo').label, 'Todo');
  assert.equal(taskColumn('nonsense').key, 'todo', 'falls to the first column, never undefined');
});

test('both boards take their order from it, and neither rewrites the words', () => {
  const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
  const PIXEL = read('src/renderer/src/components/TasksKanban.tsx');
  const MODERN = read('src/renderer/src/modern/tasks/status.ts');
  for (const [name, src] of [['pixel', PIXEL], ['modern', MODERN]]) {
    assert.match(src, /TASK_COLUMNS/, `${name}: takes the shared table`);
    // A hand-written column array in either skin is a second place for the
    // order to be wrong.
    assert.doesNotMatch(src, /\{ key: 'todo',/, `${name}: no parallel column array`);
  }
  // Each skin keeps only its own paint, keyed by column key.
  assert.match(PIXEL, /var\(--cth-sky\)/);
  assert.match(MODERN, /bg-muted-foreground/);
  // The classic board SHOUTS its headers, but derives them rather than
  // rewording: 'DONE' on screen, 'Done' in the prose the summary builds.
  assert.match(PIXEL, /toUpperCase\(\)/);
  assert.equal(columnPhrase(deleteSummary([card('a', 'done')])), '1 in Done');
});
