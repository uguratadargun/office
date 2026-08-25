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

/* ── MD-107: ONE writer, and a boot that reconciles ─────────────────────────
 *
 * The three writes above used to be inline in the pixel modal, and modern
 * Settings did only the first — so a rename there wrote config and left the
 * floor, the roster strip and every agent still saying Michael. Two copies of a
 * three-step write is how one of them ends up with two steps, so they moved into
 * `store/bossName.ts` and both UIs call it.
 */

const { applyBossName, reconcileBossName } = loadTs('src/renderer/src/store/bossName.ts');

/** Record what the renderer sent over IPC for one save. */
function stubCth(over = {}) {
  const calls = { config: [], meta: [] };
  global.window.cth = {
    updateConfig: async (patch) => { calls.config.push(patch); return patch; },
    hiveUpdateAgentMeta: async (id, patch) => { calls.meta.push([id, patch]); return { ok: true }; },
    ...over
  };
  return calls;
}

test('one save reaches all three places god is named', async () => {
  useStore.setState({
    agents: [agent({ id: 'god', name: DEFAULT_BOSS_NAME, isGod: true }), agent({ id: 'jim', name: 'Jim' })],
    bossName: DEFAULT_BOSS_NAME
  });
  const calls = stubCth();

  await applyBossName('Ugur');

  assert.deepEqual(calls.config, [{ bossName: 'Ugur' }], 'the setting');
  assert.equal(useStore.getState().bossName, 'Ugur', 'the mirror the UI paints');
  assert.equal(useStore.getState().agents.find((a) => a.isGod).name, 'Ugur', "god's roster entry");
  assert.deepEqual(calls.meta, [['god', { name: 'Ugur' }]], 'the hive registry + identity.md');
});

test('a cleared field persists BLANK and applies the default', async () => {
  // Writing the resolved name back would turn "use the default" into a literal
  // "Michael" the user then cannot clear.
  useStore.setState({ agents: [agent({ id: 'god', name: 'Ugur', isGod: true })], bossName: 'Ugur' });
  const calls = stubCth();

  await applyBossName('   ');

  assert.deepEqual(calls.config, [{ bossName: '   ' }], 'the raw value is what is stored');
  assert.equal(useStore.getState().bossName, DEFAULT_BOSS_NAME);
  assert.deepEqual(calls.meta, [['god', { name: DEFAULT_BOSS_NAME }]], 'the RESOLVED name is what agents are told');
});

test('a registry write that fails does not lose the visible rename', async () => {
  useStore.setState({ agents: [agent({ id: 'god', name: DEFAULT_BOSS_NAME, isGod: true })], bossName: DEFAULT_BOSS_NAME });
  stubCth({ hiveUpdateAgentMeta: async () => { throw new Error('registry locked'); } });

  await applyBossName('Deniz'); // must not reject

  assert.equal(useStore.getState().bossName, 'Deniz');
  assert.equal(useStore.getState().agents[0].name, 'Deniz');
});

test('boot reconciles a restored roster that still holds the old name', () => {
  // The mirror defaults to Michael and the roster is restored from disk, so a
  // window opened after a rename in a previous session showed the old name until
  // something happened to respawn god.
  useStore.setState({
    agents: [agent({ id: 'god', name: DEFAULT_BOSS_NAME, isGod: true })],
    bossName: DEFAULT_BOSS_NAME
  });
  reconcileBossName({ bossName: 'Ugur' });
  assert.equal(useStore.getState().bossName, 'Ugur');
  assert.equal(useStore.getState().agents[0].name, 'Ugur');
});

test('both UIs save through the one writer, and neither keeps a copy', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const pixel = read('src/renderer/src/components/SettingsModal.tsx');
  const modern = read('src/renderer/src/modern/settings/GeneralSection.tsx');

  assert.match(pixel, /applyBossName\(v\)/, 'the pixel modal must delegate');
  assert.match(modern, /applyBossName\(v\.trim\(\)\)/, 'modern Settings must delegate — this is the bug MD-107 fixed');
  for (const [name, src] of [['pixel', pixel], ['modern', modern]]) {
    assert.ok(!/hiveUpdateAgentMeta\(god/.test(src), `${name} must not keep its own registry write`);
  }
  // The bug was modern writing config ALONE. A bare updateConfig({ bossName })
  // is exactly that shape returning.
  assert.ok(!/updateConfig\(\{ bossName/.test(modern), 'modern must not write the config directly');
  assert.ok(!/save\(\{ bossName/.test(modern), 'modern must not write the config directly');
});

test('the reconcile runs where BOTH roots share code, not in the pixel root', () => {
  const hive = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/hooks/useHive.ts'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/App.tsx'), 'utf8');
  assert.match(hive, /reconcileBossName\(config\)/, 'useHive is what both roots call');
  assert.ok(!/setBossName\(/.test(app), 'the pixel root must not seed the mirror on its own again');
});
