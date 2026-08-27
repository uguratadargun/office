/**
 * Where the hook shim's IPC endpoint lives.
 *
 * Pure so both the main process (`HookServer.listen`) and the tests can ask the
 * same question. The value also rides out to every spawned agent as `HIVE_SOCK`,
 * so server and shim always derive it from this one function.
 */
import { createHash } from 'node:crypto';

/**
 * The usable length of a Unix-domain socket path, in bytes.
 *
 * `sockaddr_un.sun_path` is a FIXED char array — 104 bytes on macOS/BSD, 108 on
 * Linux — and the platforms disagree on what happens when a longer path is
 * passed: Linux rejects the bind with ENAMETOOLONG, while macOS TRUNCATES
 * silently. Truncation is the dangerous one. The server binds, `listen` reports
 * success, no error event fires — and the socket appears under a mangled name
 * (the path cut mid-component) somewhere up the tree, while `<hive>/hooks.sock`
 * never exists. It is invisible: the shim builds its connect path from the same
 * long string and truncates it identically, so hooks appear to work on the same
 * machine, right up until two hive roots share their first ~103 bytes and start
 * bleeding each other's agent traffic. `stop()` then unlinks the path it MEANT
 * to bind, so the real socket file is never cleaned up either — a scratch-profile
 * run leaves one behind every launch.
 *
 * 100 rather than 104: leave room for the NUL and for the small differences
 * between what a caller passes and what the kernel is handed.
 */
export const MAX_UNIX_SOCK_PATH = 100;

/** A stable, collision-resistant short name for one hive root. */
function rootHash(root: string): string {
  return createHash('sha1').update(root).digest('hex').slice(0, 12);
}

/**
 * The socket path for a hive root.
 *
 * - Windows: a named pipe. `net`'s IPC there is the flat `\\.\pipe\` namespace,
 *   not the filesystem, so a raw file path fails to bind with EACCES.
 * - POSIX, ordinary depth: `<root>/hooks.sock` — beside the hive it serves,
 *   where an operator can find it and where a hive folder move takes it along.
 * - POSIX, too deep for `sun_path`: a hashed name in the temp dir. Keyed on the
 *   root, so it is stable across restarts and distinct per hive; short enough
 *   that the kernel takes it whole. This is the branch a scratch
 *   `--user-data-dir` (deep temp paths) and a deeply nested home both land on.
 */
export function hookSockPath(root: string, platform: string, tmpDir: string): string {
  if (platform === 'win32') return `\\\\.\\pipe\\munder-difflin-${rootHash(root)}`;
  const beside = `${root}/hooks.sock`;
  if (Buffer.byteLength(beside) <= MAX_UNIX_SOCK_PATH) return beside;
  return `${tmpDir.replace(/\/+$/, '')}/md-hook-${rootHash(root)}.sock`;
}
