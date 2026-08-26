'use strict';

/**
 * MD-158 — the modern UI could not see ephemeral workers at all.
 *
 * A worker is a real process spending real tokens against a real worktree, and
 * the only way to watch or stop one was to switch front-ends. Two things are
 * pinned here: the row WORDING (one list drawn by two panels must not describe
 * the same worker two ways) and the stop control (it kills a live process, so
 * it arms first and tells the truth about what teardown does).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const {
  workerStatusLabel, workerCapacityLabel, workerBilledLabel, workerIdleLabel,
  workerMetaRow, stopWorkerConsequence, preservedAgeLabel
} = loadTs('src/shared/workers.ts');
const { relDuration } = loadTs('src/shared/relTime.ts');

const worker = (over = {}) => ({
  workerId: 'w-1', name: 'slack-fixer', baseBranch: 'main',
  ageMs: 12_000, idleMs: 4000, tokensUsed: 36_000, tokenCap: null,
  hasSlack: true, releasing: false, ...over
});

test('a duration is not a timestamp', () => {
  assert.equal(relDuration(0), '0s');
  assert.equal(relDuration(999), '0s');
  assert.equal(relDuration(12_000), '12s');
  assert.equal(relDuration(89_000), '89s');
  assert.equal(relDuration(91_000), '2m');
  assert.equal(relDuration(3 * 3600_000), '3h');
  assert.equal(relDuration(50 * 3600_000), '2d');
  assert.equal(relDuration(NaN), '0s');
});

test('a worker being torn down stops claiming it is doing your work', () => {
  assert.equal(workerStatusLabel(worker()), 'working');
  assert.equal(workerStatusLabel(worker({ releasing: true })), 'stopping');
});

test('uncapped is a different fact from a large cap', () => {
  assert.equal(workerBilledLabel(worker()), 'billed 36k · uncapped');
  assert.equal(workerBilledLabel(worker({ tokenCap: 2_000_000 })), 'billed 36k / 2M');
  assert.equal(workerCapacityLabel(2, 4), '2 / 4');
});

test('a dead pty is reported, not rounded to "idle 0s"', () => {
  assert.equal(workerIdleLabel(worker({ idleMs: null })), 'pty gone');
  assert.equal(workerIdleLabel(worker({ idleMs: 240_000 })), 'idle 4m');
});

test('the meta line is one order, for both panels', () => {
  const row = workerMetaRow(worker());
  assert.deepEqual(row.map((m) => m.key), ['id', 'base', 'age', 'idle', 'billed']);
  assert.deepEqual(row.map((m) => m.text), [
    'w-1', 'base: main', 'up 12s', 'idle 4s', 'billed 36k · uncapped'
  ]);
  assert.equal(preservedAgeLabel({ preservedAt: 1000 }, 3 * 3600_000 + 1000), 'kept 3h ago');
});

test('the stop warning does not claim the work is lost — teardown preserves it', () => {
  const c = stopWorkerConsequence(worker());
  assert.match(c, /slack-fixer/);
  assert.match(c, /no reply/i, 'the Slack thread going unanswered is the real cost');
  assert.match(c, /worktree is kept/i);
  assert.doesNotMatch(c, /work is lost|lose the work/i);
});

test('both panels draw the list from the shared wording', () => {
  for (const file of [
    'src/renderer/src/components/WorkersTab.tsx',
    'src/renderer/src/modern/monitor/WorkersPanel.tsx'
  ]) {
    const src = read(file);
    assert.match(src, /workerMetaRow\(w\)/, `${file} words its own meta line`);
    assert.match(src, /workerStatusLabel|workerCapacityLabel/, `${file} words its own status`);
    assert.match(src, /window\.cth\.listWorkers/);
  }
  // The classic panel's private copies are gone.
  const pixel = read('src/renderer/src/components/WorkersTab.tsx');
  assert.doesNotMatch(pixel, /function relAge/);
  assert.doesNotMatch(pixel, /function fmtTokens/);
});

test('stopping a live worker arms first, and a failed stop is surfaced', () => {
  const src = read('src/renderer/src/modern/monitor/WorkersPanel.tsx');
  assert.match(src, /<DestructiveButton/, 'stop is a bare button');
  assert.match(src, /consequence=\{stopWorkerConsequence\(w\)\}/);
  // Killing a process cannot be undone, so the prompt must not auto-disarm out
  // from under a user who is reading it.
  assert.match(src, /autoDisarm=\{false\}/);
  assert.match(src, /if \(!res\.ok\) setError/, 'a refused stop is swallowed');
  assert.match(src, /window\.cth\.stopWorker\(workerId\)/);
});

test('Workers is a Monitor tab, not a new nav entry', () => {
  const view = read('src/renderer/src/modern/monitor/MonitorView.tsx');
  assert.match(view, /<TabsTrigger value="workers">Workers<\/TabsTrigger>/);
  assert.match(view, /<WorkersPanel \/>/);
  assert.doesNotMatch(read('src/renderer/src/modern/nav.ts'), /workers/i);
});
