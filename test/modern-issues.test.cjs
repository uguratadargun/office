'use strict';

/**
 * MD-88 — the two areas' pure decisions.
 *
 * What is pinned here is the handful of semantics a from-scratch rewrite of a
 * screen is most likely to tidy away, because each one looks like a redundancy
 * until you know why it is there:
 *
 *   - the CI dot and the local review verdict are DIFFERENT facts;
 *   - a Doctor row that is `unverifiable` is an ANSWER, not a fault;
 *   - an allowlist that accepts nobody is a BLOCKER, not a warning.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  ciTone, railTone, prSuffix, openPrs, prsForIssue, routingHint,
  issuesEmptyMessage, pageCapNote, resolveRepo, repoLabel, canReview, ISSUE_PAGE_SIZE
} = loadTs('src/renderer/src/modern/issues/issuesData.ts');
const {
  slackRow, telegramRow, webhooksRow, restRow, restUsable, allowlistCount,
  isActionable, actionableCount, sortDoctorResults
} = loadTs('src/renderer/src/modern/integrations/integrationsData.ts');

// ─── Issues / PRs ────────────────────────────────────────────────────────────

test('CI and the local verdict stay two independent facts', () => {
  // The whole point: a green pipeline must not be able to colour the verdict
  // rail, and an unreviewed PR must not look reviewed because CI passed.
  assert.equal(ciTone('success'), 'ok');
  assert.equal(railTone(undefined, false), 'none', 'CI green + no local review = no rail');
  assert.equal(railTone({ verdict: 'not_ready' }, false), 'notReady');
  assert.equal(ciTone('failure'), 'bad');
  assert.equal(railTone({ verdict: 'ready' }, false), 'ready', 'CI red + a READY local verdict is a real combination');
});

test('no pipeline is not a failing pipeline', () => {
  assert.equal(ciTone(null), 'none');
  assert.equal(ciTone(undefined), 'none');
  assert.notEqual(ciTone(null), ciTone('failure'));
});

test('an unknown verdict draws no rail rather than a third colour', () => {
  assert.equal(railTone({ verdict: 'unknown' }, false), 'none');
  assert.equal(railTone({ verdict: 'ready' }, true), 'running', 'a run in flight outranks the stale verdict');
});

test('the PR suffix says the most decisive thing first', () => {
  assert.equal(prSuffix({ state: 'merged', review: 'approved' }), 'merged', 'a merged PR\'s review is history');
  assert.equal(prSuffix({ state: 'open', draft: true, ready: true }), 'draft');
  assert.equal(prSuffix({ state: 'open', ready: true }), 'ready');
  assert.equal(prSuffix({ state: 'open', review: 'changes_requested' }), 'changes requested');
  assert.equal(prSuffix({ state: 'open', review: 'none' }), '');
});

test('the routing hint never reads as authorship', () => {
  const hint = routingHint('Jim', 'fix/x', 'Michael');
  assert.match(hint, /routes to Jim/);
  assert.match(hint, /agent on branch fix\/x/);
  assert.doesNotMatch(hint, /approved|opened|author/i);
});

test('the PR list is open-only, newest first', () => {
  const prs = [{ state: 'open', number: 3 }, { state: 'merged', number: 9 }, { state: 'open', number: 7 }];
  assert.deepEqual(openPrs(prs).map((p) => p.number), [7, 3]);
  assert.deepEqual(openPrs(undefined), []);
});

test('an issue carries only the PRs that close it', () => {
  const prs = [{ number: 1, issues: [412] }, { number: 2, issues: [] }, { number: 3, issues: [7, 412] }];
  assert.deepEqual(prsForIssue(prs, 412).map((p) => p.number), [1, 3]);
  assert.deepEqual(prsForIssue(prs, 999), []);
});

test('the page cap is VISIBLE whenever a full page comes back', () => {
  // An invisible cap makes an issue you cannot see indistinguishable from an
  // issue that does not exist — and search is the only way past it.
  assert.match(pageCapNote(ISSUE_PAGE_SIZE), /first 10/);
  assert.equal(pageCapNote(ISSUE_PAGE_SIZE - 1), null);
});

test('"not fetched yet" and "nothing matched" send you to different buttons', () => {
  assert.match(issuesEmptyMessage({ fetched: false, filtered: false }), /press Fetch/);
  assert.match(issuesEmptyMessage({ fetched: true, filtered: true }), /match that filter/);
  assert.match(issuesEmptyMessage({ fetched: true, filtered: false }), /No open issues/);
});

test('a remembered repo that was unregistered falls back instead of showing nothing', () => {
  assert.equal(resolveRepo(['/a', '/b'], '/b'), '/b');
  assert.equal(resolveRepo(['/a', '/b'], '/gone'), '/a');
  assert.equal(resolveRepo([], '/gone'), '');
});

// ─── MD-111 ──────────────────────────────────────────────────────────────────

test('the repo picker names the folder before the path it sits in', () => {
  // The trigger truncates at the END. Leading with the path put the ellipsis
  // through the only distinguishing part, so two clones under one parent were
  // the same string on screen.
  assert.equal(repoLabel('/private/tmp/claude-501/scratch/fd'), 'fd — /private/tmp/claude-501/scratch');
  const a = repoLabel('/Users/x/work/office');
  const b = repoLabel('/Users/x/work/fd');
  assert.notEqual(a.slice(0, 12), b.slice(0, 12), 'siblings must differ in the part that survives truncation');
});

test('repoLabel survives the paths config can actually hold', () => {
  assert.equal(repoLabel('/Users/x/work/fd/'), 'fd — /Users/x/work', 'a trailing separator is not a nameless repo');
  assert.equal(repoLabel('C:\\src\\fd'), 'fd — C:\\src', 'Windows paths have a basename too');
  assert.equal(repoLabel('fd'), 'fd', 'no parent to name means no dangling dash');
  assert.equal(repoLabel('/fd'), 'fd', 'a repo at the root has no parent to name, so no dangling dash');
  assert.equal(repoLabel(''), '');
});

test('Review is offered only while a PR can still change', () => {
  // Beside an issue the chips are NOT filtered to open PRs, so this is the only
  // thing stopping an engine run against a merged diff.
  assert.equal(canReview({ state: 'open' }), true);
  assert.equal(canReview({ state: 'merged' }), false);
  assert.equal(canReview({ state: 'closed' }), false);
  assert.equal(canReview(undefined), false);
});

test('an issue keeps the closed PRs that referenced it — which is why canReview exists', () => {
  const prs = [
    { number: 1, state: 'merged', issues: [7] },
    { number: 2, state: 'open', issues: [7] }
  ];
  const linked = prsForIssue(prs, 7);
  assert.equal(linked.length, 2, 'prsForIssue does not filter by state');
  assert.deepEqual(linked.filter(canReview).map((p) => p.number), [2]);
});

// ─── Integrations ────────────────────────────────────────────────────────────

test('an allowlist that accepts nobody BLOCKS, and says which field', () => {
  // The failure this page exists to prevent: a bridge that starts, looks
  // connected, and silently ingests nothing.
  const row = slackRow(
    { slackEnabled: true, slackBotToken: 't', slackSigningSecret: 's', slackAllowedUserIds: '  ' },
    { running: false }
  );
  assert.equal(row.state, 'blocked');
  assert.match(row.blocker, /allowed senders/);
  assert.match(row.blocker, /nothing would be ingested/);
});

test('Telegram stays fail-closed: no chat id is a blocker, not a warning', () => {
  const row = telegramRow({ telegramEnabled: true, telegramBotToken: 't' }, { running: false });
  assert.equal(row.state, 'blocked');
  assert.match(row.blocker, /no allowed chat id/);
});

test('blockers are reported in the order the connect actually fails', () => {
  // The order is main's `startSlackServer`: the TRANSPORT credential first,
  // then the fail-closed allowlist. MD-94 caught this listing the bot token
  // ahead of both — main never checks it, so the row said "cannot start" and
  // disabled a Start button that would have worked (fixed in MD-99).
  const bare = slackRow({ slackEnabled: true, slackAllowedUserIds: '' }, { running: false });
  assert.match(bare.blocker, /signing secret/, 'Events API needs a signing secret before anything else');
  const socket = slackRow(
    { slackEnabled: true, slackBotToken: 't', slackTransport: 'socket', slackAllowedUserIds: 'U1' },
    { running: false }
  );
  assert.match(socket.blocker, /app token/, 'Socket Mode needs an app token, not a signing secret');
});

test('disabled is not broken', () => {
  assert.equal(slackRow({ slackEnabled: false }, { running: false }).state, 'off');
  assert.equal(telegramRow({}, { running: false }).state, 'off');
});

test('running beats every configuration doubt', () => {
  const row = slackRow({ slackEnabled: true }, { running: true, transport: 'socket' });
  assert.equal(row.state, 'connected');
  assert.match(row.detail, /transport: socket/);
});

test('no detail line can carry a credential', () => {
  const secret = 'xoxb-SUPER-SECRET';
  const rows = [
    slackRow({ slackEnabled: true, slackBotToken: secret, slackSigningSecret: secret, slackAllowedUserIds: 'U1' }, { running: true }),
    telegramRow({ telegramEnabled: true, telegramBotToken: secret, telegramChatId: secret }, { running: true, username: 'bot' })
  ];
  for (const r of rows) {
    assert.doesNotMatch(`${r.detail} ${r.blocker ?? ''}`, /SUPER-SECRET/, `${r.id} leaked a credential`);
  }
  assert.match(rows[1].detail, /token set/, 'it says SET, not what it is');
});

test('the allowlist count reads both spellings and does not count blanks', () => {
  assert.equal(allowlistCount('U1,U2 U3'), 3);
  assert.equal(allowlistCount('   '), 0);
  assert.equal(allowlistCount(undefined), 0);
});

test('an endpoint with no tunnel yet says so instead of showing a broken URL', () => {
  const row = webhooksRow({ running: true, endpoints: [{ id: 'a', url: '' }] }, 1);
  assert.equal(row.state, 'connected');
  assert.match(row.detail, /waiting for tunnel/);
  assert.doesNotMatch(row.detail, /tunnel undefined/);
});

test('custom REST usability is enabled AND holding whatever secret it needs', () => {
  assert.equal(restUsable({ id: 'a', label: 'A', enabled: true, hasSecret: false, authType: 'none' }), true);
  assert.equal(restUsable({ id: 'b', label: 'B', enabled: true, hasSecret: false, authType: 'bearer' }), false);
  assert.equal(restUsable({ id: 'c', label: 'C', enabled: false, hasSecret: true, authType: 'bearer' }), false);
  const row = restRow([
    { id: 'a', label: 'A', enabled: true, hasSecret: true, authType: 'bearer' },
    { id: 'b', label: 'B', enabled: false, hasSecret: true, authType: 'bearer' }
  ]);
  assert.match(row.detail, /2 configured · 1 usable/);
  assert.equal(row.lifecycle, false, 'the registry is configuration, not a bridge to start');
});

// ─── Provider Doctor ─────────────────────────────────────────────────────────

test('ONLY a mismatch means "go fix something"', () => {
  // not-installed and unverifiable are answers. A page that paints all three as
  // failures cries wolf and stops being read.
  assert.equal(isActionable('mismatch'), true);
  assert.equal(isActionable('ok'), false);
  assert.equal(isActionable('not-installed'), false);
  assert.equal(isActionable('unverifiable'), false);
});

test('the Doctor count ignores the answers, however many there are', () => {
  const results = [
    { status: 'unverifiable' }, { status: 'not-installed' },
    { status: 'unverifiable' }, { status: 'ok' }
  ];
  assert.equal(actionableCount(results), 0, 'nothing to do, despite four non-ok rows');
  assert.equal(actionableCount([...results, { status: 'mismatch' }]), 1);
  assert.equal(actionableCount(null), 0);
});

test('actionable rows sort first, and ties keep the engine\'s own order', () => {
  const rows = [
    { id: 'a', status: 'ok' }, { id: 'b', status: 'mismatch' },
    { id: 'c', status: 'unverifiable' }, { id: 'd', status: 'mismatch' }
  ];
  assert.deepEqual(sortDoctorResults(rows).map((r) => r.id), ['b', 'd', 'a', 'c']);
});
