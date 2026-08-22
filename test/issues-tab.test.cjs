const test = require('node:test');
const assert = require('node:assert');
const loadTs = require('./load-ts.cjs');

const { resolveIssueRepo, verdictFrame, LS_ISSUE_REPO } = loadTs('src/renderer/src/components/issuesTab.ts');
const { chipState } = loadTs('src/shared/prReview.ts');

// ─── (MD-48) the repo the Issues tab opens on ───────────────────────────────
// The tab unmounts on every tab switch, so "which repo" has to survive outside
// the component or it silently snaps back to the first one.

test('a remembered repo survives a tab switch', () => {
  const repos = ['/a/one', '/b/two', '/c/three'];
  assert.equal(resolveIssueRepo(repos, '/b/two'), '/b/two');
});

test('nothing remembered falls back to the first repo', () => {
  assert.equal(resolveIssueRepo(['/a/one', '/b/two'], null), '/a/one');
  assert.equal(resolveIssueRepo(['/a/one', '/b/two'], ''), '/a/one');
});

test('a repo that is no longer registered does not win', () => {
  // Unregistering a repo used to leave the tab pointed at a dead path, fetching
  // nothing and blaming the host for it.
  assert.equal(resolveIssueRepo(['/a/one', '/b/two'], '/gone/away'), '/a/one');
});

test('no repos at all resolves to empty, never undefined', () => {
  assert.equal(resolveIssueRepo([], '/b/two'), '');
  assert.equal(resolveIssueRepo([], null), '');
});

test('the storage key stays in this app’s namespace', () => {
  assert.match(LS_ISSUE_REPO, /^cth\./);
});

// ─── (MD-48) the verdict frame ──────────────────────────────────────────────
// A NOT READY review rendering as anything but red is the failure this whole
// card exists for.

test('NOT READY frames red and READY frames green', () => {
  assert.equal(verdictFrame(chipState({ verdict: 'not_ready' })).color, 'var(--cth-coral)');
  assert.equal(verdictFrame(chipState({ verdict: 'ready' })).color, 'var(--cth-mint)');
});

test('unreviewed and no-verdict stay a neutral hairline', () => {
  // Red must only ever mean "someone read this and it is not ready". If the
  // engine failing to answer also painted red, the colour would stop meaning it.
  for (const state of ['neutral']) {
    assert.deepEqual(verdictFrame(state), { color: 'var(--cth-ink-300)', width: 1 });
  }
  assert.deepEqual(verdictFrame(chipState(undefined)), { color: 'var(--cth-ink-300)', width: 1 });
  assert.deepEqual(verdictFrame(chipState({ verdict: 'unknown' })), { color: 'var(--cth-ink-300)', width: 1 });
});

test('a verdict frame is thicker than the neutral one', () => {
  // The colour alone is not the signal — the frame has to read as a frame.
  assert.ok(verdictFrame('red').width > verdictFrame('neutral').width);
  assert.ok(verdictFrame('green').width > verdictFrame('neutral').width);
});

test('a review in flight is neither green nor red', () => {
  assert.equal(verdictFrame(chipState({ verdict: 'ready' }, true)).color, 'var(--cth-lemon)');
});
