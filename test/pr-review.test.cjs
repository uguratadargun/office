'use strict';

/**
 * Local PR review (MD-47) — the pure half.
 *
 * The one failure that matters here is a FALSE GREEN. Everything else is an
 * inconvenience: a chip that stays neutral, a report that has to be re-run. A
 * verdict parser that answers READY when the engine did not say so puts a merge
 * button next to a diff nobody vouched for.
 *
 * So the parser defaults to `unknown` on every path that is not an explicit
 * READY, and these tests spend most of their weight on the ways real engine
 * output can *look* like an approval without being one.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  parseVerdict, repoRefFromUrl, reviewFileName, reviewKey, chipState, reviewPrompt, DIFF_CAP
} = loadTs('src/shared/prReview.ts');

// Real shape of what these engines return: prose, headings, then the last line.
const READY_REPORT = `## Summary
Adds an \`--effort\` flag to the Claude preset and threads it through the spawn path.

## Blocking issues
None.

## Non-blocking notes
- \`isValidEffort\` could take the preset instead of the id.

## Tests and CI
CI is green; the new behaviour has 9 tests derived from the presets table.

VERDICT: READY
`;

const NOT_READY_REPORT = `## Summary
Rewrites the auth middleware.

## Blocking issues
- \`session.ts:88\` trusts an unvalidated \`role\` claim from the token body.

## Tests and CI
CI failing: 3 tests in auth.test.ts.

VERDICT: NOT READY — an unvalidated role claim is trusted for authorization
`;

test('a READY report reads as ready', () => {
  assert.deepEqual(parseVerdict(READY_REPORT), { verdict: 'ready' });
});

test('a NOT READY report carries its one-line reason', () => {
  const r = parseVerdict(NOT_READY_REPORT);
  assert.equal(r.verdict, 'not_ready');
  assert.equal(r.reason, 'an unvalidated role claim is trusted for authorization');
});

test('a report with no verdict line is unknown, NEVER ready', () => {
  // This is the one that matters: a truncated answer, a refusal, an engine that
  // ignored the format. None of them approved anything.
  for (const text of [
    '',
    'I was unable to fetch the diff.',
    '## Summary\nLooks good to me, ship it.',   // the trap: approving PROSE, no verdict
    'VERDICT:',
    'VERDICT: MAYBE',
    'THE VERDICT IS READY'                       // not the required form
  ]) {
    assert.deepEqual(parseVerdict(text), { verdict: 'unknown' }, JSON.stringify(text));
  }
});

test('the verdict is read from the END, so quoting the format does not approve', () => {
  // A careful reviewer restates its instructions before reasoning. Taking the
  // FIRST match would score this thorough review as an approval.
  const text = [
    'I was asked to end with VERDICT: READY or VERDICT: NOT READY — <reason>.',
    '',
    '## Blocking issues',
    '- the migration drops a column with no backfill',
    '',
    'VERDICT: NOT READY — the migration drops a column with no backfill'
  ].join('\n');
  const r = parseVerdict(text);
  assert.equal(r.verdict, 'not_ready');
  assert.equal(r.reason, 'the migration drops a column with no backfill');
});

test('markdown around the verdict line is tolerated', () => {
  // Engines bold their last line, or quote it, or add a period. The content is
  // right; reporting `unknown` over punctuation would be its own false signal.
  assert.equal(parseVerdict('**VERDICT: READY**').verdict, 'ready');
  assert.equal(parseVerdict('> VERDICT: READY').verdict, 'ready');
  assert.equal(parseVerdict('`VERDICT: READY`').verdict, 'ready');
  assert.equal(parseVerdict('verdict: ready').verdict, 'ready');
  const r = parseVerdict('**VERDICT: NOT READY — no tests.**');
  assert.equal(r.verdict, 'not_ready');
  assert.equal(r.reason, 'no tests');
});

test('a NOT READY with no reason is still NOT READY', () => {
  assert.deepEqual(parseVerdict('VERDICT: NOT READY'), { verdict: 'not_ready', reason: undefined });
});

test('repo coordinates come from the PR url, for both hosts', () => {
  assert.deepEqual(repoRefFromUrl('https://github.com/acme/widgets/pull/12'),
    { host: 'github', owner: 'acme', repo: 'widgets' });
  assert.deepEqual(repoRefFromUrl('https://gitlab.com/acme/widgets/-/merge_requests/12'),
    { host: 'gitlab', owner: 'acme', repo: 'widgets' });
  // Self-hosted GitLab is on its own domain — the PATH shape decides the host.
  assert.deepEqual(repoRefFromUrl('https://git.internal.example/team/sub/widgets/-/merge_requests/3'),
    { host: 'gitlab', owner: 'team-sub', repo: 'widgets' });
  for (const bad of ['', 'not a url', 'https://github.com/acme', 'https://example.com/x/y/issues/4']) {
    assert.equal(repoRefFromUrl(bad), null, bad);
  }
});

test('the report filename is stable, scoped, and safe on Windows', () => {
  const ref = { host: 'github', owner: 'acme', repo: 'widgets' };
  const name = reviewFileName(ref, 12, '2026-08-21T15:40:00.000Z');
  assert.equal(name, 'github-acme-widgets-PR12-2026-08-21T15-40-00-000Z.md');
  // No path separators and no colons, whatever the repo is called.
  const nasty = reviewFileName({ host: 'github', owner: '../..', repo: 'a/b:c' }, 1, '2026-01-01T00:00:00Z');
  assert.doesNotMatch(nasty, /[/\\:]/);
  assert.match(nasty, /^github-unknown-a-b-c-PR1-/);
});

test('the cache key identifies a PR across repos with the same number', () => {
  const a = reviewKey({ host: 'github', owner: 'acme', repo: 'widgets' }, 12);
  const b = reviewKey({ host: 'github', owner: 'acme', repo: 'gadgets' }, 12);
  assert.equal(a, 'github/acme/widgets#12');
  assert.notEqual(a, b);
});

test('chip colour follows the verdict, and unknown is NOT green', () => {
  const rec = (verdict) => ({ key: 'k', number: 1, verdict, path: '/p', ts: 0, engine: 'claude', durationMs: 0 });
  assert.equal(chipState(undefined), 'neutral');
  assert.equal(chipState(rec('ready')), 'green');
  assert.equal(chipState(rec('not_ready')), 'red');
  // An engine that failed is not a bad diff, and must not look like one.
  assert.equal(chipState(rec('unknown')), 'neutral');
  assert.equal(chipState(rec('ready'), true), 'running');
  assert.equal(chipState(undefined, true), 'running');
});

test('the prompt demands the verdict last and carries the real PR state', () => {
  const p = reviewPrompt({
    number: 12, title: 'Add effort flag', body: 'Closes #3', state: 'open',
    draft: false, review: 'pending', ci: 'success', diff: 'diff --git a b'
  });
  assert.match(p, /VERDICT: READY/);
  assert.match(p, /VERDICT: NOT READY/);
  assert.match(p, /VERY LAST LINE/);
  assert.match(p, /PR #12: Add effort flag/);
  assert.match(p, /CI: success/);
  assert.match(p, /diff --git a b/);
});

test('an oversized diff is truncated VISIBLY, so the report can admit it', () => {
  const huge = 'x'.repeat(DIFF_CAP + 5000);
  const p = reviewPrompt({
    number: 1, title: 't', body: '', state: 'open', draft: false,
    review: 'none', ci: 'none', diff: huge
  });
  assert.match(p, /diff truncated at/);
  assert.match(p, /do not claim to have reviewed what you could not see/);
  assert.ok(p.length < huge.length + 4000, 'the cap must actually cut the diff');
});

test('a round trip: the parser reads back what the prompt asked for', () => {
  // Derived rather than pinned — if the required form in the prompt ever changes,
  // this fails instead of the parser quietly stopping to match it.
  const p = reviewPrompt({
    number: 1, title: 't', body: '', state: 'open', draft: false, review: 'none', ci: 'none', diff: 'd'
  });
  const readyLine = p.split('\n').find((l) => /^VERDICT: READY$/.test(l));
  assert.ok(readyLine, 'the prompt must contain the exact READY form');
  assert.equal(parseVerdict(`some review text\n\n${readyLine}`).verdict, 'ready');
});
