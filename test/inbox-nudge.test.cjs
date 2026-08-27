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
  DEFAULT_INBOX_NUDGE_DEBOUNCE_SECONDS
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
  assert.match(src, /enqueueMessage\(a\.id, inboxNudgeText\(fresh\.length\)\)/,
    'the batched nudge must carry the count, or the agent answers one of three');
});

test('held mail is NOT marked seen — that is what makes it a delay, not a drop', () => {
  const src = read('src/renderer/src/hooks/useHive.ts');
  const held = /if \(nudgeHeld\([\s\S]*?continue;/.exec(src);
  assert.ok(held, 'the debounce branch is gone');
  assert.ok(!/seen\.add/.test(held[0]),
    'marking held mail seen would silence it forever — the whole point is that it comes back');
});
