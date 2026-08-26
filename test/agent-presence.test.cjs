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
  // MD-145 moved WakeButton out of AgentDetail into its own file (the terminal
  // queue needs it too, and importing it back out of AgentDetail would have
  // been a cycle). Same component, same guarantee — read it where it lives.
  const wake = read('src/renderer/src/modern/agents/WakeButton.tsx');
  assert.match(wake, /if \(!r\.ok\) setError\(r\.error \?\? 'spawn failed'\)/);
  assert.match(wake, /could not wake — \{error\}/);
  assert.match(wake, /text-destructive/, 'a failure must not read as ordinary muted copy');
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

/* ── MD-114b: a pty that dies while the app keeps running ───────────────── */

/**
 * The first pass fixed how a processless agent READS. Then the floor produced
 * the shape it did not cover: six roster entries with `sleeping: false` AND a
 * `ptyId`, with nothing alive behind that id. `isProcessless` says `live` for
 * those — correctly, the card claims a process; the card is just wrong. And
 * nothing ever looked again, because the reconcile runs once, at boot.
 *
 * The cost was not cosmetic: a wake is only ever sent to an agent the store
 * believes is asleep, so Orcun accumulated two unread inbox messages that
 * nobody could get him to read.
 */
test('MD-114b — a card claiming a dead pty is not "processless" yet, and that is the gap', () => {
  const zombie = { id: 'orcun', ptyId: 'pty-orcun', sleeping: false };
  assert.equal(m.isProcessless(zombie), false, 'presence trusts the card; only pty:list can contradict it');
  assert.equal(m.agentPresence(zombie), 'live');
});

test('MD-114b — a missing pty must be missing for a WHILE, so a restart survives', () => {
  const agents = [
    { id: 'live', ptyId: 'pty-live' },
    { id: 'orcun', ptyId: 'pty-orcun' },
    { id: 'napping', sleeping: true },
    { id: 'parked' }
  ];
  const LIVE = ['pty-live'];
  const T0 = 1_000_000;

  // Restart & Continue is killPty(id) then spawnPty({id}): between those awaits
  // the id is legitimately absent. The first sighting must NEVER park.
  const first = m.scanDeadPtys(agents, LIVE, {}, T0);
  assert.deepEqual(first.park, [], 'a fresh miss is what a restart looks like from here');
  assert.deepEqual(first.missingSince, { orcun: T0 });

  // Scanning again IMMEDIATELY must not park either — and this is the case a
  // strike COUNT got wrong: the loop also scans on window focus, and two focus
  // events can land a second apart, straddling a restart.
  const rapid = m.scanDeadPtys(agents, LIVE, first.missingSince, T0 + 900);
  assert.deepEqual(rapid.park, [], 'two fast scans are not evidence of anything');
  assert.deepEqual(rapid.missingSince, { orcun: T0 }, 'the clock starts at the FIRST miss, not the last');

  // Still gone once the minimum age has passed — now it is real.
  const aged = m.scanDeadPtys(agents, LIVE, first.missingSince, T0 + m.MIN_PARK_AGE_MS);
  assert.deepEqual(aged.park, ['orcun']);
  assert.deepEqual(aged.missingSince, {}, 'a parked id stops being tracked');

  // …and an id that comes back alive drops its timestamp rather than banking
  // it, so a flapping pty can never age its way to a park.
  const recovered = m.scanDeadPtys(agents, ['pty-live', 'pty-orcun'], first.missingSince, T0 + 60_000);
  assert.deepEqual(recovered.park, []);
  assert.deepEqual(recovered.missingSince, {});
});

test('MD-114b — the pane stops claiming the idle window for an agent that DIED', () => {
  // Parking sets `sleeping: true` — it has to, that flag is what makes mail
  // wake the agent — so `sleeping` alone can no longer answer "why". Without
  // the action, killing an agent's CLI from a terminal produced a pane calmly
  // explaining it had been shut down after the idle window: the same lie one
  // layer down. Verified in the packaged app.
  const hibernated = m.presenceCopy({ sleeping: true, action: 'sleeping' });
  const died = m.presenceCopy({ sleeping: true, action: m.PARKED_ACTION });
  assert.match(hibernated.body, /idle window/);
  assert.match(hibernated.title, /Asleep/);
  assert.match(died.title, /Parked/);
  assert.doesNotMatch(died.body, /idle window/);
  assert.equal(m.PARKED_ACTION, 'session ended');
});

test('MD-114b — the scan never touches an agent that is already parked or asleep', () => {
  // Those are the FIRST pass's states. Re-parking them would rewrite `action`
  // on every poll and churn the roster file for nothing.
  const out = m.scanDeadPtys([{ id: 'napping', sleeping: true }, { id: 'parked' }], [], {}, 1_000_000);
  assert.deepEqual(out.park, []);
  assert.deepEqual(out.missingSince, {});
  // A sleeping agent that still carries a stale ptyId is also left alone — it
  // must not even collect a strike, or two polls later it is parked all over
  // again and its `action` is rewritten under the user every 15 seconds.
  const sleepy = [{ id: 'x', ptyId: 'pty-x', sleeping: true }];
  const s1 = m.scanDeadPtys(sleepy, [], {}, 1_000_000);
  assert.deepEqual(s1, { missingSince: {}, park: [] });
  const s2 = m.scanDeadPtys(sleepy, [], s1.missingSince, 1_099_999);
  assert.deepEqual(s2, { missingSince: {}, park: [] });
});

test('MD-114b — the reported floor: the scan picks exactly the agents with no process', () => {
  // The roster god read off disk, verbatim in shape: pam/jim/god alive, the
  // rest holding a `pty-<id>` with nothing behind it.
  const roster = [
    { id: 'god', ptyId: 'pty-god' },
    { id: 'pam-mt310mbm', ptyId: 'pty-pam-mt310mbm', sleeping: false },
    { id: 'ryan-mt30ypdj', sleeping: true },
    { id: 'jim-mt2yvlbg', ptyId: 'pty-jim-mt2yvlbg', sleeping: false },
    { id: 'munder-developer-mt2szzlu', sleeping: true },
    { id: 'orcun-mt2y57jx', ptyId: 'pty-orcun-mt2y57jx', sleeping: false },
    { id: 'worker-md91-toby', sleeping: true },
    { id: 'worker-md103-dwight', ptyId: 'pty-worker-md103-dwight', sleeping: false }
  ];
  const alive = ['pty-god', 'pty-pam-mt310mbm', 'pty-jim-mt2yvlbg'];
  const one = m.scanDeadPtys(roster, alive, {}, 1_000_000);
  const two = m.scanDeadPtys(roster, alive, one.missingSince, 1_000_000 + m.MIN_PARK_AGE_MS);
  assert.deepEqual(two.park.sort(), ['orcun-mt2y57jx', 'worker-md103-dwight']);
  // The three already-asleep ones are not re-parked, and nothing alive is touched.
  for (const id of ['god', 'pam-mt310mbm', 'jim-mt2yvlbg', 'ryan-mt30ypdj']) {
    assert.ok(!two.park.includes(id), `${id} must not be parked`);
  }
});

test('MD-114b — the roster keeps the card and marks it SLEEPING, not restorable', () => {
  const store = read('src/renderer/src/store/store.ts');
  // Read the ACTION BODY, not a window of the file: the next action along also
  // mentions these words, and a loose window would pass on its text.
  const start = store.indexOf('parkDeadAgents: (ids) =>');
  assert.ok(start > 0, 'the store must expose the action at all');
  const body = store.slice(start, store.indexOf('  sleepAgent: (id) =>', start));
  assert.ok(body.length > 200 && body.length < 2500, 'body slice looks wrong');
  // Sleeping is the state the hive already knows how to end by itself: main
  // broadcasts `hive:agentWake` when anything is sent to a sleeping agent.
  assert.match(body, /sleeping: true,\s*\n\s*ptyId: undefined,/);
  assert.match(body, /action: PARKED_ACTION,/,
    'worth telling apart from the hibernate rule, which is a decision rather than a death');
  // The card must NOT leave `agents` — `restorable` is the previous session's
  // team, behind a button; this agent is on the team now and has mail waiting.
  assert.doesNotMatch(body, /restorableAgents/);
  assert.doesNotMatch(body, /filter\(/, 'parking keeps the card; it never removes one');
});

test('MD-114b — the roster re-checks for as long as the window is open', () => {
  const hook = read('src/renderer/src/hooks/useHive.ts');
  assert.match(hook, /import \{ scanDeadPtys \} from '@shared\/agentPresence'/);
  assert.match(hook, /window\.setInterval\(\(\) => \{ void scan\(\); \}, PTY_LIVENESS_POLL_MS\)/,
    'the boot-time reconcile runs ONCE; a pty that dies afterwards was never noticed');
  assert.match(hook, /window\.addEventListener\('focus', onFocus\)/,
    'coming back to the window is when a laptop-sleep has just ended');
  assert.match(hook, /window\.clearInterval\(timer\)[\s\S]{0,80}removeEventListener\('focus', onFocus\)/,
    'an interval that outlives its effect is a leak per reload');
  // Carrying the first-miss timestamps forward IS the minimum-age rule.
  assert.match(hook, /missingSince = out\.missingSince;/);
});

test('MD-114b — neither UI has a control that is enabled and does nothing', () => {
  // The pixel Command Center returned early on `!a.ptyId`, so "restart &
  // continue" on a parked agent was a live button with no effect and no error —
  // the same silent dead end MD-109 fixed for archive.
  // MD-115 lifted the respawn into `@shared/restartAgent`, so these invariants
  // moved with it — same four facts, now asserted once at their new home plus
  // at each call site's gate, instead of twice against two copies.
  const shared = read('src/shared/restartAgent.ts');
  assert.match(shared, /export function respawnPtyId[\s\S]{0,200}return agent\.ptyId \?\? `pty-\$\{agent\.id\}`;/,
    'a parked agent respawns under the id it WOULD have had, or the resume reattaches to nobody');
  assert.match(shared, /export function needsKill[\s\S]{0,120}return !!agent\.ptyId;/,
    'a parked agent has no process to stop first');
  assert.match(shared, /ptyId,\n\s*command,/,
    'a revived agent holds a process again — the id goes in the same write as the rest');
  assert.match(shared, /sleeping: false,\n\s*archived: false,/,
    'and so do the flags that made it parked');

  const ccp = read('src/renderer/src/components/CommandCenterPanel.tsx');
  assert.doesNotMatch(ccp, /if \(!a\.ptyId\) return;/);
  assert.match(ccp, /const ptyId = respawnPtyId\(a\);/);
  assert.match(ccp, /const killed = spawn\.needsKill\s*\n\s*\? await window\.cth\.killPty\(ptyId\)/,
    'there is nothing to kill, and a failed kill must not abort the spawn');
  // Archive works on a parked entry in BOTH UIs (MD-109's shared action).
  for (const f of [
    'src/renderer/src/components/AgentDetailPanel.tsx',
    'src/renderer/src/components/FullscreenTerminal.tsx',
    'src/renderer/src/modern/agents/AgentDetail.tsx'
  ]) assert.match(read(f), /endSessionAndArchive/, `${f} must not gate archive on a live pty`);
  // And the modern roster reaches the same respawn, gate included — a helper
  // that only worked for half its callers would be the duplicate coming back.
  const overview = read('src/renderer/src/modern/agents/AgentsOverview.tsx');
  assert.doesNotMatch(overview, /if \(!a\.ptyId \|\| !config\) return;/);
  assert.match(overview, /const killed = spawn\.needsKill/);
  assert.match(overview, /respawnPtyId/);
});
