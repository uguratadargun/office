'use strict';

/**
 * The hook socket must be BINDABLE, not merely well-named.
 *
 * `sockaddr_un.sun_path` is a fixed 104-byte array on macOS. Passing a longer
 * path does not fail there — the kernel truncates it, `listen` reports success,
 * no error event fires, and the socket materialises under a mangled name partway
 * up the tree while `<hive>/hooks.sock` never exists at all. That is how a scratch
 * `--user-data-dir` run ends up with no hook telemetry and no error to explain it
 * (MD-166/MD-167), and how two hives sharing a long prefix would bleed each
 * other's agent traffic. /private/tmp/claude-501/... still had the leftover
 * truncated socket files to prove it.
 *
 * These pin the escape hatch: past the limit, fall back to a short hashed name.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { hookSockPath, MAX_UNIX_SOCK_PATH } = loadTs('src/shared/sockPath.ts');

const TMP = os.tmpdir();

test('an ordinary hive root keeps the socket beside the hive', () => {
  assert.equal(hookSockPath('/Users/ada/office/hive', 'darwin', TMP), '/Users/ada/office/hive/hooks.sock');
});

test('a root too deep for sun_path falls back to a short hashed name', () => {
  const deep = '/private/tmp/claude-501/-Users-ugur-HarnessAgents-worktrees-pam-mt310mbm'
    + '/d1a7d785-b9c3-4528-acb8-fb50b0470b62/scratchpad/md167/home/hive';
  assert.ok(`${deep}/hooks.sock`.length > MAX_UNIX_SOCK_PATH, 'fixture must actually be too long');
  const p = hookSockPath(deep, 'darwin', TMP);
  assert.notEqual(p, `${deep}/hooks.sock`);
  assert.ok(Buffer.byteLength(p) <= MAX_UNIX_SOCK_PATH, `fallback is still too long: ${p}`);
  assert.match(path.basename(p), /^md-hook-[0-9a-f]{12}\.sock$/);
});

test('the fallback is stable per root and distinct between roots', () => {
  const a = '/private/tmp/claude-501/'.padEnd(120, 'a') + '/hive';
  const b = '/private/tmp/claude-501/'.padEnd(120, 'b') + '/hive';
  assert.equal(hookSockPath(a, 'darwin', TMP), hookSockPath(a, 'darwin', TMP), 'must survive a restart');
  assert.notEqual(hookSockPath(a, 'darwin', TMP), hookSockPath(b, 'darwin', TMP),
    'two hives must never share one socket — that is crossed agent traffic');
});

test('windows still gets a named pipe, whatever the root length', () => {
  for (const root of ['C:/office/hive', 'C:/'.padEnd(200, 'x') + '/hive']) {
    assert.match(hookSockPath(root, 'win32', TMP), /^\\\\\.\\pipe\\munder-difflin-[0-9a-f]{12}$/);
  }
});

test('the fallback path actually binds, and the intended-but-long one does not survive', async () => {
  const deep = fs.mkdtempSync(path.join(os.tmpdir(), 'md167-')) + '/'.padEnd(1, '/')
    + 'a'.repeat(60) + '/hive';
  fs.mkdirSync(deep, { recursive: true });
  const p = hookSockPath(deep, process.platform, os.tmpdir());
  assert.notEqual(p, `${deep}/hooks.sock`, 'fixture must land on the fallback branch');
  try { fs.rmSync(p); } catch { /* not there */ }

  const server = net.createServer(() => {});
  await new Promise((res, rej) => { server.on('error', rej); server.listen(p, res); });
  try {
    // The real assertion: the socket exists AT THE PATH WE ASKED FOR. A truncated
    // bind reports success too — only this tells the two apart.
    assert.equal(server.address(), p, 'bound somewhere other than the path we passed');
    assert.ok(fs.existsSync(p), 'no socket file at the path we bound');
  } finally {
    await new Promise((res) => server.close(res));
    try { fs.rmSync(p); } catch { /* already gone */ }
    fs.rmSync(deep, { recursive: true, force: true });
  }
});
