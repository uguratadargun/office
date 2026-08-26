'use strict';

/**
 * MD-146 — a woken agent is told it has mail.
 *
 * Mail is the wake signal, so the wake always SPAWNED. What it never did was
 * announce: `respawnedRecord` marks the card idle the moment `spawnPty`
 * resolves, the queue drain gates on exactly that, and the nudge was therefore
 * typed into a CLI a fifth of a second old. The pty write succeeds — there is a
 * tty, nothing is reading it — so the queue item was acknowledged and the
 * message id was already recorded as nudged. The agent sat at a prompt with an
 * unread inbox until a SECOND message arrived against a pty that was by then
 * alive.
 *
 * Two decisions carry the fix and both are pinned here: WHICH agents are
 * looking at a session that has never been told anything, and WHEN that session
 * can actually hear it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const {
  newSessions, announceDue, ANNOUNCE_QUIET_MS, ANNOUNCE_FALLBACK_MS
} = loadTs('src/renderer/src/hooks/wakeAnnounce.ts');

// ─── Which sessions are new ──────────────────────────────────────────────────

test('an agent that gains a pty it did not have is a new session', () => {
  // Wake-on-mail and the Wake button both land here: asleep (no pty) → spawned.
  const { started, sessions } = newSessions({}, [{ id: 'jim', ptyId: 'pty-jim' }]);
  assert.deepEqual(started, ['jim']);
  assert.deepEqual(sessions, { jim: 'pty-jim' });
});

test('a pty that has not changed is the same running CLI, and is not announced to again', () => {
  // This is the "delivery to a live pty is unaffected" half: an agent already
  // awake keeps taking its mail through the ordinary nudge loop.
  const { started } = newSessions({ jim: 'pty-jim' }, [{ id: 'jim', ptyId: 'pty-jim' }]);
  assert.deepEqual(started, []);
});

test('Restart & Continue re-uses the pty id, and still counts as a new session', () => {
  // kill + spawn under the SAME id: the card goes live → processless → live.
  // The intermediate tick drops it from the map, so the id reappearing is new.
  const first = newSessions({}, [{ id: 'jim', ptyId: 'pty-jim' }]);
  const dead = newSessions(first.sessions, [{ id: 'jim' }]);
  assert.deepEqual(dead.sessions, {}, 'a processless card holds no session');
  const back = newSessions(dead.sessions, [{ id: 'jim', ptyId: 'pty-jim' }]);
  assert.deepEqual(back.started, ['jim']);
});

test('a processless agent is never announced to — there is nowhere to type', () => {
  const { started, sessions } = newSessions({}, [{ id: 'jim' }, { id: 'andy', ptyId: 'pty-andy' }]);
  assert.deepEqual(started, ['andy']);
  assert.deepEqual(sessions, { andy: 'pty-andy' });
});

// ─── When the session can hear it ────────────────────────────────────────────

test('a pty that has never written a byte is not ready — that is the original bug', () => {
  // The defect exactly: announcing 200ms after spawnPty resolved.
  assert.equal(announceDue({ spawnedAt: 1000, lastOutputAt: 0, now: 1200 }), false);
  assert.equal(announceDue({ spawnedAt: 1000, lastOutputAt: undefined, now: 1200 }), false);
});

test('still booting: it has spoken, but not yet stopped', () => {
  const spawnedAt = 1000;
  const now = spawnedAt + 3000;
  assert.equal(announceDue({ spawnedAt, lastOutputAt: now - 500, now }), false);
});

test('spoken, then quiet: the prompt is up and the announce goes out', () => {
  const spawnedAt = 1000;
  const now = spawnedAt + 20_000;
  assert.equal(announceDue({ spawnedAt, lastOutputAt: now - ANNOUNCE_QUIET_MS, now }), true);
});

test('a readiness signal that never arrives costs a late announce, never a lost one', () => {
  // The parser-miss fallback: no output at all, ever. Mail must still be
  // announced — an unread inbox is the failure this card is about.
  const spawnedAt = 1000;
  assert.equal(
    announceDue({ spawnedAt, lastOutputAt: 0, now: spawnedAt + ANNOUNCE_FALLBACK_MS - 1 }),
    false);
  assert.equal(
    announceDue({ spawnedAt, lastOutputAt: 0, now: spawnedAt + ANNOUNCE_FALLBACK_MS }),
    true);
});

test('the bound outranks a pty that never stops talking', () => {
  // A CLI streaming continuously would never satisfy the quiet test.
  const spawnedAt = 1000;
  const now = spawnedAt + ANNOUNCE_FALLBACK_MS + 5_000;
  assert.equal(announceDue({ spawnedAt, lastOutputAt: now - 10, now }), true);
});

test('the fallback is not shorter than a CLI boot', () => {
  const useHive = fs.readFileSync(
    path.resolve(__dirname, '..', 'src/renderer/src/hooks/useHive.ts'), 'utf8');
  const boot = /const BOOT_GRACE_MS = ([\d_]+)/.exec(useHive);
  assert.ok(boot, 'BOOT_GRACE_MS must still exist to compare against');
  // A fallback inside the boot window fires during the very boot it exists to
  // wait out — the bug, with a delay in front of it.
  assert.ok(ANNOUNCE_FALLBACK_MS >= Number(boot[1].replace(/_/g, '')),
    `fallback ${ANNOUNCE_FALLBACK_MS} must not undercut BOOT_GRACE_MS ${boot[1]}`);
  assert.ok(ANNOUNCE_QUIET_MS < ANNOUNCE_FALLBACK_MS);
});

// ─── The wiring, pinned where it is load-bearing ─────────────────────────────

test('the announce and an ordinary delivery are the same text through the same queue', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', 'src/renderer/src/hooks/useHive.ts'), 'utf8');
  // Same constant, same enqueue — so every gate (pause, draft/menu safety,
  // cooldown, the drop-if-already-drained recheck) and the store's
  // one-pending-nudge dedupe apply to a woken agent exactly as to a live one.
  assert.match(src, /enqueueMessage\(id, INBOX_NUDGE_TEXT\)/);
  // The ordinary nudge loop must yield the agent while an announce is owed;
  // without this it enqueues into the still-booting CLI and burns the message
  // id, which is the failure being fixed.
  assert.match(src, /if \(announceOwed\.current\.has\(a\.id\)\) continue;/);
  // …and the second guard, which a live run found: a wake spawns BETWEEN #3a's
  // ticks, so for a second or two the agent has a pty #3a has not adopted and
  // `announceOwed` does not name. Without this line the ordinary loop typed the
  // nudge 1.7 s into the CLI's boot — the same defect through the other door.
  assert.match(src, /if \(sessionPty\.current\[a\.id\] !== a\.ptyId\) continue;/);
  // Readiness is read from main's live pty map, not from a terminal parser: a
  // parser only runs for a pane that is on screen, and mail must not depend on
  // which agent the user happens to be looking at.
  assert.match(src, /listPtys\(\)[\s\S]{0,400}announceDue\(/);
});
