'use strict';

/**
 * MD-78 — the usage readout billed 2.84x what the session actually cost.
 *
 * The fixture is a REAL session (god's one-line "selam" to a sleeping Andy,
 * 2026-08-25 10:31Z): 4 API requests whose usage sums to exactly 180,769
 * tokens. Both accounting rungs over-counted it, for two unrelated reasons, and
 * both are pinned here against that same ground truth:
 *
 *   - transcript.ts summed every `type:"assistant"` LINE, but Claude Code writes
 *     one line per CONTENT BLOCK — text, thinking and each tool_use repeat the
 *     response's `message.id` and a verbatim copy of its `usage`. 7 lines for 4
 *     requests → 269,582.
 *   - telemetry.ts added every OTLP export of `claude_code.token.usage`, which
 *     Claude Code exports CUMULATIVELY (the OTel JS default; it never sets
 *     OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE). Every 5s export
 *     re-added the whole running total → 445,772 over 4 exports, and more the
 *     longer the session runs.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

// Sandbox HOME before anything reads it: projectDir() maps into ~/.claude.
const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
process.env.HOME = FAKE_HOME;
process.env.USERPROFILE = FAKE_HOME;

const loadTs = require('./load-ts.cjs');
const { readAgentUsage, projectDir } = loadTs('src/main/transcript.ts');
const { TelemetryCollector } = loadTs('src/main/telemetry.ts');

/** The 7 transcript records of the 4 real requests, block type and all. */
const RECORDS = [
  ['bc5da32d-c151-46b4-ad00-58e55c3022b4', '<synthetic>', 0, 0, 0, 0],
  ['msg_011CePK65TcGjFVuwm37NkUd', 'claude-opus-5', 2, 182, 26342, 16032], // text
  ['msg_011CePK65TcGjFVuwm37NkUd', 'claude-opus-5', 2, 182, 26342, 16032], // + tool_use
  ['msg_011CePK6bc5Xiw1E3KEEmLsQ', 'claude-opus-5', 2, 109, 42374, 3052],
  ['msg_011CePK6o5eAy5PgPE3GVL9Q', 'claude-opus-5', 2, 440, 45426, 387],   // thinking
  ['msg_011CePK6o5eAy5PgPE3GVL9Q', 'claude-opus-5', 2, 440, 45426, 387],   // + tool_use
  ['msg_011CePK7DwNQqKJjRm6H9a1M', 'claude-opus-5', 2, 95, 45813, 509]
].map(([id, model, i, o, cr, cw]) => ({ id, model, i, o, cr, cw }));

const TRUE_TOTAL = 180769;
const TRUE = { input: 8, output: 826, cacheRead: 159955, cacheCreation: 19980 };

function line(r) {
  return JSON.stringify({
    type: 'assistant',
    sessionId: 'fc1f3836',
    message: {
      id: r.id,
      model: r.model,
      usage: {
        input_tokens: r.i, output_tokens: r.o,
        cache_read_input_tokens: r.cr, cache_creation_input_tokens: r.cw
      }
    }
  }) + '\n';
}

function makeProject() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  const dir = projectDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  return { cwd, file: path.join(dir, 'fc1f3836.jsonl') };
}

function total(u) {
  return u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;
}

test('transcript: one request billed once, however many blocks it was written as', () => {
  const { cwd, file } = makeProject();
  fs.writeFileSync(file, RECORDS.map(line).join(''));
  const u = readAgentUsage(cwd);
  assert.equal(total(u), TRUE_TOTAL, 'was 269,582 — the per-block duplicates');
  assert.equal(u.inputTokens, TRUE.input);
  assert.equal(u.outputTokens, TRUE.output);
  assert.equal(u.cacheReadTokens, TRUE.cacheRead);
  assert.equal(u.cacheWriteTokens, TRUE.cacheCreation);
});

test('transcript: a response whose blocks straddle two tail reads still counts once', () => {
  // The incremental cache parses only the appended tail, so the dedup window has
  // to survive between calls — the text block lands in read #1 and its tool_use
  // twin in read #2.
  const { cwd, file } = makeProject();
  fs.writeFileSync(file, RECORDS.slice(0, 2).map(line).join(''));
  readAgentUsage(cwd); // primes the cache mid-response
  fs.appendFileSync(file, RECORDS.slice(2).map(line).join(''));
  assert.equal(total(readAgentUsage(cwd)), TRUE_TOTAL);
});

test('transcript: records with no message id are still each counted', () => {
  const { cwd, file } = makeProject();
  const anon = JSON.stringify({
    type: 'assistant', sessionId: 's', message: { model: 'claude-opus-5', usage: { output_tokens: 100 } }
  }) + '\n';
  fs.writeFileSync(file, anon + anon + anon);
  assert.equal(readAgentUsage(cwd).outputTokens, 300, 'dedup must not collapse an idless engine');
});

// ─── OTLP ────────────────────────────────────────────────────────────────────

const AGENT = 'andy-mt2ykkfq';
const SESSION = 'fc1f3836-6fce-4c48-9735-e74e438afbc1';

/** One `claude_code.token.usage` export: a data point per token type. */
function batch(values, temporality) {
  return {
    resourceMetrics: [{
      resource: { attributes: [{ key: 'agent.id', value: { stringValue: AGENT } }] },
      scopeMetrics: [{
        metrics: [{
          name: 'claude_code.token.usage',
          sum: {
            aggregationTemporality: temporality,
            dataPoints: Object.entries(values).map(([type, v]) => ({
              asInt: String(v),
              attributes: [
                { key: 'session.id', value: { stringValue: SESSION } },
                { key: 'model', value: { stringValue: 'claude-opus-5' } },
                { key: 'type', value: { stringValue: type } }
              ]
            }))
          }
        }]
      }]
    }]
  };
}

function post(endpoint, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL('/v1/metrics', endpoint);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
    }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
    req.end(payload);
  });
}

/** The running totals after each of the 4 requests — what a cumulative counter
 *  reports on each 5s export. */
const CUMULATIVE_EXPORTS = [
  { input: 2, output: 182, cacheRead: 26342, cacheCreation: 16032 },
  { input: 4, output: 291, cacheRead: 68716, cacheCreation: 19084 },
  { input: 6, output: 731, cacheRead: 114142, cacheCreation: 19471 },
  { input: 8, output: 826, cacheRead: 159955, cacheCreation: 19980 }
];

async function collect(exports_, temporality) {
  const c = new TelemetryCollector();
  const { ok, endpoint } = await c.start();
  assert.ok(ok, 'collector bound');
  try {
    for (const v of exports_) await post(endpoint, batch(v, temporality));
    return c.getAgentUsage(AGENT);
  } finally {
    c.stop();
  }
}

test('otlp: a cumulative counter is billed by its rise, not re-added every export', async () => {
  const s = await collect(CUMULATIVE_EXPORTS, 2);
  assert.equal(s.input + s.output + s.cacheRead + s.cacheCreation, TRUE_TOTAL,
    'was 445,772 — every export re-added the running total');
  assert.deepEqual(
    { input: s.input, output: s.output, cacheRead: s.cacheRead, cacheCreation: s.cacheCreation },
    TRUE
  );
});

test('otlp: a delta counter is still summed', async () => {
  const s = await collect([
    { input: 2, output: 182, cacheRead: 26342, cacheCreation: 16032 },
    { input: 6, output: 644, cacheRead: 133613, cacheCreation: 3948 }
  ], 1);
  assert.equal(s.input + s.output + s.cacheRead + s.cacheCreation, TRUE_TOTAL);
});

test('otlp: a counter that restarts mid-session is not read as a negative', async () => {
  // A `claude --resume` picks the session id back up with its counters at zero.
  const s = await collect([...CUMULATIVE_EXPORTS, { input: 1, output: 5, cacheRead: 10, cacheCreation: 0 }], 2);
  assert.equal(s.input + s.output + s.cacheRead + s.cacheCreation, TRUE_TOTAL + 16);
});
