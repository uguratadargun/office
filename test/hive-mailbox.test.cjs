'use strict';

/**
 * A thread is not a work queue.
 *
 * inbox() and outbox() each read ONE live folder, which is what the router
 * needs. But the router files a handled message under `inbox/.done` and a
 * delivered one under `outbox/.sent` within seconds, so between them the live
 * folders hold only what nobody has dealt with yet — a conversation built from
 * those loses its own history almost immediately. mailbox() is the read for the
 * UI: both halves, both states, each message exactly once.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { HiveManager } = loadTs('src/main/hive.ts');

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-mailbox-'));
  const dir = path.join(home, 'hive', 'agents', 'ada');
  const write = (sub, id, extra = {}) => {
    const target = path.join(dir, sub);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, `${id}.json`), JSON.stringify({
      id, conversation: 'c1', in_reply_to: null, from: 'god', to: 'ada',
      act: 'inform', subject: 's', body: 'b', hops: 0,
      requires_reply: false, needs_human: false,
      created_at: '2026-08-25T10:00:00.000Z', ...extra
    }));
  };
  return { home, write };
}

test('mailbox reads live AND archived, both directions', () => {
  const { home, write } = fixture();
  write('inbox', 'live-in');
  write('inbox/.done', 'done-in');
  write('outbox', 'live-out', { from: 'ada', to: 'god' });
  write('outbox/.sent', 'sent-out', { from: 'ada', to: 'god' });

  const hive = new HiveManager(() => home);
  const ids = hive.mailbox('ada').map((m) => m.id).sort();
  assert.deepEqual(ids, ['done-in', 'live-in', 'live-out', 'sent-out']);
});

test('a message that exists on both sides is returned once', () => {
  const { home, write } = fixture();
  // The router leaves the same delivered message in the sender's outbox/.sent
  // and the recipient's inbox/.done; this agent can be either end.
  write('inbox/.done', 'both');
  write('outbox/.sent', 'both');

  const hive = new HiveManager(() => home);
  assert.deepEqual(hive.mailbox('ada').map((m) => m.id), ['both']);
});

test('an empty or missing mailbox is an empty list, not a throw', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-mailbox-empty-'));
  const hive = new HiveManager(() => home);
  assert.deepEqual(hive.mailbox('nobody'), []);
});
