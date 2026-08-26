'use strict';

/**
 * MD-145 — the classic terminal's QUEUE, in the modern Terminal tab.
 *
 * The human: "the Messages tab next to Terminal is useless, remove it; but the
 * classic UI's terminal section had a queue — add that, inside the Terminal
 * tab."
 *
 * The thing to protect here is that this is a second FRONT-END, not a second
 * delivery path. One store queue per agent, one drain (useHive's flush loop),
 * one set of gates. These tests pin the transforms both composers apply and the
 * one state machine that decides which hold to report.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const loadTs = require('./load-ts.cjs');

const {
  promoteInQueue, moveInQueue, editInQueue, queueHoldReason
} = loadTs('src/shared/messageQueue.ts');

const q = (...ids) => ids.map((id) => ({ id, text: `msg ${id}`, ts: 1 }));
const ids = (list) => list.map((m) => m.id).join('');

/* ── order: what the drain takes next ───────────────────────────────────── */

test('delivery order is the list order, and "send now" moves one to the front', () => {
  // The drain reads messageQueues[id][0] — position IS the delivery order, so
  // every transform here is a statement about what gets typed next.
  const after = promoteInQueue(q('a', 'b', 'c'), 'c');
  assert.equal(ids(after), 'cab');
  assert.equal(after[0].manual, true, 'send now must bypass the floor-wide pause');
  assert.equal(after[1].manual, undefined, 'the others keep waiting on the pause');
});

test('reorder is clamped, never wrapped', () => {
  assert.equal(ids(moveInQueue(q('a', 'b', 'c'), 'b', -1)), 'bac');
  assert.equal(ids(moveInQueue(q('a', 'b', 'c'), 'b', 1)), 'acb');
  // Up on the front message must NOT send it to the back: the next thing typed
  // into someone's terminal would silently become a different message.
  const front = q('a', 'b', 'c');
  assert.equal(moveInQueue(front, 'a', -1), front, 'no-op returns the same array');
  const back = q('a', 'b', 'c');
  assert.equal(moveInQueue(back, 'c', 1), back);
  assert.equal(moveInQueue(back, 'nope', 1), back);
});

/* ── editing ────────────────────────────────────────────────────────────── */

test('editing rewrites the text AND drops the instruction override', () => {
  // `instruction` is what the drain actually types. Keeping it through an edit
  // would show the user their new wording and type the old one.
  const list = [{ id: 'a', text: 'shown', ts: 1, instruction: 'typed', slack: { channel: 'C1', thread_ts: '1' } }];
  const [edited] = editInQueue(list, 'a', '  rewritten  ');
  assert.equal(edited.text, 'rewritten');
  assert.equal('instruction' in edited, false);
  assert.deepEqual(edited.slack, { channel: 'C1', thread_ts: '1' }, 'everything else is carried through');
});

test('an empty edit is refused rather than queueing a blank line', () => {
  const list = q('a');
  assert.equal(editInQueue(list, 'a', '   '), list);
  assert.equal(editInQueue(list, 'missing', 'x'), list);
});

/* ── why is it not moving? ──────────────────────────────────────────────── */

test('the hold reported is the drain’s own gate order', () => {
  const base = { count: 2, idle: true };
  assert.equal(queueHoldReason({ count: 0, idle: false }), null, 'nothing queued, nothing to say');
  // Busy beats everything: the drain never even looks at the pause or the
  // prompt until the agent is idle.
  assert.equal(queueHoldReason({ ...base, idle: false, paused: true, block: 'draft' }), 'busy');
  assert.equal(queueHoldReason({ ...base, paused: true, block: 'draft' }), 'paused');
  assert.equal(queueHoldReason({ ...base, block: 'draft' }), 'draft');
  assert.equal(queueHoldReason({ ...base, block: 'picker' }), 'picker');
  assert.equal(queueHoldReason({ ...base, block: 'exited' }), 'exited');
  assert.equal(queueHoldReason(base), 'sending');
});

test('a released message escapes the pause, and settling is not a hold', () => {
  assert.equal(queueHoldReason({ count: 1, idle: true, paused: true, frontManual: true }), 'sending');
  // A sub-second gap between writes is not something to tell anyone about.
  assert.equal(queueHoldReason({ count: 1, idle: true, block: 'settling' }), 'sending');
});

/* ── one queue, one drain, two front-ends ───────────────────────────────── */

const read = (p) => fs.readFileSync(p, 'utf8');
const MODERN = read('src/renderer/src/modern/agents/TerminalQueue.tsx');
const PIXEL = read('src/renderer/src/components/MessageQueueComposer.tsx');
const DETAIL = read('src/renderer/src/modern/agents/AgentDetail.tsx');
const STORE = read('src/renderer/src/store/store.ts');

test('both composers park messages in the SAME store queue', () => {
  for (const [name, src] of [['modern', MODERN], ['pixel', PIXEL]]) {
    assert.match(src, /enqueueMessage/, `${name}: queues through the store`);
    assert.match(src, /releaseQueuedMessage/, `${name}: same "send now"`);
    assert.match(src, /removeQueuedMessage/, `${name}: same remove`);
    // No second delivery path: only useHive's drain may type into a pty.
    assert.doesNotMatch(src, /submitToPty/, `${name}: delivery belongs to the drain, not a composer`);
  }
});

test('both composers ask @shared/messageQueue which hold to report', () => {
  assert.match(MODERN, /queueGate\(\{/);
  assert.match(PIXEL, /queueGate\(\{/);
  // MD-145 kept a per-UI vocabulary and shared only the state machine; MD-155
  // shares the SENTENCE too, because a hold that reads differently depending on
  // which UI you opened is a hold two people cannot compare notes about. Each
  // composer now renders the helper's label rather than its own ladder.
  assert.match(MODERN, /gate\?\.label/);
  assert.match(PIXEL, /gate\?\.label/);
  assert.doesNotMatch(PIXEL, /held — delivery paused floor-wide/);
});

test('the store applies the shared transforms, and persists what they return', () => {
  assert.match(STORE, /import \{ editInQueue, moveInQueue, promoteInQueue \} from '@shared\/messageQueue'/);
  assert.match(STORE, /editQueuedMessage: \(agentId, messageId, text\) =>/);
  assert.match(STORE, /moveQueuedMessage: \(agentId, messageId, delta\) =>/);
  // A no-op transform must not rewrite roster.json on every click.
  assert.match(STORE, /if \(next === current\) return \{\};/);
  assert.match(STORE, /persistQueues\(messageQueues\);/);
});

test('the queue sits under the terminal, and the Messages tab is gone', () => {
  assert.match(DETAIL, /<TerminalQueue agent=\{agent\} \/>/);
  assert.doesNotMatch(DETAIL, /MessagesTab/);
  assert.doesNotMatch(DETAIL, /TabsTrigger/, 'one pane left — the tab strip went with it');
});

test('a processless agent can still be queued for, and is offered Wake', () => {
  // The queue survives having no process: what you write now is delivered after
  // Wake, by the same drain. Telling the user to go and find Wake elsewhere is
  // what makes a queued message look lost.
  assert.match(MODERN, /isProcessless\(agent\)/);
  // The "no terminal" case is one of the gates now, so the sentence about it
  // comes from the shared helper (MD-155) instead of a local branch.
  assert.match(MODERN, /hasProcess: !asleep/);
  assert.match(MODERN, /<WakeButton agent=\{agent\} size="xs" \/>/);
});
