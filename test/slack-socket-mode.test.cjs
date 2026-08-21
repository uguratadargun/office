'use strict';

/**
 * Socket Mode (MD-21) — the pure decision points that pick a transport, reject a
 * pasted-in-the-wrong-field token, and unwrap a Socket Mode envelope. The
 * transports themselves (a bound HTTP port, a live WebSocket) are not exercised
 * here; what is, is everything that decides WHAT they do.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  resolveSlackTransport,
  isAppLevelToken,
  envelopeToPayload,
  SlackEventRouter
} = loadTs('src/main/slack.ts');

const APP_TOKEN = 'xapp-1-A0123456-4444444444-abcdef0123456789';

// ─── mode selection ──────────────────────────────────────────────────────────

test('an install with no transport set stays on the Events API', () => {
  const r = resolveSlackTransport({ signingSecret: 'shhh' });
  assert.equal(r.kind, 'events');
  assert.equal(r.signingSecret, 'shhh');
});

test('socket mode is chosen only when explicitly asked for, and carries its token', () => {
  const r = resolveSlackTransport({ transport: 'socket', appToken: APP_TOKEN, signingSecret: 'shhh' });
  assert.equal(r.kind, 'socket');
  assert.equal(r.appToken, APP_TOKEN);
});

test('socket mode without an app token is invalid, not a silent fallback to HTTP', () => {
  // Falling back would open a tunnel the user explicitly opted out of.
  const r = resolveSlackTransport({ transport: 'socket', signingSecret: 'shhh' });
  assert.equal(r.kind, 'invalid');
  assert.match(r.error, /app-level token/);
});

test('a bot token pasted into the app-token field is rejected with a specific reason', () => {
  const r = resolveSlackTransport({ transport: 'socket', appToken: 'xoxb-1111-2222-abcdefghijkl' });
  assert.equal(r.kind, 'invalid');
  assert.match(r.error, /not an app-level token/);
});

test('the Events API still requires a signing secret', () => {
  assert.equal(resolveSlackTransport({}).kind, 'invalid');
  assert.equal(resolveSlackTransport({ transport: 'events', signingSecret: '   ' }).kind, 'invalid');
});

test('surrounding whitespace on a pasted token or secret is not a configuration error', () => {
  assert.equal(resolveSlackTransport({ transport: 'socket', appToken: `  ${APP_TOKEN}  ` }).kind, 'socket');
  assert.equal(resolveSlackTransport({ signingSecret: ' shhh ' }).signingSecret, 'shhh');
});

// ─── token validation ────────────────────────────────────────────────────────

test('only an xapp- token of plausible length passes as an app-level token', () => {
  assert.equal(isAppLevelToken(APP_TOKEN), true);
  assert.equal(isAppLevelToken('xoxb-1111-2222-abcdefghijkl'), false);
  assert.equal(isAppLevelToken('xapp-short'), false);   // prefix alone isn't enough
  assert.equal(isAppLevelToken(''), false);
  assert.equal(isAppLevelToken(undefined), false);
});

// ─── envelope → event mapping ────────────────────────────────────────────────

test('an events_api envelope yields exactly the payload the HTTP endpoint would receive', () => {
  const body = { type: 'event_callback', event: { type: 'message', text: 'hi' } };
  assert.deepEqual(envelopeToPayload({ type: 'events_api', envelope_id: 'e1', body }), body);
});

test('non-event frames on the same socket are dropped, not routed', () => {
  // hello / disconnect / slash_commands / interactive all arrive on this channel.
  for (const type of ['hello', 'disconnect', 'slash_commands', 'interactive', undefined]) {
    assert.equal(envelopeToPayload({ type, body: { type: 'event_callback' } }), null, `type=${type}`);
  }
});

test('a malformed envelope body is dropped rather than handed on as an object', () => {
  assert.equal(envelopeToPayload({ type: 'events_api' }), null);
  assert.equal(envelopeToPayload({ type: 'events_api', body: 'nope' }), null);
  assert.equal(envelopeToPayload({ type: 'events_api', body: [] }), null);
  assert.equal(envelopeToPayload(null), null);
  assert.equal(envelopeToPayload(undefined), null);
});

// ─── the shared router — the point of the extraction ─────────────────────────

function routerWithSpy(opts = {}) {
  const seen = [];
  const router = new SlackEventRouter({ ...opts, onMessage: (m) => { seen.push(m); } });
  return { router, seen };
}

function mentionPayload(over = {}) {
  return {
    type: 'event_callback',
    authorizations: [{ user_id: 'UBOT123' }],
    event: { type: 'app_mention', channel: 'C1', text: '<@UBOT123> ship it', ts: '100.1', ...over }
  };
}

test('the router forwards an @-mention with the leading mention stripped', () => {
  const { router, seen } = routerWithSpy();
  router.handle(mentionPayload());
  assert.equal(seen.length, 1);
  assert.equal(seen[0].text, 'ship it');
  assert.equal(seen[0].channel, 'C1');
  // Not itself a reply → its own ts is the thread to answer in.
  assert.equal(seen[0].thread_ts, '100.1');
});

test('the router dedups one logical message arriving twice', () => {
  // Subscribing to both app_mention and message.* delivers the SAME message
  // twice; a second onMessage would mean a second ack posted into the thread.
  const { router, seen } = routerWithSpy();
  router.handle(mentionPayload());
  router.handle(mentionPayload({ type: 'message' }));
  assert.equal(seen.length, 1);
});

test('the router honours the channel filter', () => {
  const { router, seen } = routerWithSpy({ channelId: 'C_ONLY' });
  router.handle(mentionPayload({ channel: 'C_OTHER' }));
  assert.equal(seen.length, 0);
  router.handle(mentionPayload({ channel: 'C_ONLY', ts: '200.2' }));
  assert.equal(seen.length, 1);
});

test('the router ignores anything that is not an event_callback', () => {
  const { router, seen } = routerWithSpy();
  router.handle({ type: 'url_verification', challenge: 'abc' });
  router.handle({ type: 'event_callback' });               // no event
  router.handle({});
  assert.equal(seen.length, 0);
});

test('an onMessage that throws does not break ingestion for the next message', () => {
  let calls = 0;
  const router = new SlackEventRouter({
    onMessage: () => { calls++; throw new Error('renderer gone'); }
  });
  router.handle(mentionPayload());
  router.handle(mentionPayload({ ts: '300.3' }));
  assert.equal(calls, 2);
});

// ─── both transports share that router ───────────────────────────────────────

test('a socket envelope and an HTTP body route through identical logic', () => {
  // The mapping is the whole integration: unwrap, and it is the same payload.
  const body = mentionPayload();
  const { router, seen } = routerWithSpy();
  router.handle(envelopeToPayload({ type: 'events_api', envelope_id: 'e1', body }));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].text, 'ship it');
});
