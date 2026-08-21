'use strict';

/**
 * Outbound completion callbacks.
 *
 * The webhook API was inbound-only, so every integration long-polled `GET /<id>`
 * to learn something we already knew the instant it happened. A caller can now
 * hand us a URL — which inverts the threat model: inbound, the risk is someone
 * reaching us; outbound, the risk is someone using us to reach something else
 * from inside the user's machine. Most of what follows is that gate.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const loadTs = require('./load-ts.cjs');

const {
  validateCallbackUrl, isPrivateAddress, signPayload, verifySignature,
  backoffDelayMs, isRetryableStatus,
  MAX_CALLBACK_URL_LENGTH, CALLBACK_MAX_ATTEMPTS
} = loadTs('src/main/webhookCallback.ts');

// ── SSRF gate ───────────────────────────────────────────────────────────────

test('a plain https URL is accepted and normalised', () => {
  const r = validateCallbackUrl('https://hooks.example.com/md?run=7');
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://hooks.example.com/md?run=7');
});

test('http is refused outside dev', () => {
  assert.equal(validateCallbackUrl('http://hooks.example.com/md').ok, false);
  // …and permitted with the dev capability, which is what makes local receivers testable.
  assert.equal(validateCallbackUrl('http://hooks.example.com/md', { allowPrivate: true }).ok, true);
});

test('loopback and private literals are refused', () => {
  for (const u of [
    'https://127.0.0.1/cb', 'https://10.0.0.5/cb', 'https://192.168.1.9/cb',
    'https://172.16.4.4/cb', 'https://169.254.169.254/latest/meta-data',
    'https://[::1]/cb', 'https://[fd00::1]/cb', 'https://[fe80::1]/cb'
  ]) {
    assert.equal(validateCallbackUrl(u).ok, false, `${u} must be refused`);
  }
});

test('the cloud metadata address is refused by name and by shape', () => {
  // 169.254.169.254 is the single most valuable SSRF target on a cloud box; it is
  // inside link-local, so the range check covers it rather than a special case.
  assert.equal(isPrivateAddress('169.254.169.254'), true);
  assert.equal(isPrivateAddress('169.254.0.1'), true);
});

test('IPv4-mapped IPv6 does not walk around the blocklist', () => {
  // `::ffff:127.0.0.1` is loopback wearing a hat, and is the usual bypass.
  assert.equal(isPrivateAddress('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateAddress('::ffff:10.1.2.3'), true);
  assert.equal(validateCallbackUrl('https://[::ffff:127.0.0.1]/cb').ok, false);
  assert.equal(isPrivateAddress('::ffff:93.184.216.34'), false, 'a mapped PUBLIC v4 is still fine');
});

test('local-only hostnames are refused without needing DNS', () => {
  for (const h of ['localhost', 'api.localhost', 'printer.local', 'db.internal', 'x.home.arpa']) {
    assert.equal(validateCallbackUrl(`https://${h}/cb`).ok, false, `${h} must be refused`);
  }
});

test('a public address and a public name pass', () => {
  assert.equal(isPrivateAddress('93.184.216.34'), false);
  assert.equal(isPrivateAddress('2606:2800:220:1:248:1893:25c8:1946'), false);
  assert.equal(validateCallbackUrl('https://93.184.216.34/cb').ok, true);
});

test('an unknown or malformed peer counts as unsafe, never as fine', () => {
  // This function also decides at CONNECT time. A default of "allow" there is a
  // hole; a default of "refuse" is at worst a failed delivery.
  assert.equal(isPrivateAddress(''), true);
  assert.equal(isPrivateAddress('   '), true);
  assert.equal(isPrivateAddress('999.1.2.3'), true);
});

test('embedded credentials are refused, not redacted', () => {
  // They would otherwise end up in every log line and retry record about the delivery.
  assert.equal(validateCallbackUrl('https://user:pw@hooks.example.com/cb').ok, false);
  assert.equal(validateCallbackUrl('https://user@hooks.example.com/cb').ok, false);
});

test('non-strings, junk and oversized URLs are refused with a reason', () => {
  for (const bad of [undefined, null, 42, {}, '', '   ', 'not a url', '/relative', 'ftp://x.example/cb']) {
    const r = validateCallbackUrl(bad);
    assert.equal(r.ok, false, `${JSON.stringify(bad)} must be refused`);
    assert.ok(r.error && r.error.length, 'and say why — the caller gets this back as a 400');
  }
  const long = 'https://hooks.example.com/' + 'a'.repeat(MAX_CALLBACK_URL_LENGTH);
  assert.equal(validateCallbackUrl(long).ok, false);
});

test('the dev capability relaxes the address gate but not the URL shape', () => {
  assert.equal(validateCallbackUrl('https://127.0.0.1:9000/cb', { allowPrivate: true }).ok, true);
  assert.equal(validateCallbackUrl('https://u:p@127.0.0.1/cb', { allowPrivate: true }).ok, false,
    'credentials stay refused even in dev');
  assert.equal(validateCallbackUrl('ftp://127.0.0.1/cb', { allowPrivate: true }).ok, false);
});

// ── Signing ─────────────────────────────────────────────────────────────────

test('the signature is an HMAC over timestamp.body, not over the body alone', () => {
  // Signing the body alone means a captured delivery replays forever. With the
  // stamp covered, a receiver can enforce a freshness window.
  const body = JSON.stringify({ taskId: 'webhook-1', status: 'done' });
  const sig = signPayload(body, 'sh-secret', 1700000000000);
  const expected = 'sha256=' + createHmac('sha256', 'sh-secret').update(`1700000000000.${body}`).digest('hex');
  assert.equal(sig, expected);
  assert.notEqual(sig, 'sha256=' + createHmac('sha256', 'sh-secret').update(body).digest('hex'));
});

test('a different timestamp, body or secret is a different signature', () => {
  const body = '{"a":1}';
  const base = signPayload(body, 's', 1);
  assert.notEqual(base, signPayload(body, 's', 2), 'timestamp is covered');
  assert.notEqual(base, signPayload('{"a":2}', 's', 1), 'body is covered');
  assert.notEqual(base, signPayload(body, 's2', 1), 'secret is the key');
});

test('verifySignature accepts a real one and rejects every near miss', () => {
  const body = '{"taskId":"webhook-9"}';
  const sig = signPayload(body, 'secret', 42);
  assert.equal(verifySignature(body, 'secret', 42, sig), true);
  assert.equal(verifySignature(body, 'secret', 43, sig), false, 'replayed with a fresh stamp');
  assert.equal(verifySignature('{"taskId":"other"}', 'secret', 42, sig), false, 'body swapped');
  assert.equal(verifySignature(body, 'wrong', 42, sig), false);
  assert.equal(verifySignature(body, 'secret', 42, 'sha256=' + '0'.repeat(64)), false);
  // Length mismatch must be a plain false, not a throw — timingSafeEqual throws on it.
  assert.equal(verifySignature(body, 'secret', 42, 'short'), false);
  assert.equal(verifySignature(body, 'secret', 42, ''), false);
});

// ── Retry schedule ──────────────────────────────────────────────────────────

test('backoff is 0, 1s, 3s, 9s, 27s and clamps at 30s', () => {
  const delays = Array.from({ length: CALLBACK_MAX_ATTEMPTS }, (_, i) => backoffDelayMs(i + 1));
  assert.deepEqual(delays, [0, 1000, 3000, 9000, 27000]);
  assert.equal(backoffDelayMs(1), 0, 'the first attempt is immediate');
  assert.equal(backoffDelayMs(99), 30_000, 'clamped, never unbounded');
  assert.equal(backoffDelayMs(0), 0);
  assert.equal(backoffDelayMs(-3), 0, 'never negative — that would be a busy loop');
});

test('the whole schedule stays inside the advertised window', () => {
  const total = Array.from({ length: CALLBACK_MAX_ATTEMPTS }, (_, i) => backoffDelayMs(i + 1))
    .reduce((a, b) => a + b, 0);
  assert.ok(total <= 60_000, `five tries span ${total}ms — must stay bounded`);
});

test('only a transient failure is worth repeating', () => {
  // A 4xx means the receiver understood us and objected; sending the identical
  // body four more times cannot change their mind.
  assert.equal(isRetryableStatus(200), false);
  assert.equal(isRetryableStatus(204), false);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(401), false);
  assert.equal(isRetryableStatus(404), false);
  assert.equal(isRetryableStatus(410), false);
  assert.equal(isRetryableStatus(408), true, 'timeout is transient');
  assert.equal(isRetryableStatus(429), true, 'so is being asked to slow down');
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(503), true);
});

// ── The delivery itself ─────────────────────────────────────────────────────
// `deliverCallback` is the one part that touches a socket. Driven against a real
// local server rather than a mock, because the things that break here — a wrong
// transport for the scheme, an undrained response leaking the socket, a body that
// does not match what was signed — are exactly what a mock papers over.
const http = require('node:http');
const { deliverCallback } = loadTs('src/main/webhookCallback.ts');

/** A throwaway loopback receiver. `allowPrivate` is what lets us reach it, which
 *  is the same capability the app grants itself only in dev. */
function receiver(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}/cb` }));
  });
}

test('a delivery arrives intact, with a signature the receiver can verify', async (t) => {
  const seen = [];
  const { srv, url } = await receiver((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8'), method: req.method });
      res.writeHead(204); res.end();
    });
  });
  t.after(() => srv.close());

  const body = JSON.stringify({ taskId: 'webhook-abc', status: 'done', result: 'shipped' });
  const ts = 1700000000000;
  const r = await deliverCallback(url, body, {
    'x-md-timestamp': String(ts),
    'x-md-signature': signPayload(body, 'endpoint-secret', ts)
  }, { allowPrivate: true });

  assert.equal(r.ok, true);
  assert.equal(r.status, 204);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].body, body, 'the body signed is the body sent — byte for byte');
  assert.equal(seen[0].headers['content-type'], 'application/json');
  // The receiver-side check, exactly as the README tells integrators to do it.
  assert.equal(
    verifySignature(seen[0].body, 'endpoint-secret', seen[0].headers['x-md-timestamp'], seen[0].headers['x-md-signature']),
    true
  );
});

test('http is used for an http:// receiver, not an https handshake', async (t) => {
  // The dev capability admits http://; sending TLS at a plain server fails in a
  // way that reads like the receiver's fault.
  const { srv, url } = await receiver((req, res) => { req.resume(); res.writeHead(200); res.end(); });
  t.after(() => srv.close());
  const r = await deliverCallback(url, '{}', {}, { allowPrivate: true });
  assert.equal(r.ok, true, r.error);
});

test('a 500 is a retryable failure and a 404 is a final one', async (t) => {
  const { srv, url } = await receiver((req, res) => {
    req.resume();
    res.writeHead(req.headers['x-case'] === 'gone' ? 404 : 500);
    res.end();
  });
  t.after(() => srv.close());

  const soft = await deliverCallback(url, '{}', {}, { allowPrivate: true });
  assert.equal(soft.ok, false);
  assert.equal(soft.status, 500);
  assert.equal(soft.retryable, true);

  const hard = await deliverCallback(url, '{}', { 'x-case': 'gone' }, { allowPrivate: true });
  assert.equal(hard.ok, false);
  assert.equal(hard.status, 404);
  assert.equal(hard.retryable, false, 'a 404 repeated four more times is still a 404');
});

test('a dead receiver resolves as a failure rather than rejecting', async () => {
  // The retry loop wants a verdict; an unhandled rejection here would take the
  // done-observer's tick with it.
  const r = await deliverCallback('http://127.0.0.1:1/cb', '{}', {}, { allowPrivate: true, timeoutMs: 1500 });
  assert.equal(r.ok, false);
  assert.ok(r.error, 'and says what went wrong');
});

test('without the dev capability, a loopback target is refused at connect time', async (t) => {
  // The second half of the SSRF gate: this URL passed nothing at accept time — it
  // is being handed straight to the transport — and must still not be fetched.
  const { srv, url } = await receiver((req, res) => { req.resume(); res.writeHead(200); res.end(); });
  t.after(() => srv.close());
  const r = await deliverCallback(url, '{}', {}, {});
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /private address/);
  assert.equal(r.retryable, false, 'refusing ourselves is a decision, not a transient fault');
});
