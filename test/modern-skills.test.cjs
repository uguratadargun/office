'use strict';

/**
 * MD-159 — the Skills area in the modern UI (inventory card G).
 *
 * Modern had no Skills surface at all. Nothing is lost by that — which is why
 * it was S2 — but agent behaviour becomes unexplainable: a skill is
 * instructions that fire inside an agent, and with no list of them "why did it
 * just do that?" has no answer in this UI.
 *
 * What is pinned here is the arithmetic the area does before it draws — above
 * all that the COUNT and the ROWS come from one predicate — and the three
 * rules a screen that installs executable instructions does not get to relax.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const {
  CATALOG_RENDER_CAP, matchesSkill, filterLocal, filterCatalog, facetCounts,
  isRemovable, isInstalled, installedEmptyCopy, catalogSourceNote, installOutcome, setRow
} = loadTs('src/renderer/src/modern/skills/skillsModel.ts');

const cat = (name, extra = {}) => ({
  name, description: `does ${name}`, url: `https://x/${name}`,
  category: 'general', owner: 'anthropics', ...extra
});
const local = (name, extra = {}) => ({
  id: name, name, description: `does ${name}`,
  provider: 'claude', scope: 'user', path: `/u/.claude/skills/${name}`, ...extra
});

/* ── search ─────────────────────────────────────────────────────────────── */

test('a search matches the name or the description, and nothing else', () => {
  const s = cat('pdf', { description: 'fill in forms', url: 'https://github.com/acme/pdf-tools' });
  assert.equal(matchesSkill(s, 'PDF'), true, 'case-insensitive on the name');
  assert.equal(matchesSkill(s, 'forms'), true, 'and on the description');
  // Not the url or the path: searching "acme" would then match every skill
  // that merely lives under a directory with acme in it — a different question.
  assert.equal(matchesSkill(s, 'acme'), false);
  // An empty search is not a filter.
  assert.equal(matchesSkill(s, '   '), true);
});

test('a skill with no description is still searchable by name', () => {
  assert.equal(matchesSkill({ name: 'docx' }, 'doc'), true);
  assert.equal(matchesSkill({ name: 'docx' }, 'zzz'), false);
});

/* ── the count and the rows come from ONE predicate ─────────────────────── */

test('the matching total and the rendered rows cannot disagree', () => {
  // The classic tab derived `shownCatalog` and `totalMatching` through two
  // separate copies of the same filter chain. Two copies of one predicate is
  // how a list ends up claiming a total it is not showing rows for.
  const many = Array.from({ length: CATALOG_RENDER_CAP + 25 }, (_, i) => cat(`s${i}`));
  const out = filterCatalog(many, {});
  assert.equal(out.matching.length, CATALOG_RENDER_CAP + 25, 'the real total');
  assert.equal(out.shown.length, CATALOG_RENDER_CAP, 'bounded render');
  assert.equal(out.capped, true, 'and it says so');
  // Every rendered row is one of the matches, in order.
  assert.deepEqual(out.shown, out.matching.slice(0, CATALOG_RENDER_CAP));
});

test('a list that fits is not reported as capped', () => {
  const out = filterCatalog([cat('a'), cat('b')], {});
  assert.equal(out.capped, false);
  assert.equal(out.shown.length, 2);
});

test('facets and search compose, and "all" is not a filter', () => {
  const list = [
    cat('a', { owner: 'anthropics', category: 'docs' }),
    cat('b', { owner: 'stripe', category: 'docs' }),
    cat('c', { owner: 'stripe', category: 'pay', description: 'charge a card' })
  ];
  assert.equal(filterCatalog(list, { owner: 'all', category: 'all' }).matching.length, 3);
  assert.deepEqual(filterCatalog(list, { owner: 'stripe' }).matching.map((s) => s.name), ['b', 'c']);
  assert.deepEqual(filterCatalog(list, { category: 'docs' }).matching.map((s) => s.name), ['a', 'b']);
  assert.deepEqual(
    filterCatalog(list, { owner: 'stripe', query: 'card' }).matching.map((s) => s.name), ['c']);
  assert.equal(filterCatalog(list, { owner: 'stripe', category: 'docs', query: 'card' }).matching.length, 0);
});

test('installed rows filter by the same rule', () => {
  const list = [local('pdf'), local('docx')];
  assert.deepEqual(filterLocal(list, 'pdf').map((s) => s.name), ['pdf']);
  assert.equal(filterLocal(list, '').length, 2);
  assert.deepEqual(filterLocal(undefined, 'x'), []);
});

/* ── facets ─────────────────────────────────────────────────────────────── */

test('facets are commonest first, ties broken alphabetically', () => {
  const list = [cat('a', { owner: 'z' }), cat('b', { owner: 'm' }), cat('c', { owner: 'm' }), cat('d', { owner: 'a' })];
  // The catalog's own order is whatever the upstream file happens to be in; a
  // dropdown that reshuffles between two refreshes is one nobody trusts.
  assert.deepEqual(facetCounts(list, 'owner'), [['m', 2], ['a', 1], ['z', 1]]);
  assert.deepEqual(facetCounts([], 'owner'), []);
});

/* ── the rules this screen does not relax ───────────────────────────────── */

test('a bundled skill is never offered a remove button', () => {
  // Bundled skills are re-copied into every agent on spawn, so "removing" one
  // deletes a folder that comes straight back — and the behaviour the user was
  // trying to stop keeps happening after the row disappears.
  assert.equal(isRemovable(local('x', { scope: 'bundled' })), false);
  assert.equal(isRemovable(local('x', { scope: 'user' })), true);
  assert.equal(isRemovable(local('x', { scope: 'project' })), true);
});

test('an uninstallable catalog entry does not invite a retry loop', () => {
  // `unsupported` means there is no downloadable source, so retrying can never
  // work — that is a different sentence from a download that failed.
  const un = installOutcome({ ok: false, error: 'no source archive', unsupported: true });
  assert.match(un.error, /open the page/i);
  const failed = installOutcome({ ok: false, error: 'network refused' });
  assert.equal(failed.error, 'network refused');
  // Success leaves NO row state: what the row looks like afterwards is the
  // installed list's answer, not something this row remembers.
  assert.equal(installOutcome({ ok: true, path: '/p' }), null);
});

test('"Installed" is read off disk, not remembered by the row', () => {
  // The live run caught this one in the port: install a skill, uninstall it
  // from the Installed pane, and the catalog row still read "Installed" and
  // stayed disabled — the install marked the row by URL and the uninstall
  // cleared it by PATH, so the two never met and the entry could not be
  // reinstalled without a full refetch. The local list is refreshed after both
  // operations, so deriving from it is self-correcting.
  const installed = [local('xlsx')];
  assert.equal(isInstalled({ name: 'xlsx' }, installed), true);
  assert.equal(isInstalled({ name: 'XLSX' }, installed), true, 'case is not identity');
  assert.equal(isInstalled({ name: 'docx' }, installed), false);
  // After an uninstall the list is what changed, and the answer follows it.
  assert.equal(isInstalled({ name: 'xlsx' }, []), false);
  assert.equal(isInstalled({ name: 'xlsx' }, null), false, 'not loaded yet is not installed');
});

test('a cached catalog says so, and a live one says nothing', () => {
  // A cached copy shown as if it were live is how someone retries an install
  // against a catalog entry that no longer exists.
  assert.match(catalogSourceNote({ stale: true, error: 'offline' }), /cached copy — offline\./);
  assert.match(catalogSourceNote({ stale: true }), /cached copy/);
  assert.equal(catalogSourceNote({ stale: false }), null);
  assert.equal(catalogSourceNote(null), null);
});

test('"nothing installed" and "nothing matches" are different facts', () => {
  assert.match(installedEmptyCopy(0, ''), /No skills installed yet/);
  assert.match(installedEmptyCopy(12, 'zzz'), /No installed skill matches that/);
  // A search over an empty machine is still a search — it must not claim the
  // machine is bare when the user has typed a filter.
  assert.match(installedEmptyCopy(0, 'zzz'), /matches that/);
});

test('one row failing is one row failing', () => {
  // A panel-wide error makes a refused install look like the catalog being
  // down, and the user refreshes instead of reading the reason.
  let s = setRow({}, 'a', { busy: true });
  s = setRow(s, 'b', { error: 'nope' });
  assert.deepEqual(Object.keys(s).sort(), ['a', 'b']);
  assert.equal(setRow(s, 'a', null).a, undefined);
  assert.equal(setRow(s, 'a', null).b.error, 'nope', 'clearing one leaves the other');
});

test('the catalog row reads its label from the local list', () => {
  const VIEW_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', 'src/renderer/src/modern/skills/SkillsView.tsx'), 'utf8');
  assert.match(VIEW_SRC, /installed=\{isInstalled\(s, local\)\}/);
  // The sticky-flag version this replaced.
  assert.doesNotMatch(VIEW_SRC, /state\?\.done/, 'no remembered install flag');
});

/* ── shape: reachable, and the decision stays a decision ────────────────── */

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const VIEW = read('src/renderer/src/modern/skills/SkillsView.tsx');
const NAV = read('src/renderer/src/modern/nav.ts');

test('the area is reachable and all five IPCs are wired', () => {
  assert.match(NAV, /id: 'skills'/);
  assert.match(NAV, /import\('\.\/skills\/SkillsView'\)/, 'lazy, like every other area');
  for (const call of ['skillsLocal', 'skillsCatalog', 'skillsInstall', 'skillsUninstall', 'skillsReveal']) {
    assert.match(VIEW, new RegExp(`window\\.cth\\.${call}\\(`), `${call} is wired`);
  }
});

test('installing stays a decision, and removing is armed', () => {
  // A skill is instructions that run inside an agent holding the user's tools
  // and keys. The publisher is the whole basis for trusting it, so it is never
  // hidden, and the row always links out.
  assert.match(VIEW, /skill\.owner/, 'the publisher is shown');
  assert.match(VIEW, /window\.cth\.openExternal\(skill\.url\)/, 'and the row links out');
  assert.match(VIEW, /<DestructiveButton/, 'uninstall is armed');
  assert.match(VIEW, /consequence=/, 'and says what it destroys');
  // No bulk install, no "install all" — every one is a separate decision.
  assert.doesNotMatch(VIEW, /installAll|Install all/i);
});

test('the catalog is not fetched until Browse is opened', () => {
  // Someone who only wanted to see what is installed should not cost a network
  // round trip.
  assert.match(VIEW, /if \(mode === 'browse' && catalog === null\) void loadCatalog\(\);/);
});
