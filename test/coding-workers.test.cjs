'use strict';

/**
 * MD-132 — "max concurrent coding workers".
 *
 * The important thing about this setting is what it is NOT. `maxConcurrentWorkers`
 * is a resource backstop main applies itself, by holding spawn-requests in a
 * queue. This one cannot work that way: "is this agent coding" is a judgement
 * about the WORK, not something main can read off a PTY. So nothing blocks
 * anything — the number is PUBLISHED to god twice and god does the rationing.
 *
 * Which makes the two publication points the whole feature, and the thing to
 * pin: if either goes quiet, the policy silently ceases to exist while the
 * settings box still shows a number.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const cw = loadTs('src/shared/codingWorkers.ts');
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

/* ── the value ──────────────────────────────────────────────────────────── */

test('the default is 3, and absent config gets it', () => {
  assert.equal(cw.DEFAULT_MAX_CODING_WORKERS, 3);
  assert.equal(cw.maxCodingWorkers(undefined), 3);
  assert.equal(cw.maxCodingWorkers(null), 3);
  assert.equal(cw.maxCodingWorkers({}), 3);
});

test('out of range CLAMPS rather than rejecting', () => {
  // Deliberate: this is read on the way OUT to god's roster line. Refusing a
  // bad value there would inject no policy at all, so a typo in a settings box
  // would silently REMOVE the cap instead of bending it.
  assert.equal(cw.maxCodingWorkers({ maxCodingWorkers: 0 }), 1);
  assert.equal(cw.maxCodingWorkers({ maxCodingWorkers: -5 }), 1);
  assert.equal(cw.maxCodingWorkers({ maxCodingWorkers: 9 }), 8);
  assert.equal(cw.maxCodingWorkers({ maxCodingWorkers: 999 }), 8);
  assert.equal(cw.MIN_MAX_CODING_WORKERS, 1);
  assert.equal(cw.MAX_MAX_CODING_WORKERS, 8);
});

test('anything that is not a usable number falls back, never NaN', () => {
  for (const bad of [NaN, Infinity, -Infinity, '4', null, {}, []]) {
    assert.equal(cw.maxCodingWorkers({ maxCodingWorkers: bad }), 3, `${String(bad)} must fall back`);
  }
  assert.equal(cw.maxCodingWorkers({ maxCodingWorkers: 2.6 }), 3, 'a fraction rounds, it does not truncate to 2');
  for (let n = 1; n <= 8; n++) assert.equal(cw.maxCodingWorkers({ maxCodingWorkers: n }), n);
});

/* ── publication point 1: god's injected roster line ────────────────────── */

test('the policy is injected into god\'s roster line, with the number in it', () => {
  const hive = read('src/main/hive.ts');
  assert.match(hive, /Policy: max \$\{snap\.maxCodingWorkers\} concurrent coding workers/,
    'the roster line is the whole enforcement mechanism — it must state the number');
  // Read from the SAME snapshot the roster is built from, so the floor and the
  // policy printed beside it can never be from different moments.
  assert.match(hive, /maxCodingWorkers\?: number;/);
  // Absent ⇒ no sentence, rather than "max undefined".
  assert.match(hive, /typeof snap\.maxCodingWorkers === 'number'\s*\n?\s*\?/);
  assert.match(hive, /: '';/);
  // And it must tell god what to DO, not just the number.
  assert.match(hive, /queue the work instead of spawning/);
});

/* ── publication point 2: fleet.json ────────────────────────────────────── */

test('the policy is written into the fleet.json snapshot header', () => {
  const idx = read('src/main/index.ts');
  assert.match(idx, /writeFleetSnapshot\(\{ ts: now, maxCodingWorkers: maxCodingWorkers\(cfg\), agents \}\)/,
    'god reads fleet.json directly as often as it reads the injected line');
  // Clamped on the way out, so the file cannot carry a value the UI would not.
  assert.match(idx, /import \{[\s\S]{0,400}maxCodingWorkers[\s\S]{0,80}\} from '\.\/config'/);
});

/* ── the settings rows, in BOTH UIs ─────────────────────────────────────── */

test('both UIs expose the row, and both say it is a policy rather than a limit', () => {
  const modern = read('src/renderer/src/modern/settings/AgentsSection.tsx');
  const pixel = read('src/renderer/src/components/SettingsModal.tsx');
  for (const [name, src] of [['modern', modern], ['pixel', pixel]]) {
    assert.match(src, /Max concurrent coding workers/, `${name} must show the row`);
    assert.match(src, /not a limit the app enforces/,
      `${name} must not promise an enforcement that does not exist`);
    assert.match(src, /maxCodingWorkers/, `${name} must read and write the key`);
  }
});

test('the pixel row re-seeds on mount, so a save is not read back as the default', () => {
  // MD-64: a blur-saved row that is missing from the re-seed effect shows the
  // stale default for the rest of the session. One row = two edits.
  const pixel = read('src/renderer/src/components/SettingsModal.tsx');
  assert.match(pixel, /setCodingWorkers\(String\(cc\.maxCodingWorkers \?\? DEFAULT_MAX_CODING_WORKERS\)\)/);
  assert.match(pixel, /onBlur=\{\(\) => void saveCodingWorkers\(\)\}/);
});

test('the new key is indexed for settings search, or the anti-rot test fails', () => {
  const idx = read('src/renderer/src/modern/settings/index.ts');
  assert.match(idx, /id: 'set-coding-workers'[\s\S]{0,200}keys: \['maxCodingWorkers'\]/);
});

test('it is NOT wired as an enforcement anywhere', () => {
  // The one way this feature can go wrong later is someone "finishing" it by
  // adding a silent block. Nothing may gate a spawn on this number.
  const idx = read('src/main/index.ts');
  const spawnish = idx.split('\n').filter((l) =>
    /maxCodingWorkers/.test(l) && /(return|throw|if \(|queue|reject|block)/.test(l));
  assert.deepEqual(spawnish, [], `maxCodingWorkers must never gate anything: ${spawnish.join(' | ')}`);
});
