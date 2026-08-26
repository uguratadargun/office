#!/usr/bin/env node
/**
 * MD-160 live check — the boot orphan sweep must keep hibernated agents.
 *
 * `archiveOrphanedAgents()` runs inside `bootstrapHiveServices`, in the MAIN
 * process, before any window exists — so no unit test reaches it and the only
 * honest proof is a real launch. Its rule was "archived:false with no live PTY
 * is a stale carry-over", and an agent parked by idle-hibernate (MD-146) is
 * processless BY DESIGN: on one restart the sweep archived jim-mt2yvlbg and
 * pam-mt310mbm and respawned a finished ephemeral worker in their place.
 *
 * The check, end to end:
 *   1. a scratch harnessHome with a registry holding TWO processless agents —
 *      `parked` (sleeping:true, hibernated) and `ghost` (sleeping:false, quit
 *      without archiving) — plus god;
 *   2. launch the built app against a throwaway --user-data-dir whose config.json
 *      is written BEFORE first launch and points at that scratch home (never a
 *      fresh profile on the real home — that is the MD-139 incident);
 *   3. after boot, read registry.json back:
 *        parked → archived:false, sleeping:true   (kept: mail will wake it)
 *        ghost  → archived:true                   (still swept: this is the
 *                                                  control that proves the fix
 *                                                  narrowed the rule, not killed it)
 *
 * onboardingComplete is FALSE on purpose: the renderer's boot spawn (god + team)
 * is gated on it, so nothing real is launched — but harnessHome is set, so main
 * still bootstraps the hive and runs the sweep, which is all this is about.
 * Slack / Telegram / webhooks are off so the scratch app talks to nobody.
 *
 * Run: npm run build && node scripts/verify-sweep-keeps-hibernated.mjs
 * Exit 0 = pass.
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'md160-'));
const home = join(tmp, 'harness-home');      // the scratch harnessHome
const profile = join(tmp, 'user-data');      // the scratch --user-data-dir
const hiveRoot = join(home, 'hive');
const registryPath = join(hiveRoot, 'registry.json');

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

// ── 1. the scratch hive, with the two agents the sweep has to tell apart ─────
const agent = (id, over) => ({
  id, name: id, provider: 'claude', role: 'agent', capabilities: [],
  cwd: home, status: 'idle', lastSeen: Date.now(), archived: false, ...over
});
mkdirSync(join(hiveRoot, 'agents'), { recursive: true });
writeFileSync(registryPath, JSON.stringify({
  godId: 'god',
  agents: {
    god: agent('god', { isGod: true, role: 'orchestrator' }),
    parked: agent('parked', { sleeping: true }),   // hibernated — must survive
    ghost: agent('ghost', { sleeping: false })     // died without archiving — must be swept
  }
}, null, 2), 'utf8');

// ── 2. the profile's config, written BEFORE the first launch ────────────────
mkdirSync(profile, { recursive: true });
writeFileSync(join(profile, 'config.json'), JSON.stringify({
  harnessHome: home,
  onboardingComplete: false,   // keeps the renderer from spawning a real team
  slackEnabled: false,
  telegramEnabled: false,
  webhookEnabled: false,
  webhookTriggers: [],
  idleHibernateMinutes: 0      // no hibernate tick racing this run
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

/** Kill our own process and nothing else: SIGTERM, then a 5 s SIGKILL race.
 *  Never app.close() — a scratch app's quit confirm has hung a run before. */
async function shutdown() {
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
    for (let i = 0; i < 50 && child.exitCode === null && child.signalCode === null; i++) await sleep(100);
    if (child.exitCode === null && child.signalCode === null) {
      try { execFileSync('kill', ['-9', String(child.pid)]); } catch { /* already gone */ }
      await sleep(300);
    }
  }
}

try {
  // Wait for the sweep to have run — it is the first thing bootstrapHiveServices
  // does after claiming ownership, so the log line is the precise signal.
  let booted = false;
  for (let i = 0; i < 120; i++) {          // up to 60 s
    if (/\[migration\] archived orphaned agent|\[migration\] skipped the orphan sweep/.test(log)) { booted = true; break; }
    if (child.exitCode !== null) break;
    await sleep(500);
  }
  // The "kept everything" case logs nothing, so fall back to a settle window.
  if (!booted) await sleep(4000);

  const reg = JSON.parse(readFileSync(registryPath, 'utf8'));
  const parked = reg.agents.parked ?? {};
  const ghost = reg.agents.ghost ?? {};
  const god = reg.agents.god ?? {};

  console.log(`\n--- registry after boot (${registryPath}) ---`);
  console.log(JSON.stringify({ parked, ghost, god: { archived: god.archived } }, null, 2));
  console.log('---\n');

  check('parked agent is NOT archived', parked.archived, false);
  check('parked agent is still sleeping', parked.sleeping, true);
  check('ghost agent IS archived (the sweep still sweeps)', ghost.archived, true);
  check('god is never archived', god.archived, false);
} catch (e) {
  failures++;
  console.error('FAIL  the check threw:', e);
  console.error('--- app log ---\n' + log.slice(-4000));
} finally {
  await shutdown();
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
