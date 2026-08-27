'use strict';

/**
 * The modern Monitor's arithmetic (MD-90).
 *
 * These are the invariants the pixel Monitor earned and a re-skin is most
 * likely to lose: an unbudgeted agent has no meter at all, a cost we cannot
 * price is never a zero, spend and context headroom stay two separate numbers,
 * and a breaker that has actually acted outranks a comfortable percentage.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  buildFleetRow, fleetTotals, sampleTokens, contextTone, budgetTone, sparkPoints, rowCacheMiss
} = loadTs('src/renderer/src/modern/monitor/fleetRows.ts');

/** Fixed "now" so the today/not-today label is not a clock (MD-177). */
const NOW = new Date(2026, 7, 27, 12, 0, 0).getTime();

const agent = (over = {}) => ({ id: 'a1', name: 'Pam', status: 'running', cwd: '/w', ...over });
const inputs = (over = {}) => ({
  agents: [], samples: {}, usage: {}, spark: {}, rate: {}, lastTool: {},
  breakers: {}, toolCounts: {}, agentCaps: {}, nowMs: NOW, ...over
});

test('no budget anywhere means NO meter — not an empty one', () => {
  const row = buildFleetRow(agent(), inputs({ usage: { a1: usage(50_000) } }));
  assert.equal(row.budget, null, 'an invented denominator would make an unbudgeted agent look capped');
  assert.equal(row.tone, 'normal');
});

test('a per-agent cap wins over the floor budget', () => {
  const f = inputs({ usage: { a1: usage(90_000) }, floorCap: 1_000_000, agentCaps: { a1: 100_000 } });
  const row = buildFleetRow(agent(), f);
  assert.equal(row.budget.cap, 100_000);
  assert.equal(row.budget.pct, 90);
  assert.equal(row.agentCap, 100_000);
});

test('the resolved per-provider reading beats the Claude-only OTel sample', () => {
  // A codex agent has no OTel sample at all: reading only the sample would
  // print "no spend" for an agent that is spending.
  const row = buildFleetRow(agent(), inputs({ usage: { a1: usage(2_000_000, 4.5, 'sqlite') } }));
  assert.equal(row.tokens, 2_000_000);
  assert.equal(row.source, 'sqlite');
  assert.equal(row.usd, 4.5);
});

test('no signal is not zero spend', () => {
  const row = buildFleetRow(agent(), inputs());
  assert.equal(row.source, 'none');
  assert.equal(row.usd, null, 'a null cost is "we do not know", which formatUsd renders as unknown');
});

test('spend and context headroom stay two separate readings', () => {
  const row = buildFleetRow(
    agent({ contextTokens: 83_382, contextLimit: 200_000 }),
    inputs({ usage: { a1: usage(1_270_846) }, floorCap: 2_000_000 })
  );
  // 93% of the bill is cache reads — the same window re-sent every turn. The
  // two numbers disagreeing is correct, so they must never share a meter.
  assert.equal(row.context.pct, 42);
  assert.equal(row.budget.pct, 64);
});

test('an armed breaker outranks a comfortable percentage', () => {
  const f = inputs({
    usage: { a1: usage(10_000) }, floorCap: 1_000_000,
    breakers: { a1: { agentId: 'a1', level: 'stopped', reason: 'loop', ts: 0 } }
  });
  const row = buildFleetRow(agent(), f);
  assert.equal(row.armed, true);
  assert.equal(row.tone, 'danger', 'the breaker has already acted; 1% of budget does not make that calm');
});

test('steering is not armed — the breaker has only warned', () => {
  const f = inputs({ breakers: { a1: { agentId: 'a1', level: 'steering', reason: 'nudge', ts: 0 } } });
  assert.equal(buildFleetRow(agent(), f).armed, false);
});

test('a flat sparkline is suppressed rather than drawn as idle', () => {
  const f = inputs({ spark: { a1: [0, 0, 0, 0] } });
  assert.equal(buildFleetRow(agent(), f).hasSpark, false);
  assert.equal(sparkPoints([0, 0, 0], 100, 20), '', 'no max means nothing to plot');
  assert.equal(sparkPoints([5], 100, 20), '', 'one point is not a line');
  assert.match(sparkPoints([0, 10], 100, 20), /^0\.0,20\.0 100\.0,0\.0$/);
});

test('fleet totals refuse to invent a $0 when nothing could be priced', () => {
  const f = inputs({ usage: { a1: usage(500, null, 'transcript') } });
  const rows = [buildFleetRow(agent(), f)];
  const t = fleetTotals(rows, f);
  assert.equal(t.usd, null);
  assert.equal(t.unpriced, true, 'so the UI can say "unpriced" instead of implying free');
  assert.equal(t.measured, 1);
});

test('fleet totals report the cache share of inputs', () => {
  const f = inputs({
    samples: { a1: sample({ input: 100, cacheRead: 700, cacheCreation: 200, output: 50 }) },
    usage: { a1: usage(1050, 1) }
  });
  const t = fleetTotals([buildFleetRow(agent(), f)], f);
  assert.equal(t.inputs, 1000);
  assert.equal(t.cachePct, 70);
  assert.equal(t.usd, 1);
});

test('the two tone ladders match the pixel thresholds', () => {
  assert.equal(contextTone(74), 'normal');
  assert.equal(contextTone(75), 'warn');
  assert.equal(contextTone(88), 'danger');
  assert.equal(budgetTone(null, false), 'normal');
  assert.equal(budgetTone({ pct: 59, over: false }, false), 'normal');
  assert.equal(budgetTone({ pct: 60, over: false }, false), 'warn');
  assert.equal(budgetTone({ pct: 90, over: false }, false), 'danger');
  assert.equal(budgetTone({ pct: 5, over: true }, false), 'danger');
});

test('sampleTokens counts every kind, cache included', () => {
  assert.equal(sampleTokens(sample({ input: 1, output: 2, cacheRead: 4, cacheCreation: 8 })), 15);
  assert.equal(sampleTokens(undefined), 0);
});

function usage(totalTokens, usd = 1, source = 'otlp') {
  return { totalTokens, usd, source, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, model: null, lastActivityMs: null };
}
function sample(over) {
  return { agentId: 'a1', sessionId: 's', ts: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, model: 'm', usd: 0, ...over };
}

// ─── MD-177: prompt-cache miss rate on the row ───────────────────────────────
// A wake past the 5-minute cache TTL re-sends the whole prefix as a cache
// WRITE, ~12x the price of a read. The Monitor's job is to make that visible
// without ever turning "we cannot see" into a comfortable 0%.

test('an agent with no readable transcript shows NOTHING, not a 0% miss rate', () => {
  const row = buildFleetRow(agent(), inputs({ usage: { a1: usage(50_000) } }));
  assert.equal(row.cacheMiss, null,
    '0% would read as a perfect cache when it means we never looked');
  assert.equal(rowCacheMiss([{ day: '2026-08-27', cacheWriteTokens: 0, cacheReadTokens: 0, turns: 0 }], NOW),
    null, 'a day with no cacheable input at all is still unmeasured');
});

test('the row carries the latest day, its split, and whether that day is today', () => {
  const days = [
    { day: '2026-08-26', cacheWriteTokens: 130_000, cacheReadTokens: 0, turns: 1 },
    { day: '2026-08-27', cacheWriteTokens: 40_000, cacheReadTokens: 60_000, turns: 8 }
  ];
  const u = { ...usage(500_000), cacheDays: days };
  const row = buildFleetRow(agent(), inputs({ usage: { a1: u } }));
  assert.equal(row.cacheMiss.pct, 40);
  assert.equal(row.cacheMiss.day, '2026-08-27');
  assert.equal(row.cacheMiss.isToday, true);
  assert.equal(row.cacheMiss.turns, 8);
  assert.equal(row.cacheMiss.tone, 'danger', '40% of the bill is re-sent context');

  const stale = buildFleetRow(agent(), inputs({
    usage: { a1: { ...u, cacheDays: [days[0]] } }
  }));
  assert.equal(stale.cacheMiss.isToday, false,
    'yesterday`s number must be labelled or it reads as live');
});

test('the fleet band sums every day across every agent — that is the 12% the card was opened on', () => {
  const f = inputs({
    usage: {
      a1: { ...usage(100), cacheDays: [{ day: '2026-08-27', cacheWriteTokens: 12, cacheReadTokens: 88, turns: 1 }] },
      a2: { ...usage(100), cacheDays: [{ day: '2026-08-27', cacheWriteTokens: 12, cacheReadTokens: 88, turns: 1 }] }
    },
    agents: [agent(), agent({ id: 'a2', name: 'Jim' })]
  });
  const rows = f.agents.map((a) => buildFleetRow(a, f));
  assert.equal(fleetTotals(rows, f).cacheMissPct, 12);
  assert.equal(fleetTotals([], inputs()).cacheMissPct, null,
    'an empty floor is unmeasured, not perfectly cached');
});
