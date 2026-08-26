'use strict';

/**
 * MD-128 — "on issues and PRs I need to see who they are assigned to, with
 * their avatars."
 *
 * The awkward part is that GitHub's CLI does not hand over an avatar. Verified
 * against the real thing before choosing an approach:
 *
 *     gh pr list --json assignees  →  {id, login, name}          (no avatar)
 *     gh pr list --json author     →  {id, is_bot, login, name}  (no avatar)
 *     gh pr view  --json reviews   →  {author:{login}, state}    (no avatar)
 *
 * Only `gh api graphql` carries `avatarUrl`, and moving the shared list call to
 * GraphQL to decorate a row would rewrite the one data path the watcher, the
 * review flow and both UIs share. So GitHub avatars are DERIVED from the login
 * (`https://avatars.githubusercontent.com/<login>` — canonical, zero extra
 * requests, and the card said not to add a call per row) while GitLab's are
 * CARRIED, because its API returns `avatar_url` outright.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const people = loadTs('src/shared/people.ts');
const gh = loadTs('src/main/github.ts');
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

/* ── (1) mapping the host payload → people with avatars ─────────────────── */

test('GitHub assignees map to people, avatar derived from the login', () => {
  // The exact shape `gh pr list --json assignees` returned for fd#2102.
  const raw = [
    { id: 'MDQ6VXNlcjE2OTI1OTE=', login: 'tavianator', name: 'Tavian Barnes', databaseId: 0 },
    { id: 'MDQ6VXNlcjQyMDkyNzY=', login: 'sharkdp', name: 'David Peter', databaseId: 0 }
  ];
  assert.deepEqual(gh.githubPeople(raw), [
    { login: 'tavianator', name: 'Tavian Barnes', avatarUrl: 'https://avatars.githubusercontent.com/tavianator' },
    { login: 'sharkdp', name: 'David Peter', avatarUrl: 'https://avatars.githubusercontent.com/sharkdp' }
  ]);
});

test('GitLab people CARRY their avatar_url rather than deriving one', () => {
  assert.deepEqual(
    gh.gitlabPeople([{ username: 'ugur', name: 'Uğur', avatar_url: 'https://gitlab.ordulu.com/uploads/x.png' }]),
    [{ login: 'ugur', name: 'Uğur', avatarUrl: 'https://gitlab.ordulu.com/uploads/x.png' }]
  );
  // No avatar on the payload ⇒ undefined, which is the initials path.
  assert.deepEqual(gh.gitlabPeople([{ username: 'ugur', avatar_url: null }]),
    [{ login: 'ugur', name: undefined, avatarUrl: undefined }]);
});

test('a person with no login is not a person', () => {
  assert.deepEqual(gh.githubPeople([{ name: 'Ghost' }, { login: '   ' }, null]), []);
  assert.deepEqual(gh.gitlabPeople([{ name: 'Ghost' }, undefined]), []);
  assert.deepEqual(gh.githubPeople(undefined), []);
  assert.equal(people.githubAvatarUrl(''), undefined, 'a blank login must not build …/ and request the host index');
  assert.equal(people.githubAvatarUrl('  '), undefined);
});

test('a login with URL-unsafe characters is encoded, not concatenated', () => {
  assert.equal(people.githubAvatarUrl('a b/c'), 'https://avatars.githubusercontent.com/a%20b%2Fc');
});

/* ── (2) the stack: 3 + "+N" ────────────────────────────────────────────── */

const p = (n) => Array.from({ length: n }, (_, i) => ({ login: `u${i + 1}` }));

test('the stack shows three faces and counts the rest', () => {
  assert.deepEqual(people.avatarStack(p(2)), { shown: p(2), overflow: 0 });
  assert.deepEqual(people.avatarStack(p(3)), { shown: p(3), overflow: 0 });
  const five = people.avatarStack(p(5));
  assert.deepEqual(five.shown.map((x) => x.login), ['u1', 'u2', 'u3']);
  assert.equal(five.overflow, 2, 'the hidden ones are COUNTED — silent truncation is the lie MD-130 came from');
});

test('an empty or absent list draws nothing', () => {
  assert.deepEqual(people.avatarStack([]), { shown: [], overflow: 0 });
  assert.deepEqual(people.avatarStack(undefined), { shown: [], overflow: 0 });
  assert.deepEqual(people.avatarStack([{ login: '' }, null]), { shown: [], overflow: 0 });
});

test('the tooltip lists EVERY login, not just the shown ones', () => {
  assert.equal(people.loginList(p(5)), 'u1, u2, u3, u4, u5');
  assert.equal(people.loginList([]), '');
});

/* ── (3) the fallback: initials, always ─────────────────────────────────── */

test('initials prefer the display name, and never render punctuation', () => {
  assert.equal(people.initialsFor({ login: 'sharkdp', name: 'David Peter' }), 'DP');
  assert.equal(people.initialsFor({ login: 'sharkdp' }), 'SH');
  assert.equal(people.initialsFor({ login: 'tmccombs', name: 'Thayne' }), 'TH');
  assert.equal(people.initialsFor({ login: '_ghost' }), 'GH', 'a tile reading "_G" is noise');
  assert.equal(people.initialsFor({ login: 'a' }), 'A');
  assert.equal(people.initialsFor({}), '?', 'something, never an empty tile');
  assert.equal(people.initialsFor({ name: 'Uğur Ata Dargun' }), 'UD', 'first and LAST word');
});

test('the component renders the fallback whenever there is no avatar', () => {
  const src = read('src/renderer/src/modern/issues/AssigneeStack.tsx');
  // Radix's Fallback is the whole reason for using it over a bare <img>.
  assert.match(src, /Avatar\.Fallback/);
  assert.match(src, /\{p\.avatarUrl && \(/, 'no src ⇒ no <img> at all, so nothing can 404 into a broken tile');
  assert.match(src, /delayMs=\{0\}/, 'a blank tile that fills in later reads as a bug on a list that repolls');
  assert.match(src, /initialsFor\(p\)/);
});

/* ── (4) the CSP: exactly one host added ────────────────────────────────── */

test('the renderer CSP allows the avatar host and nothing else new', () => {
  const html = read('src/renderer/index.html');
  const m = /img-src ([^;]*);/.exec(html);
  assert.ok(m, 'img-src must still be declared');
  assert.deepEqual(m[1].trim().split(/\s+/), [
    "'self'", 'data:', 'blob:', 'https://avatars.githubusercontent.com'
  ], 'exactly these four — one host was added, nothing was widened');
  // The other directives must not have been touched while adding it.
  assert.match(html, /default-src 'self'/);
  assert.match(html, /script-src 'self'/);
});

test('the avatar host in the CSP is the one the code actually builds', () => {
  const html = read('src/renderer/index.html');
  assert.ok(html.includes(people.GITHUB_AVATAR_HOST),
    'the constant and the CSP must not drift — a silent mismatch is an invisible broken image');
});
