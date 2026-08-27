'use strict';

// What a card cost, and when a night got expensive (MD-176).
//
// The cost ledger's shape is the whole trap: its rows are CUMULATIVE running
// totals per (agent, session), and two sources write into it with different
// meanings. Every over-count this file pins was measured on the real ledger.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  spendInWindow, agentSpend, taskSpend, taskSpendWindow, stampTaskSpans,
  isNightHour, nightKey, nightStartMs, alarmWindow, shouldRaiseSpendAlarm, formatSpendAlarm, usd
} = require('./load-ts.cjs')('src/shared/spend.ts');

const row = (agent, session, ts, usdVal, tokens = 0) => ({
  agent_id: agent, session_id: session, ts,
  input: tokens, output: 0, cache_read: 0, cache_creation: 0, usd: usdVal
});

// ─── the cumulative-row trap ────────────────────────────────────────────────

test('a cumulative series counts its GROWTH, not the sum of its rows', () => {
  // Summing usd across rows re-adds the whole running total on every beat — the
  // same over-count MD-78 fixed one rung up. 1 + 2 + 3 = 6 is the wrong answer;
  // the session cost 3 and 1 of it happened before the window.
  const rows = [
    row('jim', 's1', 100, 1), row('jim', 's1', 200, 2), row('jim', 's1', 300, 3)
  ];
  assert.equal(spendInWindow(rows, 100, 300).total.usd, 2);
});

test('a series that appears mid-window contributes its growth, never its history', () => {
  // THE trap that made this "growth only": one transcript-fallback row read
  // $38.76 for an agent whose live session said $2.52. Counted from zero it
  // dumps a lifetime of spend into whichever night that single row landed in.
  const rows = [row('jim', '', 150, 38.76)];
  assert.equal(spendInWindow(rows, 100, 300).total.usd, 0);
});

test('the live session and the transcript fallback do not double-count', () => {
  const rows = [
    row('jim', 's1', 100, 1), row('jim', 's1', 300, 3),   // live: +2
    row('jim', '', 200, 38.76)                            // one fallback snapshot: +0
  ];
  assert.equal(spendInWindow(rows, 100, 300).byAgent.jim.usd, 2);
});

test('a counter that drops restarted, so the new value is fresh spend', () => {
  // A relaunched session re-reads from zero. Treating the drop as negative spend
  // would let a restart refund the night.
  const rows = [row('jim', 's1', 100, 5), row('jim', 's1', 200, 0.5)];
  assert.equal(spendInWindow(rows, 0, 999).total.usd, 0.5);
});

test('rows outside the window are ignored on both ends', () => {
  const rows = [
    row('jim', 's1', 50, 1), row('jim', 's1', 150, 2), row('jim', 's1', 250, 9)
  ];
  // Only the 150 row is inside, and a lone in-window row is a baseline: 0.
  assert.equal(spendInWindow(rows, 100, 200).total.usd, 0);
});

test('each agent gets its own line and the total is their sum', () => {
  const rows = [
    row('jim', 's1', 100, 1), row('jim', 's1', 200, 3),
    row('pam', 's2', 100, 0), row('pam', 's2', 200, 0.5)
  ];
  const s = spendInWindow(rows, 0, 999);
  assert.equal(s.byAgent.jim.usd, 2);
  assert.equal(s.byAgent.pam.usd, 0.5);
  assert.equal(s.total.usd, 2.5);
});

test('tokens follow the same growth rule as dollars', () => {
  const rows = [row('jim', 's1', 100, 0, 1000), row('jim', 's1', 200, 0, 4000)];
  assert.equal(spendInWindow(rows, 0, 999).total.tokens, 3000);
});

test('billed tokens are every leg, not just input', () => {
  const rows = [
    { agent_id: 'jim', session_id: 's1', ts: 100, input: 0, output: 0, cache_read: 0, cache_creation: 0, usd: 0 },
    { agent_id: 'jim', session_id: 's1', ts: 200, input: 1, output: 2, cache_read: 4, cache_creation: 8, usd: 0 }
  ];
  assert.equal(spendInWindow(rows, 0, 999).total.tokens, 15);
});

test('an agent nobody billed reads zero, not undefined', () => {
  assert.deepEqual(agentSpend([], 'ghost', 0, 1), { usd: 0, tokens: 0 });
});

// ─── card spans ─────────────────────────────────────────────────────────────

const NOW = '2026-08-27T12:00:00.000Z';

test('entering doing stamps a start, and only once', () => {
  const first = stampTaskSpans([{ status: 'doing' }], NOW);
  assert.equal(first.changed, true);
  assert.equal(first.cards[0].startedAt, NOW);
  // Idempotent: every writer and the periodic reconcile all run this.
  const again = stampTaskSpans(first.cards, '2026-08-27T13:00:00.000Z');
  assert.equal(again.changed, false);
  assert.equal(again.cards[0].startedAt, NOW);
});

test('leaving doing stamps an end, and only once', () => {
  const done = stampTaskSpans([{ status: 'done', startedAt: NOW }], '2026-08-27T13:00:00.000Z');
  assert.equal(done.cards[0].endedAt, '2026-08-27T13:00:00.000Z');
  assert.equal(stampTaskSpans(done.cards, '2026-08-27T14:00:00.000Z').changed, false);
});

test('a card that never started never gets an end', () => {
  const r = stampTaskSpans([{ status: 'todo' }], NOW);
  assert.equal(r.changed, false);
  assert.equal(r.cards[0].endedAt, undefined);
});

test('re-opening a card keeps the original start and clears the end', () => {
  // The span is "how long this was being worked". A card sent back to doing is
  // the same work, not a second card.
  const r = stampTaskSpans([{ status: 'doing', startedAt: NOW, endedAt: '2026-08-27T13:00:00.000Z' }], 'x');
  assert.equal(r.changed, true);
  assert.equal(r.cards[0].startedAt, NOW);
  assert.equal(r.cards[0].endedAt, undefined);
});

test('a card still in flight is measured up to now', () => {
  const started = '2026-01-01T00:00:00.000Z';
  const now = Date.parse(started) + 60_000;
  const w = taskSpendWindow({ status: 'doing', startedAt: started }, now);
  assert.deepEqual(w, { from: Date.parse(started), to: now });
});

test('a window that would run backwards is refused, not silently inverted', () => {
  // A clock that moved, or a bad stamp. An inverted window quietly reports zero
  // forever; null says "no measurement", which is the truth.
  assert.equal(taskSpendWindow({ status: 'doing', startedAt: '2026-01-01T00:00:00.000Z' }, 5000), null);
});

test('a card with no start has no window, so it borrows nobody\'s spend', () => {
  // The alternative — falling back to the assignee's whole day — reports a number
  // that is confidently wrong, which is worse than reporting nothing.
  assert.equal(taskSpendWindow({ status: 'todo', createdAt: NOW }, 1), null);
  assert.equal(taskSpend([], { status: 'todo', assignee: 'jim' }, 1), null);
});

test('an unassigned card has no cost, however long it sat in doing', () => {
  assert.equal(taskSpend([row('jim', 's1', 1, 1)], { status: 'doing', startedAt: NOW }, 9e12), null);
});

test('a card costs its assignee\'s spend across its own window only', () => {
  const start = Date.parse('2026-08-27T10:00:00.000Z');
  const rows = [
    row('jim', 's1', start - 1000, 1),          // before the card started
    row('jim', 's1', start + 1000, 4),
    row('jim', 's1', start + 2000, 6),
    row('pam', 's2', start + 1500, 99)          // somebody else's spend
  ];
  const card = { status: 'doing', assignee: 'jim', startedAt: '2026-08-27T10:00:00.000Z' };
  assert.deepEqual(taskSpend(rows, card, start + 5000), { usd: 2, tokens: 0 });
});

// ─── the night window ───────────────────────────────────────────────────────

const at = (h, m = 0, day = 27) => new Date(2026, 7, day, h, m, 0, 0);   // local

test('the quiet hours wrap midnight', () => {
  assert.equal(isNightHour(at(23)), true);
  assert.equal(at(2).getHours() < 8 && isNightHour(at(2)), true);
  assert.equal(isNightHour(at(8)), false);
  assert.equal(isNightHour(at(21, 59)), false);
  assert.equal(isNightHour(at(22)), true);
});

test('both halves of one night share a key, so the alarm fires once', () => {
  // 23:30 on the 27th and 02:00 on the 28th are the SAME night. A key that
  // changed at midnight would alarm twice before breakfast.
  assert.equal(nightKey(at(23, 30, 27)), '2026-08-27');
  assert.equal(nightKey(at(2, 0, 28)), '2026-08-27');
  assert.equal(nightKey(at(22, 0, 28)), '2026-08-28');
});

test('the window starts at the local 22:00 that opened it', () => {
  assert.equal(nightStartMs(at(2, 0, 28)), at(22, 0, 27).getTime());
  assert.equal(nightStartMs(at(23, 0, 27)), at(22, 0, 27).getTime());
});

test('during the quiet hours the window opens at 22:00', () => {
  assert.deepEqual(alarmWindow(at(2, 30, 28), false, null),
    { from: at(22, 0, 27).getTime(), to: at(2, 30, 28).getTime() });
});

test('a floor that goes quiet BY DAY is measured from its last activity', () => {
  // THE trap: measuring from 22:00 at 14:00 bills a whole working day to
  // "nobody was driving this". Checked against the real ledger, that was the
  // difference between $250 and the handful of dollars actually unattended.
  const lastActivity = at(13, 0).getTime();
  assert.deepEqual(alarmWindow(at(14, 0), true, lastActivity),
    { from: lastActivity, to: at(14, 0).getTime() });
});

test('a busy daytime floor has no window at all', () => {
  assert.equal(alarmWindow(at(14, 0), false, at(13, 0).getTime()), null);
});

test('a quiet floor with no activity signal at all has no window', () => {
  // "We cannot tell" must never open an alarm window.
  assert.equal(alarmWindow(at(14, 0), true, null), null);
});

const ALARM = { now: at(2), quietFloor: false, spentUsd: 9, thresholdUsd: 5 };

test('spend over the limit during the quiet hours raises it', () => {
  assert.equal(shouldRaiseSpendAlarm(ALARM), true);
});

test('a quiet floor counts as night whatever the clock says', () => {
  // The MD-164 signal: an hour with nothing happening is unattended spend, and
  // that is the thing worth interrupting somebody about.
  assert.equal(shouldRaiseSpendAlarm({ ...ALARM, now: at(14) }), false);
  assert.equal(shouldRaiseSpendAlarm({ ...ALARM, now: at(14), quietFloor: true }), true);
});

test('it fires once per night, and the next night re-arms it', () => {
  assert.equal(shouldRaiseSpendAlarm({ ...ALARM, lastAlarmKey: '2026-08-26' }), false);
  assert.equal(shouldRaiseSpendAlarm({ ...ALARM, lastAlarmKey: '2026-08-25' }), true);
});

test('at or under the limit says nothing', () => {
  assert.equal(shouldRaiseSpendAlarm({ ...ALARM, spentUsd: 5 }), false);
  assert.equal(shouldRaiseSpendAlarm({ ...ALARM, spentUsd: 5.01 }), true);
});

test('a threshold of zero disables the alarm outright', () => {
  assert.equal(shouldRaiseSpendAlarm({ ...ALARM, thresholdUsd: 0 }), false);
  assert.equal(shouldRaiseSpendAlarm({ ...ALARM, thresholdUsd: -1 }), false);
});

// ─── the message ────────────────────────────────────────────────────────────

test('sub-cent spend never reads as $0.00', () => {
  // A zero in an over-limit alarm looks like the alarm misfired.
  assert.equal(usd(0.004), '<$0.01');
  assert.equal(usd(0), '$0.00');
  assert.equal(usd(4.1), '$4.10');
});

test('the alarm names the number, the limit and who spent it', () => {
  const text = formatSpendAlarm({
    spentUsd: 9.5, thresholdUsd: 5, now: at(2),
    byAgent: { jim: { usd: 8, tokens: 1_200_000 }, pam: { usd: 1.5, tokens: 4000 } },
    nameFor: (id) => (id === 'jim' ? 'Jim' : id)
  });
  assert.match(text, /\$9\.50/);
  assert.match(text, /\$5\.00 limit/);
  assert.match(text, /since 22:00/);
  // Biggest spender first — a breakdown you have to sort yourself is a list.
  assert.ok(text.indexOf('Jim') < text.indexOf('pam'));
  assert.match(text, /Jim: \$8\.00 \(1,200,000 tokens\)/);
  // Lettered options, because that is what the Ask Me board and Telegram parse.
  assert.match(text, /^a: /m);
});

test('an alarm with nothing attributable still says so rather than showing blank', () => {
  const text = formatSpendAlarm({ spentUsd: 9, thresholdUsd: 5, now: at(2), byAgent: {} });
  assert.match(text, /no per-agent breakdown/);
});

test('the alarm text says which stretch it measured, not always 22:00', () => {
  const text = formatSpendAlarm({
    spentUsd: 9, thresholdUsd: 5, now: at(14), byAgent: {}, since: at(13, 5).getTime()
  });
  assert.match(text, /since 13:05/);
});
