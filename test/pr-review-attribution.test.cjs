'use strict';

/**
 * MD-130 — "it says approved but I did not approve".
 *
 * The human read that on their own project. Nothing had approved on their
 * behalf: `githubWrite` (the only route to the review-submit verb) has zero
 * callers in the renderer, `writePR` is reached from one IPC nothing invokes,
 * and the pr-watcher arms `gh pr merge --auto`, which is a merge.
 *
 * The word came from GitLab. Their project has no approval rule, and GitLab's
 * `approved` flag means "this MR MEETS ITS APPROVAL REQUIREMENTS" — with
 * `approvals_required: 0` there is nothing to meet, so it answers true on every
 * MR with an EMPTY approver list. Read off their live instance while
 * diagnosing (read-only, four MRs, all identical):
 *
 *     approved=True | approvals_required=0 | approved_by=[]
 *
 * Two rules come out of that and both are pinned here:
 *   1. no approver ⇒ no approval (the data layer);
 *   2. the word never appears without a name beside it (the renderer).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const gh = loadTs('src/main/github.ts');
const data = loadTs('src/renderer/src/modern/issues/issuesData.ts');
const people = loadTs('src/shared/people.ts');
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

/* ── 1. The data layer: gitlabReview ────────────────────────────────────── */

const CLEAN = { blocking_discussions_resolved: true };

test('MD-130 — approvals_required:0 with an empty approver list is NOT an approval', () => {
  // The exact shape from the human's instance.
  assert.equal(
    gh.gitlabReview(CLEAN, { approved: true, approvals_required: 0, approved_by: [] }),
    'none',
    'this is the bug: every MR on a rule-less project claimed an approval nobody gave'
  );
});

test('MD-130 — a real approver still approves', () => {
  assert.equal(
    gh.gitlabReview(CLEAN, {
      approved: true, approvals_required: 1,
      approved_by: [{ user: { username: 'tavianator' } }]
    }),
    'approved'
  );
  // …and an approver on a rule-less project counts too: someone pressed it.
  assert.equal(
    gh.gitlabReview(CLEAN, {
      approved: true, approvals_required: 0,
      approved_by: [{ user: { username: 'sharkdp' } }]
    }),
    'approved'
  );
});

test('MD-130 — a blank username in the approver list is not an approver', () => {
  assert.equal(
    gh.gitlabReview(CLEAN, { approved: true, approvals_required: 0, approved_by: [{ user: { username: '  ' } }] }),
    'none'
  );
  assert.equal(
    gh.gitlabReview(CLEAN, { approved: true, approvals_required: 0, approved_by: [{}] }),
    'none'
  );
});

test('MD-130 — the guards that were already right stay right', () => {
  // Unresolved discussions still beat everything: changes_requested.
  assert.equal(
    gh.gitlabReview({ blocking_discussions_resolved: false }, { approved: true, approved_by: [{ user: { username: 'x' } }] }),
    'changes_requested'
  );
  // A rule exists and is unmet → pending, not none.
  assert.equal(gh.gitlabReview(CLEAN, { approved: false, approvals_required: 2, approved_by: [] }), 'pending');
  // "We could not tell" must never read as "nobody is blocking".
  assert.equal(gh.gitlabReview({}, { approved: false, approvals_required: 0 }), 'pending');
});

/* ── 2. The renderer: the word never stands alone ───────────────────────── */

const open = (over) => ({ state: 'open', draft: false, ...over });

test('MD-130 — a decision is ALWAYS qualified with who made it', () => {
  assert.equal(
    data.prSuffix(open({ review: 'approved', decidedBy: [{ login: 'sharkdp' }] })),
    'approved by sharkdp'
  );
  assert.equal(
    data.prSuffix(open({ review: 'changes_requested', decidedBy: [{ login: 'tmccombs' }] })),
    'changes requested by tmccombs'
  );
  assert.equal(
    data.prSuffix(open({ review: 'approved', decidedBy: [{ login: 'a' }, { login: 'b' }] })),
    'approved by a and b'
  );
  assert.equal(
    data.prSuffix(open({ review: 'approved', decidedBy: [{ login: 'a' }, { login: 'b' }, { login: 'c' }] })),
    'approved by a +2'
  );
});

test('MD-130 — a decision with NOBODY attached renders nothing at all', () => {
  // There is no honest way to print it, so it is not printed. This is what the
  // human would now see on their rule-less GitLab project if the data layer
  // ever handed the word through again.
  assert.equal(data.prSuffix(open({ review: 'approved', decidedBy: [] })), '');
  assert.equal(data.prSuffix(open({ review: 'approved' })), '');
  assert.equal(data.prSuffix(open({ review: 'changes_requested', decidedBy: [] })), '');
});

test('MD-130 — the bare words can never be produced, whatever the input', () => {
  const REVIEWS = ['approved', 'changes_requested', 'pending', 'none', undefined, 'nonsense'];
  const WHO = [undefined, [], [{ login: 'x' }], [{ login: 'x' }, { login: 'y' }]];
  for (const review of REVIEWS) {
    for (const decidedBy of WHO) {
      for (const draft of [false, true]) {
        for (const state of ['open', 'merged', 'closed']) {
          const out = data.prSuffix({ state, draft, review, decidedBy });
          assert.notEqual(out, 'approved', `bare "approved" from ${JSON.stringify({ state, draft, review, decidedBy })}`);
          assert.notEqual(out, 'changes requested', 'bare "changes requested"');
          if (/^approved/.test(out)) assert.match(out, /^approved by \S/, 'approved must always name someone');
        }
      }
    }
  }
});

test("MD-130 — the app's own computed `ready` has left the decision slot", () => {
  // It used to win FIRST, so an approved PR read `ready` and an unreviewed one
  // read `ready` too — one badge, two meanings, neither labelled.
  assert.equal(data.prSuffix(open({ ready: true, review: 'none' })), '');
  assert.equal(data.prSuffix(open({ ready: true, review: 'approved', decidedBy: [{ login: 'z' }] })), 'approved by z');
  assert.doesNotMatch(read('src/renderer/src/modern/issues/issuesData.ts').split('export function prSuffix')[1].slice(0, 700),
    /return 'ready'/, 'the ready branch must be gone from the badge');
});

test('MD-130 — state and draft still beat the decision', () => {
  assert.equal(data.prSuffix({ state: 'merged', review: 'approved', decidedBy: [{ login: 'a' }] }), 'merged');
  assert.equal(data.prSuffix(open({ draft: true, review: 'approved', decidedBy: [{ login: 'a' }] })), 'draft');
  assert.equal(data.prSuffix(open({ review: 'pending' })), 'review pending');
});

test('MD-130 — a GitHub decision and a LOCAL verdict can never read the same', () => {
  // The local engine verdict's vocabulary, from ReviewDialog + railTone.
  const LOCAL = ['READY', 'NOT READY', 'ready', 'not_ready'];
  const decisions = [
    data.prSuffix(open({ review: 'approved', decidedBy: [{ login: 'a' }] })),
    data.prSuffix(open({ review: 'changes_requested', decidedBy: [{ login: 'a' }] })),
    data.prSuffix(open({ review: 'pending' })),
    data.prSuffix(open({ review: 'none' }))
  ].filter(Boolean);
  for (const d of decisions) {
    assert.ok(!LOCAL.includes(d), `"${d}" collides with the local verdict vocabulary`);
  }
  // And the local verdict is still rendered as a RAIL on the row, never a word.
  const view = read('src/renderer/src/modern/issues/IssuesView.tsx');
  assert.match(view, /border-l-success/);
  assert.match(view, /border-l-destructive/);
});

/* ── 3. Who decided: mapping GitHub's reviews ───────────────────────────── */

test('MD-130 — the deciders are the reviewers whose LATEST state is the decision', () => {
  const reviews = [
    { author: { login: 'tmccombs' }, state: 'CHANGES_REQUESTED' },
    { author: { login: 'sharkdp' }, state: 'COMMENTED' },
    { author: { login: 'tmccombs' }, state: 'APPROVED' }   // same person, later
  ];
  assert.deepEqual(gh.reviewersMatching(reviews, 'approved').map((p) => p.login), ['tmccombs'],
    'GitHub keeps only the latest review per person as the deciding one');
  assert.deepEqual(gh.reviewersMatching(reviews, 'changes_requested').map((p) => p.login), []);
  // A decision nobody can own gets nobody.
  assert.deepEqual(gh.reviewersMatching(reviews, 'none'), []);
  assert.deepEqual(gh.reviewersMatching(reviews, 'pending'), []);
  assert.deepEqual(gh.reviewersMatching(null, 'approved'), []);
  // …and every decider carries an avatar, so the row can draw a face.
  assert.match(gh.reviewersMatching(reviews, 'approved')[0].avatarUrl, /^https:\/\/avatars\.githubusercontent\.com\/tmccombs$/);
});
