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

// ─── MD-170: an ack of an FYI is filed, not delivered ────────────────────────
// 125 of 845 live messages were replies to `inform`s that had asked for none —
// each a wake plus a full read turn to learn that something arrived. The rule
// itself is unit-tested in test/inbox-nudge.test.cjs (isBareAck); what is pinned
// here is the ROUTER honouring it, because that is where the wake is emitted and
// where the file lands.

/** A hive on a temp home with god + jim, recording every emit. */
async function floor(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md170-ack-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const events = [];
  const hive = new HiveManager(() => home, (channel, payload) => { events.push({ channel, payload }); });
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true }, {});
  await hive.ensureAgent({ id: 'jim', name: 'Jim', provider: 'claude', cwd: home }, {});
  const dir = (id, ...rest) => path.join(home, 'hive', 'agents', id, ...rest);
  const ls = (id, ...rest) =>
    fs.readdirSync(dir(id, ...rest)).filter((f) => f.endsWith('.json')).sort();
  const wakes = () => events.filter((e) => e.channel === 'hive:agentWake').map((e) => e.payload.id);
  return { home, hive, dir, ls, wakes };
}

/** god FYIs jim, and jim has handled it — the shape every real ack replies to. */
function fyi(hive, dir) {
  const sent = hive.send({ to: 'jim', act: 'inform', subject: 'FYI', body: 'MD-99 merged' }, 'god');
  fs.renameSync(dir('jim', 'inbox', `${sent.id}.json`), dir('jim', 'inbox', '.done', `${sent.id}.json`));
  return sent;
}

test('a short ack of a terminal inform lands in .done, wakes nobody, and is logged', async (t) => {
  const { hive, dir, ls, wakes } = await floor(t);
  const parent = fyi(hive, dir);
  const ack = hive.send({ to: 'god', act: 'inform', in_reply_to: parent.id, subject: 'ack', body: 'got it' }, 'jim');

  assert.deepEqual(ls('god', 'inbox'), [], 'god must not be handed an "ack" to read');
  assert.deepEqual(ls('god', 'inbox', '.done'), [`${ack.id}.json`],
    'archived, not dropped — the thread and the audit trail stay whole');
  assert.deepEqual(wakes(), [], 'and above all: no respawn');

  const log = fs.readFileSync(path.join(dir('god').replace(path.join('agents', 'god'), ''), 'log.jsonl'), 'utf8');
  assert.match(log, /"kind":"ack-archived"/, 'silently swallowing mail is how a floor loses a message');
});

test('the archived ack is still part of the conversation', async (t) => {
  const { hive, dir } = await floor(t);
  const parent = fyi(hive, dir);
  const ack = hive.send({ to: 'god', act: 'inform', in_reply_to: parent.id, subject: 'ack', body: 'got it' }, 'jim');
  assert.ok(hive.mailbox('god').some((m) => m.id === ack.id), 'a thread view must still show it');
});

test('a reply to a request is delivered — it is the answer somebody waits on', async (t) => {
  const { hive, dir, ls } = await floor(t);
  const asked = hive.send({ to: 'jim', act: 'request', subject: 'which branch?' }, 'god');
  fs.renameSync(dir('jim', 'inbox', `${asked.id}.json`), dir('jim', 'inbox', '.done', `${asked.id}.json`));
  hive.send({ to: 'god', act: 'inform', in_reply_to: asked.id, subject: 're', body: 'feat/x' }, 'jim');
  // In the LIVE inbox, not .done: an ack is filed as handled, an answer is not.
  // (Whether it also wakes god is MD-163's question, not this one — an `inform`
  // reply waits for the next real wake either way.)
  assert.equal(ls('god', 'inbox').length, 1, 'delivered');
  assert.deepEqual(ls('god', 'inbox', '.done'), []);
});

test('a long reply to an FYI is a follow-up, not an ack', async (t) => {
  const { hive, dir, ls } = await floor(t);
  const parent = fyi(hive, dir);
  hive.send(
    { to: 'god', act: 'inform', in_reply_to: parent.id, subject: 'more', body: 'x'.repeat(400) },
    'jim'
  );
  assert.equal(ls('god', 'inbox').length, 1, 'past the length budget it is substance — deliver it');
});

test('an unfindable parent fails OPEN — the message is delivered', async (t) => {
  const { hive, ls } = await floor(t);
  hive.send({ to: 'god', act: 'inform', in_reply_to: 'no-such-message', subject: 'ack', body: 'ok' }, 'jim');
  assert.equal(ls('god', 'inbox').length, 1, 'when in doubt, deliver — losing mail is the worse failure');
});

test('a reply that asks for something is delivered however short it is', async (t) => {
  const { hive, dir, ls, wakes } = await floor(t);
  const parent = fyi(hive, dir);
  hive.send({ to: 'god', act: 'query', in_reply_to: parent.id, subject: 'which one?', body: 'a or b?' }, 'jim');
  assert.equal(ls('god', 'inbox').length, 1);
  assert.deepEqual(wakes(), ['god'], 'a question hanging off an FYI is still a question');
});

test('requires_reply is opt-in — it is no longer inferred from the act', async (t) => {
  const { hive } = await floor(t);
  assert.equal(hive.send({ to: 'jim', act: 'request', subject: 'MD-99' }, 'god').requires_reply, false,
    'the obligation travels with the act; the flag means "answer me anyway"');
  assert.equal(hive.send({ to: 'jim', act: 'inform', requires_reply: true, subject: 'x' }, 'god').requires_reply, true);
});
