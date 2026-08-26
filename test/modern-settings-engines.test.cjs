'use strict';

/**
 * MD-102 — the AI engines panel exists, and the things it depends on cannot
 * quietly drift apart again.
 *
 * MD-93 found `providerKeySet/Has/Clear`, `providerBaseUrls` and
 * `providerDefaultModels` with ZERO callers under `modern/`: onboarding offers
 * ten orchestrator engines and a modern-only install could authenticate none of
 * them. What is pinned here is not "a panel renders" — it is the four couplings
 * whose breakage puts the feature back where it was without failing anything:
 * the backend table main validates against, the settings index that makes a row
 * findable, the section list that must have a pane behind every tab, and the
 * inbox filter that decides which engines may run the orchestrator at all.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { PROVIDER_KEY_BACKENDS, BACKEND_KEY_ENV, isKnownBackend } = loadTs('src/shared/providerKeys.ts');
const { SETTINGS, SECTIONS, NOT_A_SETTING } = loadTs('src/renderer/src/modern/settings/index.ts');
const { AGENT_PROVIDER_PRESETS, canReceiveInbox, providerPreset } = loadTs('src/shared/agentProvider.ts');

const ROOT = path.join(__dirname, '..', 'src');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const modern = (rel) => read(path.join('renderer', 'src', 'modern', rel));

// ─── one backend table, not three ───────────────────────────────────────────

test('main validates against the same backend table the UI renders', () => {
  // main used to own a `BACKEND_KEY_ENV` literal and each UI kept its own copy
  // with a comment asking the next editor to sync them by hand. A backend added
  // in one place and not the other is either a row whose save is rejected as
  // "unknown backend", or a working backend with no field to type a key into.
  const mainSrc = read(path.join('main', 'index.ts'));
  assert.match(mainSrc, /from '\.\.\/shared\/providerKeys'/, 'main must import the shared table');
  assert.doesNotMatch(
    mainSrc,
    /const BACKEND_KEY_ENV: Record<string, string> = \{/,
    'main must not re-declare the table it imports'
  );
  assert.doesNotMatch(
    read(path.join('renderer', 'src', 'components', 'AiEnginesSettings.tsx')),
    /ANTHROPIC_API_KEY/,
    'the pixel panel must not carry a second copy either'
  );
});

test('every backend in the table is a backend main will accept', () => {
  assert.ok(PROVIDER_KEY_BACKENDS.length >= 5);
  for (const b of PROVIDER_KEY_BACKENDS) {
    assert.equal(BACKEND_KEY_ENV[b.id], b.envVar);
    assert.equal(isKnownBackend(b.id), true);
  }
  assert.equal(isKnownBackend('not-a-backend'), false);
});

test('the modern panel renders the table rather than a list of its own', () => {
  const src = modern('settings/AiEnginesPanel.tsx');
  assert.match(src, /PROVIDER_KEY_BACKENDS\.map/, 'rows must come from the shared table');
  for (const b of PROVIDER_KEY_BACKENDS) {
    assert.doesNotMatch(src, new RegExp(`'${b.envVar}'`), `${b.envVar} must not be hard-coded here`);
  }
});

test('a key is written, never read back', () => {
  const src = modern('settings/AiEnginesPanel.tsx');
  assert.match(src, /providerKeySet\(\{ backend, key \}\)/);
  assert.match(src, /providerKeyHas\(b\.id\)/, 'presence is a boolean, fetched per backend');
  assert.doesNotMatch(src, /providerKeyGet|readKey|\.key\b\s*=\s*await/, 'no path may fetch a stored key');
});

test('the OpenAI slot moves the voice gate with it', () => {
  // apikey:openai is the SAME broker slot Realtime mints its token from. Saving
  // or clearing it here without moving the store mirror leaves the topbar mic
  // disabled — or enabled with no key — until the next launch.
  const src = modern('settings/AiEnginesPanel.tsx');
  assert.match(src, /if \(backend === 'openai'\) setHasOpenAiKey\(true\)/);
  assert.match(src, /if \(backend === 'openai'\) setHasOpenAiKey\(false\)/);
});

test('a blank endpoint clears the entry instead of storing an empty string', () => {
  // '' as a base URL is spliced into a request as a valid-looking origin.
  assert.match(modern('settings/AiEnginesPanel.tsx'), /if \(trimmed\) current\[id\] = trimmed; else delete current\[id\];/);
});

// ─── the index and the section list ─────────────────────────────────────────

const NEWLY_OWNED = ['godProvider', 'godModel', 'mcpDefaults', 'providerBaseUrls', 'providerDefaultModels'];

test('the keys MD-93 found homeless are indexed, not excused', () => {
  const indexed = new Set(SETTINGS.flatMap((e) => e.keys));
  for (const key of NEWLY_OWNED) {
    assert.ok(indexed.has(key), `${key} must be indexed now that a row writes it`);
    assert.ok(!(key in NOT_A_SETTING), `${key} must no longer be excused in NOT_A_SETTING`);
  }
});

test('NOT_A_SETTING no longer points at panels that do not exist', () => {
  const reasons = Object.values(NOT_A_SETTING).join(' ');
  assert.doesNotMatch(reasons, /AI engines panel/);
  assert.doesNotMatch(reasons, /MCP defaults panel/);
  assert.doesNotMatch(reasons, /onboarding \+ Monitor/, 'Monitor never had an orchestrator picker');
  assert.doesNotMatch(reasons, /auto-compact/, 'General never exposed an auto-compact mission');
});

test('every section in the rail has a pane behind it', () => {
  // A section added to SECTIONS and not to SettingsView renders an empty page —
  // the tab is clickable and nothing appears, with nothing failing.
  const view = modern('settings/SettingsView.tsx');
  for (const s of SECTIONS) {
    assert.ok(view.includes(`section === '${s}'`), `SettingsView renders nothing for ${s}`);
  }
  assert.ok(SECTIONS.includes('Prerequisites'));
});

test('every section in the rail has at least one indexed row', () => {
  for (const s of SECTIONS) {
    assert.ok(SETTINGS.some((e) => e.section === s), `${s} has no rows in the index — search can never reach it`);
  }
});

// ─── the orchestrator picker ────────────────────────────────────────────────

test('only engines that can drain an inbox may run the orchestrator', () => {
  // An orchestrator on a terminal-only engine stops orchestrating and reports
  // nothing. The wizard filters on this; the Settings picker has to agree.
  assert.match(modern('settings/OrchestratorRows.tsx'), /filter\(\(p\) => canReceiveInbox\(p\.id\)\)/);
  const excluded = AGENT_PROVIDER_PRESETS.filter((p) => !canReceiveInbox(p.id));
  assert.ok(excluded.length > 0, 'the filter must actually exclude something, or it is decoration');
  assert.ok(AGENT_PROVIDER_PRESETS.some((p) => canReceiveInbox(p.id)), 'and must leave something to choose');
});

test('switching engine re-seeds the model instead of carrying a stale id', () => {
  // Every offered engine must HAVE a recommendation, or the reset writes
  // undefined and the picker shows a blank the user has to fix by hand.
  assert.match(
    modern('settings/OrchestratorRows.tsx'),
    /godModel: providerPreset\(v as AgentProvider\)\.recommendedOrchestratorModel/
  );
  for (const p of AGENT_PROVIDER_PRESETS.filter((x) => canReceiveInbox(x.id))) {
    const rec = providerPreset(p.id).recommendedOrchestratorModel;
    assert.ok(rec === undefined || typeof rec === 'string', `${p.id} has an unusable recommendation`);
  }
});

test('a saved orchestrator model outside the list is still shown', () => {
  // godModel is a free string on disk. A Select whose value matches no item
  // renders an EMPTY box, which reads as "no model chosen" while the boss is
  // in fact running one.
  assert.match(
    modern('settings/OrchestratorRows.tsx'),
    /known\.some\(\(c\) => c\.value === model\)\s*\?\s*known\s*:\s*\[\{ value: model/
  );
});

// ─── the S2 panels ──────────────────────────────────────────────────────────

test('the updates block shares the reducer with the toolbar chip', () => {
  // A second copy of the wording is how Settings and the badge end up
  // disagreeing about which version is installed.
  const src = modern('settings/GeneralSection.tsx');
  assert.match(src, /describeUpdateSettings\(status, window\.cth\.version\)/);
  assert.match(src, /reduceStatus\(prev, next\)/);
});

test('removing a registered project takes two clicks', () => {
  const src = modern('settings/GeneralSection.tsx');
  // Still two clicks — but through the app's ONE arm machine rather than this
  // file's private 5s timer, which was the fourth private copy of a policy the
  // app settled once (MD-153). The behaviour this test was written for is the
  // arming, not the `armed === r` ternary that used to implement it.
  assert.match(src, /<DestructiveButton[\s\S]{0,400}onRun=\{\(\) => void remove\(r\)\}/,
    'the trash icon must arm before it removes');
  assert.match(src, /icon=\{<Trash2 \/>\}/, 'and the dense row keeps its glyph');
  assert.doesNotMatch(src, /setArmed/, 'no private phase state left');
});

test('MCP rows keep their tier split', () => {
  // Flattening the list puts a write-capable server next to a read-only one
  // with nothing marking the difference.
  const src = modern('settings/McpDefaultsPanel.tsx');
  assert.match(src, /TIER_ORDER: McpTier\[\] = \['safe-readonly', 'write', 'secret'\]/);
});

test('Prerequisites does not shell out from the renderer', () => {
  const src = modern('settings/PrerequisitesSection.tsx');
  assert.match(src, /setupPrompt\(missingEssential\)/);
  assert.doesNotMatch(src, /spawnPty|runCommand|exec\(/, 'installing software stays the user’s action');
});
