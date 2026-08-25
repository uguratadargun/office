'use strict';

/**
 * humanQA <-> Telegram mirror (MD-58) — the pure decisions: which asks get sent,
 * which reply answers which ask, and what the card looks like afterwards. The
 * timer and the https calls are not exercised here; every choice they make is.
 *
 * The invariant under all of it: ASK ME and Telegram are two front doors onto
 * ONE humanQA entry, and whichever closes it first closes it for the other.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  unsentQuestions, findQuestionByMessageId, patchEntry, isOpen,
  formatQuestionForChat, formatAnswerAck, answerMessage
} = loadTs('src/shared/humanQa.ts');
const { filterUpdates } = loadTs('src/main/telegram.ts');

const card = (id, humanQA, title = `card ${id}`) => ({ id, title, humanQA });

// ─── which asks get mirrored ─────────────────────────────────────────────────

test('an open, never-sent ask is pending', () => {
  const p = unsentQuestions([card('MD-1', [{ q: 'which region?', askedAt: 'x' }])]);
  assert.equal(p.length, 1);
  assert.deepEqual(p[0], { taskId: 'MD-1', title: 'card MD-1', index: 0, q: 'which region?' });
});

test('an ask already mirrored is NEVER re-sent', () => {
  // tgMessageId on the card IS the exactly-once ledger — this is the whole
  // reason the mapping lives on the entry instead of in a side file.
  assert.deepEqual(unsentQuestions([card('MD-1', [{ q: 'which?', tgMessageId: 900 }])]), []);
});

test('answered and dismissed asks are not pending', () => {
  const tasks = [card('MD-1', [
    { q: 'answered', a: 'yes' },
    { q: 'dismissed', dismissedAt: 'x' }
  ])];
  assert.deepEqual(unsentQuestions(tasks), []);
});

test('an ask the human answered on ASK ME before the first tick is never sent', () => {
  // Requirement (3): if ASK ME closes it first, Telegram must stay silent.
  assert.deepEqual(unsentQuestions([card('MD-9', [{ q: 'go?', a: 'go' }])]), []);
});

test('only the un-mirrored entries of a mixed card are pending, with their real indexes', () => {
  const p = unsentQuestions([card('MD-3', [
    { q: 'old', a: 'done' },
    { q: 'sent already', tgMessageId: 12 },
    { q: 'fresh' }
  ])]);
  assert.equal(p.length, 1);
  assert.equal(p[0].index, 2, 'the write target must be the real array index');
  assert.equal(p[0].q, 'fresh');
});

test('cards with no humanQA, and a junk ledger, produce nothing rather than throwing', () => {
  assert.deepEqual(unsentQuestions([card('MD-1'), { id: 'MD-2', title: 't', humanQA: 'nope' }]), []);
  for (const bad of [null, undefined, 'nope', {}]) assert.deepEqual(unsentQuestions(bad), []);
});

test('a blank question is not an ask', () => {
  assert.equal(isOpen({ q: '   ' }), false);
  assert.deepEqual(unsentQuestions([card('MD-1', [{ q: '  ' }])]), []);
});

// ─── which reply answers which ask ───────────────────────────────────────────

test('a reply to a mirrored ask locates that exact entry', () => {
  const tasks = [
    card('MD-1', [{ q: 'first', tgMessageId: 100 }]),
    card('MD-2', [{ q: 'other', tgMessageId: 200 }, { q: 'second', tgMessageId: 201 }])
  ];
  const hit = findQuestionByMessageId(tasks, 201);
  assert.deepEqual(hit, { taskId: 'MD-2', title: 'card MD-2', index: 1, q: 'second' });
});

test('a reply to an ask ALREADY answered on ASK ME matches nothing', () => {
  // Requirement (3), the other direction: a late chat reply must not clobber the
  // answer the human typed on the board, and must not double-close the card.
  // Falling through means it is routed as an ordinary request instead.
  const tasks = [card('MD-1', [{ q: 'which?', a: 'the left one', tgMessageId: 100 }])];
  assert.equal(findQuestionByMessageId(tasks, 100), null);
});

test('a reply to a dismissed ask matches nothing', () => {
  const tasks = [card('MD-1', [{ q: 'which?', dismissedAt: 'x', tgMessageId: 100 }])];
  assert.equal(findQuestionByMessageId(tasks, 100), null);
});

test('a reply to an unrelated bot message matches nothing (falls through to god routing)', () => {
  const tasks = [card('MD-1', [{ q: 'which?', tgMessageId: 100 }])];
  assert.equal(findQuestionByMessageId(tasks, 999), null);
});

test('a plain message with no reply_to matches nothing', () => {
  const tasks = [card('MD-1', [{ q: 'which?', tgMessageId: 100 }])];
  for (const bad of [undefined, null, NaN, '100']) {
    assert.equal(findQuestionByMessageId(tasks, bad), null, String(bad));
  }
});

// ─── the write ───────────────────────────────────────────────────────────────

test('answering patches ONE entry and leaves the rest of the history untouched', () => {
  const qa = [{ q: 'old', a: 'done', askedAt: 'a' }, { q: 'live', tgMessageId: 7, askedAt: 'b' }];
  const next = patchEntry(qa, 1, { a: 'ship it', answeredAt: 'now' });
  assert.deepEqual(next[0], qa[0]);
  assert.equal(next[1].a, 'ship it');
  assert.equal(next[1].answeredAt, 'now');
  // The mirror id survives the answer — it is how a duplicate reply is later
  // recognised as pointing at an already-closed ask.
  assert.equal(next[1].tgMessageId, 7);
  assert.equal(next[1].askedAt, 'b');
});

test('patchEntry does not mutate the array it was given', () => {
  const qa = [{ q: 'live' }];
  patchEntry(qa, 0, { a: 'x' });
  assert.equal(qa[0].a, undefined);
});

test('an out-of-range index writes nothing rather than growing the array', () => {
  const qa = [{ q: 'live' }];
  assert.deepEqual(patchEntry(qa, 5, { a: 'x' }), qa);
  assert.deepEqual(patchEntry(qa, -1, { a: 'x' }), qa);
  assert.deepEqual(patchEntry(undefined, 0, { a: 'x' }), []);
});

test('a mirrored ask stops being pending once its id is stamped', () => {
  // The full outbound cycle, in the two calls main actually makes.
  const before = [card('MD-4', [{ q: 'go?' }])];
  const [ask] = unsentQuestions(before);
  const after = [card('MD-4', patchEntry(before[0].humanQA, ask.index, { tgMessageId: 55 }))];
  assert.deepEqual(unsentQuestions(after), []);
  assert.equal(findQuestionByMessageId(after, 55).taskId, 'MD-4');
});

// ─── formatting + the god's mail ─────────────────────────────────────────────

test('the chat question is plain text, card-id prefixed', () => {
  assert.equal(formatQuestionForChat('MD-12', '  Which region?  '), '[MD-12] Which region?');
});

test('a runaway question is trimmed, not dropped by a 400', () => {
  const out = formatQuestionForChat('MD-1', 'x'.repeat(9000));
  assert.ok(out.length <= 3500);
  assert.ok(out.endsWith('…'));
});

test('the chat acknowledgement names the card', () => {
  assert.equal(formatAnswerAck('MD-58'), '✅ MD-58 cevaplandı');
});

test("the god's mail is identical whichever front door answered", () => {
  // Same builder as ASK ME (taskActions re-exports it) — that is the point.
  const m = answerMessage({ id: 'MD-1', title: 'Do the thing' }, 'which one?', 'the left');
  assert.equal(m.to, 'god');
  assert.equal(m.act, 'inform');
  assert.ok(m.body.includes('MD-1'));
  assert.ok(m.body.includes('Q: which one?'));
  assert.ok(m.body.includes('A: the left'));
});

// ─── the transport carries the reply pointer ─────────────────────────────────

test('a chat reply arrives with the message id it replied to', () => {
  const { messages } = filterUpdates([{
    update_id: 1,
    message: { message_id: 9, text: 'eu-west-1', chat: { id: 42 }, reply_to_message: { message_id: 100 } }
  }], '42', 0);
  assert.equal(messages[0].replyToMessageId, 100);
});

test('a plain chat message carries no reply pointer at all', () => {
  const { messages } = filterUpdates([{
    update_id: 1, message: { message_id: 9, text: 'hi', chat: { id: 42 } }
  }], '42', 0);
  assert.equal('replyToMessageId' in messages[0], false);
});

test("a stranger's reply is still dropped by the allowlist", () => {
  // The mirror must not become a way around the one-chat gate.
  const { messages } = filterUpdates([{
    update_id: 1,
    message: { message_id: 9, text: 'yes', chat: { id: 999 }, reply_to_message: { message_id: 100 } }
  }], '42', 0);
  assert.deepEqual(messages, []);
});

// ─── the round-trip through the renderer's re-parse ──────────────────────────

const { parseTasks } = loadTs('src/renderer/src/store/taskLedger.ts');

test('the renderer re-parse PRESERVES the mirror id', () => {
  // The board re-reads tasks.json every 5s and rebuilds each humanQA entry field
  // by field, then writes the whole array back when the human answers. If this
  // mapper dropped tgMessageId, every still-open ask on that card would look
  // un-mirrored on the next tick and be sent to the chat a second time.
  const [t] = parseTasks({
    tasks: [{
      id: 'MD-1', title: 'c', status: 'blocked', dependsOn: [], priority: 3,
      createdAt: '2026-08-25T00:00:00Z',
      humanQA: [{ q: 'answered', a: 'yes', tgMessageId: 10 }, { q: 'still open', tgMessageId: 11 }]
    }]
  });
  assert.equal(t.humanQA[0].tgMessageId, 10);
  assert.equal(t.humanQA[1].tgMessageId, 11);
  // …and the survived id still resolves, so a reply to it is matchable.
  assert.equal(findQuestionByMessageId([t], 11).q, 'still open');
  assert.deepEqual(unsentQuestions([t]), [], 'nothing looks un-mirrored after a re-parse');
});

test('a ledger written by an older build (no mirror ids) just looks un-mirrored', () => {
  const [t] = parseTasks({
    tasks: [{
      id: 'MD-2', title: 'c', status: 'blocked', dependsOn: [], priority: 3,
      createdAt: '2026-08-25T00:00:00Z', humanQA: [{ q: 'legacy ask' }]
    }]
  });
  assert.equal(t.humanQA[0].tgMessageId, undefined);
  assert.equal(unsentQuestions([t]).length, 1, 'it gets mirrored once, then stamped');
});
