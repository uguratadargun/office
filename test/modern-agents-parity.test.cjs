'use strict';

/**
 * MD-97 — the parity QA's S1s were all the same SHAPE of bug: a control that
 * renders, has a tooltip, and does nothing. `setIdeOpen` with no navigation.
 * `requestDispatchSeed` with no consumer. Copy that says "Wake it" beside no
 * wake button. A store list rendered nowhere.
 *
 * None of them has a pure surface to test — the defect is a missing WIRE, and
 * a wire that is gone again fails silently, exactly as it did the first time.
 * So these assert the wiring at the source: which module reaches for which
 * capability. Coarse on purpose; a test that could only be satisfied by one
 * exact line would be a copy of the code.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src', p), 'utf8');
const DETAIL = read('modern/agents/AgentDetail.tsx');
const OVERVIEW = read('modern/agents/AgentsOverview.tsx');
const LIST = read('modern/agents/AgentList.tsx');
const DIALOG = read('modern/agents/AddAgentDialog.tsx');
const ISSUES = read('modern/issues/IssuesView.tsx');
const IDE = read('modern/ide/IdeView.tsx');
const NAV = read('modern/nav.ts');
const SHELL = read('modern/AppShell.tsx');

test('S1 — a hibernated agent can be woken from this UI', () => {
  assert.match(DETAIL, /wakeSleepingAgent/, 'the asleep empty state must offer the wake, not just describe it');
  assert.match(DETAIL, /WakeButton/);
  // The roster row too: that is where a sleeping agent is otherwise a disabled
  // Continue with no explanation.
  assert.match(OVERVIEW, /WakeButton/);
});

test('S1 — a sleeping agent reads "asleep" wherever its status is shown', () => {
  // MD-97 asserted the literal ternary in this one file, which is what a fix
  // in one place looks like — and the agent-detail header, which never had it,
  // went on printing `idle` for the same agent (MD-100). The word now comes
  // from `statusBadge`, so the check is that every badge asks it rather than
  // spelling it again: a fourth surface added tomorrow inherits the answer.
  for (const [name, src] of [['overview', OVERVIEW], ['rail', LIST], ['detail', DETAIL]]) {
    assert.match(src, /statusBadge\(/, `${name} must take its status word from statusBadge`);
    assert.doesNotMatch(src, /sleeping \? 'asleep'/, `${name} still spells the label itself`);
  }
  // MD-114 — and `statusBadge` reads PRESENCE, so all three also cover an agent
  // that lost its process WITHOUT the hibernate flag: a released ephemeral
  // worker used to read `idle` in every one of them with no terminal behind it.
  // The Wake control follows the same predicate rather than the flag.
  assert.match(OVERVIEW, /isProcessless\(a\) \? \(\s*<WakeButton/);
});

test('S1 — last session\'s team is rendered and restorable', () => {
  assert.match(OVERVIEW, /restorableAgents/, 'the previous-session list must be rendered somewhere');
  assert.match(OVERVIEW, /restoreTeam/, 'restore all');
  assert.match(OVERVIEW, /respawnAgent/, 'per-agent restore');
  assert.match(OVERVIEW, /removeRestorableAgent/, 'dismiss');
  // It is reachable with an agent selected, where the overview is off screen.
  assert.match(LIST, /restorableAgents/);
  // …and the AUTOMATIC restore is mounted at BOOT, not inside a view — the hook
  // spawns processes 2.5s after it mounts, and that must not be a side effect
  // of navigating to the Agents screen.
  const APP = read('modern/App.tsx');
  assert.match(APP, /useRestoreTeam\(/, 'modern never mounted the auto-restore at all');
});

test('S1 — kill is armed, not a single click on an icon beside Edit', () => {
  assert.match(DETAIL, /useDestructive/);
  // Straight to killPty from an onClick is the bug this replaced.
  assert.doesNotMatch(DETAIL, /onClick=\{\(\) => \{\s*if \(!agent\.ptyId\) return;\s*void window\.cth\.killPty/);
});

test('S1 — the hook is imported without dragging the pixel button along', () => {
  assert.match(DETAIL, /from '@\/components\/ui\/useDestructive'/);
  const HOOK = fs.readFileSync(
    path.join(__dirname, '..', 'src/renderer/src/components/ui/useDestructive.ts'), 'utf8');
  assert.doesNotMatch(HOOK, /^import .*PixelButton/m, 'the modern chunk must not pull a pixel control in');
  // The pixel control keeps working through a re-export, not a second copy.
  const ACTION = fs.readFileSync(
    path.join(__dirname, '..', 'src/renderer/src/components/ui/DestructiveAction.tsx'), 'utf8');
  assert.match(ACTION, /export \{ useDestructive \} from '\.\/useDestructive'/);
  assert.doesNotMatch(ACTION, /export function useDestructive/, 'one implementation, not two');
});

test('S1 — Issues → Assign seeds the dispatch box AND goes there', () => {
  assert.match(ISSUES, /requestDispatchSeed/);
  assert.match(ISSUES, /navigate\('agents'\)/, 'seeding a box the user cannot see is still a no-op');
  // The dispatch box only exists with nothing selected.
  assert.match(ISSUES, /select\(null\)/);
  // …and something has to actually read the seed.
  assert.match(OVERVIEW, /dispatchSeedRequest/);
});

test('the seed is consumed once per request, not once per render', () => {
  // seq-keyed: assigning the same issue twice must re-seed, and a re-render
  // must not clobber what the user has since typed.
  assert.match(OVERVIEW, /seq/);
});

test('S1 — "Open IDE" navigates, and releases the agent it pinned', () => {
  assert.match(DETAIL, /setIdeOpen\(true, agent\.id\); navigate\('ide'\)/);
  assert.match(IDE, /setIdeOpen\(false, null\)/, 'one click must not pin the IDE for the session');
  assert.match(IDE, /pinnedId/);
});

test('S2 — the roster row edits the engine instead of printing it', () => {
  assert.match(OVERVIEW, /modelsForProvider/, 'model picker');
  assert.match(OVERVIEW, /AGENT_PROVIDER_PRESETS/, 'provider picker');
  assert.match(OVERVIEW, /effortLevelsFor/, 'EffortEditor');
  assert.match(OVERVIEW, /'fresh'/, 'plain Restart');
});

test('S2 — the private note is visible and editable here too', () => {
  assert.match(DETAIL, /setAgentNote/);
  assert.match(LIST, /agent\.note/, 'a written note should be visible without opening the editor');
});

test('S2 — a hire manifest can be imported', () => {
  assert.match(DIALOG, /importHireFile/);
});

test('S2 — the rail carries the waiting counts', () => {
  assert.match(NAV, /badge\?: ComponentType/, 'the nav entry type takes an optional badge');
  assert.match(NAV, /badge: TasksBadge/);
  assert.match(NAV, /badge: AskMeBadge/);
  assert.match(SHELL, /Badge && <Badge \/>/, 'the shell renders it');
});

test('one poller behind both badges, and a failed read keeps the last good count', () => {
  const POLLER = read('modern/lib/navBadges.ts');
  assert.match(POLLER, /badgeCounts/, 'reuse the pixel UI\'s counter, do not re-derive it');
  assert.match(POLLER, /catch \{ \/\* keep the last good counts \*\/ \}/,
    'blanking on an error would say "nothing is waiting on you"');
  // One interval for both badges (the other mention is its return type).
  assert.equal((POLLER.match(/= setInterval\(/g) || []).length, 1);
});
