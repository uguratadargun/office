'use strict';

/**
 * MD-114 — the zombie agent.
 *
 * Dwight (a released ephemeral worker) sat on the modern roster reading `idle`
 * with no terminal, no Wake and no Restart. The harness had torn his PTY down on
 * his `act:"done"` report; the roster entry kept `status: 'idle'` and
 * `sleeping: false`, and every "is this agent parked?" branch in both UIs asks
 * `agent.sleeping` — a flag written by exactly one path, the idle-hibernate
 * rule. So an agent that lost its process any other way matched no branch at all
 * and rendered as a healthy agent nobody could talk to.
 *
 * Two halves, both pinned here:
 *   (1) READING one — presence is derived from `ptyId`, so no surface can show a
 *       processless agent as live, and Wake reaches it.
 *   (2) CREATING one — a teardown tells the renderer, so the card cannot outlive
 *       the process it describes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const m = loadTs('src/shared/agentPresence.ts');
const model = loadTs('src/renderer/src/modern/agents/agentsModel.ts');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

/* ── (1) Reading: three states, derived from the process ────────────────── */

test('presence is decided by the PTY, and `sleeping` only names the reason', () => {
  assert.equal(m.agentPresence({ ptyId: 'pty-jim' }), 'live');
  assert.equal(m.agentPresence({ ptyId: 'pty-jim', sleeping: true }), 'live',
    'a live pty outranks a stale flag — the process is the fact');
  assert.equal(m.agentPresence({ sleeping: true }), 'asleep');
  assert.equal(m.agentPresence({}), 'parked', 'the zombie: no process, and nobody said so');
  assert.equal(m.agentPresence({ ptyId: '' }), 'parked', 'an empty id is not a process');
});

test('every control keys on PROCESSLESS, so both parked states get the same affordance', () => {
  assert.equal(m.isProcessless({ ptyId: 'pty-jim' }), false);
  assert.equal(m.isProcessless({ sleeping: true }), true);
  assert.equal(m.isProcessless({}), true);
});

test('the badge word is one word for both, but the pane copy tells the truth', () => {
  assert.equal(m.presenceWord({ ptyId: 'pty-jim' }, 'working'), 'working');
  assert.equal(m.presenceWord({ sleeping: true }, 'idle'), 'asleep');
  assert.equal(m.presenceWord({}, 'working'), 'asleep', 'a dead process is not "working"');

  const napping = m.presenceCopy({ sleeping: true });
  const zombie = m.presenceCopy({});
  assert.match(napping.title, /Asleep/);
  assert.match(napping.body, /idle window/);
  assert.match(zombie.title, /Parked/);
  assert.notEqual(zombie.title, napping.title,
    'calling a crashed agent "asleep" in the one place with room to explain is the lie MD-114 is about');
  assert.match(zombie.body, /ephemeral worker|crashed/);
  // Both must promise the same thing about what waking does, or the control
  // beside them means two different things.
  for (const c of [napping, zombie]) assert.match(c.body, /respawns it under its own id/);
});

/* ── (2) Creating one: what a teardown owes the roster ──────────────────── */

test('a teardown decides the roster edit — and stays silent for a restart', () => {
  // Hibernation broadcasts `hive:agentSleeping` itself, BEFORE the kill.
  assert.equal(m.teardownRosterEffect({ sleeping: true, worker: false }), 'sleep');
  assert.equal(m.teardownRosterEffect({ sleeping: true, worker: true }), 'sleep',
    'sleep wins: a hibernating pty is being parked, not released');
  // The MD-114 case: an ephemeral worker released after its `act:"done"`.
  assert.equal(m.teardownRosterEffect({ sleeping: false, worker: true }), 'archive');
  // A normal agent's pty ending. Restart & Continue is kill-then-spawn under the
  // SAME id, so a broadcast here would archive the card mid-restart.
  assert.equal(m.teardownRosterEffect({ sleeping: false, worker: false }), 'none');
});

/* ── The wiring. Each of these is a surface that used to ask `sleeping`. ── */

test('MAIN tells the floor when it releases a worker', () => {
  const src = read('src/main/index.ts');
  assert.match(src, /import \{ teardownRosterEffect \} from '\.\.\/shared\/agentPresence'/);
  // Read BEFORE the worktree branch deletes it, or the decision is made on a map
  // this function has already emptied.
  assert.match(src, /const wasWorker = liveWorkers\.has\(id\);/);
  assert.match(
    src,
    /teardownRosterEffect\(\{ sleeping, worker: wasWorker \}\) === 'archive'[\s\S]{0,240}?send\('hive:agentArchived', \{ id: agentId \}\)/,
    'the release path must broadcast, not just write the registry'
  );
  // Order matters: `wasWorker` has to be captured above the first delete.
  assert.ok(
    src.indexOf('const wasWorker = liveWorkers.has(id);') < src.indexOf('liveWorkers.delete(id);'),
    'wasWorker is read after the entry is already gone'
  );
});

test('Wake is gated on having no process, not on the hibernate flag', () => {
  const src = read('src/renderer/src/hooks/useRestoreTeam.ts');
  assert.match(src, /import \{ isProcessless \} from '@shared\/agentPresence'/);
  assert.match(src, /if \(!agent \|\| !isProcessless\(agent\)\) return \{ ok: false/,
    'the old `!agent?.sleeping` made Wake a silent no-op for every other way a pty dies');
  // The respawn itself already coped with a missing ptyId — that is why this is
  // a one-line gate change and not a new spawn path.
  assert.match(read('src/renderer/src/store/respawn.ts'), /ptyId: a\.ptyId \?\? `pty-\$\{a\.id\}`/);
});

test('a Wake that cannot spawn says so on screen, not into the console', () => {
  // Otherwise the fix ships the same symptom it was filed for: a button that is
  // pressed, does nothing visible, and leaves the agent where it was.
  const hook = read('src/renderer/src/hooks/useRestoreTeam.ts');
  assert.match(hook, /Promise<WakeOutcome>/);
  assert.match(hook, /return \{ ok: false, error: out\.error \?\? 'spawn failed' \}/);
  const detail = read('src/renderer/src/modern/agents/AgentDetail.tsx');
  assert.match(detail, /if \(!r\.ok\) setError\(r\.error \?\? 'spawn failed'\)/);
  assert.match(detail, /could not wake — \{error\}/);
  assert.match(detail, /text-destructive/, 'a failure must not read as ordinary muted copy');
});

test('the modern detail pane offers Wake for BOTH parked states', () => {
  const src = read('src/renderer/src/modern/agents/AgentDetail.tsx');
  assert.match(src, /isProcessless\(agent\) \? \(/);
  assert.match(src, /<Empty title=\{presenceCopy\(agent\)\.title\} action=\{<WakeButton agent=\{agent\} \/>\}>/);
  assert.doesNotMatch(src, /title="No PTY"/,
    'the dead-end pane — a title, one flat sentence and nothing to press — is what the human hit');
});

test('the modern header and the floor counter stop believing a dead status', () => {
  const detail = read('src/renderer/src/modern/agents/AgentDetail.tsx');
  // The header badge wore `agent.status` raw, one line above a pane explaining
  // the agent had no process — the card contradicting itself on screen.
  assert.match(detail, /<Badge variant=\{statusBadge\(agent\)\.tone\}[^>]*>\{statusBadge\(agent\)\.label\}<\/Badge>/);
  assert.doesNotMatch(detail, /statusTone\(agent\.status\)/);
  const app = read('src/renderer/src/modern/App.tsx');
  assert.match(app, /!isProcessless\(a\) && \(a\.status === 'working' \|\| a\.status === 'thinking'\)/,
    'the "N working" chip counted agents whose process was gone');
});

test('the pixel rail reads presence too, so the two front-ends cannot disagree', () => {
  const src = read('src/renderer/src/components/AgentStrip.tsx');
  assert.match(src, /import \{ isProcessless \} from '@shared\/agentPresence'/);
  assert.match(src, /status=\{isProcessless\(a\) \? 'sleeping' : a\.status\}/);
  assert.match(src, /sleeping=\{isProcessless\(a\)\}/, 'the card renders WAKE off this prop');
  assert.match(src, /if \(isProcessless\(a\)\) void wakeSleepingAgent\(a\.id, config\)/);
});

test('the PTY reconcile runs for BOTH UIs — it is roster truth, not pixel chrome', () => {
  const hook = read('src/renderer/src/hooks/useHive.ts');
  const app = read('src/renderer/src/App.tsx');
  assert.match(hook, /reconcileWithLivePtys\(list\.map\(\(p\) => p\.id\)\)/,
    'the modern root never ran this, so it kept every dead agent from the last session');
  assert.doesNotMatch(app, /reconcileWithLivePtys/, 'exactly one copy, in the hook both roots call');
  // It must stay AFTER the god bootstrap: reconcile drops any agent whose ptyId
  // is not in the list it captured, and god is not filed under restorable.
  assert.ok(
    hook.indexOf('// 1) Bootstrap the god agent') < hook.indexOf('reconcileWithLivePtys'),
    'reconcile must not race ahead of the bootstrap that spawns god'
  );
});

/* ── The roster view-model, end to end on the reported shape ────────────── */

test('the reported agent — released worker, status idle, no pty — reads as parked', () => {
  const dwight = { id: 'worker-md103-dwight', status: 'idle', action: 'shipping', project: 'office' };
  assert.equal(model.agentListRank(dwight), model.RANK_ASLEEP);
  assert.deepEqual(model.statusBadge(dwight), { label: 'asleep', tone: 'outline' });
  assert.equal(model.rowSubtitle(dwight), 'office');
  assert.equal(m.presenceCopy(dwight).title, 'Parked — no process');
});
