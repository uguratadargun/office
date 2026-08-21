'use strict';

/**
 * The MCP consent map reaches more than one engine.
 *
 * `buildMcpServers` lived privately in hive.ts and was called only on the Claude
 * spawn path, so Settings showed ten toggles that did nothing for ten of the
 * eleven engines. It is now shared, and each wired engine renders it into the
 * config file that CLI actually reads. These tests pin the two things that break
 * silently: the consent gate (a keyed server must never ride in on a default) and
 * each engine's field names, which differ — Codex takes command + args, OpenCode
 * takes one argv array and calls the env block `environment`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  buildMcpServers, codexMcpToml, openCodeMcp, MCP_CATALOG, MCP_WIRED_PROVIDERS
} = loadTs('src/shared/mcpCatalog.ts');

const secretEntry = MCP_CATALOG.find((e) => e.tier === 'secret');
const cwdEntry = MCP_CATALOG.find((e) => e.spec.args.includes('<cwd>'));

test('a safe-readonly server is on by default and namespaced munder-*', () => {
  const servers = buildMcpServers('/work/repo', undefined);
  const safe = MCP_CATALOG.filter((e) => e.tier === 'safe-readonly');
  assert.ok(safe.length > 0, 'catalog has safe servers to check');
  for (const e of safe) assert.ok(servers[`munder-${e.id}`], `${e.id} on by default`);
  for (const e of MCP_CATALOG.filter((e) => e.tier !== 'safe-readonly')) {
    assert.ok(!servers[`munder-${e.id}`], `${e.id} (${e.tier}) stays off`);
  }
});

test('a write/secret server needs an explicit yes — a default can never arm it', () => {
  assert.ok(secretEntry, 'catalog has a secret-tier server');
  const id = `munder-${secretEntry.id}`;
  // A hand-edited config that merely MENTIONS the server must not arm it...
  assert.ok(!buildMcpServers('/w', { [secretEntry.id]: { enabled: false } })[id]);
  assert.ok(!buildMcpServers('/w', {})[id]);
  // ...only an explicit true does.
  assert.ok(buildMcpServers('/w', { [secretEntry.id]: { enabled: true } })[id]);
});

test('filesystem/git are scoped to the agent cwd, never the whole disk', () => {
  assert.ok(cwdEntry, 'catalog has a cwd-scoped server');
  const servers = buildMcpServers('/work/repo', { [cwdEntry.id]: { enabled: true } });
  const args = servers[`munder-${cwdEntry.id}`].args;
  assert.ok(args.includes('/work/repo'), 'cwd substituted');
  assert.ok(!args.includes('<cwd>'), 'no placeholder survives');
});

test('an off-by-default consent map renders nothing at all for either engine', () => {
  const none = Object.fromEntries(MCP_CATALOG.map((e) => [e.id, { enabled: false }]));
  const servers = buildMcpServers('/w', none);
  assert.deepEqual(servers, {});
  // '' rather than a header — an empty bundle must leave codex's config.toml
  // byte-identical to what the hooks installer alone wrote.
  assert.equal(codexMcpToml(servers), '');
  assert.deepEqual(openCodeMcp(servers), {});
});

test('codexMcpToml emits Codex stdio tables and escapes hostile paths', () => {
  const toml = codexMcpToml({
    'munder-fs': { command: 'npx', args: ['-y', 'server', '/we"ird\\path'] },
    'munder-keyed': { command: 'uvx', args: ['s'], env: { TOKEN: 'abc' } }
  });
  assert.match(toml, /\[mcp_servers\.munder-fs\]/);
  assert.match(toml, /command = "npx"/);
  assert.match(toml, /args = \["-y", "server", "\/we\\"ird\\\\path"\]/);
  assert.match(toml, /env = \{ TOKEN = "abc" \}/);
  // No env key at all for a server that declares none — not an empty table.
  const fsBlock = toml.slice(toml.indexOf('[mcp_servers.munder-fs]'), toml.indexOf('[mcp_servers.munder-keyed]'));
  assert.ok(!fsBlock.includes('env ='), 'no empty env table');
});

test('openCodeMcp collapses command+args into one argv and renames env → environment', () => {
  const out = openCodeMcp({
    'munder-fs': { command: 'npx', args: ['-y', 'server', '/work'] },
    'munder-keyed': { command: 'uvx', args: ['s'], env: { TOKEN: 'abc' } }
  });
  assert.deepEqual(out['munder-fs'], { type: 'local', command: ['npx', '-y', 'server', '/work'], enabled: true });
  assert.deepEqual(out['munder-keyed'].environment, { TOKEN: 'abc' });
  assert.ok(!('env' in out['munder-keyed']), 'OpenCode has no `env` key — it would be dropped silently');
});

test('every wired provider is a real provider id', () => {
  const { AGENT_PROVIDER_PRESETS } = loadTs('src/shared/agentProvider.ts');
  for (const id of MCP_WIRED_PROVIDERS) {
    assert.ok(AGENT_PROVIDER_PRESETS.some((p) => p.id === id), `${id} is a known provider`);
  }
});

/**
 * The call site, not just the renderer: installCodexHooks has to be handed the
 * AGENT's cwd and the consent map. Types alone will not catch `dir` passed where
 * `meta.cwd` belongs — both are strings, and the failure is a filesystem server
 * scoped to the hive's own state folder instead of the user's repo.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('codex spawn writes the consented servers into its per-agent config.toml', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-mcp-codex-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const { HiveManager } = loadTs('src/main/hive.ts');
  const hive = new HiveManager(() => home);
  const dir = path.join(home, 'agent-dir');
  fs.mkdirSync(dir, { recursive: true });

  const codexHome = hive.installCodexHooks(dir, '/work/repo', { [cwdEntry.id]: { enabled: true } });
  const toml = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');

  assert.match(toml, new RegExp(`\\[mcp_servers\\.munder-${cwdEntry.id}\\]`), 'the enabled server is written');
  assert.ok(toml.includes('"/work/repo"'), 'scoped to the AGENT cwd, not the hive dir');
  assert.ok(!toml.includes(dir), 'the hive state dir is never handed to a filesystem server');
  assert.ok(toml.includes('[[hooks.Stop]]'), 'the lifecycle hooks it already wrote are still there');
});
