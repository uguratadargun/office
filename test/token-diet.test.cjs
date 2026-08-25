const test = require('node:test');
const assert = require('node:assert');
const loadTs = require('./load-ts.cjs');

const { beatIsNoop, rosterFingerprint, rosterIsNews, FLEET_DELTA_NONE } =
  loadTs('src/shared/tokenDiet.ts');

// ─── (MD-61) the heartbeat beat that says nothing ───────────────────────────
// A beat wakes god for a full turn against a ~133k-token context. 41% of his
// wakeups were a beat reporting "quiet, nothing changed" and a one-line reply.

test('a quiet beat with no fleet change is a no-op', () => {
  assert.equal(beatIsNoop(0, FLEET_DELTA_NONE), true);
});

test('actionable mail is always news, even when nobody moved', () => {
  assert.equal(beatIsNoop(1, FLEET_DELTA_NONE), false);
});

test('a real fleet delta is always sent', () => {
  assert.equal(beatIsNoop(0, '• Jim: +12000 tok'), false);
});

test('the FIRST beat (null delta, no baseline yet) is still sent', () => {
  // Suppressing it would mean the very first beat after a restart establishes a
  // baseline god never sees — and then every later beat compares to it.
  assert.equal(beatIsNoop(0, null), false);
});

// ─── (MD-61) the roster line that is re-injected forever ────────────────────

test('the volatile snapshot header is not part of the comparison', () => {
  // THE trap: rosterContext() opens with "snapshot 12s ago", which ticks on
  // every prompt. Comparing raw strings would answer "changed" every time and
  // turn the whole gate into a no-op that still looks implemented.
  const a = '[LIVE ROSTER — auto-injected from /h/fleet.json, snapshot 12s ago] 2 ACTIVE agent(s): jim.';
  const b = '[LIVE ROSTER — auto-injected from /h/fleet.json, snapshot 47s ago] 2 ACTIVE agent(s): jim.';
  assert.equal(rosterFingerprint(a), rosterFingerprint(b));
  assert.equal(rosterIsNews(a, b), false);
});

test('an agent joining or leaving the floor IS news', () => {
  const a = '[LIVE ROSTER — snapshot 12s ago] 1 ACTIVE agent(s): jim.';
  const b = '[LIVE ROSTER — snapshot 12s ago] 2 ACTIVE agent(s): jim; pam.';
  assert.equal(rosterIsNews(a, b), true);
});

test('a changed token count or breaker level IS news', () => {
  const a = '[LIVE ROSTER — snapshot 1s ago] jim (agent, 10k tok)';
  const b = '[LIVE ROSTER — snapshot 1s ago] jim (agent, 90k tok, breaker steer)';
  assert.equal(rosterIsNews(a, b), true);
});

test('the first roster of a session is news — there is nothing to repeat', () => {
  assert.equal(rosterIsNews(undefined, '[LIVE ROSTER — snapshot 1s ago] jim'), true);
  assert.equal(rosterIsNews(null, '[LIVE ROSTER — snapshot 1s ago] jim'), true);
});

test('a roster with no bracketed header still compares by body', () => {
  assert.equal(rosterFingerprint('2 ACTIVE agent(s): jim.'), '2 ACTIVE agent(s): jim.');
});
