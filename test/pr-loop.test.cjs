'use strict';

/**
 * The PR loop reads `gh pr list` and `glab mr list`, which disagree on every
 * field (number/iid, state vocab, headRefName/source_branch, check rollups vs
 * head_pipeline). One normalized PR shape feeds the watcher, the renderer and
 * the merge button, so the mappers and argv builders are pinned here — a
 * dropped flag or a mis-read state silently looks like "no PRs", which looks
 * like working software.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  runJson, linkedIssues, ciFromRollup, mapGitHubPRs, mapGitLabMRs,
  prListCommand, mergeCommand, isReady, gitlabReview,
  OPEN_PR_LIMIT, RECENT_PR_LIMIT,
  gitlabCi, mergeClosingIssues, gitlabNoteLocation,
  commentCommand, reviewCommand, issueCreateCommand, prCreateCommand, writeCommandFor
} = loadTs('src/main/github.ts');
const {
  snapshotOf, diffPRs, groupCommentEvents, ownerFor, messageFor, PRWatcher
} = loadTs('src/main/prWatcher.ts');

test('linkedIssues reads the closing keywords, case-insensitive, deduped', () => {
  assert.deepEqual(linkedIssues('Closes #12 and fixes #7. Also closes #12 again. Resolved #3'), [12, 7, 3]);
  assert.deepEqual(linkedIssues('see #99 for context'), [], 'a bare #N is a mention, not a link');
  assert.deepEqual(linkedIssues(''), []);
});

test('runJson: ok + parsed JSON', async () => {
  const r = await runJson(process.execPath, ['-e', 'console.log(JSON.stringify([1,2]))'], process.cwd());
  assert.equal(r.ok, true);
  assert.deepEqual(r.json, [1, 2]);
});

test('runJson: empty stdout', async () => {
  const r = await runJson(process.execPath, ['-e', ''], process.cwd());
  assert.equal(r.ok, true);
  assert.equal(r.json, null);
});

test('runJson: non-zero exit with stderr', async () => {
  const r = await runJson(process.execPath, ['-e', 'console.error("boom"); process.exit(2)'], process.cwd());
  assert.equal(r.ok, false);
  assert.match(r.error, /boom/);
});

test('runJson: invalid JSON', async () => {
  const r = await runJson(process.execPath, ['-e', 'console.log("nope")'], process.cwd());
  assert.equal(r.ok, false);
  assert(r.error && r.error.length > 0, 'error is non-empty string');
});

test('runJson: missing binary', async () => {
  const r = await runJson('definitely-not-a-binary-xyz', [], process.cwd());
  assert.equal(r.ok, false);
  assert(r.error && r.error.length > 0, 'error is non-empty string');
});

test('ciFromRollup: any failure wins, then pending, then success; empty is null', () => {
  assert.deepEqual(ciFromRollup([
    { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'u1' },
    { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'u2' },
    { __typename: 'StatusContext', state: 'PENDING', targetUrl: 'u3' }
  ]), { ci: 'failure', ciUrl: 'u2' });
  assert.deepEqual(ciFromRollup([
    { __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: null, detailsUrl: 'u1' },
    { __typename: 'StatusContext', state: 'SUCCESS', targetUrl: 'u2' }
  ]), { ci: 'pending', ciUrl: null });
  assert.deepEqual(ciFromRollup([
    { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED', detailsUrl: 'u1' },
    { __typename: 'StatusContext', state: 'SUCCESS', targetUrl: 'u2' }
  ]), { ci: 'success', ciUrl: null });
  assert.deepEqual(ciFromRollup([]), { ci: null, ciUrl: null });
  assert.deepEqual(ciFromRollup(undefined), { ci: null, ciUrl: null });
});

test('mapGitHubPRs flattens gh pr list JSON', () => {
  assert.deepEqual(mapGitHubPRs([{
    number: 5, title: 'Fix crash', body: 'Closes #7', url: 'https://github.com/acme/app/pull/5',
    state: 'OPEN', isDraft: false, headRefName: 'fix-crash', reviewDecision: 'APPROVED',
    statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'x' }],
    closingIssuesReferences: [{ number: 7 }, { number: 9 }],
    reviews: [{ id: 'R1', author: { login: 'grace' }, body: 'LGTM', state: 'APPROVED' }, { id: 'R2', author: { login: 'bot' }, body: '', state: 'COMMENTED' }],
    comments: [{ id: 'C1', author: { login: 'ada' }, body: 'nit: rename', url: 'https://github.com/acme/app/pull/5#issuecomment-1' }]
  }, {
    number: 6, title: 'Old', body: '', url: 'u', state: 'MERGED', isDraft: false, headRefName: 'old',
    reviewDecision: '', statusCheckRollup: [], closingIssuesReferences: [], reviews: [], comments: []
  }, {
    number: 8, title: 'WIP', body: null, url: 'u8', state: 'OPEN', isDraft: true, headRefName: 'wip',
    reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: null, closingIssuesReferences: null, reviews: null, comments: null
  }]), [{
    number: 5, title: 'Fix crash', body: 'Closes #7', url: 'https://github.com/acme/app/pull/5', branch: 'fix-crash',
    state: 'open', draft: false, review: 'approved', ci: 'success', ciUrl: null,
    issues: [7, 9],
    comments: [
      { id: 'review:R1', author: 'grace', body: 'LGTM', url: 'https://github.com/acme/app/pull/5', bot: false },
      { id: 'comment:C1', author: 'ada', body: 'nit: rename', url: 'https://github.com/acme/app/pull/5#issuecomment-1', bot: false }
    ]
  }, {
    number: 6, title: 'Old', body: '', url: 'u', branch: 'old', state: 'merged', draft: false,
    review: 'none', ci: null, ciUrl: null, issues: [], comments: []
  }, {
    number: 8, title: 'WIP', body: '', url: 'u8', branch: 'wip', state: 'open', draft: true,
    review: 'changes_requested', ci: null, ciUrl: null, issues: [], comments: []
  }]);
  assert.deepEqual(mapGitHubPRs(null), []);
});

test('mapGitHubPRs marks a [bot]-suffixed author as bot, and an explicit is_bot flag too', () => {
  const [flattened] = mapGitHubPRs([{
    number: 1, title: 't', body: '', url: 'u', state: 'OPEN', isDraft: false, headRefName: 'b',
    reviewDecision: '', statusCheckRollup: [], closingIssuesReferences: [], reviews: [],
    comments: [
      { id: 'C1', author: { login: 'dependabot[bot]' }, body: 'bump deps', url: 'u1' },
      { id: 'C2', author: { login: 'grace', is_bot: true }, body: 'flagged explicitly', url: 'u2' },
      { id: 'C3', author: { login: 'ada' }, body: 'not a bot', url: 'u3' }
    ]
  }]);
  assert.deepEqual(flattened.comments.map((c) => c.bot), [true, true, false]);
});

test('mapGitLabMRs flattens glab mr list JSON (pipeline/approvals/notes attached later)', () => {
  assert.deepEqual(mapGitLabMRs([{
    iid: 3, title: 'Add thing', description: 'Fixes #11', web_url: 'https://gitlab.com/acme/app/-/merge_requests/3',
    state: 'opened', draft: false, source_branch: 'add-thing'
  }, {
    iid: 4, title: 'Done', description: null, web_url: 'u4', state: 'merged', draft: false, source_branch: 'done'
  }, {
    iid: 5, title: 'Nope', description: '', web_url: 'u5', state: 'closed', work_in_progress: true, source_branch: 'nope'
  }]), [{
    number: 3, title: 'Add thing', body: 'Fixes #11', url: 'https://gitlab.com/acme/app/-/merge_requests/3', branch: 'add-thing',
    state: 'open', draft: false, review: 'none', ci: null, ciUrl: null, issues: [11], comments: []
  }, {
    number: 4, title: 'Done', body: '', url: 'u4', branch: 'done', state: 'merged', draft: false,
    review: 'none', ci: null, ciUrl: null, issues: [], comments: []
  }, {
    number: 5, title: 'Nope', body: '', url: 'u5', branch: 'nope', state: 'closed', draft: true,
    review: 'none', ci: null, ciUrl: null, issues: [], comments: []
  }]);
});

test('prListCommand asks each CLI for every field the mapper reads', () => {
  const FIELDS = 'number,title,body,url,state,isDraft,headRefName,reviewDecision,statusCheckRollup,closingIssuesReferences,reviews,comments';
  assert.deepEqual(prListCommand('github'), {
    cmd: 'gh',
    args: ['pr', 'list', '--state', 'all', '--limit', String(RECENT_PR_LIMIT), '--json', FIELDS]
  });
  assert.deepEqual(prListCommand('gitlab'), {
    cmd: 'glab',
    args: ['mr', 'list', '--all', '--output', 'json', '--per-page', String(RECENT_PR_LIMIT)]
  });
});

test('prListCommand scopes to open PRs, so merged ones cannot crowd them out', () => {
  // The bug this pins: one capped ANY-STATE query returned the 20 most recent
  // PRs, which on a busy repo are all merged — pushing every open PR off the
  // end, so the watcher silently stopped firing events above the cap.
  const gh = prListCommand('github', 'open', OPEN_PR_LIMIT);
  assert.deepEqual(gh.args.slice(0, 6),
    ['pr', 'list', '--state', 'open', '--limit', String(OPEN_PR_LIMIT)]);

  const gl = prListCommand('gitlab', 'open', OPEN_PR_LIMIT);
  assert.deepEqual(gl.args,
    ['mr', 'list', '--output', 'json', '--per-page', String(OPEN_PR_LIMIT)]);
  assert.ok(!gl.args.includes('--all'),
    'glab lists opened MRs by default; --all would reintroduce the crowding');

  // The open budget must be strictly larger than the recent-tail budget, or the
  // tail can still starve the open list.
  assert.ok(OPEN_PR_LIMIT > RECENT_PR_LIMIT, 'open budget must exceed the recent tail');
  assert.ok(OPEN_PR_LIMIT >= 100, 'documented ceiling');
});

test('mergeCommand: immediate squash by default, host-side auto-merge when asked', () => {
  assert.deepEqual(mergeCommand('github', 5, false), { cmd: 'gh', args: ['pr', 'merge', '5', '--squash'] });
  assert.deepEqual(mergeCommand('github', 5, true), { cmd: 'gh', args: ['pr', 'merge', '5', '--auto', '--squash'] });
  assert.deepEqual(mergeCommand('gitlab', 3, false), { cmd: 'glab', args: ['mr', 'merge', '3', '--squash', '--yes'] });
  assert.deepEqual(mergeCommand('gitlab', 3, true), { cmd: 'glab', args: ['mr', 'merge', '3', '--when-pipeline-succeeds', '--squash', '--yes'] });
});

test('gitlabReview: an MR with blocking discussions is changes_requested, never ready', () => {
  // The bug this pins: GitLab reports "changes requested" as unresolved
  // discussions, not through the approvals endpoint. Reading approvals alone
  // made changes_requested unreachable, so a rejected MR read 'none' and
  // isReady() said yes — arming auto-merge on code a human had rejected.
  const blocked = { blocking_discussions_resolved: false };
  const clean = { blocking_discussions_resolved: true };

  assert.equal(gitlabReview(blocked, {}), 'changes_requested');
  assert.equal(gitlabReview(blocked, { approved: true }), 'changes_requested',
    'an approval does not clear a blocking discussion');
  assert.equal(gitlabReview(clean, { approved: true }), 'approved');
  assert.equal(gitlabReview(clean, { approvals_required: 2 }), 'pending');
  assert.equal(gitlabReview(clean, {}), 'none', 'clean discussions, no rule required');

  // Unknown must never read as "nobody is blocking".
  assert.equal(gitlabReview({}, {}), 'pending', 'host did not report the field');
  assert.equal(gitlabReview(null, null), 'pending');

  // The end-to-end consequence: the rejected MR is not mergeable.
  const base = {
    number: 1, title: 't', url: 'u', branch: 'b', state: 'open', draft: false,
    ci: 'success', ciUrl: null, issues: [], comments: []
  };
  assert.equal(isReady({ ...base, review: gitlabReview(blocked, {}) }), false,
    'a rejected MR must never be ready');
  assert.equal(isReady({ ...base, review: gitlabReview({}, {}) }), false,
    'an unknown review state must never be ready');
});

// ── Write half of the loop (MD-30) ──────────────────────────────────────────
// Every flag below was read off the CLI installed on this machine, not docs —
// the two hosts disagree on almost every name.

test('comment uses each host\'s own subcommand and flag', () => {
  assert.deepEqual(commentCommand('github', 5, 'looks good'),
    { cmd: 'gh', args: ['pr', 'comment', '5', '--body', 'looks good'] });
  // glab has no `mr comment`; notes are a subcommand group, and --message not --body.
  assert.deepEqual(commentCommand('gitlab', 5, 'looks good'),
    { cmd: 'glab', args: ['mr', 'note', 'create', '5', '--message', 'looks good'] });
});

test('gh review always carries a body unless it is a bare approve', () => {
  // gh prompts interactively for a missing body on --comment/--request-changes,
  // which in a headless agent hangs forever. Approve is the only bodiless one.
  assert.deepEqual(reviewCommand('github', 7, 'approve'),
    { cmd: 'gh', args: ['pr', 'review', '7', '--approve'] });
  assert.deepEqual(reviewCommand('github', 7, 'approve', 'ship it').args,
    ['pr', 'review', '7', '--approve', '--body', 'ship it']);
  assert.ok(reviewCommand('github', 7, 'request_changes').args.includes('--body'),
    'a bodiless request-changes would block on a prompt');
  assert.ok(reviewCommand('github', 7, 'comment').args.includes('--body'));
  assert.equal(reviewCommand('github', 7, 'request_changes').args[3], '--request-changes');
});

test('GitLab has no request-changes verb, so it revokes AND says why', () => {
  // The asymmetry is real: GitLab review is approve/revoke plus discussions.
  // A bare revoke tells the author nothing, so a note always rides along.
  const rc = reviewCommand('gitlab', 3, 'request_changes', 'needs tests');
  assert.deepEqual(rc.cmd, 'glab');
  assert.deepEqual(rc.args, ['mr', 'revoke', '3']);
  assert.deepEqual(rc.extra, commentCommand('gitlab', 3, 'needs tests'));

  // Even with no reason given, the author still gets told something.
  assert.ok(reviewCommand('gitlab', 3, 'request_changes').extra.args.includes('Changes requested.'));

  // Approve with a body approves AND notes; bare approve does not note.
  assert.deepEqual(reviewCommand('gitlab', 3, 'approve').args, ['mr', 'approve', '3']);
  assert.equal(reviewCommand('gitlab', 3, 'approve').extra, undefined);
  assert.ok(reviewCommand('gitlab', 3, 'approve', 'nice').extra);

  // A GitLab "comment" review is just a note — no approval state is touched.
  assert.deepEqual(reviewCommand('gitlab', 3, 'comment', 'thoughts'),
    commentCommand('gitlab', 3, 'thoughts'));
});

test('issue create: gh says --body, glab says --description', () => {
  assert.deepEqual(issueCreateCommand('github', 'Bug', 'It breaks'),
    { cmd: 'gh', args: ['issue', 'create', '--title', 'Bug', '--body', 'It breaks'] });
  assert.deepEqual(issueCreateCommand('gitlab', 'Bug', 'It breaks'),
    { cmd: 'glab', args: ['issue', 'create', '--title', 'Bug', '--description', 'It breaks'] });
});

test('pr create maps head/base/draft onto each host\'s spelling', () => {
  assert.deepEqual(prCreateCommand('github', { title: 'T', body: 'B', head: 'feat', base: 'main' }).args,
    ['pr', 'create', '--title', 'T', '--body', 'B', '--head', 'feat', '--base', 'main']);
  assert.deepEqual(prCreateCommand('gitlab', { title: 'T', body: 'B', head: 'feat', base: 'main' }).args,
    ['mr', 'create', '--title', 'T', '--description', 'B', '--source-branch', 'feat', '--target-branch', 'main']);
});

test('draft: gh has a flag, GitLab has a title convention', () => {
  assert.ok(prCreateCommand('github', { title: 'T', body: 'B', draft: true }).args.includes('--draft'));
  // glab mr create has NO --draft; GitLab marks drafts by title prefix.
  const gl = prCreateCommand('gitlab', { title: 'T', body: 'B', draft: true });
  assert.equal(gl.args.includes('--draft'), false);
  assert.equal(gl.args[gl.args.indexOf('--title') + 1], 'Draft: T');
  // Already-prefixed titles are not doubled.
  assert.equal(
    prCreateCommand('gitlab', { title: 'Draft: T', body: 'B', draft: true }).args[3], 'Draft: T');
});

test('writeCommandFor routes every verb, on both hosts', () => {
  const actions = [
    { kind: 'comment', number: 1, body: 'x' },
    { kind: 'review', number: 1, verdict: 'approve' },
    { kind: 'issueCreate', title: 't', body: 'b' },
    { kind: 'prCreate', title: 't', body: 'b' }
  ];
  for (const host of ['github', 'gitlab']) {
    for (const a of actions) {
      const out = writeCommandFor(host, a);
      assert.equal(out.cmd, host === 'github' ? 'gh' : 'glab', `${host}/${a.kind}`);
      assert.ok(Array.isArray(out.args) && out.args.length > 0, `${host}/${a.kind} produced no argv`);
      assert.equal(out.args.some((x) => x === undefined || x === null), false,
        `${host}/${a.kind} produced a hole in argv`);
    }
  }
});

// ── GitLab parity (MD-22) ───────────────────────────────────────────────────

test('gitlabCi points at the failing JOB, not the whole pipeline', () => {
  // GitHub gives the exact check's detailsUrl; GitLab's head pipeline only gives
  // a pipeline url, which made the "CI failed" inbox message much less useful.
  const head = { id: 7, status: 'failed', web_url: 'https://gl/pipelines/7' };
  assert.deepEqual(
    gitlabCi(head, [{ status: 'failed', web_url: 'https://gl/jobs/42' }]),
    { ci: 'failure', ciUrl: 'https://gl/jobs/42' });
  // No job list (the extra call failed) → still a failure, just the pipeline url.
  assert.deepEqual(gitlabCi(head), { ci: 'failure', ciUrl: 'https://gl/pipelines/7' });
  assert.deepEqual(gitlabCi(head, []), { ci: 'failure', ciUrl: 'https://gl/pipelines/7' });
});

test('gitlabCi maps the non-failure statuses', () => {
  assert.deepEqual(gitlabCi({ status: 'success' }), { ci: 'success', ciUrl: null });
  assert.deepEqual(gitlabCi({ status: 'running' }), { ci: 'pending', ciUrl: null });
  assert.deepEqual(gitlabCi({ status: 'canceled', web_url: 'u' }).ci, 'failure');
  // No pipeline at all is "unknown", not green — isReady() must not pass it.
  assert.deepEqual(gitlabCi(null), { ci: null, ciUrl: null });
  assert.deepEqual(gitlabCi(undefined), { ci: null, ciUrl: null });
  assert.deepEqual(gitlabCi({}), { ci: null, ciUrl: null });
});

test('mergeClosingIssues unions the API list with the regex hits', () => {
  // Issues linked through the GitLab UI never appear in the title/body, so the
  // regex alone misses them and the board never learns what the MR closes.
  assert.deepEqual(mergeClosingIssues([7], [{ iid: 12 }, { iid: 4 }]), [7, 12, 4]);
  assert.deepEqual(mergeClosingIssues([7], [{ iid: 7 }]), [7], 'no duplicates');
  assert.deepEqual(mergeClosingIssues([], []), []);
  // A failed/garbage API response must not lose the regex hits.
  assert.deepEqual(mergeClosingIssues([3], null), [3]);
  assert.deepEqual(mergeClosingIssues([3], [{}, { iid: 0 }, { iid: -1 }, { iid: 'x' }]), [3]);
});

test('gitlabNoteLocation gives an inline note its file and line', () => {
  assert.equal(gitlabNoteLocation({ new_path: 'src/a.ts', new_line: 12 }), 'src/a.ts:12');
  // A deletion has only the old side.
  assert.equal(gitlabNoteLocation({ old_path: 'src/b.ts', old_line: 4 }), 'src/b.ts:4');
  assert.equal(gitlabNoteLocation({ new_path: 'src/c.ts' }), 'src/c.ts', 'path without a line still helps');
  // A plain discussion note has no position — it must stay unadorned.
  assert.equal(gitlabNoteLocation(undefined), null);
  assert.equal(gitlabNoteLocation({}), null);
  assert.equal(gitlabNoteLocation(null), null);
});

test('isReady: open, not draft, CI green, review approved or not required', () => {
  const base = { number: 1, title: '', url: '', branch: 'b', state: 'open', draft: false, review: 'approved', ci: 'success', ciUrl: null, issues: [], comments: [] };
  assert.equal(isReady(base), true);
  assert.equal(isReady({ ...base, review: 'none' }), true, 'no review required still counts');
  assert.equal(isReady({ ...base, review: 'pending' }), false);
  assert.equal(isReady({ ...base, review: 'changes_requested' }), false);
  assert.equal(isReady({ ...base, ci: 'pending' }), false);
  assert.equal(isReady({ ...base, ci: null }), false, 'no checks at all is not green');
  assert.equal(isReady({ ...base, draft: true }), false);
  assert.equal(isReady({ ...base, state: 'merged' }), false);
});

const pr = (over = {}) => ({
  number: 5, title: 'Fix crash', url: 'https://h/pull/5', branch: 'fix-crash', state: 'open', draft: false,
  review: 'approved', ci: 'success', ciUrl: null, issues: [7], comments: [], ...over
});

test('diffPRs: first sight records but fires nothing', () => {
  assert.deepEqual(diffPRs(undefined, [pr({ ci: 'failure', ciUrl: 'u' })]), []);
});

test('diffPRs: CI going red fires once; staying red does not', () => {
  const green = snapshotOf([pr()]);
  const red = pr({ ci: 'failure', ciUrl: 'u' });
  assert.deepEqual(diffPRs(green, [red]).map((e) => e.kind), ['ci-failed']);
  assert.deepEqual(diffPRs(snapshotOf([red]), [red]), []);
});

test('diffPRs: new comment ids fire one event each, old ones are silent', () => {
  const c1 = { id: 'review:1', author: 'ada', body: 'nit', url: 'u1' };
  const c2 = { id: 'inline:2', author: 'lin', body: 'bug here', url: 'u2' };
  const prev = snapshotOf([pr({ comments: [c1] })]);
  const evs = diffPRs(prev, [pr({ comments: [c1, c2] })]);
  assert.deepEqual(evs, [{ kind: 'comment', pr: pr({ comments: [c1, c2] }), comment: c2 }]);
});

test('diffPRs: becoming ready fires once; merged/closed fire on the transition', () => {
  const notReady = snapshotOf([pr({ ci: 'pending' })]);
  assert.deepEqual(diffPRs(notReady, [pr()]).map((e) => e.kind), ['ready']);
  assert.deepEqual(diffPRs(snapshotOf([pr()]), [pr()]), []);
  assert.deepEqual(diffPRs(snapshotOf([pr()]), [pr({ state: 'merged' })]).map((e) => e.kind), ['merged']);
  assert.deepEqual(diffPRs(snapshotOf([pr()]), [pr({ state: 'closed' })]).map((e) => e.kind), ['closed']);
  assert.deepEqual(diffPRs(snapshotOf([pr({ state: 'merged' })]), [pr({ state: 'merged' })]), []);
});

test('diffPRs: a PR first seen while already merged is silent (history, not news)', () => {
  assert.deepEqual(diffPRs(snapshotOf([pr({ number: 1 })]), [pr({ number: 1 }), pr({ number: 2, state: 'merged' })]), []);
});

test('diffPRs: a PR first seen open and green fires ready (within an already-tracked repo)', () => {
  const prev = snapshotOf([pr({ number: 1 })]);
  assert.deepEqual(diffPRs(prev, [pr({ number: 1 }), pr({ number: 2 })]).map((e) => e.kind), ['ready']);
});

test('diffPRs: a PR first seen open and red fires ci-failed', () => {
  const prev = snapshotOf([pr({ number: 1 })]);
  const evs = diffPRs(prev, [pr({ number: 1 }), pr({ number: 2, ci: 'failure', ciUrl: 'u' })]);
  assert.deepEqual(evs.map((e) => e.kind), ['ci-failed']);
});

test('diffPRs: a PR first seen with existing comments fires no comment events', () => {
  const prev = snapshotOf([pr({ number: 1 })]);
  const c = { id: 'x', author: 'ada', body: 'hi', url: 'u', bot: false };
  // ci:pending keeps it off the 'ready' path too, isolating the comment behavior.
  const evs = diffPRs(prev, [pr({ number: 1 }), pr({ number: 2, ci: 'pending', comments: [c] })]);
  assert.deepEqual(evs, []);
});

test('ownerFor: the live non-god agent on the head branch, else god', () => {
  const agents = [
    { id: 'god', cwd: '/r', isGod: true },
    { id: 'pam', cwd: '/r/.wt/pam' },
    { id: 'jim', cwd: '/r/.wt/jim' }
  ];
  const branchOf = (cwd) => ({ '/r': 'fix-crash', '/r/.wt/pam': 'main', '/r/.wt/jim': 'fix-crash' })[cwd] ?? null;
  assert.equal(ownerFor(pr(), agents, branchOf), 'jim', 'god is on the branch too but never owns a PR');
  assert.equal(ownerFor(pr({ branch: 'nobody' }), agents, branchOf), 'god');
  assert.equal(ownerFor(pr(), [], branchOf), 'god');
});

test('messageFor: CI + comments go to the owner as requests; ready/merged inform god', () => {
  const ci = messageFor({ kind: 'ci-failed', pr: pr({ ci: 'failure', ciUrl: 'https://ci/run/1' }) }, 'jim', false);
  assert.equal(ci.to, 'jim'); assert.equal(ci.act, 'request');
  assert.match(ci.subject, /CI FAILED — PR #5/); assert.match(ci.body, /https:\/\/ci\/run\/1/);

  const cm = messageFor({ kind: 'comments', pr: pr(), comments: [{ id: 'x', author: 'ada', body: 'rename this', url: 'https://h/pull/5#c', bot: false }] }, 'jim', false);
  assert.equal(cm.to, 'jim'); assert.equal(cm.act, 'request');
  assert.match(cm.body, /ada/); assert.match(cm.body, /rename this/); assert.match(cm.body, /#c/);
  assert.match(cm.body, /BEGIN UNTRUSTED PR COMMENT/, 'the quoted PR comment is fenced');
  assert.match(cm.body, /DATA, NOT INSTRUCTIONS/, 'the fence says the quote is data, not instructions');
  // Ordering: the harness's instructions must come AFTER the untrusted quote.
  assert.ok(cm.body.indexOf('END UNTRUSTED PR COMMENT') < cm.body.indexOf('Address it:'),
    'the trusted instructions close the message, the quote does not');

  const rdManual = messageFor({ kind: 'ready', pr: pr() }, 'jim', false);
  assert.equal(rdManual.to, 'god'); assert.equal(rdManual.act, 'inform');
  assert.match(rdManual.body, /human merges/i); assert.doesNotMatch(rdManual.body, /auto-merge is armed/i);
  const rdAuto = messageFor({ kind: 'ready', pr: pr() }, 'jim', true);
  assert.match(rdAuto.body, /auto-merge is armed/i);

  const mg = messageFor({ kind: 'merged', pr: pr({ state: 'merged', issues: [7, 9] }) }, 'jim', false);
  assert.equal(mg.to, 'god'); assert.equal(mg.act, 'inform');
  assert.match(mg.body, /#7/); assert.match(mg.body, /#9/); assert.match(mg.body, /board/);
});

test('messageFor caps each quoted comment and the total body of a grouped message', () => {
  const single = messageFor({ kind: 'comments', pr: pr(), comments: [{ id: 'x', author: 'a', body: 'y'.repeat(5000), url: 'u', bot: false }] }, 'jim', false);
  assert.ok(single.body.length < 1500, 'one huge comment stays near the 800-char quote cap (+ the fence)');

  const many = messageFor({
    kind: 'comments', pr: pr(), comments: Array.from({ length: 10 }, (_, i) => (
      { id: `c${i}`, author: `author${i}`, body: 'z'.repeat(5000), url: `u${i}`, bot: false }
    ))
  }, 'jim', false);
  assert.ok(many.body.length < 4300, 'many huge comments stay near the ~4000-char total cap');
});

test('messageFor: multiple new comments on one PR collapse into one message naming both authors', () => {
  const m = messageFor({
    kind: 'comments', pr: pr(), comments: [
      { id: 'a', author: 'ada', body: 'first note', url: 'u1', bot: false },
      { id: 'b', author: 'lin', body: 'second note', url: 'u2', bot: false }
    ]
  }, 'jim', false);
  assert.match(m.subject, /REVIEW COMMENTS — PR #5 \(2 new\)/);
  assert.match(m.body, /ada/); assert.match(m.body, /lin/);
});

test('groupCommentEvents: drops a bot comment', () => {
  const bot = { id: 'x', author: 'dependabot[bot]', body: 'bump', url: 'u', bot: true };
  const grouped = groupCommentEvents([{ kind: 'comment', pr: pr(), comment: bot }], null);
  assert.deepEqual(grouped, []);
});

test('groupCommentEvents: drops a self-authored comment', () => {
  const self = { id: 'x', author: 'jim', body: 'note to self', url: 'u', bot: false };
  const grouped = groupCommentEvents([{ kind: 'comment', pr: pr(), comment: self }], 'jim');
  assert.deepEqual(grouped, []);
});

test('groupCommentEvents: a third-party comment still arrives alongside a dropped bot one', () => {
  const bot = { id: 'x', author: 'ci[bot]', body: 'noise', url: 'u', bot: true };
  const real = { id: 'y', author: 'ada', body: 'please fix', url: 'u2', bot: false };
  const grouped = groupCommentEvents([
    { kind: 'comment', pr: pr(), comment: bot },
    { kind: 'comment', pr: pr(), comment: real }
  ], null);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].kind, 'comments');
  assert.deepEqual(grouped[0].comments, [real]);
});

test('groupCommentEvents: two comments on one PR collapse into one event; non-comment events pass through', () => {
  const c1 = { id: 'a', author: 'ada', body: 'one', url: 'u1', bot: false };
  const c2 = { id: 'b', author: 'lin', body: 'two', url: 'u2', bot: false };
  const grouped = groupCommentEvents([
    { kind: 'ci-failed', pr: pr() },
    { kind: 'comment', pr: pr(), comment: c1 },
    { kind: 'comment', pr: pr(), comment: c2 }
  ], null);
  assert.deepEqual(grouped.map((e) => e.kind), ['ci-failed', 'comments']);
  assert.deepEqual(grouped[1].comments, [c1, c2]);
});

test('PRWatcher.poll: persists the snapshot, routes events, arms auto-merge only when on', async () => {
  const kv = new Map();
  const sent = [];
  const merged = [];
  let fetched = [pr({ ci: 'pending' })];
  let auto = false;
  const w = new PRWatcher({
    repos: () => ['/r'],
    autoMerge: () => auto,
    host: () => 'github',
    liveAgents: () => [{ id: 'jim', cwd: '/r/.wt/jim' }],
    send: (m, from) => { sent.push({ ...m, from }); return m; },
    getKv: (k) => kv.get(k),
    setKv: (k, v) => kv.set(k, v),
    notify: () => {},
    fetch: async () => ({ ok: true, prs: fetched }),
    merge: async (_cwd, n, a) => { merged.push([n, a]); return { ok: true }; },
    branchOf: () => 'fix-crash'
  });

  await w.poll();
  assert.deepEqual(sent, [], 'first sight is silent');
  assert.ok(kv.get('pr-watch:/r')[5], 'snapshot persisted under the repo key');
  assert.equal(w.latest('/r').prs[0].owner, 'jim');
  assert.equal(w.latest('/r').error, null);

  fetched = [pr()];
  await w.poll();
  assert.equal(sent.length, 1); assert.equal(sent[0].to, 'god'); assert.match(sent[0].subject, /READY/);
  assert.deepEqual(merged, [], 'auto-merge off: nothing armed');

  await w.poll();
  assert.equal(sent.length, 1, 'still ready, no repeat');

  auto = true;
  fetched = [pr({ number: 6, ci: 'pending' })];
  await w.poll();
  fetched = [pr({ number: 6 })];
  await w.poll();
  assert.deepEqual(merged, [[6, true]], 'auto-merge on: armed once on the ready transition');
  assert.equal(sent.at(-1).from, 'pr-watcher');
});

test('PRWatcher: a failed viewer lookup is retried, not cached forever', async () => {
  // The bug this pins: viewerFor() cached `null` on failure, so ONE transient
  // `gh api user` blip permanently disabled self-comment filtering — and the
  // agent then got its own review comments routed back into its own inbox.
  const kv = new Map();
  const sent = [];
  let calls = 0;
  let ok = false;
  const withComment = (id) => pr({
    ci: 'pending',
    comments: [{ id, author: 'jim-bot', body: 'looks off', url: 'c' + id }]
  });
  let fetched = [withComment('c1')];
  const w = new PRWatcher({
    repos: () => ['/r'],
    autoMerge: () => false,
    host: () => 'github',
    liveAgents: () => [{ id: 'jim', cwd: '/r/.wt/jim' }],
    send: (m, from) => { sent.push({ ...m, from }); return m; },
    getKv: (k) => kv.get(k),
    setKv: (k, v) => kv.set(k, v),
    notify: () => {},
    fetch: async () => ({ ok: true, prs: fetched }),
    merge: async () => ({ ok: true }),
    branchOf: () => 'fix-crash',
    viewer: async () => {
      calls++;
      return ok ? { ok: true, login: 'jim-bot' } : { ok: false, error: 'gh: not authenticated' };
    }
  });

  await w.poll();                              // first sight: records only
  fetched = [withComment('c2')];
  await w.poll();                              // lookup fails here
  assert.equal(calls, 1, 'looked the viewer up once');
  const afterFailure = sent.length;

  // Auth comes back. The next comment must consult the viewer AGAIN.
  ok = true;
  fetched = [withComment('c3')];
  await w.poll();
  assert.equal(calls, 2, 'a failed lookup is retried on the next poll, not cached');

  // And once it succeeds, the agent's own comments are filtered out again.
  fetched = [withComment('c4')];
  await w.poll();
  assert.equal(calls, 2, 'a successful lookup IS cached — no repeat CLI call');
  assert.equal(sent.length, afterFailure + 0 + 0,
    'jim-bot is the viewer, so its own comments are never mailed back');
});

test('PRWatcher.poll: a failed fetch leaves the snapshot untouched (no false "first sight" later)', async () => {
  const kv = new Map([['pr-watch:/r', snapshotOf([pr()])]]);
  const sent = [];
  const w = new PRWatcher({
    repos: () => ['/r'], autoMerge: () => false, host: () => 'github', liveAgents: () => [],
    send: (m) => { sent.push(m); return m; }, getKv: (k) => kv.get(k), setKv: (k, v) => kv.set(k, v), notify: () => {},
    fetch: async () => ({ ok: false, error: 'gh: not logged in' }), branchOf: () => null
  });
  await w.poll();
  assert.deepEqual(sent, []);
  assert.deepEqual(kv.get('pr-watch:/r'), snapshotOf([pr()]));
});

test('PRWatcher.poll: a throwing repo does not stop the others', async () => {
  const kv = new Map();
  let fetchCalls = 0;
  const w = new PRWatcher({
    repos: () => ['/a', '/b'], autoMerge: () => false, host: () => 'github', liveAgents: () => [],
    send: (m) => m, getKv: (k) => kv.get(k), setKv: (k, v) => kv.set(k, v), notify: () => {},
    fetch: async (cwd) => {
      fetchCalls++;
      if (cwd === '/a') throw new Error('boom');
      return { ok: true, prs: [pr()] };
    },
    branchOf: () => null
  });

  await w.poll();
  assert.equal(w.latest('/b').prs.length, 1, 'the throwing repo did not stop the next one');
  assert.ok(kv.has('pr-watch:/b'));
  assert.ok(!kv.has('pr-watch:/a'), 'the throwing repo never reached setKv');

  const before = fetchCalls;
  await w.poll();
  assert.ok(fetchCalls > before, 'busy was reset — a second poll still runs');
});

test('PRWatcher.poll: a failed auto-merge arm tells god', async () => {
  const kv = new Map();
  const sent = [];
  let fetched = [pr({ number: 6, ci: 'pending' })];
  const w = new PRWatcher({
    repos: () => ['/r'], autoMerge: () => true, host: () => 'github', liveAgents: () => [],
    send: (m, from) => { sent.push({ ...m, from }); return m; },
    getKv: (k) => kv.get(k), setKv: (k, v) => kv.set(k, v), notify: () => {},
    fetch: async () => ({ ok: true, prs: fetched }),
    merge: async () => ({ ok: false, error: 'protected branch' }),
    branchOf: () => null
  });

  await w.poll();
  fetched = [pr({ number: 6 })];
  await w.poll();

  const last = sent.at(-1);
  assert.equal(last.to, 'god');
  assert.match(last.subject, /AUTO-MERGE NOT ARMED/);
  assert.match(last.body, /protected branch/);
  assert.equal(last.from, 'pr-watcher');
});

test('PRWatcher.poll: a failed fetch sets latest(cwd).error; a later success clears it', async () => {
  const kv = new Map();
  const notified = [];
  let ok = false;
  const w = new PRWatcher({
    repos: () => ['/r'], autoMerge: () => false, host: () => 'github', liveAgents: () => [],
    send: (m) => m, getKv: (k) => kv.get(k), setKv: (k, v) => kv.set(k, v),
    notify: (cwd, prs, error) => notified.push({ cwd, prs, error }),
    fetch: async () => (ok ? { ok: true, prs: [pr()] } : { ok: false, error: 'gh: rate limited' }),
    branchOf: () => null
  });

  await w.poll();
  assert.equal(w.latest('/r').error, 'gh: rate limited');
  assert.deepEqual(w.latest('/r').prs, []);
  assert.equal(notified.at(-1).error, 'gh: rate limited');

  ok = true;
  await w.poll();
  assert.equal(w.latest('/r').error, null);
  assert.equal(notified.at(-1).error, null);
});

test('PRWatcher.poll: drops bot/self comments and caches the viewer login across polls', async () => {
  const kv = new Map();
  const sent = [];
  let viewerCalls = 0;
  const self_ = { id: 'a', author: 'jim', body: 'self note', url: 'u1', bot: false };
  const bot = { id: 'b', author: 'ci[bot]', body: 'noise', url: 'u2', bot: true };
  const third = { id: 'c', author: 'ada', body: 'please fix', url: 'u3', bot: false };
  let fetched = [pr({ ci: 'pending', comments: [] })];
  const w = new PRWatcher({
    repos: () => ['/r'], autoMerge: () => false, host: () => 'github',
    liveAgents: () => [{ id: 'jim', cwd: '/r/.wt/jim' }],
    send: (m, from) => { sent.push({ ...m, from }); return m; },
    getKv: (k) => kv.get(k), setKv: (k, v) => kv.set(k, v), notify: () => {},
    fetch: async () => ({ ok: true, prs: fetched }),
    branchOf: () => 'fix-crash',
    viewer: async () => { viewerCalls++; return { ok: true, login: 'jim' }; }
  });
  await w.poll(); // first sight: records only, no comments to filter, viewer never called
  assert.equal(viewerCalls, 0, 'lazy — nothing to filter yet');

  fetched = [pr({ ci: 'pending', comments: [self_, bot] })];
  await w.poll();
  assert.deepEqual(sent, [], 'self + bot both filtered, no message');
  assert.equal(viewerCalls, 1);

  fetched = [pr({ ci: 'pending', comments: [self_, bot, third] })];
  await w.poll();
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /ada/);
  assert.doesNotMatch(sent[0].body, /noise/);
  assert.doesNotMatch(sent[0].body, /self note/);
  assert.equal(viewerCalls, 1, 'viewer login cached, not re-fetched on later polls');
});

test('PRWatcher.poll: a failed viewer lookup still drops bot comments (self filter just no-ops)', async () => {
  const kv = new Map();
  const sent = [];
  const bot = { id: 'b', author: 'ci[bot]', body: 'noise', url: 'u2', bot: true };
  const third = { id: 'c', author: 'ada', body: 'please fix', url: 'u3', bot: false };
  let fetched = [pr({ ci: 'pending', comments: [] })];
  const w = new PRWatcher({
    repos: () => ['/r'], autoMerge: () => false, host: () => 'github', liveAgents: () => [],
    send: (m) => { sent.push(m); return m; }, getKv: (k) => kv.get(k), setKv: (k, v) => kv.set(k, v), notify: () => {},
    fetch: async () => ({ ok: true, prs: fetched }), branchOf: () => null,
    viewer: async () => ({ ok: false, error: 'not logged in' })
  });
  await w.poll();
  fetched = [pr({ ci: 'pending', comments: [bot, third] })];
  await w.poll();
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /ada/);
});
