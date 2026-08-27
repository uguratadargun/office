'use strict';

/**
 * One pending inbox nudge per agent.
 *
 * The nudge is queued the moment mail lands, but typed only once the terminal is
 * free — and an agent's Stop hook usually drains the inbox before that. Stacked
 * copies then arrive against an ALREADY-EMPTY inbox: the floor saw three in a
 * row on 2026-08-21 12:50Z, each costing a delivery slot and a model round-trip
 * to be told there was nothing to read.
 *
 * The queue therefore recognises the nudge, the same way it already recognises
 * `/compact`. This pins the recogniser — if the nudge text drifts and this stops
 * matching, the dedupe silently turns off, which is the failure worth catching.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { INBOX_NUDGE_TEXT, isInboxNudge } = loadTs('src/shared/inboxNudge.ts');

test('the shipped nudge text is recognised as a nudge', () => {
  assert.equal(isInboxNudge(INBOX_NUDGE_TEXT), true,
    'the constant the renderer enqueues must match the recogniser');
});

test('recognises the nudge regardless of surrounding whitespace', () => {
  assert.equal(isInboxNudge(`\n  ${INBOX_NUDGE_TEXT}  \n`), true);
});

test('a reworded guidance tail still matches, so the dedupe cannot silently lapse', () => {
  assert.equal(
    isInboxNudge('You have new hive inbox message(s) — go read them, whatever the tail says.'),
    true);
});

test('ordinary work is never mistaken for a nudge', () => {
  for (const text of [
    'Fix the failing test in test/pr-loop.test.cjs',
    '/compact',
    'DISPATCH MD-7 — hive-ops hardening',
    'Please check your inbox when you get a chance',   // near-miss, different opening
    ''
  ]) {
    assert.equal(isInboxNudge(text), false, `must not match: ${JSON.stringify(text)}`);
  }
});

// ---------------------------------------------------------------------------
// MD-163 — one wake per agent per burst.
//
// Every nudge is a full model turn against a 130k+ token context, so a burst of
// mail must cost ONE. The three rules below are what the main-process delivery
// path and the renderer's nudge loop both consult; pinning them here is what
// stops a future edit from quietly restoring the per-message wake.
// ---------------------------------------------------------------------------

const {
  inboxNudgeText, isSystemSender, shouldNudgeForMail,
  inboxNudgeDebounceMs, nudgeHeld, wakesHibernatedAgent,
  DEFAULT_INBOX_NUDGE_DEBOUNCE_SECONDS,
  inboxNudgeMail, nudgeMailDigest, clipToBytes, NUDGE_BODY_BYTES,
  isBareAck, ACK_BODY_MAX
} = loadTs('src/shared/inboxNudge.ts');

test('a batched nudge names the count and is still recognised as a nudge', () => {
  const three = inboxNudgeText(3);
  assert.match(three, /3 of them/, 'the agent must be told the burst was a burst');
  assert.equal(isInboxNudge(three), true,
    'a batched nudge that stops matching would defeat the queue dedupe it relies on');
  assert.match(three, /move handled ones to inbox\/\.done\//,
    'the instruction half must survive the splice');
});

test('one message keeps the exact shipped text', () => {
  // MD-146's first-wake announce and test/wake-announce.test.cjs pin this
  // constant; a count of 1 must not produce a second, near-identical string.
  for (const n of [1, 0, -2, NaN]) {
    assert.equal(inboxNudgeText(n), INBOX_NUDGE_TEXT, `count ${n}`);
  }
});

test("only mail that asks for something wakes a parked agent", () => {
  // Waking respawns the CLI with --resume — the whole transcript re-sent as a
  // cache-write prefix — and then types the nudge. An FYI is not worth that.
  for (const act of ['request', 'query', 'propose']) {
    assert.equal(wakesHibernatedAgent({ act }), true, act);
  }
  // `done` wakes too: a finished card is work for whoever has to close or merge
  // it, and a report that sits unread stalls the floor. The burn the audit
  // measured was `inform` — an FYI — not a report.
  assert.equal(wakesHibernatedAgent({ act: 'done' }), true, 'done');
  for (const act of ['inform', 'agree', 'refuse']) {
    assert.equal(wakesHibernatedAgent({ act }), false, act);
  }
  assert.equal(wakesHibernatedAgent({ act: 'inform', requires_reply: true }), true,
    'an explicit requires_reply outranks the act');
  assert.equal(wakesHibernatedAgent(null), false);
  assert.equal(wakesHibernatedAgent({}), false);
});

test("the scheduler's own beats nudge a working floor but not an idle one", () => {
  const beat = [{ from: 'scheduler' }];
  assert.equal(shouldNudgeForMail(beat, false), false,
    'the hourly standup on a silent night is the burn this card exists to stop');
  assert.equal(shouldNudgeForMail(beat, true), true,
    'while agents are actually working the digest is worth reading');
  for (const from of ['heartbeat', 'scheduler', 'breaker', 'system']) {
    assert.equal(isSystemSender(from), true, from);
  }
  for (const from of ['god', 'pam-mt310mbm', 'webhook', undefined]) {
    assert.equal(isSystemSender(from), false, String(from));
  }
});

test('real mail nudges an idle floor, even mixed in with beats', () => {
  assert.equal(shouldNudgeForMail([{ from: 'god' }], false), true);
  assert.equal(shouldNudgeForMail([{ from: 'scheduler' }, { from: 'god' }], false), true,
    'one actionable message in the batch is enough — the agent reads the whole inbox');
  assert.equal(shouldNudgeForMail([], true), false, 'no mail, no nudge');
});

test('the debounce window is 60s by default and switchable off', () => {
  assert.equal(DEFAULT_INBOX_NUDGE_DEBOUNCE_SECONDS, 60);
  assert.equal(inboxNudgeDebounceMs(undefined), 60_000);
  assert.equal(inboxNudgeDebounceMs(90), 90_000);
  for (const off of [0, -1, NaN]) {
    assert.equal(inboxNudgeDebounceMs(off), 0, `${off} must disable batching, not shorten it`);
  }
});

test('a burst is held inside the window and released after it', () => {
  const W = 60_000;
  assert.equal(nudgeHeld(undefined, 1_000, W), false, 'the first message always nudges');
  assert.equal(nudgeHeld(1_000, 6_000, W), true, 'the two behind it are held');
  assert.equal(nudgeHeld(1_000, 61_000, W), false,
    'held mail is not dropped — the next tick past the window nudges with the full count');
  assert.equal(nudgeHeld(1_000, 6_000, 0), false, 'window off means never held');
});

// The policy above is only worth anything if it is actually CONSULTED. Both
// call sites are pinned the way test/wake-announce.test.cjs pins the announce:
// a refactor that drops one of these would leave every unit test above green.

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const read = (rel) => readFileSync(join(__dirname, '..', rel), 'utf8');

test('main gates the wake emit — it does not announce every delivery', () => {
  const src = read('src/main/hive.ts');
  const body = /private deliver\([\s\S]*?\n  \}/.exec(src);
  assert.ok(body, 'deliver() is gone — the wake is announced somewhere else now');
  assert.match(body[0], /if \(!wakesHibernatedAgent\(msg\)\) return;/,
    'an unconditional emit is the pre-MD-163 behaviour: every FYI respawns a parked agent');
  assert.match(body[0], /hive:agentWake/);
});

test('the renderer nudge loop consults the floor gate and the debounce', () => {
  const src = read('src/renderer/src/hooks/useHive.ts');
  assert.match(src, /shouldNudgeForMail\(fresh, floorBusy\)/,
    'without this a scheduler beat nudges an idle floor every hour, all night');
  assert.match(src, /nudgeHeld\(lastNudge\.current\[a\.id\], now, debounceMs\)/,
    'without this a burst of N messages costs N wakes');
  assert.match(src, /enqueueMessage\(a\.id, inboxNudgeMail\(fresh\)\)/,
    'MD-171: the nudge carries the mail (and, via inboxNudgeText, still the count)');
});

test('held mail is NOT marked seen — that is what makes it a delay, not a drop', () => {
  const src = read('src/renderer/src/hooks/useHive.ts');
  const held = /if \(nudgeHeld\([\s\S]*?continue;/.exec(src);
  assert.ok(held, 'the debounce branch is gone');
  assert.ok(!/seen\.add/.test(held[0]),
    'marking held mail seen would silence it forever — the whole point is that it comes back');
});

// ─── MD-171: the nudge carries the mail ──────────────────────────────────────
// The turn is being spent either way. What it must NOT also buy is `ls inbox`,
// a `cat` per file and (measured across 97 sessions) a memory.md re-read.

const mail = (over = {}) =>
  ({ id: 'm-1', from: 'god', act: 'request', subject: 'MD-99 dispatch', body: 'do the thing', ...over });

test('the nudge opens with the lead sentence and then the mail', () => {
  const text = inboxNudgeMail([mail()]);
  assert.equal(isInboxNudge(text), true, 'the dedupe key is the lead sentence — it must survive');
  assert.match(text, /\[m-1\] god request — MD-99 dispatch/, 'id, sender, act and subject');
  assert.match(text, /do the thing/, 'and the body itself, or the agent still has to open the file');
});

test('a batch keeps its count AND lists every message', () => {
  const text = inboxNudgeMail([mail(), mail({ id: 'm-2', subject: 'second' })]);
  assert.match(text, /2 of them/, 'the MD-163 batch count rides along unchanged');
  assert.match(text, /\[m-1\]/);
  assert.match(text, /\[m-2\]/);
});

test('a body over the budget is clipped and names its file; a short one is not', () => {
  const big = inboxNudgeMail([mail({ body: 'x'.repeat(NUDGE_BODY_BYTES + 500) })], { inboxDir: '/h/agents/jim/inbox' });
  assert.match(big, /clipped at 2048 bytes/);
  assert.match(big, /\/h\/agents\/jim\/inbox\/m-1\.json/, 'the pointer is the whole point of clipping');
  assert.ok(!/x{2049}/.test(big), 'the oversized body must not ride in full');
  assert.ok(!/clipped at/.test(inboxNudgeMail([mail()])),
    'a body that fits carries no clip notice — a pointer nobody needs is pure cost');
});

test('the budget is bytes, not characters — a multibyte body cannot smuggle 3× its cost', () => {
  // '✅' is three bytes. Counting characters would let 2048 of them through as
  // 6 KB of context, which is exactly the overrun the budget exists to prevent.
  const { text, clipped } = clipToBytes('✅'.repeat(1000), 300);
  assert.equal(clipped, true);
  assert.equal(text.length, 100, '100 × 3 bytes = the 300-byte budget, cut on a character boundary');
  assert.equal(clipToBytes('short', 300).clipped, false);
});

test('the digest tells the agent where the file is and what .done means', () => {
  const text = nudgeMailDigest([mail()], { inboxDir: '/h/inbox' });
  assert.match(text, /\/h\/inbox\/<id>\.json/);
  assert.match(text, /\/h\/inbox\/\.done/, 'the .done contract is restated, because the file still lands in inbox');
  assert.ok(!/\/h\/inbox\/\.done\//.test(text),
    'no trailing separator — test/hive-windows-prompt pins the absence of the mixed-separator form');
});

test('a Windows inbox path keeps Windows separators', () => {
  const text = nudgeMailDigest([mail()], { inboxDir: 'C:\\h\\agents\\jim\\inbox' });
  assert.match(text, /C:\\h\\agents\\jim\\inbox\\<id>\.json/);
  assert.ok(!text.includes('inbox/'), 'a mixed-separator path is one its own shell cannot open');
});

test('no messages, no digest — the lead sentence stands alone', () => {
  assert.equal(inboxNudgeMail([]), INBOX_NUDGE_TEXT);
  assert.equal(nudgeMailDigest([]), '');
});

// ─── MD-170: a bare ack of an FYI is not mail ────────────────────────────────
// 125 of 845 live messages were replies to informs that asked for none. Each one
// woke its recipient for a turn that learned nothing.

const inform = { act: 'inform', requires_reply: false };
const ack = (over = {}) => ({ in_reply_to: 'm-1', act: 'inform', body: 'got it, thanks', ...over });

test('a short reply to a terminal inform is a bare ack', () => {
  assert.equal(isBareAck(ack(), inform), true);
  assert.equal(isBareAck(ack({ act: 'agree' }), inform), true, 'agree/refuse close a proposal, not an FYI');
});

test('an ack must actually be a REPLY, and the parent must be findable', () => {
  assert.equal(isBareAck(ack({ in_reply_to: null }), inform), false, 'an unsolicited inform is not an ack');
  assert.equal(isBareAck(ack(), null), false, 'an unfindable parent fails OPEN — losing mail is worse');
});

test('only a TERMINAL inform can be acked away', () => {
  assert.equal(isBareAck(ack(), { act: 'request' }), false, 'this is the answer someone is waiting on');
  assert.equal(isBareAck(ack(), { act: 'query' }), false);
  assert.equal(isBareAck(ack(), { act: 'inform', requires_reply: true }), false,
    'the sender explicitly asked to be answered');
});

test('a reply that asks for something is never an ack, however short', () => {
  for (const act of ['request', 'query', 'propose', 'done']) {
    assert.equal(isBareAck(ack({ act }), inform), false, `a ${act} carries work`);
  }
  assert.equal(isBareAck(ack({ requires_reply: true }), inform), false, 'the flag outranks the act');
});

test('length is what separates "got it" from a real follow-up', () => {
  assert.equal(isBareAck(ack({ body: 'x'.repeat(ACK_BODY_MAX - 1) }), inform), true);
  assert.equal(isBareAck(ack({ body: 'x'.repeat(ACK_BODY_MAX) }), inform), false,
    'at the limit it is substantive — deliver it');
});
