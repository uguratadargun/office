'use strict';

/**
 * The usage digest — the arithmetic that tells a working day from a night spent
 * answering timers.
 *
 * Its whole value is the attribution: which hour, which trigger, how full the
 * context was. A total that is merely correct proves none of that, so these pin
 * the three bucketings and the two rules that are easy to get quietly wrong —
 * a turn is attributed to the PROMPT that started it (not to the tool_result
 * that happens to precede it), and a response written out as three content
 * blocks is one turn, not three.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  classifyTrigger, contextBucket, resolveRange, foldTurns, totalsOf,
  emptyAgentDigest, digestHeadline, share, TRIGGER_KINDS, CONTEXT_BUCKETS,
  NIGHT_START_HOUR, NIGHT_END_HOUR
} = loadTs('src/shared/usageDigest.ts');

// ── classification ──────────────────────────────────────────────────────────
// The literal strings the harness sends. If one is reworded and this is not,
// a night's cost silently becomes "other" — which is the failure worth catching.

test('the nudge the harness actually sends classifies as a nudge', () => {
  const { INBOX_NUDGE_TEXT } = loadTs('src/shared/inboxNudge.ts');
  assert.equal(classifyTrigger(INBOX_NUDGE_TEXT), 'inbox-nudge',
    'the shipped nudge text must be recognised — this is the pairing that breaks silently');
});

test('each trigger is recognised from its own marker', () => {
  for (const [text, kind] of [
    ['Hourly ops standup — anything to report?', 'standup'],
    ['the ops standup is due', 'standup'],
    ['You have new hive inbox message(s) — read your inbox', 'inbox-nudge'],
    ['Circuit breaker: steer/constrain', 'breaker'],
    ['You are "Pam" (pam-mt310mbm), an autonomous agent', 'spawn-prompt'],
    ['HIVE PROTOCOL — every task:', 'spawn-prompt'],
    ['HUMAN ANSWER: yes, go ahead', 'human'],
    ['Task from the human: ship it', 'human'],
    ['looks good, merged', 'other'],
    ['', 'other']
  ]) {
    assert.equal(classifyTrigger(text), kind, `"${text.slice(0, 40)}" → ${kind}`);
  }
});

test('the spawn prompt does not steal the nudge, whichever order they are tested in', () => {
  // The spawn prompt QUOTES the protocol, which talks about the inbox — so the
  // specific beats have to be tested before the generic "You are…" opener.
  assert.equal(
    classifyTrigger('You are "Pam". HIVE PROTOCOL: read your inbox'), 'spawn-prompt');
  assert.equal(
    classifyTrigger('You have new hive inbox message(s). HIVE PROTOCOL applies.'), 'inbox-nudge');
});

// ── context bands ───────────────────────────────────────────────────────────

test('context bands split on the numbers the compaction rule reasons about', () => {
  assert.equal(contextBucket(0), '<100k');
  assert.equal(contextBucket(99_999), '<100k');
  assert.equal(contextBucket(100_000), '100–200k');
  assert.equal(contextBucket(199_999), '100–200k');
  assert.equal(contextBucket(200_000), '200–400k');
  assert.equal(contextBucket(399_999), '200–400k');
  assert.equal(contextBucket(400_000), '>400k');
  assert.deepEqual(CONTEXT_BUCKETS, ['<100k', '100–200k', '200–400k', '>400k']);
});

// ── the window ──────────────────────────────────────────────────────────────

const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime();

test('"last night" is the 20:00 → 08:00 stretch that just finished', () => {
  const now = at(2026, 8, 27, 14, 30); // afternoon
  const r = resolveRange('last-night', now);
  assert.equal(new Date(r.sinceMs).getHours(), NIGHT_START_HOUR);
  assert.equal(new Date(r.sinceMs).getDate(), 26, 'starts the evening BEFORE');
  assert.equal(new Date(r.untilMs).getHours(), NIGHT_END_HOUR);
  assert.equal(new Date(r.untilMs).getDate(), 27);
});

test('a night still in progress ends at now, not at a future 08:00', () => {
  const now = at(2026, 8, 27, 3, 15); // the small hours — the point of the view
  const r = resolveRange('last-night', now);
  assert.equal(r.untilMs, now, 'a night you are inside must not report as empty until breakfast');
  assert.equal(new Date(r.sinceMs).getDate(), 26);
});

test('the other three windows are what they say', () => {
  const now = at(2026, 8, 27, 14, 0);
  assert.equal(new Date(resolveRange('today', now).sinceMs).getHours(), 0);
  assert.equal(resolveRange('24h', now).sinceMs, now - 86_400_000);
  assert.equal(resolveRange('all', now).sinceMs, 0);
  for (const r of ['today', '24h', 'all']) {
    assert.equal(resolveRange(r, now).untilMs, now);
  }
});

// ── folding ─────────────────────────────────────────────────────────────────

const turn = (over = {}) => ({ ts: at(2026, 8, 27, 3), tokens: 1000, usd: 1, contextTokens: 50_000, trigger: 'standup', ...over });

test('a turn lands in its hour, its trigger and its context band at once', () => {
  const row = foldTurns(emptyAgentDigest('a', 'A'), [turn()], 0, Date.now());
  assert.deepEqual(row.total, { turns: 1, tokens: 1000, usd: 1 });
  assert.equal(row.byHour[3].turns, 1, 'hour 03');
  assert.equal(row.byHour[4].turns, 0);
  assert.equal(row.byTrigger.standup.turns, 1);
  assert.equal(row.byContext['<100k'].turns, 1);
});

test('turns outside the window are dropped, and the edges are inclusive', () => {
  const t = at(2026, 8, 27, 3);
  const rows = (since, until) => foldTurns(emptyAgentDigest('a', 'A'), [turn({ ts: t })], since, until).total.turns;
  assert.equal(rows(t, t), 1, 'a turn exactly on both edges counts');
  assert.equal(rows(t + 1, t + 2), 0);
  assert.equal(rows(t - 2, t - 1), 0);
});

test('a turn with no timestamp is counted in "all time" and nowhere else', () => {
  // It cannot be placed in an hour, and parking it in an arbitrary one would
  // invent a peak. It is still real spend, so "all time" keeps it.
  const t = [turn({ ts: 0 })];
  assert.equal(foldTurns(emptyAgentDigest('a', 'A'), t, 0, Date.now()).total.turns, 1);
  assert.equal(foldTurns(emptyAgentDigest('a', 'A'), t, 1, Date.now()).total.turns, 0);
  assert.equal(foldTurns(emptyAgentDigest('a', 'A'), t, 0, Date.now()).byHour.reduce((n, c) => n + c.turns, 0), 0);
});

test('totals are the sum of the rows, bucket for bucket', () => {
  const a = foldTurns(emptyAgentDigest('a', 'A'), [turn(), turn({ trigger: 'human', contextTokens: 500_000 })], 0, Date.now());
  const b = foldTurns(emptyAgentDigest('b', 'B'), [turn({ ts: at(2026, 8, 27, 9) })], 0, Date.now());
  const t = totalsOf([a, b]);
  assert.deepEqual(t.total, { turns: 3, tokens: 3000, usd: 3 });
  assert.equal(t.byHour[3].turns, 2);
  assert.equal(t.byHour[9].turns, 1);
  assert.equal(t.byTrigger.standup.turns, 2);
  assert.equal(t.byTrigger.human.turns, 1);
  assert.equal(t.byContext['>400k'].turns, 1);
  const spread = TRIGGER_KINDS.reduce((n, k) => n + t.byTrigger[k].turns, 0);
  assert.equal(spread, t.total.turns, 'every turn lands in exactly one trigger bucket');
});

test('share never returns NaN, because a NaN reaches the DOM as "no data"', () => {
  assert.equal(share(0, 0), 0);
  assert.equal(share(5, 0), 0);
  assert.equal(share(1, 4), 0.25);
});

test('the headline names the peak hour and the trigger behind the spend', () => {
  const a = foldTurns(emptyAgentDigest('a', 'A'), [
    turn({ ts: at(2026, 8, 27, 2), usd: 9, trigger: 'standup' }),
    turn({ ts: at(2026, 8, 27, 11), usd: 1, trigger: 'human' })
  ], 0, Date.now());
  const t = totalsOf([a]);
  const d = { total: t.total, byHour: t.byHour, byTrigger: t.byTrigger, byContext: t.byContext };
  assert.equal(digestHeadline(d), 'Busiest hour 02:00 · standup is 90% of the spend');
  assert.equal(digestHeadline({ ...d, total: { turns: 0, tokens: 0, usd: 0 } }), null,
    'nothing to say beats a headline about zero');
});

// ── the transcript parser ───────────────────────────────────────────────────
// Driven on text rather than on a file: the real reader points at the user's own
// ~/.claude, and a test has no business writing there.

const { parseTranscriptTurns } = loadTs('src/main/usageDigest.ts');

const jsonl = (...recs) => recs.map((r) => JSON.stringify(r)).join('\n') + '\n';
const user = (text, ts = '2026-08-27T03:00:00.000Z') =>
  ({ type: 'user', timestamp: ts, message: { content: text } });
const asst = (id, usage, ts = '2026-08-27T03:00:01.000Z') =>
  ({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-opus-4-1', usage } });
const U = (input, output, cacheRead = 0, cacheWrite = 0) =>
  ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite });

test('one response written as three content blocks is ONE turn', () => {
  // Claude Code writes a line per block, each carrying the SAME message.id and a
  // VERBATIM copy of that request's usage. Summing lines bills it three times —
  // the 1.49x over-count transcript.ts already guards against.
  const turns = parseTranscriptTurns(jsonl(
    user('Hourly ops standup'),
    asst('msg_1', U(100, 10)), asst('msg_1', U(100, 10)), asst('msg_1', U(100, 10))
  ));
  assert.equal(turns.length, 1);
  assert.equal(turns[0].tokens, 110);
});

test('a turn is attributed to the PROMPT that started it, across the tool loop', () => {
  // The tool_result messages between prompt and answer are the harness feeding
  // the model its own output. Counting one as a prompt would file most of the
  // night under "other" — the exact blind spot this tab exists to remove.
  const turns = parseTranscriptTurns(jsonl(
    user('You have new hive inbox message(s) — read your inbox'),
    asst('m1', U(1000, 10)),
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    asst('m2', U(2000, 20)),
    user('HUMAN ANSWER: ship it'),
    asst('m3', U(3000, 30))
  ));
  assert.deepEqual(turns.map((t) => t.trigger), ['inbox-nudge', 'inbox-nudge', 'human']);
});

test('a turn carries what the request CARRIED, not what it produced', () => {
  const [t] = parseTranscriptTurns(jsonl(user('hi'), asst('m1', U(5_000, 900_000, 300_000, 20_000))));
  assert.equal(t.contextTokens, 325_000, 'input + cache read + cache write — output is not context yet');
  assert.equal(contextBucket(t.contextTokens), '200–400k');
  assert.equal(t.tokens, 1_225_000, 'billed is all four');
  assert.ok(t.usd > 0, 'priced from its own model');
});

test('records without usage, and unparseable lines, are skipped rather than fatal', () => {
  const turns = parseTranscriptTurns(
    'not json\n' + jsonl(user('hi'), { type: 'assistant', message: { id: 'm0' } }, asst('m1', U(10, 1))));
  assert.equal(turns.length, 1);
});

test('the timestamp is the assistant record\'s own', () => {
  const [t] = parseTranscriptTurns(jsonl(user('hi'), asst('m1', U(10, 1), '2026-08-27T02:30:00.000Z')));
  assert.equal(t.ts, Date.parse('2026-08-27T02:30:00.000Z'));
  const [u] = parseTranscriptTurns(jsonl(user('hi'), { type: 'assistant', message: { id: 'm2', usage: U(10, 1) } }));
  assert.equal(u.ts, 0, 'no timestamp is 0, not NaN — foldTurns keys off exactly that');
});
