'use strict';

/**
 * MD-155 — a queued message that is not moving now says WHY.
 *
 * The drain (`useHive` effect #4) gates on six things; the composers could see
 * two of them. A queue held by the boot grace or by the one-at-a-time cooldown
 * was reported as "delivering one at a time", which reads as "on its way" while
 * nothing moves for seconds, and an agent the operator had PAUSED was reported
 * as merely "busy" — sending people to hunt for a bug they caused on purpose.
 *
 * The gate ORDER is the load-bearing part: report them in a different order and
 * a composer says "sending…" while something upstream has been holding.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const { queueGate, queueHoldReason } = loadTs('src/shared/messageQueue.ts');

const base = { count: 2, idle: true, name: 'Pam', hasProcess: true };

test('nothing queued says nothing', () => {
  assert.equal(queueGate({ count: 0, idle: false }), null);
  assert.equal(queueGate({ count: 0, idle: true, cooldownMsLeft: 4000 }), null);
});

test('every gate is named, in the drain’s order', () => {
  // No terminal beats everything: there is nowhere to deliver.
  assert.equal(queueGate({ ...base, hasProcess: false, floorPaused: true }).gate, 'noProcess');
  // Not idle → the agent, and the operator's own Pause/Halt outranks "busy".
  assert.equal(queueGate({ ...base, idle: false }).gate, 'busy');
  assert.equal(queueGate({ ...base, idle: false, agentPaused: true }).gate, 'agentPaused');
  assert.equal(queueGate({ ...base, idle: false, agentHalted: true, agentPaused: true }).gate, 'agentHalted');
  // Idle → the floor-wide pause, which a released message bypasses.
  assert.equal(queueGate({ ...base, floorPaused: true }).gate, 'floorPaused');
  assert.equal(queueGate({ ...base, floorPaused: true, frontManual: true }).gate, 'sending');
  // Then the boot grace, then the terminal's own block, then the cooldown.
  assert.equal(queueGate({ ...base, bootGraceMsLeft: 3000, block: 'draft', cooldownMsLeft: 4000 }).gate, 'bootGrace');
  assert.equal(queueGate({ ...base, block: 'draft', cooldownMsLeft: 4000 }).gate, 'draft');
  assert.equal(queueGate({ ...base, block: 'picker' }).gate, 'picker');
  assert.equal(queueGate({ ...base, block: 'exited' }).gate, 'exited');
  assert.equal(queueGate({ ...base, cooldownMsLeft: 2200 }).gate, 'cooldown');
  // 'settling' is a sub-second gap between writes — not worth telling anyone.
  assert.equal(queueGate({ ...base, block: 'settling' }).gate, 'sending');
  assert.equal(queueGate({ ...base }).gate, 'sending');
  // A zero clock is not a hold.
  assert.equal(queueGate({ ...base, bootGraceMsLeft: 0, cooldownMsLeft: 0 }).gate, 'sending');
});

test('a timed gate says when it lifts, rounded up', () => {
  assert.match(queueGate({ ...base, cooldownMsLeft: 2200 }).label, /next message in 3s/);
  assert.match(queueGate({ ...base, cooldownMsLeft: 400 }).label, /under a second/);
  assert.match(queueGate({ ...base, bootGraceMsLeft: 4001 }).label, /booting; delivery resumes in 5s/);
});

test('each label names the gate, and the agent by name', () => {
  const named = [
    queueGate({ ...base, hasProcess: false }),
    queueGate({ ...base, idle: false }),
    queueGate({ ...base, idle: false, agentPaused: true }),
    queueGate({ ...base, idle: false, agentHalted: true }),
    queueGate({ ...base, block: 'draft' }),
    queueGate({ ...base, block: 'picker' }),
    queueGate({ ...base, block: 'exited' }),
    queueGate({ ...base, bootGraceMsLeft: 2000 })
  ];
  for (const r of named) assert.match(r.label, /Pam/, `${r.gate} does not name the agent`);
  // The one hold with an escape hatch says what it is.
  assert.match(queueGate({ ...base, floorPaused: true }).label, /Send now/);
  // No agent name given — never "undefined is working".
  assert.match(queueGate({ count: 1, idle: false }).label, /this agent is working/);
});

test('the coarse hold is DERIVED, so there is one gate order', () => {
  assert.equal(queueHoldReason({ count: 0, idle: false }), null);
  assert.equal(queueHoldReason({ count: 1, idle: false, paused: true, block: 'draft' }), 'busy');
  assert.equal(queueHoldReason({ count: 1, idle: true, paused: true, block: 'draft' }), 'paused');
  assert.equal(queueHoldReason({ count: 1, idle: true, block: 'picker' }), 'picker');
  assert.equal(queueHoldReason({ count: 1, idle: true }), 'sending');
});

test('the drain’s two clocks are READ from the drain, not mirrored', () => {
  const clock = read('src/renderer/src/hooks/deliveryClock.ts');
  assert.match(clock, /export const FLUSH_COOLDOWN_MS = 4500/);
  const hive = read('src/renderer/src/hooks/useHive.ts');
  // The refs are initialised FROM the shared maps — same object, so a reader
  // sees exactly what the gate reads.
  assert.match(hive, /useRef<Record<string, number>>\(lastFlushAt\)/);
  assert.match(hive, /useRef<Record<string, number>>\(bootGraceUntilAt\)/);
  assert.match(hive, /FLUSH_COOLDOWN_MS \} from '\.\/deliveryClock'|, FLUSH_COOLDOWN_MS \}/);
  // Display only: the drain must still be the only writer.
  assert.doesNotMatch(clock, /lastFlushAt\[[^\]]+\] =/);
  assert.doesNotMatch(clock, /bootGraceUntilAt\[[^\]]+\] =/);
});

test('both composers show the same sentence, from the one helper', () => {
  for (const file of [
    'src/renderer/src/components/MessageQueueComposer.tsx',
    'src/renderer/src/modern/agents/TerminalQueue.tsx'
  ]) {
    const src = read(file);
    assert.match(src, /queueGate\(\{/, `${file} does not use the shared gate`);
    assert.match(src, /gate\?\.label/, `${file} does not render the shared label`);
    assert.match(src, /useDeliveryControl\(/, `${file} cannot see Pause/Halt`);
    assert.match(src, /useDeliveryClock\(/, `${file} cannot see the two clocks`);
    // No second vocabulary for the same hold.
    assert.doesNotMatch(src, /held — auto-delivery is paused floor-wide'/, `${file} still has its own copy`);
  }
});
