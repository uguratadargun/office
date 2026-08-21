'use strict';

// updateAgentMeta: rename / re-role a registered agent in registry.json and
// rewrite identity.md (picked up on the next respawn).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { HiveManager } = loadTs('src/main/hive.ts');

async function floor(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-agent-edit-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'jim-1', name: 'Jim', role: 'sales', cwd: home });
  return hive;
}

const read = (hive, f) => fs.readFileSync(path.join(hive.root(), f), 'utf8');
const reg = (hive) => JSON.parse(read(hive, 'registry.json')).agents['jim-1'];

test('renames in registry.json and identity.md', async (t) => {
  const hive = await floor(t);
  assert.equal(hive.updateAgentMeta('jim-1', { name: 'Dwight', role: 'beets' }), true);
  assert.equal(reg(hive).name, 'Dwight');
  assert.equal(reg(hive).role, 'beets');
  const identity = read(hive, 'agents/jim-1/identity.md');
  assert.match(identity, /# Dwight \(jim-1\)/);
  assert.match(identity, /Role: beets/);
});

test("clears role on '' and ignores whitespace-only name", async (t) => {
  const hive = await floor(t);
  assert.equal(hive.updateAgentMeta('jim-1', { name: '   ', role: '' }), true);
  assert.equal(reg(hive).name, 'Jim');
  assert.equal(reg(hive).role, undefined);
  const identity = read(hive, 'agents/jim-1/identity.md');
  assert.match(identity, /Role: agent/);
  assert.doesNotMatch(identity, /Role: sales/);
});

test('name-only patch leaves role untouched', async (t) => {
  const hive = await floor(t);
  assert.equal(hive.updateAgentMeta('jim-1', { name: 'X' }), true);
  assert.equal(reg(hive).role, 'sales');
});

test('returns false for unknown id', async (t) => {
  const hive = await floor(t);
  assert.equal(hive.updateAgentMeta('nope', { name: 'X' }), false);
});

test('moves cwd — expanded, validity flagged, untouched when omitted', async (t) => {
  const hive = await floor(t);
  const before = reg(hive).cwd;
  assert.equal(hive.updateAgentMeta('jim-1', { name: 'X' }), true);
  assert.equal(reg(hive).cwd, before, 'a name-only edit must not move the agent');

  assert.equal(hive.updateAgentMeta('jim-1', { cwd: '~' }), true);
  assert.equal(reg(hive).cwd, os.homedir(), 'the registry stores the expanded path, never a literal ~');
  assert.equal(reg(hive).cwdValid, true);

  assert.equal(hive.updateAgentMeta('jim-1', { cwd: path.join(hive.root(), 'does-not-exist') }), true);
  assert.equal(reg(hive).cwdValid, false, 'a bad folder is flagged on the roster, not rejected');
});
