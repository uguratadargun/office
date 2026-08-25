'use strict';
/**
 * Cost-ledger dedup (MD-74) — the gate that lets a PTY-less agent into the
 * ledger WITHOUT bringing back the 2,417-duplicate-row storm.
 *
 * Background: the beat used to skip any agent with no live PTY outright, and
 * then only append a row when the usage sample carried a live OTLP sessionId.
 * Net effect: `munder-developer-mt2szzlu` billed 532M tokens and wrote zero
 * ledger rows, so the floor token/cost cap could not see the biggest spender on
 * the floor. Dropping the sessionId gate naively re-creates the storm, because
 * the transcript fallback re-reads the same frozen file every ~30s.
 *
 * The load-bearing claim under test: a beat appends a row only when the
 * transcript POSITION (or its totals) moved, and a live sample is unaffected.
 *
 * Self-contained, no framework — `node test/cost-ledger-dedup.test.cjs`.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const SRC = path.join(__dirname, '..', 'src', 'shared', 'costLedgerDedup.ts');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-dedup-'));
const js = ts.transpileModule(fs.readFileSync(SRC, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const jsPath = path.join(outDir, 'costLedgerDedup.cjs');
fs.writeFileSync(jsPath, js);
const { shouldAppendLedgerRow, ledgerRowKey } = require(jsPath);

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (err) { failures++; console.log(`  ✗ ${name}\n     ${err.message}`); }
}

/** A usage sample. `sessionId: ''` is the transcript fallback; non-empty is live OTLP. */
function sample(o = {}) {
  return {
    sessionId: '', ts: 1000, input: 10, output: 20, cacheRead: 30, cacheCreation: 40, ...o
  };
}

/** Replay a run of beats through the same per-agent key the beat loop keeps, and
 *  return the rows that would have been written. This is the beat's ledger
 *  branch in `runBreakerBeat` (src/main/index.ts) with nothing else attached. */
function replay(samples) {
  let prevKey;
  const rows = [];
  for (const s of samples) {
    if (shouldAppendLedgerRow(prevKey, s)) {
      rows.push(s);
      // Only the transcript path reads this key, so only it writes one. A live
      // row overwriting it would forget where the transcript stood.
      if (!s.sessionId) prevKey = ledgerRowKey(s);
    }
  }
  return rows;
}

console.log('cost-ledger dedup (MD-74)');

// ─── the regression that made the sessionId gate necessary ──────────────────

test('a FROZEN transcript re-read every beat writes exactly ONE row', () => {
  // 120 beats = one hour at the 30s beat interval. Pre-fix this wrote 120 rows.
  const beats = Array.from({ length: 120 }, () => sample());
  assert.strictEqual(replay(beats).length, 1, 'frozen transcript must not rewrite its row');
});

test('a transcript that MOVES writes a row per move', () => {
  const beats = [
    sample({ ts: 1000, output: 20 }),
    sample({ ts: 1000, output: 20 }),   // same file, same beat content — silent
    sample({ ts: 2000, output: 55 }),   // agent produced more tokens
    sample({ ts: 2000, output: 55 }),   // silent again
    sample({ ts: 3000, output: 90 })
  ];
  assert.strictEqual(replay(beats).length, 3);
});

test('a touched-but-unchanged transcript (mtime moved, totals did not) still writes', () => {
  // mtime is a filesystem fact, so position alone can move without new tokens.
  // The row is honest either way — it is the totals the ledger diffs — but this
  // pins that the key is (position + totals), not position alone.
  const beats = [sample({ ts: 1000 }), sample({ ts: 9999 })];
  assert.strictEqual(replay(beats).length, 2);
});

// ─── the sleep → wake cycle ─────────────────────────────────────────────────

test('sleep → wake → sleep produces no duplicate rows', () => {
  const LIVE = 'sess-A';
  const WOKE = 'sess-B';   // a wake starts a NEW claude session, hence a new id
  const beats = [
    // awake: live OTLP exports, one row per beat, unchanged behaviour
    sample({ sessionId: LIVE, ts: 100, output: 10 }),
    sample({ sessionId: LIVE, ts: 130, output: 25 }),
    // hibernated (MD-59): pty gone, sessionId gone, transcript frozen at its
    // final position. 40 beats = ~20 minutes asleep.
    ...Array.from({ length: 40 }, () => sample({ ts: 160, output: 30 })),
    // woken by an inbox delivery: a new live session resumes exporting
    sample({ sessionId: WOKE, ts: 900, output: 45 }),
    sample({ sessionId: WOKE, ts: 930, output: 60 }),
    // asleep again, frozen at the new position
    ...Array.from({ length: 40 }, () => sample({ ts: 960, output: 70 }))
  ];
  const rows = replay(beats);
  // 2 live + 1 for the first sleep + 2 live + 1 for the second sleep.
  assert.strictEqual(rows.length, 6, `expected 6 rows, got ${rows.length}`);
  const keys = rows.map(ledgerRowKey);
  assert.strictEqual(new Set(keys).size, keys.length, 'every row written must be distinct');
});

test('a second sleep at the SAME position as the first writes nothing new', () => {
  // Woken, did nothing, slept again: the transcript never moved, so there is no
  // new fact to record. (This is the case that would loop forever on a naive
  // "append whenever there is no sessionId" fix.)
  const beats = [
    sample({ ts: 500, output: 5 }),
    sample({ sessionId: 'sess-B', ts: 600, output: 5 }),
    sample({ ts: 500, output: 5 })
  ];
  assert.strictEqual(replay(beats).length, 2, 'live row + the one sleep row');
  // ...and the sleep row that IS written is the first one, not a repeat.
  assert.deepStrictEqual(replay(beats).map((s) => s.sessionId), ['', 'sess-B']);
});

// ─── live samples must be untouched (god's "billing math unchanged") ────────

test('a live sample ALWAYS appends, even when byte-identical to the last one', () => {
  const s = sample({ sessionId: 'sess-A', ts: 100 });
  assert.strictEqual(shouldAppendLedgerRow(ledgerRowKey(s), s), true);
});

test('null sessionId is treated as the transcript path, same as empty string', () => {
  // The UsageProvider seam types sessionId as string | null; both mean "no live
  // session", so they must not key differently or the two spellings would each
  // get their own row.
  const withNull = sample({ sessionId: null });
  const withEmpty = sample({ sessionId: '' });
  assert.strictEqual(ledgerRowKey(withNull), ledgerRowKey(withEmpty));
  assert.strictEqual(shouldAppendLedgerRow(ledgerRowKey(withEmpty), withNull), false);
});

test('no prior row (fresh process) always appends', () => {
  assert.strictEqual(shouldAppendLedgerRow(undefined, sample()), true);
});

test('the key separates agents that differ only in one field', () => {
  const base = sample();
  for (const field of ['ts', 'input', 'output', 'cacheRead', 'cacheCreation']) {
    const moved = { ...base, [field]: base[field] + 1 };
    assert.notStrictEqual(ledgerRowKey(moved), ledgerRowKey(base), `${field} must be in the key`);
  }
});

console.log(failures === 0 ? '\nall passed' : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
