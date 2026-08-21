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
