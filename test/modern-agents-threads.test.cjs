'use strict';

/**
 * A thread is only a thread if both halves are in it, exactly once. The router
 * archives a delivered message under BOTH the sender's outbox/.sent and the
 * recipient's inbox/.done, so the merge has to dedup or every reply doubles.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const t = loadTs('src/renderer/src/modern/agents/threads.ts');

const msg = (id, conv, at, extra = {}) => ({
  id, conversation: conv, in_reply_to: null, from: 'god', to: 'ada',
  act: 'request', subject: 'MD-85', body: 'do the thing', hops: 0,
  requires_reply: true, needs_human: false, created_at: at, ...extra
});

test('inbox and outbox merge into one thread, deduped by id', () => {
  const inbox = [msg('m1', 'c1', '2026-08-25T10:00:00Z')];
  const outbox = [
    msg('m2', 'c1', '2026-08-25T10:05:00Z', { from: 'ada', to: 'god', act: 'inform' }),
    msg('m1', 'c1', '2026-08-25T10:00:00Z') // same message, archived down the other path
  ];
  const threads = t.mergeThreads(inbox, outbox);
  assert.equal(threads.length, 1);
  assert.deepEqual(threads[0].messages.map((m) => m.id), ['m1', 'm2']);
});

test('threads sort by newest activity, messages oldest-first inside', () => {
  const threads = t.mergeThreads([
    msg('a1', 'old', '2026-08-25T09:00:00Z'),
    msg('b1', 'new', '2026-08-25T12:00:00Z'),
    msg('a2', 'old', '2026-08-25T09:30:00Z')
  ]);
  assert.deepEqual(threads.map((x) => x.conversation), ['new', 'old']);
  assert.deepEqual(threads[1].messages.map((m) => m.id), ['a1', 'a2']);
  assert.equal(threads[1].lastAt, '2026-08-25T09:30:00Z');
});

test('an unparseable stamp sinks instead of unsorting the whole list', () => {
  const threads = t.mergeThreads([
    msg('x', 'c', 'not-a-date'),
    msg('y', 'c', '2026-08-25T09:00:00Z')
  ]);
  assert.deepEqual(threads[0].messages.map((m) => m.id), ['x', 'y']);
});

test('a message with no conversation still gets its own thread', () => {
  const threads = t.mergeThreads([msg('lone', '', '2026-08-25T09:00:00Z')]);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].conversation, 'lone');
});

test('the reply goes to THIS AGENT, so it lands where the human is looking', () => {
  const [thread] = t.mergeThreads([msg('m1', 'c1', '2026-08-25T10:00:00Z')]);
  const p = t.replyPayload('ada', thread, '  on it  ');
  assert.equal(p.to, 'ada');            // NOT 'god' — that mailbox is not on screen
  assert.equal(p.conversation, 'c1');
  assert.equal(p.in_reply_to, 'm1');
  assert.equal(p.subject, 'Re: MD-85');
  assert.equal(p.body, 'on it');
});

test('Re: is not stacked on an already-Re: subject', () => {
  const [thread] = t.mergeThreads([msg('m1', 'c1', '2026-08-25T10:00:00Z', { subject: 'Re: MD-85' })]);
  assert.equal(t.replyPayload('ada', thread, 'x').subject, 'Re: MD-85');
});

test('long bodies clip until expanded', () => {
  const long = 'x'.repeat(t.BODY_CLIP + 50);
  assert.equal(t.clipBody(long, false).clipped, true);
  assert.equal(t.clipBody(long, false).text.length, t.BODY_CLIP + 1);
  assert.equal(t.clipBody(long, true).text, long);
  assert.equal(t.clipBody('short', false).clipped, false);
});
