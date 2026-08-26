'use strict';

/**
 * MD-138 — the modern UI had no Memory anywhere.
 *
 * The pixel UI has carried a memory tab and a memory-graph tab since the
 * beginning; `modern/nav.ts` listed ten areas and none of them was memory, so
 * from this UI an agent's `memory.md` — the thing that survives every restart
 * and is the only record of what the floor has learned — was unreachable. The
 * human's report was one sentence: "where do we see memory?"
 *
 * What is pinned here is the part a rewrite would quietly get wrong:
 *
 *  - the nav row exists AND is wired to a real view (a row with no `component`
 *    renders the placeholder card, which is a dead link with better manners);
 *  - the agent picker is NOT the IDE's. `idePickerOptions` drops every agent
 *    with no cwd because a file tree needs a root; memory lives in the hive
 *    folder, so those agents — and archived ones, whose notes are all that is
 *    left of them — must still be pickable;
 *  - the deep link resolves to an agent that is actually on the roster;
 *  - size is measured in UTF-8 BYTES, because the condenser's thresholds are;
 *  - MemPalace's five booleans are read in the right ORDER — "off" for a
 *    machine with no mempalace binary sends the user to the wrong switch.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { NAV, navEntry } = loadTs('src/renderer/src/modern/nav.ts');
const { navigate, navTarget } = loadTs('src/renderer/src/modern/navigation.ts');
const { SETTINGS } = loadTs('src/renderer/src/modern/settings/index.ts');
const {
  memoryPickerOptions,
  anchorAgentId,
  memoryFileMeta,
  palaceLine,
  hitAgentId,
  memoryDir,
  MEMORY_FILE
} = loadTs('src/renderer/src/modern/memory/memoryModel.ts');
const { summarizeReflect, formatBytes } = loadTs('src/shared/reflectSummary.ts');

const SRC = path.join(__dirname, '..', 'src', 'renderer', 'src', 'modern');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/* ── 1. The nav row ─────────────────────────────────────────────────────── */

test('the modern nav has a Memory area', () => {
  const ids = NAV.map((n) => n.id);
  assert.ok(ids.includes('memory'), `nav ids: ${ids.join(', ')}`);
  const entry = navEntry('memory');
  assert.equal(entry.label, 'Memory');
  assert.ok(entry.icon, 'the rail draws an icon per row');
});

test('the Memory row is wired to a view, not left as a placeholder', () => {
  // A NavEntry with no `component` renders the placeholder card — navigable,
  // and still nothing to read. That is the exact shape of the bug MD-138
  // reports, so "the id exists" is not the assertion.
  assert.ok(typeof navEntry('memory').component === 'object' || typeof navEntry('memory').component === 'function');
  assert.match(read('nav.ts'), /import\('\.\/memory\/MemoryView'\)/);
});

/* ── 2. The picker is not the IDE's ─────────────────────────────────────── */

const ROSTER = [
  { id: 'pam', name: 'Pam', cwd: '/Users/u/HarnessAgents/worktrees/pam-mt310mbm', ptyId: 'p1' },
  { id: 'god', name: 'Ugur', cwd: '/Users/u/HarnessAgents', isGod: true, ptyId: 'p0' },
  { id: 'toby', name: 'Toby', cwd: '', ptyId: null },
  { id: 'ryan', name: 'Ryan', cwd: '/Users/u/HarnessAgents/worktrees/ryan', archived: true }
];

test('god sorts first and everyone else keeps roster order', () => {
  assert.deepEqual(memoryPickerOptions(ROSTER).map((o) => o.id), ['god', 'pam', 'toby', 'ryan']);
});

test('an agent with no workspace is still pickable — memory does not live in the workspace', () => {
  const toby = memoryPickerOptions(ROSTER).find((o) => o.id === 'toby');
  assert.ok(toby, 'idePickerOptions would have dropped this one');
  // With no cwd there is no path to show, so the second line falls back to the
  // id — which is also the folder the file is in.
  assert.equal(toby.label, 'toby');
});

test('an archived agent keeps its memory, and says so', () => {
  const ryan = memoryPickerOptions(ROSTER).find((o) => o.id === 'ryan');
  assert.ok(ryan, 'the notes are the only thing left of an archived agent');
  assert.equal(ryan.presence, 'archived');
});

test('the workspace label is basename-first (MD-125) and a live agent wears no badge', () => {
  const pam = memoryPickerOptions(ROSTER).find((o) => o.id === 'pam');
  assert.equal(pam.label, 'pam-mt310mbm — /Users/u/HarnessAgents/worktrees/pam-mt310mbm');
  assert.equal(pam.presence, undefined, 'a badge on every row is a badge nobody reads');
  assert.equal(memoryPickerOptions(ROSTER).find((o) => o.id === 'toby').presence, 'asleep');
});

/* ── 3. The deep link ───────────────────────────────────────────────────── */

test('navigate("memory", { anchor }) carries the agent, and the view resolves it', () => {
  navigate('memory', { anchor: 'pam' });
  assert.equal(navTarget().id, 'memory');
  assert.equal(navTarget().anchor, 'pam');
  assert.equal(anchorAgentId(navTarget().anchor, ROSTER, 'god'), 'pam');
});

test('an anchor naming an agent that has left the floor falls back instead of blanking', () => {
  // Radix renders an EMPTY Select for a value that matches no item, so a stale
  // link would land on a picker showing nothing at all.
  assert.equal(anchorAgentId('kevin', ROSTER, 'god'), 'god');
  assert.equal(anchorAgentId(undefined, ROSTER, 'pam'), 'pam', 'a plain navigate keeps what is on screen');
});

test('the agent card links to memory with the agent as the anchor', () => {
  const detail = read('agents/AgentDetail.tsx');
  assert.match(detail, /navigate\('memory', \{ anchor: agent\.id \}\)/);
});

test('the Memory view reads the anchor off the nav target', () => {
  const view = read('memory/MemoryView.tsx');
  assert.match(view, /anchorAgentId\(target\.anchor, agents, current \|\| godId\)/);
  // Keyed on `seq`, so a second link to the agent already on screen still
  // switches back to Files (navigation.ts spells out why).
  assert.match(view, /\}, \[target\.seq\]\);/);
});

/* ── 4. The file: size and age ──────────────────────────────────────────── */

test('size is UTF-8 bytes, not string length', () => {
  // `hive:memory` returns text and nothing else, so the size is measured here.
  // An em-dash is 3 bytes and one UTF-16 unit; `.length` would under-report
  // every memory file in this repo against a threshold stated in bytes.
  const text = 'a — b';
  assert.equal(memoryFileMeta(text).bytes, 7);
  assert.notEqual(memoryFileMeta(text).bytes, text.length);
});

test('the size reads in the same unit the condenser states its thresholds in', () => {
  const meta = memoryFileMeta('x'.repeat(4096));
  assert.equal(meta.sizeLabel, '4.0 KB');
  assert.equal(formatBytes(512), '512 B', 'shared with summarizeReflect — one file cannot say 4.0 KB while the other says 4096');
  assert.match(summarizeReflect([{ id: 'jim', condensed: true, reason: 'ok', oldBytes: 4096, newBytes: 512 }]), /4\.0 KB → 512 B/);
});

test('no mtime means no age is claimed', () => {
  // The mtime comes from the sandboxed listDir, which can fail or be unavailable
  // (no harness home). A wrong "just now" is worse than no line.
  assert.equal(memoryFileMeta('hi', null).modifiedLabel, null);
  assert.equal(memoryFileMeta('hi', 0).modifiedLabel, null);
  const now = 1_700_000_000_000;
  assert.equal(memoryFileMeta('hi', now - 3 * 3600_000, now).modifiedLabel, '3h ago');
});

test('an empty file is called empty rather than rendered as blank markdown', () => {
  assert.equal(memoryFileMeta('   \n\n').empty, true);
  assert.equal(memoryFileMeta('# Andy').empty, false);
});

test('a fixture memory.md is rendered as markdown, not dumped as text', () => {
  // The pixel tab shows memory.md in a <pre>; these files are markdown, and the
  // shared MarkdownPreview has no stylesheet under the modern entry — without
  // the IDE's markdown.css it renders correct, completely unstyled HTML.
  const fixture = ['# Andy — memory', '', '## Standing orders', '- ship the card', ''].join('\n');
  const meta = memoryFileMeta(fixture);
  assert.equal(meta.empty, false);
  assert.equal(meta.sizeLabel, '54 B', 'the em-dash in the heading is three of those bytes');
  const view = read('memory/MemoryView.tsx');
  assert.match(view, /<MarkdownPreview source=\{mem\} baseRel=\{MEMORY_FILE\} \/>/);
  assert.match(view, /import '\.\.\/ide\/markdown\.css';/);
  assert.equal(MEMORY_FILE, 'memory.md');
});

test('the memory file is found in the hive folder, not the workspace', () => {
  assert.equal(memoryDir('/Users/u/HarnessAgents', 'andy'), '/Users/u/HarnessAgents/hive/agents/andy');
  assert.equal(memoryDir('/Users/u/HarnessAgents/', 'andy'), '/Users/u/HarnessAgents/hive/agents/andy');
  assert.equal(memoryDir(null, 'andy'), null, 'no harness home, no path to guess at');
});

/* ── 5. MemPalace status ────────────────────────────────────────────────── */

const palace = (over) => ({
  available: true, enabled: true, active: true, initialized: true,
  palacePath: '/Users/u/HarnessAgents/.palace', model: 'minilm', bin: '/usr/local/bin/mempalace',
  ...over
});

test('a missing binary is reported as missing, not as "off"', () => {
  // `active` is available && enabled && home, so checking it first would report
  // the user's SETTING for a machine that has no mempalace at all — and send
  // them to a toggle that changes nothing.
  const line = palaceLine(palace({ available: false, active: false }));
  assert.equal(line.label, 'not installed');
  assert.match(line.detail, /Prerequisites/);
  assert.equal(line.searchable, false);
});

test('off is a setting, and says which one', () => {
  const line = palaceLine(palace({ enabled: false, active: false }));
  assert.equal(line.label, 'off');
  assert.match(line.detail, /Memory & Knowledge/);
  assert.equal(line.searchable, false);
});

test('installed and enabled but homeless is an error, not a shrug', () => {
  const line = palaceLine(palace({ active: false }));
  assert.equal(line.label, 'no hive home');
  assert.equal(line.tone, 'destructive');
});

test('an un-built palace is still searchable-once-mined, and a live one names its path', () => {
  assert.equal(palaceLine(palace({ initialized: false })).label, 'building');
  const live = palaceLine(palace());
  assert.equal(live.label, 'active');
  assert.equal(live.detail, '/Users/u/HarnessAgents/.palace');
  assert.equal(live.searchable, true);
});

test('an unreadable status says so instead of claiming everything is fine', () => {
  const line = palaceLine(null);
  assert.equal(line.label, 'unknown');
  assert.equal(line.searchable, false);
});

/* ── 6. Search hits ─────────────────────────────────────────────────────── */

test('a memory hit knows whose it is; a hive-wide file belongs to nobody', () => {
  // hive:textSearch labels its targets board.md, tasks.json and <id>/memory.md.
  assert.equal(hitAgentId('andy-mt2ykkfq/memory.md'), 'andy-mt2ykkfq');
  assert.equal(hitAgentId('board.md'), null);
  assert.equal(hitAgentId('tasks.json'), null);
  // The label is `<id>/memory.md` and nothing else — an unanchored match would
  // read 'andy' out of a nested path and offer a link to an agent that is not
  // whose file that is.
  assert.equal(hitAgentId('agents/andy/memory.md'), null, 'only memory.md, and only one level deep');
  assert.equal(hitAgentId('andy/notes.md'), null);
});

/* ── 7. Settings still points at it ─────────────────────────────────────── */

test('Settings › Memory links to the view, and the row is findable in search', () => {
  assert.match(read('settings/MemorySection.tsx'), /navigate\('memory'\)/);
  const row = SETTINGS.find((s) => s.id === 'set-memory-open');
  assert.ok(row, 'an indexed row is a searchable row (modern-settings-index)');
  assert.equal(row.section, 'Memory & Knowledge');
  assert.deepEqual(row.keys, [], 'a link writes no config key');
});

/* ── 8. No new IPC ──────────────────────────────────────────────────────── */

test('the view runs on channels that already existed', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'index.ts'), 'utf8');
  for (const call of ['hiveMemory', 'memoryStatus', 'searchMemory', 'textSearch', 'memoryWakeUp', 'mineNow', 'reflectNow', 'reflectStatus', 'listDir']) {
    assert.match(preload, new RegExp(`\\b${call}:`), `${call} must already be on the bridge`);
  }
  const view = read('memory/MemoryView.tsx');
  const graph = read('memory/MemoryGraph.tsx');
  for (const m of [...view.matchAll(/window\.cth\.(\w+)/g), ...graph.matchAll(/window\.cth\.(\w+)/g)]) {
    assert.match(preload, new RegExp(`\\b${m[1]}:`), `window.cth.${m[1]} is not on the preload bridge`);
  }
});
