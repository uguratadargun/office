'use strict';

/**
 * Telegram remote control (MD-55) — the pure decision points: the chat-id
 * allowlist, the offset advance that stops re-delivery, the handle mapping that
 * makes Telegram ride the Slack pipeline, and the terminal-error classifier.
 * The long-poll loop itself (a live https socket) is not exercised here; every
 * decision it makes is.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  filterUpdates,
  telegramChannel,
  parseTelegramTarget,
  isTerminalTelegramError
} = loadTs('src/main/telegram.ts');

const ALLOWED = '424242';

/** One getUpdates entry, shaped like Telegram's. */
const upd = (update_id, chatId, text, message_id = 7) => ({
  update_id,
  message: { message_id, text, chat: { id: chatId } }
});

// ─── the allowlist ───────────────────────────────────────────────────────────

test('a message from the allowed chat is accepted', () => {
  const { messages } = filterUpdates([upd(10, 424242, 'ship it')], ALLOWED, 0);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, 'ship it');
});

test('a message from any other chat is dropped', () => {
  const { messages } = filterUpdates([upd(10, 999, 'let me in')], ALLOWED, 0);
  assert.deepEqual(messages, []);
});

test('a numeric chat id matches its string form (Telegram sends a number)', () => {
  const { messages } = filterUpdates([upd(10, 424242, 'hi')], ALLOWED, 0);
  assert.equal(messages.length, 1);
});

test('with no allowed id configured NOTHING is accepted (fail closed)', () => {
  // A blank allowlist must not degrade into "any chat" — that would hand the
  // whole office to whoever finds the bot.
  assert.deepEqual(filterUpdates([upd(10, 424242, 'hi')], '', 0).messages, []);
  assert.deepEqual(filterUpdates([upd(10, 424242, 'hi')], '   ', 0).messages, []);
});

test('non-text updates (photos, joins, edits) are ignored', () => {
  const updates = [
    { update_id: 1, message: { message_id: 1, chat: { id: 424242 } } },       // no text
    { update_id: 2, message: { message_id: 2, text: '   ', chat: { id: 424242 } } },
    { update_id: 3, edited_message: { text: 'nope', chat: { id: 424242 } } }, // not `message`
    { update_id: 4 }                                                          // no message at all
  ];
  assert.deepEqual(filterUpdates(updates, ALLOWED, 0).messages, []);
});

test('a malformed/absent result set is survivable, not a crash', () => {
  for (const bad of [null, undefined, 'nope', {}]) {
    assert.deepEqual(filterUpdates(bad, ALLOWED, 5), { messages: [], nextOffset: 5 });
  }
});

// ─── the offset (no re-delivery, ever) ───────────────────────────────────────

test('the offset advances past every update seen, including dropped ones', () => {
  // A stranger's message must still be acked to Telegram — otherwise getUpdates
  // replays it forever and the poll never makes progress.
  const { messages, nextOffset } = filterUpdates(
    [upd(10, 999, 'stranger'), upd(11, 424242, 'owner')], ALLOWED, 0
  );
  assert.equal(messages.length, 1);
  assert.equal(nextOffset, 12);
});

test('the offset never moves backwards on an out-of-order batch', () => {
  const { nextOffset } = filterUpdates([upd(50, 424242, 'a'), upd(20, 424242, 'b')], ALLOWED, 0);
  assert.equal(nextOffset, 51);
});

test('an empty batch leaves the offset exactly where it was', () => {
  assert.equal(filterUpdates([], ALLOWED, 77).nextOffset, 77);
});

// ─── handle mapping (this is what makes it ride the Slack pipeline) ──────────

test('an accepted message carries a tg: channel and a PER-MESSAGE thread handle', () => {
  const { messages } = filterUpdates([upd(1, 424242, 'do the thing', 555)], ALLOWED, 0);
  assert.equal(messages[0].channel, 'tg:424242');
  assert.equal(messages[0].thread_ts, 'tg:424242:555');
});

test('two messages in one chat get DIFFERENT thread handles', () => {
  // They share a channel but must not share a thread key: the done-reply ledger
  // and the already-replied set are both keyed on thread_ts, so a constant one
  // would make the second request silently skip its reply.
  const { messages } = filterUpdates(
    [upd(1, 424242, 'first', 100), upd(2, 424242, 'second', 101)], ALLOWED, 0
  );
  assert.notEqual(messages[0].thread_ts, messages[1].thread_ts);
  assert.equal(messages[0].channel, messages[1].channel);
});

test('telegramChannel and parseTelegramTarget round-trip', () => {
  assert.equal(telegramChannel(-100987), 'tg:-100987');
  assert.deepEqual(parseTelegramTarget('tg:-100987'), { chatId: '-100987' });
});

test('a thread handle yields the chat id AND the message id to reply under', () => {
  assert.deepEqual(parseTelegramTarget('tg:424242:555'), { chatId: '424242', messageId: 555 });
});

test('a Slack channel is NOT a Telegram target (this is the routing switch)', () => {
  for (const notTg of ['C0123ABCD', '', undefined, null, 'tg:', 'telegram:1']) {
    assert.equal(parseTelegramTarget(notTg), null, String(notTg));
  }
});

// ─── terminal errors ─────────────────────────────────────────────────────────

test('permanent Telegram errors are recognised so the poller stops hammering', () => {
  assert.equal(isTerminalTelegramError('Unauthorized'), true);
  assert.equal(isTerminalTelegramError('Forbidden: bot was blocked by the user'), true);
  assert.equal(isTerminalTelegramError('Bad Request: chat not found'), true);
});

test('a transient error is left retryable', () => {
  assert.equal(isTerminalTelegramError('Too Many Requests: retry after 3'), false);
  assert.equal(isTerminalTelegramError('socket hang up'), false);
  assert.equal(isTerminalTelegramError(undefined), false);
});
