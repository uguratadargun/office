'use strict';

/**
 * Agents are listed in several places (floor strip, Command Center roster, the
 * fullscreen roster, three pickers) and they must all agree: awake first,
 * hibernated at the bottom, and NOTHING else re-ranked.
 *
 * The dangerous half is the second clause. The roster order is the user's own
 * drag-reorder, god sits first on the dock, and the sort runs on every render —
 * so a comparator that breaks ties on anything at all would silently reorder a
 * list the user arranged by hand, and one that sorts in place would write that
 * back into the store from inside a render.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');
const loadTs = require('./load-ts.cjs');

const { compareAgentsForList, sortAgentsForList, agentListGroup } =
  loadTs('src/shared/agentOrder.ts');

const ROOT = join(__dirname, '..');
const a = (id, over = {}) => ({ id, ...over });
const ids = (list) => list.map((x) => x.id).join(',');

test('sleeping agents sink to the bottom, awake ones rise', () => {
  const list = [a('jim', { sleeping: true }), a('pam'), a('dwight', { sleeping: true }), a('oscar')];
  assert.equal(ids(sortAgentsForList(list)), 'pam,oscar,jim,dwight');
});

test('within a group the existing order is preserved exactly', () => {
  // Insertion order IS the meaning here — it is the user's drag-reorder.
  const awake = [a('e'), a('d'), a('c'), a('b'), a('a')];
  assert.equal(ids(sortAgentsForList(awake)), 'e,d,c,b,a');
  const asleep = awake.map((x) => ({ ...x, sleeping: true }));
  assert.equal(ids(sortAgentsForList(asleep)), 'e,d,c,b,a');
});

test('god keeps his place at the front', () => {
  // "Michael sits first on the dock" — he never hibernates, and no tiebreak may
  // demote him behind a working agent.
  const list = [a('god', { isGod: true }), a('jim', { status: 'working' }), a('pam', { sleeping: true })];
  assert.equal(ids(sortAgentsForList(list)), 'god,jim,pam');
});

test('a status flicker never moves a row — only sleeping carries a boundary', () => {
  // The pty parser rewrites `status` every few seconds. If it ranked, rows would
  // hop over each other under the pointer.
  const base = [a('jim', { status: 'idle' }), a('pam', { status: 'working' }), a('oscar', { status: 'thinking' })];
  const before = ids(sortAgentsForList(base));
  for (const status of ['working', 'idle', 'thinking', 'waiting', 'compacting', 'looping', 'blocked']) {
    const flickered = base.map((x) => (x.id === 'jim' ? { ...x, status } : x));
    assert.equal(ids(sortAgentsForList(flickered)), before, `status "${status}" reordered the list`);
  }
});

test('the comparator itself reports only the group, never a tiebreak', () => {
  assert.equal(compareAgentsForList(a('x'), a('y')), 0);
  assert.equal(compareAgentsForList(a('x', { sleeping: true }), a('y', { sleeping: true })), 0);
  assert.ok(compareAgentsForList(a('x'), a('y', { sleeping: true })) < 0);
  assert.ok(compareAgentsForList(a('x', { sleeping: true }), a('y')) > 0);
  assert.equal(agentListGroup({}), 0);
  assert.equal(agentListGroup({ sleeping: false }), 0);
  assert.equal(agentListGroup({ sleeping: true }), 1);
});

test('the store array is never sorted in place', () => {
  const list = [a('jim', { sleeping: true }), a('pam')];
  const sorted = sortAgentsForList(list);
  assert.equal(ids(list), 'jim,pam', 'sortAgentsForList mutated its input');
  assert.notEqual(sorted, list);
});

// Every list site must route through the comparator — a new roster that maps
// `agents` directly is how half the app drifts back out of order.
const LIST_SITES = [
  'src/renderer/src/components/AgentStrip.tsx',
  'src/renderer/src/components/CommandCenterPanel.tsx',
  'src/renderer/src/components/FullscreenTerminal.tsx',
  'src/renderer/src/components/TasksKanban.tsx',
  'src/renderer/src/components/triggers/SchedulesSection.tsx'
];

test('every agent list renders through sortAgentsForList', () => {
  for (const rel of LIST_SITES) {
    assert.match(readFileSync(join(ROOT, rel), 'utf8'), /sortAgentsForList\(/, `${rel} lists agents unsorted`);
  }
});

test('no display list maps over the raw agents array', () => {
  // The office floor is exempt on purpose: desks are positions, not a list.
  const EXEMPT = new Set(['src/renderer/src/scene/office/OfficeFloor.tsx']);
  const hits = [];
  const walk = function* (dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) yield* walk(full);
      else if (/\.tsx$/.test(name)) yield full;
    }
  };
  for (const f of walk(join(ROOT, 'src', 'renderer', 'src'))) {
    const rel = f.slice(ROOT.length + 1).split('\\').join('/');
    if (EXEMPT.has(rel)) continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      // A RENDERED list only: the expression sits in a JSX container, so the
      // trimmed line opens with `{`. Deriving a Set of ids or a list of cwds
      // from `agents` is not a list and must not be swept (order is meaningless
      // to a Set) — flagging those is how this guard turns into noise nobody
      // reads, and then into an allowlist nobody maintains.
      const t = line.trim();
      if (t.startsWith('{') && /\bagents\s*(\.filter\([^)]*\))?\.map\(/.test(t) && !/sortAgentsForList/.test(t)) {
        hits.push(`${rel}:${i + 1}: ${t.slice(0, 80)}`);
      }
    });
  }
  assert.deepEqual(hits, [], `unsorted agent list:\n${hits.join('\n')}`);
});
