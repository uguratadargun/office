'use strict';

/**
 * The usage ladder — live OTLP, then that engine's on-disk signal, then nothing.
 *
 * This was open-coded twice and the second copy stopped at the first rung:
 * `hive:agentDirectory` reported `tokens: 0, usd: 0` whenever there was no OTLP
 * sample. OTLP only ever arrives for Claude, so every codex / gemini / opencode
 * agent read to the voice layer as one that had never done anything, and a
 * Claude agent read that way until its first export. These tests pin the rung
 * order and the one rule the whole seam rests on: a missing signal is null, and
 * never zero.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { resolveUsage, diskSourceFor, NO_USAGE } = loadTs('src/main/agentUsage.ts');

const SAMPLE = { ts: 1_700_000_000_000, input: 100, output: 20, cacheRead: 5, cacheCreation: 2, model: 'claude-opus-5', usd: 1.23456 };
const DISK = { inputTokens: 300, outputTokens: 40, cacheReadTokens: 10, cacheWriteTokens: 1, estimatedCostUsd: 2.5, model: 'gpt-5-codex', lastActivityMs: 1_700_000_500_000 };

test('live telemetry wins, and the disk read is not even consulted', () => {
  const u = resolveUsage(SAMPLE, DISK, 'claude');
  assert.equal(u.source, 'otlp');
  assert.equal(u.totalTokens, 127);
  assert.equal(u.usd, 1.2346, 'rounded to the ledger precision');
  assert.equal(u.model, 'claude-opus-5');
  assert.equal(u.lastActivityMs, SAMPLE.ts);
});

test('no telemetry falls through to disk instead of reporting nothing', () => {
  const u = resolveUsage(undefined, DISK, 'codex');
  assert.equal(u.source, 'transcript');
  assert.equal(u.totalTokens, 351);
  assert.equal(u.usd, 2.5);
  assert.equal(u.lastActivityMs, DISK.lastActivityMs);
});

test('no signal at all is unknown — never a zeroed row', () => {
  const u = resolveUsage(undefined, null, 'kimi');
  assert.deepEqual(u, NO_USAGE);
  assert.equal(u.source, 'none');
  assert.equal(u.usd, null, 'the bug was this being 0');
  assert.equal(u.lastActivityMs, null, 'and this making a working agent look dead');
});

test('an unpriced disk read keeps its real tokens and reports no cost', () => {
  // OpenCode against a self-hosted model: tokens are exact, cost is unknowable.
  const u = resolveUsage(undefined, { ...DISK, estimatedCostUsd: null, model: 'vllm/Qwen3.8-27B' }, 'opencode');
  assert.equal(u.totalTokens, 351, 'tokens are still measured');
  assert.equal(u.usd, null, 'and the cost says so rather than guessing 0');
  assert.equal(u.source, 'sqlite');
});

test('a disk read that found the files but no spend is a real zero', () => {
  // This is the one legitimate zero: the transcript exists and is empty. It must
  // still be distinguishable from 'none', which is why source carries it.
  const u = resolveUsage(undefined, {
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    estimatedCostUsd: 0, lastActivityMs: 0
  }, 'claude');
  assert.equal(u.totalTokens, 0);
  assert.equal(u.usd, 0);
  assert.equal(u.source, 'transcript', 'measured zero, not absent');
  assert.equal(u.lastActivityMs, null, 'a 0 mtime is no timestamp, not 1970');
});

test('opencode is the one engine read from a database, and the readout says so', () => {
  assert.equal(diskSourceFor('opencode'), 'sqlite');
  for (const p of ['claude', 'codex', 'antigravity', 'gemini']) {
    assert.equal(diskSourceFor(p), 'transcript', `${p} writes files, not a db`);
  }
});
