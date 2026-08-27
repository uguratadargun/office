'use strict';

/**
 * MD-165 — let the orchestrator sleep.
 *
 * `shouldHibernate` returned false for god unconditionally, so the one agent
 * with the largest context in the hive was the only one that could never park.
 * Overnight that is what the timers found: the standup, the heartbeat and the
 * breaker all write mail, mail is the wake signal, and every wake costs a
 * full-context turn on a floor where nothing had happened.
 *
 * Two halves are pinned: WHEN it may park (every clause is a reason to stay
 * awake) and WHAT may wake it (the harness's own beats may not).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const {
  shouldHibernate, shouldHibernateGod, idleHibernateMs, godIdleHibernateMs,
  DEFAULT_GOD_IDLE_HIBERNATE_MINUTES
} = loadTs('src/shared/hibernate.ts');
const {
  messageIsActionable, countActionable, isSystemSender, SYSTEM_SENDERS, ACTIONABLE_ACTS
} = loadTs('src/shared/actionableMail.ts');

const NOW = 2_000_000_000;
const IDLE = 30 * 60_000;
/** Everything clear: asleep floor, no cards, no mail, quiet for an hour. */
const parkable = () => ({
  activeCards: 0, wakingMail: 0, awakeWorkers: 0,
  lastActivityAt: NOW - 60 * 60_000, breakerArmed: false
});

/* ───────────────────────────── when it may park ──────────────────────────── */

test('the orchestrator parks once the floor is asleep and it has been quiet', () => {
  assert.equal(shouldHibernateGod(parkable(), NOW, IDLE), true);
});

test('one awake worker keeps it up — somebody may report at any moment', () => {
  assert.equal(shouldHibernateGod({ ...parkable(), awakeWorkers: 1 }, NOW, IDLE), false);
});

test('its own in-flight card, waiting mail or an armed breaker keep it up', () => {
  assert.equal(shouldHibernateGod({ ...parkable(), activeCards: 1 }, NOW, IDLE), false);
  assert.equal(shouldHibernateGod({ ...parkable(), wakingMail: 1 }, NOW, IDLE), false);
  assert.equal(shouldHibernateGod({ ...parkable(), breakerArmed: true }, NOW, IDLE), false);
});

test('it must have been quiet for the whole window', () => {
  assert.equal(shouldHibernateGod({ ...parkable(), lastActivityAt: NOW - 5 * 60_000 }, NOW, IDLE), false);
  assert.equal(shouldHibernateGod({ ...parkable(), lastActivityAt: NOW - IDLE }, NOW, IDLE), true);
});

test('0 minutes is a real off switch — the pre-MD-165 behaviour', () => {
  assert.equal(shouldHibernateGod(parkable(), NOW, 0), false);
  assert.equal(godIdleHibernateMs(0), 0);
  assert.equal(godIdleHibernateMs(undefined), DEFAULT_GOD_IDLE_HIBERNATE_MINUTES * 60_000);
});

test('the orchestrator window is its OWN setting, longer than a worker’s', () => {
  // Parking the agent every other agent reports to is a bigger call than parking
  // a worker, so the two numbers must not be one knob.
  assert.ok(godIdleHibernateMs(undefined) > idleHibernateMs(undefined));
  assert.equal(godIdleHibernateMs(5), 5 * 60_000, 'the operator can still shorten it');
});

test('the worker rule still refuses god, so there is exactly one god path', () => {
  assert.equal(shouldHibernate({
    id: 'god', isGod: true, activeCards: 0, inboxCount: 0,
    lastActivityAt: NOW - 60 * 60_000, breakerArmed: false
  }, NOW, IDLE), false);
});

/* ──────────────────────────── what may wake it ───────────────────────────── */

test('the harness talking to itself is never a wake', () => {
  for (const from of SYSTEM_SENDERS) {
    assert.equal(messageIsActionable({ from, act: 'request', requires_reply: true }), false,
      `${from} must not wake a parked orchestrator`);
  }
  // The hourly standup is exactly this shape — a scheduler `request`. It is the
  // single message the overnight audit measured, so the sender test has to come
  // FIRST and be absolute.
  assert.equal(isSystemSender('scheduler'), true);
});

test('a real agent asking something wakes it; an FYI does not', () => {
  for (const act of ACTIONABLE_ACTS) {
    assert.equal(messageIsActionable({ from: 'pam', act }), true, `${act} is somebody waiting`);
  }
  assert.equal(messageIsActionable({ from: 'pam', act: 'inform' }), false);
  // `done` counts (MD-163's reason, kept on the merge): a finished card is
  // waiting to be closed or merged, which is work for the recipient.
  assert.equal(messageIsActionable({ from: 'pam', act: 'done' }), true);
  assert.equal(messageIsActionable({ from: 'scheduler', act: 'done' }), false);
  // …but an inform someone explicitly flagged is answered mail, not a notice.
  assert.equal(messageIsActionable({ from: 'pam', act: 'inform', requires_reply: true }), true);
});

test('countActionable survives a missing or ragged inbox', () => {
  assert.equal(countActionable(null), 0);
  assert.equal(countActionable([]), 0);
  assert.equal(countActionable([{ from: 'scheduler', act: 'request' }, null, { from: 'ugur', act: 'query' }]), 1);
});

/* ─────────────────────────────── the wiring ──────────────────────────────── */

test('main gates the wake in its OWN emitter, and only for the orchestrator', () => {
  const idx = read('src/main/index.ts');
  const emitter = idx.slice(idx.indexOf('const hive = new HiveManager('), idx.indexOf('const control = new ControlRegistry'));
  assert.match(emitter, /channel === 'hive:agentWake'/);
  assert.match(emitter, /isSleepingGod\(id\) && godWakingMailCount\(\) === 0/);
  // A sleeping WORKER with mail waiting is the case hibernation was built for
  // and must still wake on anything at all.
  assert.match(emitter, /Only the ORCHESTRATOR is gated/);
  // Not in deliver(): that path belongs to MD-163 and knows neither the registry
  // nor the whole inbox.
  assert.doesNotMatch(read('src/main/hive.ts'), /isSleepingGod|godWakingMail/);
});

test('SYSTEM_SENDERS has one definition, shared', () => {
  const idx = read('src/main/index.ts');
  assert.doesNotMatch(idx, /const SYSTEM_SENDERS = new Set/,
    'a second copy would let the wake gate and the heartbeat drift apart');
  assert.match(idx, /from '\.\.\/shared\/actionableMail'/);
  // MD-163 landed a second copy in inboxNudge.ts; god ruled ONE home. It
  // re-exports so every existing importer keeps working, but owns no Set.
  const nudge = read('src/shared/inboxNudge.ts');
  assert.doesNotMatch(nudge, /new Set\(\['heartbeat'/);
  assert.match(nudge, /export \{ SYSTEM_SENDERS, isSystemSender, ACTIONABLE_ACTS \} from '\.\/actionableMail';/);
});

test('the tick judges the orchestrator on what the sweep leaves behind', () => {
  const idx = read('src/main/index.ts');
  const tick = idx.slice(idx.indexOf('function hibernateTick'), idx.indexOf('function wakeAgent'));
  assert.match(tick, /if \(a\?\.isGod\) \{ godPty = p; continue; \}/);
  // A worker parked in THIS pass is no longer awake — otherwise the last worker
  // to fall asleep buys the boss another full window of standing around.
  assert.match(tick, /awakeWorkers--; hibernatePty/);
  // Ephemeral Slack/webhook workers count as awake: one running job may report.
  assert.match(tick, /liveWorkers\.has\(p\.id\)\) \{ awakeWorkers\+\+/);
  assert.match(tick, /shouldHibernateGod\(\{/);
  assert.match(tick, /wakingMail: godWakingMailCount\(\)/);
});

test('waking mail is counted separately from heartbeat news', () => {
  const idx = read('src/main/index.ts');
  // Two questions, two functions. Collapsing them would either keep the boss
  // awake all night on FYIs or make the heartbeat blind to them.
  assert.match(idx, /function godActionableInboxCount\(\)/);
  assert.match(idx, /function godWakingMailCount\(\)/);
});

test('the orchestrator window is reachable in Settings', () => {
  assert.ok(read('src/renderer/src/modern/settings/AgentsSection.tsx').includes('id="set-god-hibernate"'));
  assert.ok(read('src/renderer/src/modern/settings/index.ts').includes("id: 'set-god-hibernate'"));
  assert.match(read('src/main/config.ts'), /godIdleHibernateMinutes\?: number;/);
});
