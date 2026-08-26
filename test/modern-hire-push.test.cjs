'use strict';

/**
 * MD-148 — the hire push path was dead in the modern UI.
 *
 * `onHireImport`, `drainPendingHires` and `onHireError` were subscribed in the
 * PIXEL root only. An agent hiring another agent therefore completed in main,
 * put nothing on screen in modern, and swallowed every failure — the parity
 * inventory's most dangerous gap, because the feature it kills is the one the
 * hive exists for.
 *
 * Two halves pinned here:
 *   (1) the RULE the lift created — which queued manifest opens the form;
 *   (2) the SHAPE — one shared hook, subscribed by both roots, and a modern
 *       form that actually pre-fills from the staged manifest.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const { latestHire, hireImportLabel } = loadTs('src/shared/hire.ts');

const manifest = (name, author) => ({ spec: 'munder-difflin/hire@1', name, author });

test('the LAST queued hire is the one that opens the form', () => {
  assert.equal(latestHire([]), null);
  assert.equal(latestHire(undefined), null);
  assert.equal(latestHire(null), null);
  assert.equal(latestHire([manifest('Ada')]).name, 'Ada');
  // A cold-start backlog: the older deep links were walked away from.
  assert.equal(latestHire([manifest('Ada'), manifest('Kevin'), manifest('Pam')]).name, 'Pam');
});

test('the import banner is attributed the same way from either entry point', () => {
  assert.equal(hireImportLabel(manifest('Ada')), 'Ada');
  assert.equal(hireImportLabel(manifest('Ada', 'pam')), 'Ada · by pam');
});

test('one shared hook owns all three hire subscriptions', () => {
  const hook = read('src/renderer/src/hooks/useHireImport.ts');
  for (const ipc of ['onHireImport', 'drainPendingHires', 'onHireError']) {
    assert.match(hook, new RegExp(`window\\.cth\\.${ipc}`), `${ipc} is not subscribed`);
  }
  // Staged and reviewed — a pushed manifest must never spawn by itself.
  assert.match(hook, /setPendingHire\(manifest\)/);
  assert.match(hook, /setAddAgentOpen\(true\)/);
  assert.doesNotMatch(hook, /spawnPty/);
});

test('both roots subscribe, and neither hand-rolls the IPC any more', () => {
  for (const file of ['src/renderer/src/App.tsx', 'src/renderer/src/modern/App.tsx']) {
    const src = read(file);
    assert.match(src, /useHireImport\(/, `${file} does not use the shared hook`);
    assert.doesNotMatch(src, /window\.cth\.onHireImport/, `${file} still hand-rolls the subscription`);
    assert.doesNotMatch(src, /window\.cth\.drainPendingHires/, `${file} still hand-rolls the drain`);
  }
});

test('modern surfaces a hire, and its failure, instead of swallowing it', () => {
  const src = read('src/renderer/src/modern/App.tsx');
  // AddAgentDialog is mounted inside AgentsView, so opening it from anywhere
  // else has to bring that view on screen or nothing renders.
  assert.match(src, /onImported[\s\S]{0,200}navigate\('agents'\)/);
  assert.match(src, /onError:[\s\S]{0,120}toast\.error/);
});

test('the modern form pre-fills from the staged manifest', () => {
  const src = read('src/renderer/src/modern/agents/AddAgentDialog.tsx');
  assert.match(src, /s\.pendingHire/, 'the dialog never reads the staged hire');
  for (const field of ['name', 'character', 'provider', 'model', 'description', 'goal', 'isolate']) {
    assert.match(src, new RegExp(`hire\\?\\.${field}`), `${field} is not pre-filled from the hire`);
  }
  // Editing an existing agent must win over a manifest.
  assert.match(src, /const hire = editing \? undefined : pendingHire/);
  // Consumed by one form: a dismissed hire must not pre-fill the next one.
  assert.match(src, /close = \(\) => \{[^}]*setPendingHire\(null\)/);
});
