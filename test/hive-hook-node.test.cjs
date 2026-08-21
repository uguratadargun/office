'use strict';

/**
 * Hooks run under `/bin/sh` with a bare PATH (`/usr/bin:/bin:…`). A hook command
 * of `node "<shim>"` therefore exits 127 — "node: command not found" — on every
 * machine where node lives in a shell-managed prefix (nvm, volta, Homebrew).
 *
 * The fix is `<hive>/bin/hive-node`: a one-line wrapper around Electron's OWN
 * bundled node (`ELECTRON_RUN_AS_NODE=1 exec "<execPath>"`). Every hook installer
 * must route through it.
 *
 * A wrapper SCRIPT rather than an inline `ELECTRON_RUN_AS_NODE=1 "<exe>" …`
 * prefix, because that prefix is POSIX-sh syntax and a hard error under cmd.exe —
 * which is what runs hook commands on Windows.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const loadTs = require('./load-ts.cjs');

const { HiveManager } = loadTs('src/main/hive.ts');

const POSIX = process.platform !== 'win32';
const STRIPPED_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'md-hive-node-'));
}

const launcherIn = (home) =>
  path.join(home, 'hive', 'bin', POSIX ? 'hive-node' : 'hive-node.cmd');

/** Every file under `dir`. */
function walk(dir, out = []) {
  for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Sweep every config an installer wrote for commands that invoke one of our
 *  shims. Path-agnostic on purpose, so a new installer cannot be missed. */
function hookCommandsUnder(home) {
  const shim = /(cth-hook\.cjs|agy-hook\.cjs|grok-hook\.cjs)/;
  const found = [];
  for (const file of walk(home)) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (!shim.test(text)) continue;
    // JSON hook configs: "command": "<…>"      TOML (codex): command = '<…>'
    for (const m of text.matchAll(/"command"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) found.push(JSON.parse(`"${m[1]}"`));
    for (const m of text.matchAll(/command = '([^']+)'/g)) found.push(m[1]);
  }
  return found.filter((c) => shim.test(c));
}

const usesLauncher = (cmd, launcher) => cmd.startsWith(launcher) || cmd.startsWith(`"${launcher}"`);

async function run(cmd, env) {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', cmd], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    // Two of the commands below are CONTROLS that never read stdin and exit at
    // once — `command -v node`, and bare `node "<shim>"` exiting 127. Writing the
    // payload into a pipe whose reader has already gone is EPIPE, and an
    // unhandled 'error' on a stream is an uncaughtException, which node's test
    // runner charges to whatever test is in flight. That is the whole flake: the
    // window between dispatching this write and the child's exit widens under a
    // loaded machine, so it only ever showed up in the full parallel suite.
    // The payload is moot for a child that is already gone; only the exit code is.
    child.stdin.on('error', () => { /* child exited before reading stdin */ });
    child.stdin.end(JSON.stringify({ hook_event_name: 'Stop', session_id: 's1' }));
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

test('ensureHive writes an executable bundled-node launcher', async (t) => {
  const home = tmpHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'a1', name: 'A', provider: 'claude', cwd: home });

  const launcher = launcherIn(home);
  assert.equal(fs.existsSync(launcher), true);
  const body = fs.readFileSync(launcher, 'utf8');
  assert.match(body, /ELECTRON_RUN_AS_NODE=1/, 'without this the binary opens a second app window');
  assert.ok(body.includes(process.execPath), 'execPath is re-baked each bootstrap so an app move/update heals');
  if (POSIX) assert.ok(fs.statSync(launcher).mode & 0o111, 'must be executable');
});

test('the claude hook + statusLine commands run through the launcher', async (t) => {
  const home = tmpHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'a1', name: 'A', provider: 'claude', cwd: home });

  const launcher = launcherIn(home);
  const settings = JSON.parse(fs.readFileSync(path.join(home, 'hive/agents/a1/settings.json'), 'utf8'));
  const commands = [
    ...Object.values(settings.hooks).flatMap((matchers) => matchers.flatMap((m) => m.hooks.map((h) => h.command))),
    settings.statusLine.command
  ];

  assert.ok(commands.length > 0);
  for (const cmd of commands) assert.equal(usesLauncher(cmd, launcher), true, cmd);
});

test('every hook installer routes through the launcher — none left on bare node', async (t) => {
  const home = tmpHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'a1', name: 'A', provider: 'claude', cwd: home });

  // agy and grok install into the USER's home. Redirect it, and refuse to run
  // rather than write into the developer's real ~/.gemini / ~/.grok.
  const realHome = process.env.HOME;
  const realProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  t.after(() => {
    if (realHome === undefined) delete process.env.HOME; else process.env.HOME = realHome;
    if (realProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = realProfile;
  });
  assert.equal(os.homedir(), home, 'home redirect failed — aborting before touching the real home');

  hive.installAgyHooks();
  hive.installGrokHooks();
  hive.installCodexHooks(path.join(home, 'hive/agents/a1'));

  const launcher = launcherIn(home);
  const commands = hookCommandsUnder(home);
  // claude (Stop/statusLine/…) + agy + grok + codex.
  assert.ok(commands.length >= 4, `expected commands from all installers, got ${commands.length}`);
  const bare = commands.filter((c) => !usesLauncher(c, launcher));
  assert.deepEqual(bare, [], 'these hook commands would exit 127 wherever node is not on the bare PATH');

  for (const shim of ['agy-hook.cjs', 'grok-hook.cjs']) {
    assert.ok(commands.some((c) => c.includes(shim)), `${shim} installer produced no command`);
  }
});

test('a hook fires with NO node on PATH, and its payload reaches HIVE_SOCK', { skip: !POSIX }, async (t) => {
  const home = tmpHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'a1', name: 'A', provider: 'claude', cwd: home });

  const sock = path.join(home, 'hive', 'hooks.sock');
  try { fs.unlinkSync(sock); } catch { /* not there */ }

  const received = [];
  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('error', () => { /* the shim may hang up first */ });
    conn.on('data', (d) => { buf += d; });
    // The shim writes its payload and waits for OUR end() — it never half-closes,
    // so the payload is only complete on 'close', not 'end'.
    conn.on('close', () => { if (buf) received.push(buf); });
    conn.write(JSON.stringify({ ok: true }) + '\n', () => conn.end());
  });
  server.on('error', () => { /* keep a socket error out of the test process */ });
  await new Promise((resolve) => server.listen(sock, resolve));
  t.after(() => server.close());

  const env = { PATH: STRIPPED_PATH, HIVE_SOCK: sock, AGENT_ID: 'a1', HOME: home };
  const shim = path.join(home, 'hive/bin/cth-hook.cjs');

  // Control: the command shape used before the fix. Only meaningful if node is
  // genuinely absent from the stripped PATH (it is on a dev machine using nvm,
  // volta or Homebrew; it is not on an image with /usr/bin/node).
  const probe = await run('command -v node', env);
  if (probe.code !== 0) {
    const before = await run(`node "${shim}"`, env);
    assert.equal(before.code, 127, 'the bug: bare `node` is not resolvable from a hook');
  }

  // NOTE: async spawn, not spawnSync — the shim connects back to a socket THIS
  // process is serving, so a sync call would block our own event loop and
  // deadlock the handshake.
  const settings = JSON.parse(fs.readFileSync(path.join(home, 'hive/agents/a1/settings.json'), 'utf8'));
  const after = await run(settings.hooks.Stop[0].hooks[0].command, env);
  assert.equal(after.code, 0, `hook failed under a stripped PATH: ${after.stderr}`);

  // Poll for the payload instead of sleeping a fixed 300ms. The shim's socket
  // write races the assertion, and under load (the full suite, a concurrent
  // typecheck) it loses — this test was the intermittent 1-in-N red in
  // `npm run test:focused`. Same worst case, no fixed deadline to lose.
  const deadline = Date.now() + 5000;
  while (received.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(received.length > 0, 'nothing arrived at HIVE_SOCK');
  assert.match(received[0], /"hook_event_name"\s*:\s*"Stop"/);
});
