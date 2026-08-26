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

const { pickIdeTarget, gitPaneState } = loadTs('src/renderer/src/modern/ide/ideState.ts');

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
  assert.match(view, /import \{ pickIdeTarget \} from '\.\/ideState'/);
  assert.doesNotMatch(view, /inferred: true/, 'the rule lives in ideState.ts, not inline here');
});
