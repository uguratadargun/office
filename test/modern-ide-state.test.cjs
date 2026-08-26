'use strict';

/**
 * MD-121 — the two IDE findings from the final packaged QA (MD-118).
 *
 * Both are a screen stating something it does not know: "(assumed)" on a
 * workspace the user had just chosen, and git's own stderr presented as an
 * error on a folder that simply is not a repository.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { pickIdeTarget, gitPaneState, idePickerOptions } = loadTs('src/renderer/src/modern/ide/ideState.ts');

const GOD = { id: 'god', cwd: '/harness', isGod: true };
const PAM = { id: 'pam', cwd: '/repo/pam' };
const JIM = { id: 'jim', cwd: '/repo/jim' };
const AGENTS = [GOD, PAM, JIM];

/* ── S3: "(assumed)" ────────────────────────────────────────────────────── */

test('the agent "Open IDE" named is not a guess', () => {
  const t = pickIdeTarget(AGENTS, null, 'jim');
  assert.equal(t.agent, JIM);
  assert.equal(t.root, '/repo/jim');
  assert.equal(t.inferred, false);
});

test('S3 — a SELECTED agent is not a guess either', () => {
  // The bug: `pinnedId` is set only by "Open IDE" on an agent, so arriving from
  // the nav rail marked everything inferred — including one click after
  // choosing that very agent in Agents.
  const t = pickIdeTarget(AGENTS, 'pam', null);
  assert.equal(t.agent, PAM);
  assert.equal(t.inferred, false, 'clicking the agent IS naming it; the word must go quiet');
});

test('the pin outranks the selection, and neither is inferred', () => {
  const t = pickIdeTarget(AGENTS, 'pam', 'jim');
  assert.equal(t.agent, JIM);
  assert.equal(t.inferred, false);
});

test('only the fallback is inferred — and it still opens on something', () => {
  const t = pickIdeTarget(AGENTS, null, null);
  assert.equal(t.agent, GOD, 'god is the default workspace');
  assert.equal(t.inferred, true, 'nobody chose this one — this is the visit the word exists for');
});

test('a named agent with no cwd falls through rather than opening on nothing', () => {
  const homeless = { id: 'toby' };
  const t = pickIdeTarget([homeless, ...AGENTS], null, 'toby');
  assert.equal(t.agent, GOD);
  assert.equal(t.inferred, true);
});

test('no agents at all is not "assumed" — there is nothing to assume', () => {
  const t = pickIdeTarget([], 'pam', 'jim');
  assert.deepEqual(t, { agent: null, root: null, inferred: false });
});

/* ── S2: raw git stderr on a non-repo workspace ─────────────────────────── */

test('S2 — a non-repo is answered before an error can be', () => {
  // The shape of the bug: gitStatus was called first, so this error — git's own
  // `fatal: not a git repository …` — was what the rail rendered, in red.
  const stderr = 'fatal: not a git repository (or any of the parent directories): .git';
  assert.equal(gitPaneState({ isRepo: false, error: stderr }), 'not-a-repo');
});

test('the check has its own state, so the empty state cannot flash', () => {
  assert.equal(gitPaneState({ isRepo: null }), 'checking');
  assert.equal(gitPaneState({ isRepo: null, error: 'boom' }), 'checking');
});

test('a real failure INSIDE a repo is still an error', () => {
  assert.equal(gitPaneState({ isRepo: true, error: 'fatal: bad object HEAD' }), 'error');
  assert.equal(gitPaneState({ isRepo: true }), 'ready');
});

/* ── The wiring, which has no pure surface ──────────────────────────────── */

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src', p), 'utf8');

test('the rail asks whether git applies before asking git anything', () => {
  const rail = read('modern/ide/GitRail.tsx');
  assert.match(rail, /window\.cth\.gitIsRepo\(root\)/,
    'gitIsRepo is listed in modern/ide/SPEC.md as required and was called nowhere');
  // All three git panes, not just Changes: a non-repo root makes gitMainRepo
  // answer `root` back, so History and Compare printed the same stderr.
  assert.equal((rail.match(/<NotARepo root=\{root\} \/>/g) ?? []).length, 3);
  assert.match(rail, /gitPane === 'ready' && <Changes/,
    'Changes polls every 4s — do not mount it against a folder git cannot answer for');
});

test('the empty state is muted, not destructive — nothing failed', () => {
  const rail = read('modern/ide/GitRail.tsx');
  const start = rail.indexOf('function NotARepo');
  const body = rail.slice(start, start + 700);
  assert.match(body, /Not a git repository\./);
  assert.doesNotMatch(body, /text-destructive/, 'a folder without git is an ordinary fact, not an error');
});

test('IdeView takes the precedence rule from the tested module', () => {
  const view = read('modern/ide/IdeView.tsx');
  assert.match(view, /import \{ idePickerOptions, pickIdeTarget \} from '\.\/ideState'/);
  assert.doesNotMatch(view, /inferred: true/, 'the rule lives in ideState.ts, not inline here');
  assert.doesNotMatch(view, /a\.cwd \? \{ agent: a/, 'no second copy of the precedence order');
});

/* ── MD-129: the IDE gets an explicit agent picker ──────────────────────── */

// `getPickedAgentId` reads localStorage, which node has no notion of. A Map
// standing in for it is enough — and its absence is a case worth covering, so
// the stub is installed only where a test wants one.
function withStorage(fn, { throws = false } = {}) {
  const box = new Map();
  global.localStorage = {
    getItem: (k) => { if (throws) throw new Error('storage disabled'); return box.has(k) ? box.get(k) : null; },
    setItem: (k, v) => { if (throws) throw new Error('storage disabled'); box.set(k, String(v)); },
    removeItem: (k) => { if (throws) throw new Error('storage disabled'); box.delete(k); }
  };
  try { return fn(box); } finally { delete global.localStorage; }
}

const ideStore = loadTs('src/renderer/src/modern/ide/ideStore.ts');

test('MD-129 — picking an agent names the workspace, so it is not a guess', () => {
  // Before this card the ONLY explicit route in was "Open IDE" on the agent's
  // own card; from the nav rail the view could not be pointed anywhere.
  const picked = pickIdeTarget(AGENTS, null, 'jim');
  assert.equal(picked.root, '/repo/jim');
  assert.equal(picked.inferred, false);
  // And it outranks whatever the rest of the app has selected.
  assert.equal(pickIdeTarget(AGENTS, 'pam', 'jim').agent, JIM);
});

test('the picker lists agents that can actually be opened, god first', () => {
  const opts = idePickerOptions([
    { id: 'jim', name: 'Jim', cwd: '/repo/jim', ptyId: 'pty-jim' },
    { id: 'ghost', name: 'Ghost' },                                   // no cwd
    { id: 'old', name: 'Old', cwd: '/repo/old', archived: true },     // archived
    { id: 'god', name: 'Michael', cwd: '/harness', isGod: true, ptyId: 'pty-god' }
  ]);
  assert.deepEqual(opts.map((o) => o.id), ['god', 'jim'], 'god first; no cwd and archived are not options');
  assert.equal(opts[0].isGod, true);
});

test('the workspace reads basename-first — the trigger truncates at the end', () => {
  const [o] = idePickerOptions([{ id: 'a', name: 'A', cwd: '/Users/ugur/HarnessAgents/worktrees/pam-mt310mbm' }]);
  assert.match(o.label, /^pam-mt310mbm — \//, 'a raw path loses the half that identifies it');
  assert.equal(o.cwd, '/Users/ugur/HarnessAgents/worktrees/pam-mt310mbm', 'the full path is still there for the title');
});

test('a processless agent says so; a running one wears no badge', () => {
  const opts = idePickerOptions([
    { id: 'live', name: 'Live', cwd: '/a', ptyId: 'pty-live' },
    { id: 'parked', name: 'Parked', cwd: '/b' }
  ]);
  assert.equal(opts.find((o) => o.id === 'live').presence, undefined, 'a badge on every row is a badge nobody reads');
  assert.equal(opts.find((o) => o.id === 'parked').presence, 'asleep');
});

test('the pick is remembered across the view being unmounted', () => {
  withStorage(() => {
    assert.equal(ideStore.getPickedAgentId(), null, 'nothing remembered yet');
    ideStore.setPickedAgentId('jim');
    assert.equal(ideStore.getPickedAgentId(), 'jim');
    ideStore.setPickedAgentId(null);
    assert.equal(ideStore.getPickedAgentId(), null, 'clearing it means "no opinion", not the string "null"');
  });
});

test('storage that refuses still opens the IDE', () => {
  withStorage(() => {
    assert.equal(ideStore.getPickedAgentId(), null);
    assert.doesNotThrow(() => { ideStore.setPickedAgentId('jim'); });
  }, { throws: true });
  // And with no localStorage at all (this is node).
  assert.equal(ideStore.getPickedAgentId(), null);
});

test('MD-129 — switching agents keeps the other workspace\'s unsaved edits', () => {
  // The whole reason sessions are keyed by root: a switch is not a discard.
  ideStore.__resetIdeStore();
  ideStore.update('/repo/jim', (s) => ({
    ...s,
    buffers: { 'a.ts': { content: 'edited', original: 'was', status: 'ready' } }
  }));
  ideStore.update('/harness', (s) => ({ ...s, buffers: {} }));
  const jim = ideStore.getSession('/repo/jim');
  assert.equal(ideStore.isDirty(jim.buffers['a.ts']), true, 'the previous target is still dirty after the switch');
  assert.equal(jim.buffers['a.ts'].content, 'edited');
});

test('the picker is wired to the pin, not to a second source of truth', () => {
  const view = read('modern/ide/IdeView.tsx');
  assert.match(view, /onValueChange=\{setPinnedId\}/, 'picking must set the SAME pin "Open IDE" sets');
  assert.match(view, /setPickedAgentId\(pinnedId\)/, 'and it has to survive the view being unmounted');
  assert.match(view, /getPickedAgentId\(\)/, 'restored on mount');
  assert.match(view, /aria-label="Workspace"/);
  assert.match(view, /focus-visible:ring-2 focus-visible:ring-ring/, 'reachable in the normal tab order, ring left alone');
  // Radix reserves '' for "no selection"; every option here is an agent id.
  assert.doesNotMatch(view, /<SelectItem[^>]*value=""/);
});
