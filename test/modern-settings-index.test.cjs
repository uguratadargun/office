// The modern Settings index cannot silently go stale (MD-87 / MD-71).
//
// The pixel index (shared/settingsSearch.ts) is hand-kept and covers 42 of ~68
// config keys. That is not a bug in the list — it is a bug in the LOOP: adding a
// key to HarnessConfig and forgetting the index fails nothing, so the omission
// is invisible until a user cannot find a setting they know exists.
//
// This test closes it. Every top-level HarnessConfig key must be either
// (a) indexed in modern/settings/index.ts, or (b) named in NOT_A_SETTING with a
// stated reason. A new key is neither, so the test fails and the author has to
// make a decision. Both halves are read out of the TS source: no fixture to
// update, and no way for the two to drift apart.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const configSrc = fs.readFileSync(path.join(SRC, 'renderer', 'src', 'store', 'config.ts'), 'utf8');
const indexSrc = fs.readFileSync(path.join(SRC, 'renderer', 'src', 'modern', 'settings', 'index.ts'), 'utf8');

/** Top-level field names of `interface HarnessConfig`. */
function configKeys() {
  const start = configSrc.indexOf('export interface HarnessConfig');
  assert.ok(start > 0, 'HarnessConfig interface not found — did store/config.ts move?');
  const end = configSrc.indexOf('\n}', start);
  const body = configSrc.slice(start, end);
  // Two-space indent = top level; deeper indents are nested object literals.
  return [...body.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*)\??:/gm)].map((m) => m[1]);
}

/** Every key named in a SETTINGS entry's `keys: [...]`. */
function indexedKeys() {
  const start = indexSrc.indexOf('export const SETTINGS');
  assert.ok(start > 0, 'SETTINGS array not found');
  const body = indexSrc.slice(start);
  const keys = new Set();
  for (const m of body.matchAll(/keys:\s*\[([^\]]*)\]/g)) {
    for (const k of m[1].matchAll(/'([^']+)'/g)) keys.add(k[1]);
  }
  return keys;
}

/** Keys explicitly declared not-a-setting, with their reason. */
function exemptKeys() {
  const start = indexSrc.indexOf('export const NOT_A_SETTING');
  assert.ok(start > 0, 'NOT_A_SETTING not found');
  const body = indexSrc.slice(start, indexSrc.indexOf('\n};', start));
  const out = new Map();
  for (const m of body.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):\s*'([^']*)'/gm)) out.set(m[1], m[2]);
  return out;
}

test('every HarnessConfig key is either indexed or explicitly not-a-setting', () => {
  const keys = configKeys();
  // Guard the guard: if the parse silently returns nothing, every assertion
  // below passes vacuously and the test is worthless.
  assert.ok(keys.length > 50, `parsed only ${keys.length} config keys — parser is broken`);
  const indexed = indexedKeys();
  const exempt = exemptKeys();
  const orphans = keys.filter((k) => !indexed.has(k) && !exempt.has(k));
  assert.deepStrictEqual(
    orphans,
    [],
    `these config keys are neither in SETTINGS nor in NOT_A_SETTING:\n  ${orphans.join('\n  ')}\n` +
    'Add a row to SETTINGS, or add the key to NOT_A_SETTING with the reason it is not a setting.'
  );
});

test('every exemption states a reason, and exempts a key that exists', () => {
  const keys = new Set(configKeys());
  for (const [key, reason] of exemptKeys()) {
    assert.ok(reason.trim().length > 10, `NOT_A_SETTING.${key} needs a real reason, got "${reason}"`);
    assert.ok(keys.has(key), `NOT_A_SETTING.${key} is not a HarnessConfig key — stale exemption`);
  }
});

test('no key is both indexed and exempt', () => {
  const indexed = indexedKeys();
  const both = [...exemptKeys().keys()].filter((k) => indexed.has(k));
  assert.deepStrictEqual(both, [], `keys claimed as both a setting and not a setting: ${both.join(', ')}`);
});

test('entry ids are unique and every entry has a section the panel renders', () => {
  const ids = [...indexSrc.matchAll(/\{ id: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(ids.length > 40, `parsed only ${ids.length} entries — parser is broken`);
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate entry id in SETTINGS');
  const sections = [...indexSrc.matchAll(/^\s{2}'([^']+)'/gm)].map((m) => m[1]);
  const used = new Set([...indexSrc.matchAll(/section: '([^']+)'/g)].map((m) => m[1]));
  for (const s of used) assert.ok(sections.includes(s), `entry uses unknown section "${s}"`);
});
