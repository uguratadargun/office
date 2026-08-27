'use strict';

/**
 * MD-162 — compact far earlier, and stop compacting a floor that did nothing.
 *
 * Two independent halves, both about token cost rather than UX:
 *   1. The shipped defaults come down (2h/60/40 → 30m/25/12) AND a config that
 *      already persisted the old numbers is migrated forward — without that
 *      migration the long-running installs this card exists for never see them.
 *   2. The cadence skips entirely when nobody but the orchestrator has moved
 *      since the last compaction, because that compaction lands in the one
 *      terminal that never sleeps.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const {
  DEFAULT_CONTEXT_TRIGGER, LEGACY_COMPACT_RULE, migrateCompactRule, compactRuleNeedsMigration
} = loadTs('src/shared/triggers.ts');
const { hasNonGodActivitySince, compactSkipLog } = loadTs('src/shared/compactGate.ts');

/* ─────────────────────────────── the defaults ────────────────────────────── */

test('the shipped compact rule fires at 30m / 25% / 12%', () => {
  const c = DEFAULT_CONTEXT_TRIGGER.compact;
  assert.equal(c.enabled, true);
  assert.equal(c.everyMs, 1_800_000);
  assert.equal(c.minContextPct, 25);
  assert.equal(c.minContextPctLargeWindow, 12);
  // 12% of a 1M window is ~120k tokens — the number the card asked for. Pinned
  // as arithmetic so a future edit to the percentage has to face what it means.
  assert.equal(Math.round(1_000_000 * (c.minContextPctLargeWindow / 100)), 120_000);
});

test('auto-clear still ships disabled — /clear discards, it does not summarise', () => {
  assert.equal(DEFAULT_CONTEXT_TRIGGER.clear.enabled, false);
});

/* ────────────────────────────── the migration ────────────────────────────── */

const legacyRule = () => ({
  enabled: true,
  everyMs: LEGACY_COMPACT_RULE.everyMs,
  minContextPct: LEGACY_COMPACT_RULE.minContextPct,
  minContextPctLargeWindow: LEGACY_COMPACT_RULE.minContextPctLargeWindow,
  message: 'keep the task'
});

test('a config still on the old shipped numbers is moved onto the new ones', () => {
  const next = migrateCompactRule(legacyRule());
  assert.equal(next.everyMs, DEFAULT_CONTEXT_TRIGGER.compact.everyMs);
  assert.equal(next.minContextPct, DEFAULT_CONTEXT_TRIGGER.compact.minContextPct);
  assert.equal(next.minContextPctLargeWindow, DEFAULT_CONTEXT_TRIGGER.compact.minContextPctLargeWindow);
  // Everything that is not one of the three numbers rides through untouched —
  // the operator's focus message above all.
  assert.equal(next.message, 'keep the task');
  assert.equal(next.enabled, true);
});

test('a value the operator changed on purpose survives the migration', () => {
  const tuned = { ...legacyRule(), everyMs: 5_400_000, minContextPct: 45 };
  const next = migrateCompactRule(tuned);
  assert.equal(next.everyMs, 5_400_000, 'a hand-tuned 90m cadence is a decision');
  assert.equal(next.minContextPct, 45, 'a hand-tuned bar is a decision');
  // …and the one field still on the old default moves anyway. Per-field is the
  // whole point: a half-tuned rule must not strand its untouched half.
  assert.equal(next.minContextPctLargeWindow, DEFAULT_CONTEXT_TRIGGER.compact.minContextPctLargeWindow);
});

test('an already-current rule needs no migration and no config write', () => {
  assert.equal(compactRuleNeedsMigration(DEFAULT_CONTEXT_TRIGGER.compact), false);
  assert.equal(compactRuleNeedsMigration(legacyRule()), true);
  const same = migrateCompactRule(DEFAULT_CONTEXT_TRIGGER.compact);
  assert.deepEqual(same, DEFAULT_CONTEXT_TRIGGER.compact);
});

test('readConfig runs the V2 migration, guarded by its own flag', () => {
  const cfg = read('src/main/config.ts');
  assert.match(cfg, /return migrateCompactCadenceV2\(migrateTriggersV1\(/,
    'the migration must run on every read, after V1');
  assert.match(cfg, /compactCadenceMigratedV2\?: boolean;/);
  // A SEPARATE flag from triggersMigratedV1: an install that already ran V1 has
  // that flag set, and reusing it would strand exactly the configs this exists for.
  assert.match(cfg, /compactCadenceMigrationRan = false;[\s\S]*return withTriggerDefaults/,
    'resetConfig must drop the V2 latch alongside the V1 one');
});

test('the seeded compact-maintenance mission agrees with the trigger cadence', () => {
  const cfg = read('src/main/config.ts');
  // Load-bearing, not cosmetic: bootstrapHiveServices RETIRES that mission by
  // copying its intervalMs into contextTrigger.compact.everyMs, so a stale seed
  // here writes the old cadence straight back over the migrated one.
  assert.match(cfg, /intervalMs: 1_800_000,/);
  assert.match(cfg, /const V1_COMPACT_MAINTENANCE_INTERVAL_MS = 7_200_000;/);
  assert.match(cfg, /m\.intervalMs === V1_COMPACT_MAINTENANCE_INTERVAL_MS/);
});

/* ─────────────────────────────── the idle gate ───────────────────────────── */

const T = 1_000_000;
const god = { id: 'god', isGod: true, lastCoordinationAt: T + 999_999, lastOutputAt: T + 999_999 };

test('only the orchestrator moving does NOT open the gate', () => {
  const rows = [god, { id: 'pam', isGod: false, lastCoordinationAt: T - 5 }];
  assert.equal(hasNonGodActivitySince(rows, T), false);
});

test('a worker that coordinated opens the gate', () => {
  assert.equal(hasNonGodActivitySince(
    [god, { id: 'pam', isGod: false, lastCoordinationAt: T + 1 }], T), true);
});

test('PTY output is NOT a signal — it would make the gate self-feeding', () => {
  // The compaction we just sent produces terminal output (a real CLI answers a
  // redundant /compact with "not enough messages to compact" and prints it), so
  // counting output would have every compaction justify the next one forever.
  const rows = [god, { id: 'pam', isGod: false, lastCoordinationAt: T - 1, lastOutputAt: T + 999 }];
  assert.equal(hasNonGodActivitySince(rows, T), false);
  const src = read('src/shared/compactGate.ts');
  assert.equal(/lastOutputAt/.test(src.split('export function')[0].replace(/\/\*[\s\S]*?\*\//g, '')), false,
    'no lastOutputAt field on the row type');
});

test('a PARKED agent still counts — overnight the whole floor is asleep', () => {
  // Filtering hibernated agents out would leave god alone on the floor every
  // night, which reads as "no reading" and fails open — disabling the gate in
  // exactly the case it exists for.
  const rows = [god, { id: 'pam', isGod: false, lastCoordinationAt: T + 999 }];
  assert.equal(hasNonGodActivitySince(rows, T), true);
});

test('no floor reading at all FAILS OPEN', () => {
  // "We cannot see anyone" must never be read as "nobody is there" — an
  // unreadable registry has to keep compacting, not silently stop.
  assert.equal(hasNonGodActivitySince([], T), true);
  assert.equal(hasNonGodActivitySince([god], T), true, 'a floor of just god is not a reading');
});

test('the skip is logged, with the quiet span and the floor size', () => {
  const line = compactSkipLog([god, { id: 'pam', isGod: false, lastCoordinationAt: 0 }], Date.now() - 3_600_000);
  assert.match(line, /compact skipped/);
  assert.match(line, /60m/);
  assert.match(line, /1 agent\(s\)/);
});

test('main gates compact only, and does not stamp the run when it skips', () => {
  const idx = read('src/main/index.ts');
  const fire = idx.slice(idx.indexOf('function syncContextTriggers'), idx.indexOf('function syncContextTriggers') + 2200);
  assert.match(fire, /if \(action === 'compact'\)/, '/clear is targeted and must not be gated');
  const skip = fire.indexOf('hasNonGodActivitySince');
  const stamp = fire.indexOf('stampContextRun(action);');
  assert.ok(skip > 0 && stamp > skip,
    'the gate must run BEFORE the stamp — a skipped tick keeps the window open so '
    + 'the first tick after work resumes covers the quiet span');
});

/* ────────────────────────────────── the UI ───────────────────────────────── */

test('the three numbers are editable in modern Settings, next to the other limits', () => {
  const sec = read('src/renderer/src/modern/settings/AgentsSection.tsx');
  for (const id of ['set-compact-every', 'set-compact-pct', 'set-compact-pct-large']) {
    assert.ok(sec.includes(`id="${id}"`), `${id} missing from AgentsSection`);
    assert.ok(read('src/renderer/src/modern/settings/index.ts').includes(`id: '${id}'`),
      `${id} missing from the settings search index`);
  }
  // Through `setContextTrigger`, NOT `save()`: that IPC is the half that clamps
  // the numbers and RE-ARMS the live timers. A cadence written straight into the
  // config file looks saved and keeps firing on the old rhythm until relaunch.
  assert.match(sec, /setContextTrigger\(\{ clear, compact: \{ \.\.\.compact, \.\.\.patch \} \}\)/);
  assert.doesNotMatch(sec, /save\(\{ contextTrigger/);
});
