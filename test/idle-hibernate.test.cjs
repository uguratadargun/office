'use strict';

/**
 * Hibernation's only real failure mode is sleeping an agent that was still
 * working, so each test here pins ONE guard that keeps a session alive.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { shouldHibernate, idleHibernateMs, DEFAULT_IDLE_HIBERNATE_MINUTES, hasTerminalSurface } =
  loadTs('src/shared/hibernate.ts');

const NOW = 1_700_000_000_000;
const TEN_MIN = 10 * 60_000;

/** An agent with nothing in flight, quiet for `quietMs`. */
const idle = (quietMs, over = {}) => ({
  id: 'jim',
  activeCards: 0,
  inboxCount: 0,
  breakerArmed: false,
  lastActivityAt: NOW - quietMs,
  ...over
});

test('a quiet agent past the window sleeps', () => {
  assert.equal(shouldHibernate(idle(TEN_MIN), NOW, TEN_MIN), true);
  assert.equal(shouldHibernate(idle(TEN_MIN + 1), NOW, TEN_MIN), true);
});

test('a quiet agent inside the window does not', () => {
  assert.equal(shouldHibernate(idle(TEN_MIN - 1), NOW, TEN_MIN), false);
  assert.equal(shouldHibernate(idle(0), NOW, TEN_MIN), false);
});

test('god is never hibernated, however long he sits', () => {
  assert.equal(shouldHibernate(idle(TEN_MIN * 100, { isGod: true }), NOW, TEN_MIN), false);
});

test('an in-flight card keeps the session alive', () => {
  // The agent may be thinking for minutes without printing a byte; a doing/blocked
  // card is the difference between "quiet" and "finished".
  assert.equal(shouldHibernate(idle(TEN_MIN * 3, { activeCards: 1 }), NOW, TEN_MIN), false);
});

test('an inbox backlog keeps the session alive', () => {
  // Work is already waiting — sleeping now would mean waking immediately.
  assert.equal(shouldHibernate(idle(TEN_MIN * 3, { inboxCount: 1 }), NOW, TEN_MIN), false);
});

test('a breaker-armed agent keeps the session alive', () => {
  assert.equal(shouldHibernate(idle(TEN_MIN * 3, { breakerArmed: true }), NOW, TEN_MIN), false);
});

test('idleMs of 0 is a real off switch, not a very long timeout', () => {
  assert.equal(shouldHibernate(idle(TEN_MIN * 1000), NOW, 0), false);
  assert.equal(idleHibernateMs(0), 0);
  assert.equal(idleHibernateMs(-5), 0);
});

test('minutes convert to a window, and an unset setting takes the default', () => {
  assert.equal(idleHibernateMs(10), TEN_MIN);
  assert.equal(idleHibernateMs(1), 60_000);
  assert.equal(idleHibernateMs(undefined), DEFAULT_IDLE_HIBERNATE_MINUTES * 60_000);
});

test('every guard is independent — one active signal is enough to stay awake', () => {
  const guards = [{ activeCards: 2 }, { inboxCount: 3 }, { breakerArmed: true }, { isGod: true }];
  for (const g of guards) {
    assert.equal(shouldHibernate(idle(TEN_MIN * 5, g), NOW, TEN_MIN), false, JSON.stringify(g));
  }
  assert.equal(shouldHibernate(idle(TEN_MIN * 5), NOW, TEN_MIN), true, 'control: none of them set');
});

// ── the wake trigger, through the real router ────────────────────────────────
// The predicate above decides WHEN to sleep; this is the other half — that mail
// actually announces itself, for every route the orchestrator uses. Driven
// through the real HiveManager rather than a stub, because the bug this guards
// against ("the agent slept and nothing ever woke it") lives in the routing, not
// in the predicate.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { HiveManager } = loadTs('src/main/hive.ts');

/** A hive on a temp home with two registered agents, recording every emit. */
async function floor(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-hibernate-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const events = [];
  const hive = new HiveManager(() => home, (channel, payload) => { events.push({ channel, payload }); });
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true }, {});
  await hive.ensureAgent({ id: 'jim', name: 'Jim', provider: 'claude', cwd: home }, {});
  const wakes = () => events.filter((e) => e.channel === 'hive:agentWake').map((e) => e.payload.id);
  return { home, hive, wakes };
}

test('a message delivered to an agent announces a wake for THAT agent', async (t) => {
  const { hive, wakes } = await floor(t);
  hive.send({ to: 'jim', act: 'request', subject: 'MD-99', body: 'do the thing' }, 'god');
  assert.deepEqual(wakes(), ['jim']);
});

test('the outbox drain wakes too — that is how god actually dispatches', async (t) => {
  // god writes into his OWN outbox and the router moves it; if only `send` fired
  // the wake, every real dispatch would land in a sleeping agent's inbox unheard.
  const { home, hive, wakes } = await floor(t);
  fs.writeFileSync(
    path.join(home, 'hive', 'agents', 'god', 'outbox', 'dispatch.json'),
    JSON.stringify({ to: 'jim', act: 'request', subject: 'MD-99', body: 'do the thing' }),
    'utf8'
  );
  hive.routeOnce();
  assert.deepEqual(wakes(), ['jim']);
});

test('a broadcast wakes every recipient, and never the sender', async (t) => {
  const { hive, wakes } = await floor(t);
  hive.send({ to: 'broadcast', act: 'inform', subject: 'standup', body: 'now' }, 'god');
  const woken = wakes();
  assert.ok(woken.includes('jim'), 'the recipient is woken');
  assert.ok(!woken.includes('god'), 'the sender is not mailed, so it is not woken');
});

// ── MD-160: the park has to survive a restart ────────────────────────────────
// The sleeping flag used to live only in the renderer store, which the main
// process cannot read. The boot orphan sweep runs in main BEFORE any window
// exists, so it saw a hibernated agent as an `archived:false` entry with no PTY
// — a stale carry-over — and archived it. Two real agents went that way on one
// restart. The flag is now persisted in registry.json beside `archived`.

const { orphansToArchive } = loadTs('src/shared/hiveOwnership.ts');

const reading = (hive, id) => hive.registry().agents[id];

test('hibernating an agent persists sleeping:true in the registry', async (t) => {
  const { hive } = await floor(t);
  hive.setSleeping('jim', true);
  assert.equal(reading(hive, 'jim').sleeping, true);
  assert.equal(reading(hive, 'jim').archived, false, 'parked, NOT archived');
});

test('the boot sweep reading that registry leaves the parked agent alone', async (t) => {
  // The whole regression, end to end: a hive whose only live-PTY answer is "no"
  // (which is what every fresh boot looks like) must still keep the parked agent.
  const { hive } = await floor(t);
  hive.setSleeping('jim', true);
  const reg = hive.registry();
  const stale = orphansToArchive({
    agents: reg.agents, godId: reg.godId, hasLivePty: () => false, isOwner: true
  });
  assert.deepEqual(stale, [], 'jim is parked; god is god — nothing here is an orphan');
});

test('a respawn clears the parked flag — waking IS a respawn', async (t) => {
  const { home, hive } = await floor(t);
  hive.setSleeping('jim', true);
  await hive.ensureAgent({ id: 'jim', name: 'Jim', provider: 'claude', cwd: home }, {});
  assert.equal(reading(hive, 'jim').sleeping, false);
  assert.equal(reading(hive, 'jim').archived, false);
});

test('archiving an agent clears the parked flag — gone is not parked', async (t) => {
  const { hive } = await floor(t);
  hive.setSleeping('jim', true);
  hive.setArchived('jim', true);
  const a = reading(hive, 'jim');
  assert.equal(a.archived, true);
  assert.equal(a.sleeping, false, 'a record must never read as both archived and parked');
});

test('setSleeping is best-effort and idempotent on an unknown or unchanged agent', async (t) => {
  const { hive } = await floor(t);
  hive.setSleeping('nobody', true);                 // must not throw
  assert.equal(hive.registry().agents.nobody, undefined);
  hive.setSleeping('jim', false);                   // already awake — no-op
  assert.ok(!reading(hive, 'jim').sleeping);
});

test('the hibernate path itself persists the flag, not just the renderer event', () => {
  // The IPC send and the log line were already there and were not enough: both
  // are fire-and-forget, and neither is readable by the next boot's sweep.
  const src = readFileSync(join(__dirname, '..', 'src/main/index.ts'), 'utf8');
  const body = /function hibernatePty\([\s\S]*?\n\}/.exec(src);
  assert.ok(body, 'hibernatePty is gone — the park is written somewhere else now');
  assert.match(body[0], /hive\.setSleeping\(agentId, true\)/,
    'hibernation must persist the park, or the boot sweep archives the agent');
});

// MD-64 — the saved value read back as the default. Nothing strips it in main or
// preload (readConfig spreads the parsed file over DEFAULTS, `config:get` returns
// it whole); the Settings modal is seeded from App's config prop, which is loaded
// ONCE at boot and never refreshed, and the mount effect that re-seeds every other
// editable field from disk is an EXPLICIT list these two rows were missing from.
// Anything that saves on blur has to be re-seeded there or it lies on reopen.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

test('Settings re-seeds the blur-saved Advanced rows from the on-disk config', () => {
  const src = readFileSync(join(__dirname, '..', 'src/renderer/src/components/SettingsModal.tsx'), 'utf8');
  const effect = /window\.cth\.getConfig\(\)\.then\(\(c\) => \{([\s\S]*?)\}\)\.catch/.exec(src);
  assert.ok(effect, 'SettingsModal no longer re-seeds its fields from getConfig()');
  for (const setter of ['setHibernateMin(', 'setMaxTurnsVal(']) {
    assert.ok(effect[1].includes(setter), `${setter} missing from the re-seed effect`);
  }
});


// ─── MD-67: sleeping agents disappeared from the fullscreen view ─────────────
//
// sleepAgent() clears ptyId — the card stays on the team, only the process is
// gone. Four call sites still read `!ptyId` as "not a real agent", so fullscreen
// closed itself when the agent on screen fell asleep, its toggle skipped
// sleeping agents entirely, and the demo mock loop treated them as puppets.
// hasTerminalSurface() is the one predicate they now share.

test('a sleeping agent still has a terminal surface — that is the whole bug', () => {
  assert.equal(hasTerminalSurface({ ptyId: 'pty-jim' }), true);          // live
  assert.equal(hasTerminalSurface({ sleeping: true }), true);            // parked, wakeable
  assert.equal(hasTerminalSurface({ ptyId: 'pty-jim', sleeping: true }), true);
  assert.equal(hasTerminalSurface({}), false);                          // demo puppet
  assert.equal(hasTerminalSurface({ ptyId: '' }), false);               // never spawned
});

test('sleepAgent clears ptyId but keeps the agent on the team', () => {
  const src = readFileSync(join(__dirname, '..', 'src/renderer/src/store/store.ts'), 'utf8');
  const body = /sleepAgent: \(id\) =>([\s\S]*?)\n    \}\),/.exec(src);
  assert.ok(body, 'store no longer has a sleepAgent action');
  assert.match(body[1], /ptyId: undefined\b/, 'sleepAgent must clear ptyId');
  assert.match(body[1], /sleeping: true/);
  // If this ever became a removal, hasTerminalSurface would be pointless and the
  // views below would be right to bail.
  assert.doesNotMatch(body[1], /agents:\s*s\.agents\.filter/, 'a sleeping agent must not leave `agents`');
});

test('every view that gates on a live pty uses the shared predicate', () => {
  const read = (rel) => readFileSync(join(__dirname, '..', rel), 'utf8');

  // Pinned as EXACT expressions, not "the file mentions the helper": importing
  // it and then re-inlining `!ptyId` at the gate is precisely the regression.
  // Guards that ask "is there a PROCESS to act on" (killPty, acquireTerminal)
  // legitimately still read ptyId and are deliberately not swept.
  const fs = read('src/renderer/src/components/FullscreenTerminal.tsx');
  assert.match(fs, /if \(!agent \|\| !hasTerminalSurface\(agent\)\)/,
    'fullscreen bails on a sleeping agent again — it closes the whole view');

  const app = read('src/renderer/src/App.tsx');
  assert.match(app, /selectedId && hasTerminalSurface\(x\)/,
    'the fullscreen toggle skips the selected agent when it is asleep');
  assert.match(app, /isGod && hasTerminalSurface\(x\)/);
  assert.match(app, /all\.find\(hasTerminalSurface\)/);
  assert.match(app, /agents\.some\(hasTerminalSurface\)/,
    'the demo mock loop starts on a floor that merely went to sleep');

  const mock = read('src/renderer/src/store/mockEvents.ts');
  assert.match(mock, /isMock = \([\s\S]*?\): boolean => !hasTerminalSurface\(a\)/,
    'the mock loop puppets real sleeping agents again');
  for (const use of ['if (isMock(a)) stepAgent(a)', 'if (!isMock(a)) continue', 'filter(isMock)']) {
    assert.ok(mock.includes(use), `mockEvents no longer routes through isMock: ${use}`);
  }
});

test('the fullscreen roster shows the sleeping state, like the floor card does', () => {
  const src = readFileSync(join(__dirname, '..', 'src/renderer/src/components/FullscreenTerminal.tsx'), 'utf8');
  // Same expression the floor strip uses; without it a sleeping row reads "idle".
  assert.match(src, /agent\.sleeping \? 'sleeping'/);
  // And the terminal half says why it is empty instead of rendering a dead pane.
  assert.match(src, /SleepingPane/);
});
