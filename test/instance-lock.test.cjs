'use strict';

/**
 * MD-139 — two apps, one hive, three agents archived out from under a running app.
 *
 * A second copy of the app was launched against a scratch profile whose fresh
 * config still pointed at the REAL harnessHome. Forty seconds later its boot
 * sweep archived Pam, Andy and Jim, because the sweep's rule was "archived:false
 * with no live PTY is a stale carry-over" — and from inside a process that has
 * just started, NOBODY has a live PTY. The owning instance then read its own
 * agents back as archived and stopped hibernating them.
 *
 * Two contracts are pinned here, and they are different in kind:
 *   • OWNERSHIP — exactly one instance may write to a hive, decided by a lock
 *     file that is stale-checked rather than trusted, and released only by whoever
 *     still holds it.
 *   • LIVENESS OVER FLAGS — a live PTY mapped to an agent outranks a persisted
 *     `archived: true` that agent never earned.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { acquireHiveLock, releaseHiveLock, currentHolder, lockPath } = loadTs('src/main/instanceLock.ts');
const { orphansToArchive, hibernateEligible, mayMutateHive, ownershipBanner, OWNERSHIP_BANNER_HINT } =
  loadTs('src/shared/hiveOwnership.ts');

/** A throwaway hive root per test — the lock is a real file, so use real files. */
function hive() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md139-'));
  return path.join(dir, 'hive');
}
const ALIVE = () => true;
const DEAD = () => false;

// ─── the lock ────────────────────────────────────────────────────────────────

test('a free hive is claimed, and the lock says who holds it', () => {
  const root = hive();
  const res = acquireHiveLock(root, { instanceId: 'a', pid: 4242, isAlive: DEAD });
  assert.equal(res.owner, true);
  assert.equal(res.tookOverStale, false);
  const held = currentHolder(root);
  assert.equal(held.pid, 4242);
  assert.equal(held.instanceId, 'a');
  assert.ok(fs.existsSync(lockPath(root)), 'the lock is a real file someone can read');
});

test('a LIVE holder makes the second instance a reader', () => {
  const root = hive();
  acquireHiveLock(root, { instanceId: 'first', pid: 111, isAlive: ALIVE });
  const second = acquireHiveLock(root, { instanceId: 'second', pid: 222, isAlive: ALIVE });
  assert.equal(second.owner, false);
  assert.equal(second.heldBy.pid, 111);
  assert.equal(currentHolder(root).instanceId, 'first', 'a reader must not overwrite the lock');
});

test('a STALE lock (the holder crashed) is taken over without asking anyone', () => {
  const root = hive();
  acquireHiveLock(root, { instanceId: 'crashed', pid: 111, isAlive: ALIVE });
  const next = acquireHiveLock(root, { instanceId: 'fresh', pid: 222, isAlive: DEAD });
  assert.equal(next.owner, true);
  assert.equal(next.tookOverStale, true, 'and it says so, so the log explains itself');
  assert.equal(currentHolder(root).instanceId, 'fresh');
});

test('re-acquiring our own lock is idempotent, not a takeover', () => {
  const root = hive();
  acquireHiveLock(root, { instanceId: 'me', pid: 1, isAlive: ALIVE });
  // A re-bootstrap on the same run (changeHome recovery) must not read as a
  // second instance fighting itself.
  const again = acquireHiveLock(root, { instanceId: 'me', pid: 1, isAlive: ALIVE });
  assert.equal(again.owner, true);
  assert.equal(again.tookOverStale, false);
});

test('a recycled pid with a foreign instance id is still someone else — while it lives', () => {
  const root = hive();
  acquireHiveLock(root, { instanceId: 'old-run', pid: 999, isAlive: ALIVE });
  // Same pid, different run: the id is what tells the two apart.
  const other = acquireHiveLock(root, { instanceId: 'new-run', pid: 999, isAlive: ALIVE });
  assert.equal(other.owner, false, 'a live pid we did not write is not ours to take');
});

test('a corrupt lock counts as FREE — a hand-edited file must not brick the app', () => {
  const root = hive();
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(lockPath(root), 'not json at all', 'utf8');
  const res = acquireHiveLock(root, { instanceId: 'a', pid: 7, isAlive: ALIVE });
  assert.equal(res.owner, true);
});

test('release removes only OUR lock', () => {
  const root = hive();
  acquireHiveLock(root, { instanceId: 'mine', pid: 1, isAlive: ALIVE });
  assert.equal(releaseHiveLock(root, 'someone-else'), false, 'never delete the taker-over\'s lock');
  assert.ok(fs.existsSync(lockPath(root)));
  assert.equal(releaseHiveLock(root, 'mine'), true);
  assert.equal(currentHolder(root), null);
});

test('releasing a hive we never locked is a no-op, not an error', () => {
  assert.equal(releaseHiveLock(hive(), 'nobody'), false);
});

test('after a release the next instance is a normal owner, not a stale takeover', () => {
  const root = hive();
  acquireHiveLock(root, { instanceId: 'first', pid: 1, isAlive: ALIVE });
  releaseHiveLock(root, 'first');
  const next = acquireHiveLock(root, { instanceId: 'second', pid: 2, isAlive: ALIVE });
  assert.equal(next.owner, true);
  assert.equal(next.tookOverStale, false, 'a clean handover leaves nothing to explain');
});

// ─── the sweep ───────────────────────────────────────────────────────────────

const FLEET = {
  god: { archived: false, isGod: true },
  pam: { archived: false },
  andy: { archived: false },
  jim: { archived: false },
  ghost: { archived: false }      // really did quit without archiving
};

test('the owner archives only the agents with no live PTY, and never god', () => {
  const live = new Set(['pam', 'andy', 'jim']);
  const out = orphansToArchive({
    agents: FLEET, godId: 'god', hasLivePty: (id) => live.has(id), isOwner: true
  });
  assert.deepEqual(out, ['ghost']);
});

test('THE MD-139 BUG: a second instance sweeps nothing, even though it owns no PTYs', () => {
  // This is the exact state that archived three live agents: a process that has
  // just booted, so `hasLivePty` is false for everything.
  const out = orphansToArchive({
    agents: FLEET, godId: 'god', hasLivePty: () => false, isOwner: false
  });
  assert.deepEqual(out, [], '"no live PTY here" never meant "no live PTY anywhere"');
});

test('the same input from the OWNER does sweep — the guard is ownership, not caution', () => {
  const out = orphansToArchive({
    agents: FLEET, godId: 'god', hasLivePty: () => false, isOwner: true
  });
  assert.deepEqual(out.sort(), ['andy', 'ghost', 'jim', 'pam']);
});

test('already-archived agents are not swept again', () => {
  const out = orphansToArchive({
    agents: { a: { archived: true } }, godId: 'god', hasLivePty: () => false, isOwner: true
  });
  assert.deepEqual(out, []);
});

test('a hive with no god still sweeps correctly', () => {
  const out = orphansToArchive({
    agents: { a: { archived: false } }, godId: null, hasLivePty: () => false, isOwner: true
  });
  assert.deepEqual(out, ['a']);
});

// ─── liveness over flags ─────────────────────────────────────────────────────

test('a live PTY outranks a stale archived:true — the agent still sleeps', () => {
  // Exactly the state MD-139 left behind: registry says archived, roster and PTY
  // say running. Before this, hibernateTick skipped it and it never slept.
  assert.equal(hibernateEligible({ archived: true }, true), true);
});

test('an ordinary live agent is eligible', () => {
  assert.equal(hibernateEligible({ archived: false }, true), true);
});

test('no registry entry means it is not a hive agent at all', () => {
  assert.equal(hibernateEligible(undefined, true), false);
});

test('no live PTY, nothing to put to sleep', () => {
  assert.equal(hibernateEligible({ archived: false }, false), false);
});

// ─── read-only mode ──────────────────────────────────────────────────────────

test('only the owner may mutate the hive', () => {
  assert.equal(mayMutateHive(true), true);
  assert.equal(mayMutateHive(false), false);
});

test('the banner names the holder when it can, and still says the useful half when it cannot', () => {
  assert.match(ownershipBanner(4242), /pid 4242/);
  assert.match(ownershipBanner(4242), /read-only/);
  assert.match(ownershipBanner(null), /Another Office instance owns this workspace/);
  assert.doesNotMatch(ownershipBanner(null), /pid/, 'no "pid null" in front of a human');
});

test('both windows describe one lock the same way (MD-152)', () => {
  // The classic UI had no banner at all, so opening a second copy there put the
  // human back in the afternoon MD-139 was meant to end. Both draw it now — and
  // the follow-up sentence is shared, because two copies of a sentence about
  // ownership is how two windows start saying different things about one lock.
  const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
  for (const rel of [
    'src/renderer/src/components/ReadOnlyBanner.tsx',
    'src/renderer/src/modern/components/ReadOnlyBanner.tsx'
  ]) {
    const src = read(rel);
    assert.match(src, /OWNERSHIP_BANNER_HINT/, `${rel}: uses the shared sentence`);
    assert.match(src, /window\.cth\.hiveOwnership\?\.\(\)/, `${rel}: same one-shot read`);
    // Renders nothing for the single-instance case, which is everybody's.
    assert.match(src, /if \(!message\) return null;/, `${rel}: silent when we own it`);
  }
  // Mounted above every view in both shells.
  assert.match(read('src/renderer/src/App.tsx'), /<ReadOnlyBanner \/>/);
  assert.match(read('src/renderer/src/modern/App.tsx'), /<ReadOnlyBanner \/>/);
  assert.ok(OWNERSHIP_BANNER_HINT.includes('keep running'), 'says the agents are not the casualty');
});
