'use strict';

/**
 * MD-172 — the three numbers that decide what a floor of agents costs were
 * configurable and invisible.
 *
 * `defaultModel` had a row that said what it did but not what it cost;
 * `defaultWorkerTokenCap` had no row at all, which for a CAP is the worst
 * pairing — an operator who believed workers were capped had no way to find out
 * they were not; and effort could only be picked per hire, so a floor-wide
 * preference meant setting it by hand every time.
 *
 * Values are deliberately unchanged. What is pinned here is that the copy tells
 * the truth, and that the one new key is wired rather than decorative.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const { priceFor } = loadTs('src/main/pricing.ts');
const { seedEffort, effortLevelsFor } = loadTs('src/shared/agentProvider.ts');

const section = () => read('src/renderer/src/modern/settings/AgentsSection.tsx');

/* ─────────────────────────────── the copy ────────────────────────────────── */

test('the model row states the cost ratio, and the ratio is the real one', () => {
  assert.match(section(), /Opus costs about 5× Sonnet per token and Haiku about a quarter/);
  // Sourced from src/main/pricing.ts, not from memory: a price change has to
  // break this rather than leave a stale number sitting in Settings.
  const opus = priceFor('claude-opus-5');
  const sonnet = priceFor('claude-sonnet-5');
  const haiku = priceFor('claude-haiku-4-5-20251001');
  assert.equal(opus.inputPerM / sonnet.inputPerM, 5);
  assert.equal(opus.outputPerM / sonnet.outputPerM, 5);
  assert.ok(Math.abs(haiku.inputPerM / sonnet.inputPerM - 0.25) < 0.05);
});

test('the worker-cap row says the quiet part: 0 stops nobody', () => {
  const s = section();
  assert.ok(s.includes('id="set-worker-cap"'));
  assert.match(s, /0 = unlimited — nothing stops a worker on cost/);
  // The shipped value is untouched (human decision). 0 has to survive a blank
  // box too: `numOrUndefined` returns undefined for '', and undefined here would
  // read as "unset" rather than the explicit 0 the config documents.
  assert.match(s, /numOrUndefined\(v\) \?\? 0/);
  assert.match(read('src/main/config.ts'), /defaultWorkerTokenCap: 0,/);
});

test('the effort row offers exactly the levels the engine documents', () => {
  const s = section();
  assert.ok(s.includes('id="set-effort"'));
  assert.match(s, /effortLevelsFor\('claude'\)/);
  assert.deepEqual(effortLevelsFor('claude'), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.match(s, /Higher levels spend more tokens per turn/);
});

/* ────────────────────────── the row is not a lie ─────────────────────────── */

test('an unset default effort still means no flag at all', () => {
  assert.equal(seedEffort(undefined, 'claude'), undefined);
  assert.equal(seedEffort({}, 'claude'), undefined);
  assert.equal(seedEffort({ defaultEffort: 'high' }, 'claude'), 'high');
});

test('a level the chosen engine never listed is dropped, not spliced in', () => {
  // Codex has its own levels; an engine with no effort flag has none. Carrying a
  // Claude level onto either would put `--effort high` on a command line that
  // has no such flag and break the spawn.
  assert.equal(seedEffort({ defaultEffort: 'xhigh' }, 'custom'), undefined);
  assert.equal(seedEffort({ defaultEffort: 'not-a-level' }, 'claude'), undefined);
});

test('both hire dialogs seed effort through the SAME helper', () => {
  // Otherwise the same hire thinks differently depending on which UI opened it.
  for (const f of [
    'src/renderer/src/modern/agents/AddAgentDialog.tsx',
    'src/renderer/src/components/AddAgentModal.tsx'
  ]) {
    assert.match(read(f), /seedEffort\(config,/, `${f} must seed from the shared helper`);
  }
});

/* ─────────────────────────────── the index ───────────────────────────────── */

test('all three rows are findable in search and documented in SPEC', () => {
  const idx = read('src/renderer/src/modern/settings/index.ts');
  const spec = read('src/renderer/src/modern/settings/SPEC.md');
  for (const id of ['set-model', 'set-effort', 'set-worker-cap']) {
    assert.ok(idx.includes(`id: '${id}'`), `${id} missing from the settings search index`);
  }
  assert.match(idx, /keys: \['defaultEffort'\]/);
  assert.match(idx, /keys: \['defaultWorkerTokenCap'\]/);
  assert.match(spec, /`defaultEffort`/);
  assert.match(spec, /`defaultWorkerTokenCap` \(0 = unlimited\)/);
});
