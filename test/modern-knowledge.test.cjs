'use strict';

/**
 * MD-157 — modern can finally SEE the documents it ingests.
 *
 * Six knowledge channels have existed since the graph shipped
 * (`kg:status/list/search/get/remove/addFiles`) and modern wired exactly two of
 * them: Settings › Memory & Knowledge calls `kgAddFiles()` and `kgStatus()`. So
 * from this UI a document went in and could never be listed, searched, read or
 * removed — including one added by mistake. A one-way door is the defect here,
 * not the missing tab (MD-147 card B, S1: data goes in and cannot come out).
 *
 * What is pinned:
 *  - all four missing operations are actually CALLED from modern;
 *  - remove goes through the shared arm→confirm machine and says what is lost —
 *    it deletes extracted text off disk;
 *  - the empty states do not lie about WHY they are empty;
 *  - a removed document also leaves the search hits, which are not refetched;
 *  - the deep link that Settings now uses opens the right tab.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const {
  SEARCH_DEBOUNCE_MS, SEARCH_LIMIT, addedCopy, corpusLine, docLine, emptyCopy,
  hitKey, isSearching, pruneRemoved, removeCopy
} = loadTs('src/renderer/src/modern/memory/knowledgeModel.ts');
const { MEMORY_TABS, memoryTabFor } = loadTs('src/renderer/src/modern/memory/memoryModel.ts');

const doc = (over = {}) => ({
  id: 'd1',
  title: 'Handbook',
  source: '/docs/handbook.pdf',
  modality: 'text',
  mime: 'application/pdf',
  origExt: 'pdf',
  bytes: 2048,
  tags: [],
  caption: null,
  chunkCount: 3,
  addedAt: '2026-08-26T12:00:00.000Z',
  extractor: 'pdf',
  truncated: false,
  ...over
});

const hit = (docId, chunkIdx) => ({
  docId, chunkIdx, title: 'Handbook', source: '/docs/handbook.pdf',
  modality: 'text', score: 0.5, snippet: '…'
});

/* ── searching vs listing: two different questions ──────────────────────── */

test('an empty query LISTS the corpus, it does not search for nothing', () => {
  // `kgSearch('')` would rank every chunk in the graph against an empty term.
  assert.equal(isSearching(''), false);
  assert.equal(isSearching('   '), false, 'whitespace is not a search');
  assert.equal(isSearching(' pdf '), true);
});

test('a document can be hit more than once, so the doc id alone is not a key', () => {
  assert.notEqual(hitKey(hit('d1', 0)), hitKey(hit('d1', 4)));
  assert.equal(hitKey(hit('d1', 4)), 'd1:4');
});

test('search reads chunks on a debounce, not per keystroke', () => {
  assert.ok(SEARCH_DEBOUNCE_MS >= 100, `debounce is ${SEARCH_DEBOUNCE_MS}ms`);
  assert.ok(SEARCH_LIMIT > 0);
});

/* ── the empty states: three situations, three sentences ────────────────── */

test('an empty result says which of the empties it is', () => {
  // "Nothing ingested yet" under an active search is a lie about the corpus.
  assert.match(emptyCopy('budget', 12), /matches/i);
  assert.doesNotMatch(emptyCopy('budget', 12), /Add documents/);
  // Searching an empty corpus is not a bad query — there is nothing to find.
  assert.match(emptyCopy('budget', 0), /Nothing is in the graph yet/);
  // No query, no documents: say how documents get in.
  assert.match(emptyCopy('', 0), /Add documents/);
});

/* ── the corpus line: "off" is a setting, not a failure ─────────────────── */

test('the corpus line keeps counts and the off-switch apart', () => {
  const on = corpusLine({ enabled: true, root: '/kg', docCount: 1, chunkCount: 9, byModality: { text: 1 } });
  assert.match(on.text, /1 document · 9 chunks/);
  assert.deepEqual(on.modalities, ['text 1']);
  assert.equal(on.warning, undefined);

  // Disabled still shows the corpus: the documents are there, agents just
  // cannot read them — replacing the counts would read as "they are gone".
  const off = corpusLine({ enabled: false, root: '/kg', docCount: 4, chunkCount: 40, byModality: {} });
  assert.match(off.text, /4 documents/);
  assert.match(off.warning, /agents cannot read/i);
});

test('an unreadable corpus says so instead of showing a permanent zero', () => {
  // The Settings row swallows this failure and renders "0 documents" forever.
  const bad = corpusLine(null, 'EACCES: permission denied');
  assert.match(bad.text, /unreadable/i);
  assert.match(bad.warning, /EACCES/);
  assert.match(corpusLine(null).text, /Reading the corpus/);
});

test('a document line leads with age and size, and drops empty tags', () => {
  const now = Date.parse('2026-08-26T15:00:00.000Z');
  const line = docLine(doc(), now);
  assert.match(line, /3h ago/);
  assert.match(line, /2\.0 KB/);
  assert.match(line, /3 chunks/);
  assert.doesNotMatch(line, /· $/);
  assert.match(docLine(doc({ tags: ['hr', 'policy'] }), now), /hr, policy/);
  assert.match(docLine(doc({ chunkCount: 1 }), now), /1 chunk(?!s)/);
});

/* ── remove: the operation that deletes files off disk ──────────────────── */

test('the armed prompt names the document, the cost and the file it leaves alone', () => {
  const copy = removeCopy(doc({ title: 'Handbook', chunkCount: 3 }));
  assert.match(copy.confirm, /Handbook/);
  // "Confirm" tells the reader nothing about what is about to happen.
  assert.doesNotMatch(copy.confirm, /^confirm/i);
  assert.match(copy.consequence, /3 chunks/);
  assert.match(copy.consequence, /no undo/i);
  // The ORIGINAL file survives — a prompt that implies otherwise stops someone
  // from removing a document they meant to remove.
  assert.match(copy.consequence, /\/docs\/handbook\.pdf/);
  assert.match(copy.consequence, /left alone/i);
});

test('a removed document also leaves the search hits, which are not refetched', () => {
  const state = {
    docs: [doc({ id: 'a' }), doc({ id: 'b' })],
    hits: [hit('a', 0), hit('b', 1), hit('a', 3)]
  };
  const next = pruneRemoved(state, 'a');
  assert.deepEqual(next.docs.map((d) => d.id), ['b']);
  assert.deepEqual(next.hits.map((h) => h.docId), ['b']);
  // null means "not loaded" and must stay null — an empty array would render
  // "nothing matches" over a search that was never run.
  assert.deepEqual(pruneRemoved({ docs: null, hits: null }, 'a'), { docs: null, hits: null });
});

/* ── add: a cancelled picker is not an error ────────────────────────────── */

test('cancelling the file picker leaves no message behind', () => {
  assert.equal(addedCopy({ ok: false, error: 'cancelled' }), '');
  assert.match(addedCopy({ ok: false, error: 'disk full' }), /disk full/);
  assert.match(addedCopy({ ok: true, results: [{ ok: true }, { ok: true }] }), /Added 2 documents\./);
  assert.match(addedCopy({ ok: true, results: [{ ok: true }, { ok: false }] }), /Added 1 document, 1 failed\./);
});

/* ── the deep link Settings now uses ────────────────────────────────────── */

test('a section deep link opens the tab it names, and a stale one changes nothing', () => {
  assert.ok(MEMORY_TABS.includes('knowledge'));
  assert.equal(memoryTabFor('knowledge', 'files'), 'knowledge');
  assert.equal(memoryTabFor('graph', 'files'), 'graph');
  // A caller that has drifted must not bounce the user to a tab nobody asked for.
  assert.equal(memoryTabFor('documents', 'search'), 'search');
  assert.equal(memoryTabFor(undefined, 'search'), 'search');
});

/* ── shape: reachable, mounted, and armed ───────────────────────────────── */

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const SECTION = read('src/renderer/src/modern/memory/KnowledgeSection.tsx');
const VIEW = read('src/renderer/src/modern/memory/MemoryView.tsx');
const SETTINGS = read('src/renderer/src/modern/settings/MemorySection.tsx');

test('all four missing operations are reachable from modern', () => {
  for (const call of ['kgList', 'kgSearch', 'kgGet', 'kgRemove']) {
    assert.match(SECTION, new RegExp(`window\\.cth\\.${call}\\(`), `${call} is wired`);
  }
  // The two modern already had stay wired here too, or the section is a reader
  // with no way to fill the thing it reads.
  assert.match(SECTION, /window\.cth\.kgStatus\(/);
  assert.match(SECTION, /window\.cth\.kgAddFiles\(/);
});

test('the section is mounted in Memory as its own tab', () => {
  assert.match(VIEW, /<KnowledgeSection\s*\/>/);
  assert.match(VIEW, /<TabsTrigger value="knowledge">Knowledge<\/TabsTrigger>/);
  assert.match(VIEW, /<TabsContent value="knowledge"/);
  // Settings keeps the add button and now points at the rest of the operations.
  assert.match(SETTINGS, /navigate\('memory', \{ section: 'knowledge' \}\)/);
});

test('remove is armed, never a bare button, and says what it costs', () => {
  assert.match(SECTION, /import \{ DestructiveButton \}/);
  // Both places a document can be removed from: the row and the open document.
  const armed = SECTION.match(/<DestructiveButton\b/g) ?? [];
  assert.equal(armed.length, 2, 'the list row and the open document');
  const consequences = SECTION.match(/consequence=/g) ?? [];
  assert.equal(consequences.length, 2, 'an armed prompt with no consequence is an empty dialog');
  // Nothing may call kgRemove from a plain onClick.
  assert.doesNotMatch(SECTION, /onClick=\{\(\) => void window\.cth\.kgRemove/);
});

test('modern arms through the SAME machine as the pixel UI, not a second policy', () => {
  const BTN = read('src/renderer/src/modern/components/DestructiveButton.tsx');
  assert.match(BTN, /from '@\/components\/ui\/useDestructive'/);
  assert.match(BTN, /phase === 'armed'/);
});

test('the icon-only controls carry their name', () => {
  // DESIGN-MODERN.md: an icon-only button ships with a tooltip + accessible
  // name, which `IconButton` makes one required prop (MD-100).
  assert.match(SECTION, /import \{ IconButton \}/);
  const icons = SECTION.match(/<IconButton\b[^>]*/g) ?? [];
  assert.ok(icons.length >= 2, `found ${icons.length}`);
  for (const tag of icons) assert.match(tag, /label="/, tag);
});
