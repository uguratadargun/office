'use strict';

/**
 * Public URL resolution.
 *
 * The bug: with no `domain`, tunnelmole assigns a RANDOM subdomain per
 * connection, so every app restart handed Slack and every webhook caller a new
 * address and silently broke whatever the user had pasted into Slack/GitHub.
 *
 * One setting now covers both honest fixes, and the classification is the whole
 * risk: mistake a user's own endpoint for a tunnelmole subdomain and we try to
 * "reserve" their domain; mistake a subdomain for an endpoint and we never open
 * a tunnel at all. Both fail confusingly, so the boundary is pinned here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { resolvePublicUrl, isStable, describePublicUrl } = loadTs('src/shared/publicUrl.ts');

test('blank means ephemeral — the old behaviour, now named', () => {
  for (const v of ['', '   ', null, undefined]) {
    assert.deepEqual(resolvePublicUrl(v), { kind: 'ephemeral' });
  }
  assert.equal(isStable({ kind: 'ephemeral' }), false);
});

test('a URL with a scheme is the user’s own endpoint — we start no tunnel', () => {
  assert.deepEqual(resolvePublicUrl('https://hooks.example.com'), { kind: 'external', url: 'https://hooks.example.com' });
  assert.deepEqual(resolvePublicUrl('http://box.local:8080'), { kind: 'external', url: 'http://box.local:8080' });
  assert.deepEqual(resolvePublicUrl('  https://a.b/path  '), { kind: 'external', url: 'https://a.b/path' });
});

test('a trailing slash is trimmed, so ${base}/hook/x cannot double up', () => {
  assert.equal(resolvePublicUrl('https://hooks.example.com/').url, 'https://hooks.example.com');
  assert.equal(resolvePublicUrl('https://hooks.example.com///').url, 'https://hooks.example.com');
});

test('a bare hostname is a reserved tunnelmole subdomain', () => {
  assert.deepEqual(resolvePublicUrl('mysub.tunnelmole.net'), { kind: 'reserved', domain: 'mysub.tunnelmole.net' });
  assert.deepEqual(resolvePublicUrl('MySub.Tunnelmole.NET'), { kind: 'reserved', domain: 'mysub.tunnelmole.net' },
    'hosts are case-insensitive');
});

test('an endpoint pasted WITHOUT a scheme is not treated as a subdomain', () => {
  // These are the confusing failures: handing tunnelmole a path or port as
  // `domain` fails in a way the user cannot read.
  for (const v of ['example.com/hooks', 'example.com:8080', 'user@example.com', 'a b.com']) {
    assert.deepEqual(resolvePublicUrl(v), { kind: 'ephemeral' }, `must not reserve: ${v}`);
  }
});

test('junk falls back to ephemeral instead of throwing', () => {
  // A malformed setting must never stop the server starting — it just fails to
  // make the address stable.
  for (const v of ['https://', 'localhost', 'not a host', '...', '-bad-.com']) {
    assert.equal(resolvePublicUrl(v).kind, 'ephemeral', `must be ephemeral: ${v}`);
  }
});

test('stability is exactly "not ephemeral"', () => {
  assert.equal(isStable(resolvePublicUrl('https://hooks.example.com')), true);
  assert.equal(isStable(resolvePublicUrl('mysub.tunnelmole.net')), true);
  assert.equal(isStable(resolvePublicUrl('')), false);
});

test('every mode explains itself, and the ephemeral one warns', () => {
  assert.match(describePublicUrl(resolvePublicUrl('https://h.example.com')), /your own endpoint/i);
  assert.match(describePublicUrl(resolvePublicUrl('mysub.tunnelmole.net')), /API key/i);
  assert.match(describePublicUrl(resolvePublicUrl('')), /every restart/i,
    'the default must say out loud that it does not survive a restart');
});
