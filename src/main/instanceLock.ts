/**
 * One writer per hive.
 *
 * MD-139. Nothing stopped two copies of the app running against the same
 * harnessHome, and the second one's boot sweep archived the first one's live
 * agents. The registry, the inboxes, the task ledger and the worktrees are all
 * shared mutable state on disk with no arbitration at all — the only reason it
 * had not bitten before is that nobody had run two instances on one home.
 *
 * The arbitration is a lock file, `<hiveRoot>/instance.lock`, holding the pid
 * and a per-run instance id. Deliberately the simplest thing that is correct
 * here:
 *
 *   • A crash leaves the file behind, so the pid is STALE-CHECKED with signal 0
 *     (a pure existence probe) rather than trusted. An abandoned lock is taken
 *     over on the next boot, with no user action and no "delete this file" note.
 *   • Re-acquiring our own lock is a no-op, so a re-bootstrap (changeHome
 *     recovery, a second call on the same run) does not have to care.
 *   • Releasing only removes a file that still names US. A slow quit must never
 *     delete the lock of the instance that has already taken over.
 *
 * What it is not: cross-machine safe. Two machines sharing a hive over a network
 * mount can both see a pid that does not exist for them, and signal 0 cannot
 * tell you about a process on another host. That is out of scope — the failure
 * this exists for is two apps on one laptop.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** What a lock file holds. Small and human-readable — someone will read it. */
export interface LockRecord {
  pid: number;
  /** Unique per app RUN, so a recycled pid cannot look like us. */
  instanceId: string;
  startedAt: number;
  /** Which app wrote it — useful when the pid has already gone. */
  execPath?: string;
}

export type LockResult =
  | { owner: true; record: LockRecord; tookOverStale: boolean }
  | { owner: false; heldBy: LockRecord };

export interface LockDeps {
  /** Existence probe. Injected so the tests need no second process. */
  isAlive?: (pid: number) => boolean;
  pid?: number;
  instanceId: string;
  now?: () => number;
  execPath?: string;
}

/** The lock's path for a hive root. Exported so the .gitignore stays in step. */
export const LOCK_FILE = 'instance.lock';
export function lockPath(hiveRoot: string): string {
  return join(hiveRoot, LOCK_FILE);
}

function aliveDefault(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function readLock(path: string): LockRecord | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockRecord>;
    if (typeof raw.pid !== 'number' || typeof raw.instanceId !== 'string') return null;
    return { pid: raw.pid, instanceId: raw.instanceId, startedAt: raw.startedAt ?? 0, execPath: raw.execPath };
  } catch {
    return null; // missing, truncated, or hand-edited into nonsense → treat as free
  }
}

/**
 * Claim the right to write to this hive.
 *
 * A corrupt or unreadable lock counts as FREE rather than as held: the file is
 * a coordination hint, and refusing to run because someone hand-edited it would
 * turn a small mess into a dead app.
 */
export function acquireHiveLock(hiveRoot: string, deps: LockDeps): LockResult {
  const isAlive = deps.isAlive ?? aliveDefault;
  const pid = deps.pid ?? process.pid;
  const now = deps.now ?? Date.now;
  const path = lockPath(hiveRoot);

  const held = readLock(path);
  if (held) {
    // Already ours (a re-bootstrap on the same run) — idempotent, not a takeover.
    if (held.instanceId === deps.instanceId) {
      return { owner: true, record: held, tookOverStale: false };
    }
    // A live holder that is not us: we are a reader. Note the pid check comes
    // FIRST for a different instanceId — a recycled pid with a foreign id is
    // still someone else's live process only if that pid is actually alive.
    if (isAlive(held.pid)) return { owner: false, heldBy: held };
    // Dead holder: the previous run crashed or was SIGKILLed. Take over.
  }

  const record: LockRecord = {
    pid,
    instanceId: deps.instanceId,
    startedAt: now(),
    ...(deps.execPath ? { execPath: deps.execPath } : {})
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(record, null, 2), 'utf8');
  } catch {
    // Cannot write the lock (read-only volume, permissions). Claim ownership
    // anyway: refusing to run because we could not write a coordination file
    // would break the single-instance case, which is everybody's.
    return { owner: true, record, tookOverStale: !!held };
  }
  return { owner: true, record, tookOverStale: !!held };
}

/**
 * Give the lock up. Only removes a file that still names this instance — a slow
 * quit must never delete the lock of whoever has already taken over.
 */
export function releaseHiveLock(hiveRoot: string, instanceId: string): boolean {
  const path = lockPath(hiveRoot);
  const held = readLock(path);
  if (!held || held.instanceId !== instanceId) return false;
  try { rmSync(path, { force: true }); return true; } catch { return false; }
}

/** Who holds the lock right now, if anyone — for the read-only banner. */
export function currentHolder(hiveRoot: string): LockRecord | null {
  const path = lockPath(hiveRoot);
  if (!existsSync(path)) return null;
  return readLock(path);
}
