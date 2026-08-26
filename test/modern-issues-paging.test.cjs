'use strict';

/**
 * MD-127 — the Issues list stopped at ten and the only way past it was to
 * narrow the search until what you wanted fitted. It now loads twenty, and
 * twenty more as you reach the bottom.
 *
 * The part worth testing is not the scrolling. Neither `gh issue list` nor
 * `glab issue list` has an offset or a cursor — you can only ask for the first
 * N — so "the next page" is a BIGGER N and the answer re-includes everything
 * already on screen. The merge is what makes that correct, and a sentinel that
 * fires more than once per page is what makes it expensive.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const loadTs = require('./load-ts.cjs');
const { ISSUE_PAGE_SIZE, appendPage, hasMorePages, pageLimit, pageCapNote } =
  loadTs('src/renderer/src/modern/issues/paging.ts');
const { issueListCommand, issueListLimit, ISSUE_LIST_LIMIT, ISSUE_LIST_MAX } =
  loadTs('src/main/github.ts');

const issue = (n, title = `#${n}`) => ({ number: n, title });
const page = (from, count) => Array.from({ length: count }, (_, i) => issue(from + i));

/* ── 1. Paging appends and dedupes ──────────────────────────────────────── */

test('the human asked for twenty', () => {
  assert.equal(ISSUE_PAGE_SIZE, 20);
  assert.equal(pageLimit(1), 20);
  assert.equal(pageLimit(2), 40, 'page 2 asks for two pages worth — there is no offset to ask for');
  assert.equal(pageLimit(0), 20, 'never ask for nothing');
});

test('a second page appends without repeating the first', () => {
  const first = page(100, 20);
  // What the host actually answers on page 2: forty rows, the first twenty of
  // which are the ones already on screen.
  const second = [...first, ...page(120, 20)];
  const merged = appendPage(first, second);
  assert.equal(merged.length, 40, 'no duplicates across pages');
  assert.deepEqual(merged.map((i) => i.number), [...page(100, 40).map((i) => i.number)]);
  assert.equal(new Set(merged.map((i) => i.number)).size, 40, 'React keys stay unique');
});

test('a row keeps its place but takes the fresher copy of itself', () => {
  // Order must be stable — a row that moves out from under a click is worse
  // than a stale title — but the later fetch has seen the newer state.
  const shown = [issue(1, 'old title'), issue(2, 'two')];
  const incoming = [issue(2, 'two'), issue(1, 'RENAMED'), issue(3, 'three')];
  const merged = appendPage(shown, incoming);
  assert.deepEqual(merged.map((i) => i.number), [1, 2, 3], 'first occurrence wins the position');
  assert.equal(merged[0].title, 'RENAMED', 'last occurrence wins the data');
});

test('the empty cases are not special cases', () => {
  assert.deepEqual(appendPage([], []), []);
  assert.deepEqual(appendPage([], page(1, 3)).map((i) => i.number), [1, 2, 3]);
  assert.deepEqual(appendPage(page(1, 3), []).map((i) => i.number), [1, 2, 3]);
});

test('a short answer is the only evidence the host has run out', () => {
  assert.equal(hasMorePages(20, 20), true, 'a full page means there is probably more');
  assert.equal(hasMorePages(13, 20), false, 'the host had nothing else to give');
  assert.equal(hasMorePages(0, 20), false);
  // …and that is what the end-state line keys on.
  assert.equal(pageCapNote(13, false), 'All 13 loaded.');
  assert.equal(pageCapNote(20, true), null);
});

/* ── 2. The sentinel fires exactly one fetch ────────────────────────────── */

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src', p), 'utf8');
const VIEW = read('modern/issues/IssuesView.tsx');

test('the in-flight guard is a ref, not React state', () => {
  // An observer fires repeatedly while a row scrolls into place. `loading` is
  // state: it is not true yet on the second call in the same tick, so guarding
  // on it launches several identical `gh` calls at once.
  assert.match(VIEW, /pageInFlight = useRef\(false\)/);
  assert.match(VIEW, /if \(pageInFlight\.current \|\| loading \|\| !morePages\) return;/,
    'one in-flight page, and none at all once the host has run out');
  assert.match(VIEW, /pageInFlight\.current = true;/);
  assert.match(VIEW, /pageInFlight\.current = false;/, 'cleared in `finally` — a failed page must not wedge the list');
});

test('the observer is not rebuilt on every render', () => {
  // Rebuilding it disconnects and reconnects, and a reconnect fires immediately
  // for an element already in view — which is a fetch per keystroke.
  const start = VIEW.indexOf('function PageSentinel');
  const body = VIEW.slice(start, start + 1600);
  assert.match(body, /const latest = useRef\(onLoadMore\)/, 'the callback rides a ref');
  assert.match(body, /new IntersectionObserver/);
  assert.match(body, /\}, \[\]\);/, 'the effect has no deps — it is set up once');
  assert.match(body, /io\.disconnect\(\)/, 'and torn down');
  assert.match(body, /rootMargin/, 'fetch a screenful early, so the page is there on arrival');
  assert.match(body, /Load \{ISSUE_PAGE_SIZE\} more/, 'keyboard and screen-reader route to the same action');
});

test('a new filter is a new list, not page 7 of the old one', () => {
  assert.match(VIEW, /setPages\(1\);\s*\n\s*setMorePages\(false\);/,
    'the old page count and its "there is more" belong to the old query');
});

/* ── 3. The IPC carries the limit ───────────────────────────────────────── */

test('the page size reaches the CLI instead of being sliced off afterwards', () => {
  // The old shape fetched 30 and threw away 20 of them in the renderer.
  const gh = issueListCommand('github', { limit: 40 });
  assert.equal(gh.cmd, 'gh');
  assert.deepEqual(gh.args.slice(-2), ['--limit', '40']);
  const glab = issueListCommand('gitlab', { limit: 40 });
  assert.equal(glab.cmd, 'glab');
  assert.deepEqual(glab.args.slice(-2), ['--per-page', '40']);
});

test('leaving the limit out is exactly what every existing caller had', () => {
  assert.deepEqual(issueListCommand('github', {}).args.slice(-2), ['--limit', String(ISSUE_LIST_LIMIT)]);
  assert.deepEqual(issueListCommand('gitlab', {}).args.slice(-2), ['--per-page', String(ISSUE_LIST_LIMIT)]);
});

test('a limit the CLI would choke on never reaches it', () => {
  assert.equal(issueListLimit(undefined), ISSUE_LIST_LIMIT);
  assert.equal(issueListLimit(Number.NaN), ISSUE_LIST_LIMIT, 'NaN would render as "NaN" and return nothing');
  assert.equal(issueListLimit(0), 1, 'a zero limit silently returns an empty repo');
  assert.equal(issueListLimit(-5), 1);
  assert.equal(issueListLimit(20.7), 20, 'whole rows only');
  assert.equal(issueListLimit(10_000), ISSUE_LIST_MAX, 'a runaway page counter must not walk the whole repo');
});

test('the limit rides alongside the filters, not instead of them', () => {
  const { args } = issueListCommand('github', { limit: 60, mine: true, search: 'crash' });
  assert.deepEqual(args.slice(-4), ['--assignee', '@me', '--search', 'crash']);
  assert.ok(args.includes('60'), 'the limit survives the other flags being appended');
});

test('the renderer asks for the page it is on', () => {
  assert.match(VIEW, /limit: askedFor/);
  assert.match(VIEW, /const askedFor = pageLimit\(page\);/);
  assert.match(VIEW, /page === 1 \? batch : appendPage\(prev, batch\)/,
    'page 1 replaces; a later page merges');
});

test('the PRs segment pages the rows it already has', () => {
  // The watcher hands over every PR it holds, so paging there is about what is
  // RENDERED — no second fetch, and nothing to guard.
  assert.match(VIEW, /open\.slice\(0, pageLimit\(prPages\)\)/);
  assert.match(VIEW, /morePrs && <PageSentinel loading=\{false\}/);
});
