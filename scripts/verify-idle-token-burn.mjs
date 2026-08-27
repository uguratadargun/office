#!/usr/bin/env node
/**
 * MD-164 live check — the hourly standup must not fire at an empty floor.
 *
 * `fire()` runs on a bare `setInterval` in the MAIN process, and what it gates
 * on (a live PTY per non-god agent, god's unread inbox, the fleet delta) only
 * exists in a real launch — no unit test reaches it. The measured cost of the
 * ungated version was ~8.1M cache-read tokens across one night of an idle floor,
 * every one of them god re-reading his whole context to answer "no change".
 *
 * The check, end to end:
 *   1. a scratch harnessHome holding a hive with NOTHING but god, and a scratch
 *      --user-data-dir whose config.json is written BEFORE first launch (never a
 *      fresh profile against the real home — that is the MD-139 incident), with
 *      the ops standup shortened from an hour to six seconds;
 *   2. PHASE A — no non-god agent is awake: across three whole intervals NOT ONE
 *      standup file may land in god's inbox, and the gate must be visibly firing
 *      and skipping (three log lines), not simply un-armed;
 *   3. PHASE B — an ephemeral worker is spawned through the spawn-request queue
 *      (main-process only, no renderer) running `cat`, so a non-god agent is
 *      genuinely awake with a live PTY. Now exactly ONE standup must land: the
 *      first fire sends it, and the "previous standup still unread" gate holds
 *      every later one back. It must arrive as `act:'inform'` — a `request` sets
 *      requires_reply, and god's reply went to `scheduler`, which has no inbox,
 *      so it dead-lettered after buying a second full-context turn.
 *
 * onboardingComplete is FALSE on purpose: the renderer's boot spawn (god + team)
 * is gated on it, so no real engine is launched — but harnessHome is set, so main
 * bootstraps the hive, arms the scheduler and runs the worker watcher, which is
 * all this is about. Slack / Telegram / webhooks are off so the scratch app talks
 * to nobody, and the worker's engine is `cat` so it costs nothing and never exits.
 *
 * Run: npm run build && node scripts/verify-idle-token-burn.mjs
 * Exit 0 = pass.
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'md164-'));
const home = join(tmp, 'harness-home');      // the scratch harnessHome
const profile = join(tmp, 'user-data');      // the scratch --user-data-dir
const work = join(tmp, 'work');              // the worker's cwd (a real git repo)
const hiveRoot = join(home, 'hive');
const godInbox = join(hiveRoot, 'agents', 'god', 'inbox');

/** The standup's interval for this run — seconds, not the shipped hour. */
const INTERVAL_MS = 6000;

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

// ── 1. the scratch hive: god, and nobody else ───────────────────────────────
mkdirSync(godInbox, { recursive: true });
mkdirSync(join(hiveRoot, 'spawn-requests'), { recursive: true });
writeFileSync(join(hiveRoot, 'registry.json'), JSON.stringify({
  godId: 'god',
  agents: {
    god: {
      id: 'god', name: 'god', provider: 'claude', role: 'orchestrator', isGod: true,
      capabilities: [], cwd: home, status: 'idle', lastSeen: Date.now(), archived: false
    }
  }
}, null, 2), 'utf8');

// A real (empty) git repo for the worker's cwd — the spawn path asks it for its
// branch, and an answer is cheaper to provide than to reason about.
mkdirSync(work, { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main', work], { stdio: 'ignore' });

// ── 2. the profile's config, written BEFORE the first launch ────────────────
mkdirSync(profile, { recursive: true });
writeFileSync(join(profile, 'config.json'), JSON.stringify({
  harnessHome: home,
  onboardingComplete: false,   // keeps the renderer from spawning a real team
  slackEnabled: false,
  telegramEnabled: false,
  webhookEnabled: false,
  webhookTriggers: [],
  idleHibernateMinutes: 0,     // no hibernate tick parking the worker mid-check
  reflectEnabled: false,       // the condenser is not what this check is about
  defaultCommand: 'cat',       // nothing in this run may launch a real engine
  missions: [{
    id: 'ops-standup',
    label: 'Hourly ops standup',
    intervalMs: INTERVAL_MS,
    to: 'god',
    body: 'Hourly ops standup (scratch run).',
    enabled: true
  }]
}, null, 2), 'utf8');

// ── 3. launch ───────────────────────────────────────────────────────────────
const electron = join(repo, 'node_modules', '.bin', 'electron');
if (!existsSync(electron)) { console.error('FAIL  electron not installed'); process.exit(1); }
if (!existsSync(join(repo, 'out', 'main', 'index.js'))) {
  console.error('FAIL  out/main/index.js missing — run `npm run build` first');
  process.exit(1);
}

// Strip anything that would make the child think it is already inside an Electron
// run (this script may itself be launched from a harness that sets them).
const env = { ...process.env };
for (const k of Object.keys(env)) {
  if (k.startsWith('ELECTRON_') || k.startsWith('NODE_ENV_ELECTRON')) delete env[k];
}

const child = spawn(electron, [repo, `--user-data-dir=${profile}`], {
  cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = () => child.exitCode === null && child.signalCode === null;

/** Standup files sitting unread in god's inbox — the scheduler's mail only. */
function standups() {
  let files = [];
  try { files = readdirSync(godInbox).filter((f) => f.endsWith('.json')); } catch { /* not yet */ }
  const out = [];
  for (const f of files) {
    try {
      const m = JSON.parse(readFileSync(join(godInbox, f), 'utf8'));
      if (m.from === 'scheduler') out.push(m);
    } catch { /* half-written; the next poll sees it */ }
  }
  return out;
}

const skips = () => (log.match(/\[scheduler\] ops-standup: skipped/g) ?? []).length;

/** Poll until `fn()` is truthy or the budget runs out. Returns the last value. */
async function until(fn, budgetMs, stepMs = 500) {
  let v = fn();
  for (let waited = 0; !v && waited < budgetMs && alive(); waited += stepMs) {
    await sleep(stepMs);
    v = fn();
  }
  return v;
}

/** Kill our own process and nothing else: SIGTERM, then a 5 s SIGKILL race.
 *  Never app.close() — a scratch app's quit confirm has hung a run before. */
async function shutdown() {
  if (!alive()) return;
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
  for (let i = 0; i < 50 && alive(); i++) await sleep(100);
  if (alive()) {
    try { execFileSync('kill', ['-9', String(child.pid)]); } catch { /* already gone */ }
    await sleep(300);
  }
}

try {
  // ── PHASE A: an empty floor. Three whole intervals, nothing may be sent ────
  console.log(`\n--- PHASE A: no non-god agent awake (${INTERVAL_MS}ms × 3) ---`);
  // Wait for the gate to have fired and skipped three times, so a pass cannot be
  // "the scheduler was never armed" wearing a green tick.
  await until(() => skips() >= 3, INTERVAL_MS * 5 + 15_000);
  check('the standup gate ran and skipped at least 3 times', skips() >= 3, true);
  check('no standup landed in god\'s inbox on an empty floor', standups().length, 0);

  // ── PHASE B: wake a non-god agent, and exactly one standup must land ──────
  console.log('\n--- PHASE B: one non-god agent awake ---');
  writeFileSync(join(hiveRoot, 'spawn-requests', 'md164.json'), JSON.stringify({
    id: 'md164', name: 'Cat Worker', objective: 'Stay awake and do nothing.',
    cwd: work, command: 'cat', isolate: false
  }, null, 2), 'utf8');

  const spawned = await until(() => /\[worker\] spawned worker-md164|worker-md164/.test(log), 30_000);
  check('the scratch worker actually spawned', spawned, true);

  // Give the gate four more intervals: one to fire, three to prove the unread
  // standup is not repeated.
  const landed = await until(() => standups().length > 0, INTERVAL_MS * 4 + 15_000);
  check('a standup lands once a non-god agent is awake', landed, true);
  const first = standups()[0];
  check('it is an inform, not a reply-demanding request', first?.act, 'inform');

  await sleep(INTERVAL_MS * 3);
  check('the unread standup is not piled on', standups().length, 1);
} catch (e) {
  failures++;
  console.error('FAIL  the check threw:', e);
} finally {
  if (failures > 0) console.error('--- app log (tail) ---\n' + log.slice(-6000));
  await shutdown();
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
