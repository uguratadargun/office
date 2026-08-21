'use strict';

/**
 * Per-provider usage parsing + pricing.
 *
 * Why these tests exist: 7 of 11 providers reported $0, which made costCapUsd
 * and the breaker's cost arm decorative for most of the roster. A cap that
 * silently never fires is worse than no cap — so the invariant under test
 * throughout is "no signal is NULL, never zero".
 *
 * Fixtures are trimmed copies of the real shapes on disk (~/.codex/sessions,
 * ~/.gemini/tmp/<project>/chats), not invented ones.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { parseCodexRollout, codexRolloutCwd, parseGeminiChat, sumUsage, UNMEASURED_PROVIDERS, readProviderUsage } =
  loadTs('src/main/providerUsage.ts');
const { priceUsd, priceFor, MODEL_PRICES } = loadTs('src/shared/pricing.ts');

// ── pricing ────────────────────────────────────────────────────────────────

test('an unknown model prices as null, never 0', () => {
  assert.equal(priceFor('some-local-llama'), null);
  assert.equal(priceUsd('some-local-llama', { inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 0, cacheWriteTokens: 0 }), null,
    '$0 is indistinguishable from a free model and from a broken parser');
  assert.equal(priceUsd(undefined, { inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }), null);
});

test('prices are per MILLION tokens', () => {
  const cost = priceUsd('claude-opus-5', { inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  assert.equal(cost, MODEL_PRICES['claude-opus-5'].input);
});

test('a dated slug prices off its family, longest key wins', () => {
  assert.equal(priceFor('gpt-5-codex-2026-01-01').output, MODEL_PRICES['gpt-5-codex'].output);
  // 'gemini-3-flash' must beat a prefix match on a shorter key.
  assert.equal(priceFor('gemini-3-flash-preview').output, MODEL_PRICES['gemini-3-flash'].output);
});

test('cacheRead/cacheWrite fall back to the input rate when unpriced', () => {
  const p = MODEL_PRICES['gpt-5-codex'];
  const cost = priceUsd('gpt-5-codex', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1e6 });
  assert.equal(cost, p.input, 'cacheWrite is unset for this model → input rate');
});

// ── codex ──────────────────────────────────────────────────────────────────

const codexLine = (total) => JSON.stringify({
  timestamp: '2026-08-19T09:45:54.600Z', type: 'event_msg',
  payload: { type: 'token_count', info: { total_token_usage: total } }
});

test('codex token_count is CUMULATIVE — the last one wins, they never sum', () => {
  // The real trap: summing these multiplies the true figure by the turn count.
  const text = [
    JSON.stringify({ type: 'session_meta', payload: { cwd: '/repo', model: 'gpt-5-codex' } }),
    codexLine({ input_tokens: 100, output_tokens: 10, cached_input_tokens: 0, cache_write_input_tokens: 0 }),
    codexLine({ input_tokens: 900, output_tokens: 90, cached_input_tokens: 5, cache_write_input_tokens: 2 })
  ].join('\n');
  const u = parseCodexRollout(text);
  assert.equal(u.inputTokens, 900, 'cumulative — not 1000');
  assert.equal(u.outputTokens, 90);
  assert.equal(u.cacheReadTokens, 5);
  assert.equal(u.cacheWriteTokens, 2);
  assert.equal(u.model, 'gpt-5-codex');
  assert.ok(u.estimatedCostUsd > 0);
});

test('codex reasoning tokens are billed as output', () => {
  const text = [
    JSON.stringify({ type: 'session_meta', payload: { cwd: '/repo', model: 'gpt-5-codex' } }),
    codexLine({ input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 40 })
  ].join('\n');
  assert.equal(parseCodexRollout(text).outputTokens, 50);
});

test('a codex rollout with no token_count is null, not an empty tally', () => {
  const text = JSON.stringify({ type: 'session_meta', payload: { cwd: '/repo' } });
  assert.equal(parseCodexRollout(text), null);
  assert.equal(parseCodexRollout(''), null);
});

test('codexRolloutCwd reads the session cwd, and tolerates junk lines', () => {
  const text = ['not json', JSON.stringify({ type: 'session_meta', payload: { cwd: '/Users/x/repo' } })].join('\n');
  assert.equal(codexRolloutCwd(text), '/Users/x/repo');
  assert.equal(codexRolloutCwd('nothing here'), null);
});

test('codex reads the model from turn_context, not session_meta', () => {
  // Verified against a real rollout: session_meta carries `model_provider`
  // ("local"), NOT the model id. Reading only session_meta left every codex
  // agent unpriced.
  const text = [
    JSON.stringify({ type: 'session_meta', payload: { cwd: '/repo', model_provider: 'local' } }),
    JSON.stringify({ type: 'turn_context', payload: { cwd: '/repo', model: 'gpt-5-codex' } }),
    codexLine({ input_tokens: 1e6, output_tokens: 0 })
  ].join('\n');
  const u = parseCodexRollout(text);
  assert.equal(u.model, 'gpt-5-codex');
  assert.ok(u.estimatedCostUsd > 0, 'a known model must price');
});

test('tokens known + model unpriceable = tokens with a NULL cost', () => {
  // A locally-hosted model (real case on this machine: Qwen3.8-27B via codex).
  // Reporting $0 here would be a guess dressed as a measurement.
  const text = [
    JSON.stringify({ type: 'turn_context', payload: { model: 'Qwen3.8-27B' } }),
    codexLine({ input_tokens: 79460, output_tokens: 27 })
  ].join('\n');
  const u = parseCodexRollout(text);
  assert.equal(u.inputTokens, 79460);
  assert.equal(u.estimatedCostUsd, null);
});

// ── gemini ─────────────────────────────────────────────────────────────────

test('gemini messages are PER-MESSAGE and sum; thoughts bill as output', () => {
  const u = parseGeminiChat({
    messages: [
      { type: 'gemini', model: 'gemini-3-flash-preview', tokens: { input: 100, output: 10, cached: 5, thoughts: 7 } },
      { type: 'user' },
      { type: 'gemini', model: 'gemini-3-flash-preview', tokens: { input: 200, output: 20, cached: 1, thoughts: 3 } }
    ]
  });
  assert.equal(u.inputTokens, 300, 'per-message — these DO sum');
  assert.equal(u.outputTokens, 40, 'output + thoughts');
  assert.equal(u.cacheReadTokens, 6);
  assert.ok(u.estimatedCostUsd > 0);
});

test('a gemini chat with no token blocks is null', () => {
  assert.equal(parseGeminiChat({ messages: [{ type: 'user' }] }), null);
  assert.equal(parseGeminiChat({}), null);
  assert.equal(parseGeminiChat(null), null);
});

// ── aggregation + the central invariant ────────────────────────────────────

test('sumUsage refuses to price a total when any part was unpriced', () => {
  const priced = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCostUsd: 0.5, lastActivityMs: 2 };
  const unpriced = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCostUsd: null, lastActivityMs: 1 };
  assert.equal(sumUsage([priced, priced]).estimatedCostUsd, 1);
  assert.equal(sumUsage([priced, unpriced]).estimatedCostUsd, null,
    'a partial total silently understates spend — refuse it');
  assert.equal(sumUsage([priced, unpriced]).inputTokens, 2, 'tokens still add up');
  assert.equal(sumUsage([]), null);
});

test('sumUsage keeps the newest activity stamp', () => {
  const a = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCostUsd: 0, lastActivityMs: 10, model: 'old' };
  const b = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCostUsd: 0, lastActivityMs: 99, model: 'new' };
  assert.equal(sumUsage([a, b]).lastActivityMs, 99);
  assert.equal(sumUsage([a, b]).model, 'new');
});

test('a provider with no signal returns null — the caller must show "unknown"', () => {
  for (const p of UNMEASURED_PROVIDERS) {
    assert.equal(readProviderUsage(p, '/repo', '/nonexistent-home'), null, `${p} must be null, not 0`);
  }
  assert.equal(readProviderUsage('codex', '/repo', '/nonexistent-home'), null);
  assert.equal(readProviderUsage('claude', '/repo', '/nonexistent-home'), null,
    'claude is transcript.ts’s job, not this seam’s');
});
