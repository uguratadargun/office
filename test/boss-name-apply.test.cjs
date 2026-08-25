'use strict';

/**
 * Renaming the boss has to reach the places that actually say his name.
 *
 * MD-65 made `config.bossName` the setting and mirrored it into the store, and
 * said "the registry and the floor label follow on the next spawn". They did
 * not: the human set the name, the app kept saying Michael, and the hive log
 * showed why — `{"kind":"spawn","agentId":"god","name":"Michael"}` was the last
 * thing that ever wrote god's name, and a spawn only happens on a cold boot.
 *
 * God's name lives in THREE places, and the mirror is only one of them:
 *   • `config.bossName`            — the setting (was already correct)
 *   • the store's god AGENT entry  — the floor / roster / detail label, persisted
 *   • the hive registry entry      — what agents and god's own roster line read
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The store is a browser module: give it the two globals it touches at import.
const ls = {};
global.window = {
  localStorage: {
    getItem: (k) => (k in ls ? ls[k] : null),
    setItem: (k, v) => { ls[k] = String(v); },
    removeItem: (k) => { delete ls[k]; }
  },
  addEventListener() {},
  cth: {}
};
global.localStorage = global.window.localStorage;

const loadTs = require('./load-ts.cjs');
const { useStore } = loadTs('src/renderer/src/store/store.ts');
const { HiveManager } = loadTs('src/main/hive.ts');
const { bossName, DEFAULT_BOSS_NAME } = loadTs('src/shared/bossName.ts');

const agent = (over) => ({
  id: 'x', name: 'X', character: 'jim', accent: 'lemon', description: '', project: '',
  tmuxTarget: '', cwd: '/tmp', status: 'idle', action: '', progress: 0, ...over
});

test('setBossName renames god\'s roster entry — the floor label, not just the mirror', () => {
  useStore.setState({
    agents: [agent({ id: 'god', name: DEFAULT_BOSS_NAME, isGod: true }), agent({ id: 'jim', name: 'Jim' })],
    bossName: DEFAULT_BOSS_NAME
  });
  useStore.getState().setBossName('Ugur');
  const s = useStore.getState();
  assert.equal(s.bossName, 'Ugur');
  assert.equal(s.agents.find((a) => a.isGod).name, 'Ugur');
  assert.equal(s.agents.find((a) => a.id === 'jim').name, 'Jim', 'only the boss is renamed');
});

test('the rename is PERSISTED, so it survives a reload without a respawn', () => {
  useStore.setState({ agents: [agent({ id: 'god', name: 'Ugur', isGod: true })], bossName: 'Ugur' });
  useStore.getState().setBossName('Deniz');
  const saved = JSON.parse(ls['cth.agents'] ?? '[]');
  assert.equal(saved.find((a) => a.isGod)?.name, 'Deniz');
});

test('clearing the field puts the default back on the roster too', () => {
  useStore.setState({ agents: [agent({ id: 'god', name: 'Ugur', isGod: true })], bossName: 'Ugur' });
  useStore.getState().setBossName(bossName({ bossName: '  ' }));
  assert.equal(useStore.getState().agents[0].name, DEFAULT_BOSS_NAME);
});

test('updateAgentMeta renames god in the registry — no respawn needed', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-boss-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: DEFAULT_BOSS_NAME, cwd: home, isGod: true });
  const reg = () => JSON.parse(fs.readFileSync(path.join(hive.root(), 'registry.json'), 'utf8')).agents.god;
  assert.equal(reg().name, DEFAULT_BOSS_NAME); // the state the bug left behind

  assert.equal(hive.updateAgentMeta('god', { name: 'Ugur' }), true);
  assert.equal(reg().name, 'Ugur');
  assert.equal(reg().isGod, true, 'renaming must not disturb the routing identity');
  assert.match(fs.readFileSync(path.join(hive.root(), 'agents', 'god', 'identity.md'), 'utf8'), /Ugur/);
});

test('a later respawn keeps the new name — ensureAgent meta wins over the prior entry', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-boss2-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: DEFAULT_BOSS_NAME, cwd: home, isGod: true });
  hive.recordSession('god', 'sess-1');
  await hive.ensureAgent({ id: 'god', name: 'Ugur', cwd: home, isGod: true });
  const reg = JSON.parse(fs.readFileSync(path.join(hive.root(), 'registry.json'), 'utf8')).agents.god;
  assert.equal(reg.name, 'Ugur');
  assert.equal(reg.sessionId, 'sess-1', 'the resume key still survives the respawn');
});

test('useHive spawns god from the STORE mirror, not the boot-time config prop', () => {
  // App loads config once and never re-reads it, so a rename in Settings left
  // this closure holding the old name and any mid-session respawn wrote it back.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/hooks/useHive.ts'), 'utf8');
  assert.match(src, /const boss = useStore\.getState\(\)\.bossName;/);
  assert.ok(!/bossName\(config\)/.test(src), 'the stale boot-time config prop must not name the boss');
});

test('saving the boss name writes the registry, not only the config', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/components/SettingsModal.tsx'), 'utf8');
  const save = src.slice(src.indexOf('const saveBossName'), src.indexOf('const boss = useStore'));
  assert.match(save, /hiveUpdateAgentMeta/, 'the hive registry entry must be renamed on save');
  assert.match(save, /setBossName\(resolved\)/);
});
