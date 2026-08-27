'use strict';

/**
 * MD-177 — cache-TTL-aware wakes.
 *
 * Two halves of one fact. A wake re-sends the agent's conversation prefix, and
 * inside the 5-minute ephemeral TTL that is a cache READ while past it the whole
 * prefix is WRITTEN again at roughly twelve times the price. Measured on this
 * floor, cache writes were 12% of total spend.
 *
 *   (1) MEASURE it — per agent per day, from the transcripts, so the number is
 *       on screen instead of buried in a bill.
 *   (2) ACT on it — non-urgent mail to an agent that is mid-turn waits for the
 *       turn boundary it was going to reach anyway, where the Stop hook drains
 *       the inbox for free.
 *
 * What is pinned here is what a later edit is most likely to quietly lose: the
 * null-not-zero rule on an unmeasured cache, the fact that a `request` is never
 * held, and the deadline that makes the hold a delay rather than a drop.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const {
  cacheMissPct, cacheMissTone, dayKey, latestCacheDay, sumCacheDays, sortDaysDesc, CACHE_DAYS_KEPT
} = loadTs('src/shared/cacheMiss.ts');

// ─── The metric ──────────────────────────────────────────────────────────────

test('miss% is writes over cacheable input — the fresh input of the turn is not a cache failure', () => {
  // 10k written, 90k read. Folding `input_tokens` in would make a long user
  // message look like a cold cache, which is the wrong thing to go fix.
  assert.equal(cacheMissPct({ cacheWriteTokens: 10_000, cacheReadTokens: 90_000 }), 10);
  assert.equal(cacheMissPct({ cacheWriteTokens: 1, cacheReadTokens: 1 }), 50);
  assert.equal(cacheMissPct({ cacheWriteTokens: 130_000, cacheReadTokens: 0 }), 100,
    'a cold wake with nothing served from cache is a 100% miss, not an error');
});

test('an UNMEASURED cache is null, never 0% — the ladder`s rule, not a new one', () => {
  for (const d of [null, undefined, { cacheWriteTokens: 0, cacheReadTokens: 0 }]) {
    assert.equal(cacheMissPct(d), null,
      'reporting 0% would make an agent with no transcript indistinguishable from a perfect cache');
  }
  assert.equal(cacheMissTone(null), 'normal', 'nothing measured must not paint the row red');
});

test('tone escalates only where the number stops being context growth', () => {
  assert.equal(cacheMissTone(3), 'normal');
  assert.equal(cacheMissTone(14), 'normal');
  assert.equal(cacheMissTone(15), 'warn');
  assert.equal(cacheMissTone(29), 'warn');
  assert.equal(cacheMissTone(30), 'danger');
});

test('the day key is LOCAL, so an evening of work is one row and not two', () => {
  const noon = new Date(2026, 7, 27, 12, 0, 0).getTime();
  assert.equal(dayKey(noon), '2026-08-27');
  const lateEvening = new Date(2026, 7, 27, 23, 30, 0).getTime();
  assert.equal(dayKey(lateEvening), '2026-08-27',
    'a UTC key would file this under the 28th for anyone west of Greenwich');
  assert.equal(dayKey(NaN), '');
});

test('the row shows the latest day and SAYS when that is not today', () => {
  const days = [
    { day: '2026-08-25', cacheWriteTokens: 50, cacheReadTokens: 50, turns: 2 },
    { day: '2026-08-26', cacheWriteTokens: 10, cacheReadTokens: 90, turns: 9 }
  ];
  const now = new Date(2026, 7, 27, 9, 0, 0).getTime();
  const latest = latestCacheDay(days, now);
  assert.equal(latest.day.day, '2026-08-26');
  assert.equal(latest.isToday, false,
    'without this flag yesterday`s number reads as live and nobody notices the agent is idle');

  const today = latestCacheDay(
    [...days, { day: '2026-08-27', cacheWriteTokens: 1, cacheReadTokens: 9, turns: 1 }], now);
  assert.equal(today.isToday, true);
  assert.equal(latestCacheDay([], now), null, 'no days at all is null, not a fabricated today');
});

test('days sort newest-first and fold into one floor-wide reading', () => {
  const days = [
    { day: '2026-08-25', cacheWriteTokens: 100, cacheReadTokens: 0, turns: 1 },
    { day: '2026-08-27', cacheWriteTokens: 0, cacheReadTokens: 300, turns: 3 }
  ];
  assert.deepEqual(sortDaysDesc(days).map((d) => d.day), ['2026-08-27', '2026-08-25']);
  const all = sumCacheDays(days);
  assert.equal(all.cacheWriteTokens, 100);
  assert.equal(all.turns, 4);
  assert.equal(cacheMissPct(all), 25);
  assert.equal(cacheMissPct(sumCacheDays([])), null);
  assert.ok(CACHE_DAYS_KEPT > 0 && CACHE_DAYS_KEPT <= 31,
    'this rides on every usage poll for every agent — an unbounded history is the cost this card removes');
});

// ─── The transcript reader ───────────────────────────────────────────────────

const { readAgentCacheDays, projectDir } = loadTs('src/main/transcript.ts');

/** A transcript in the real shape: one `type:"assistant"` line per content
 *  block, all blocks of one response sharing a `message.id`. */
function writeTranscript(cwd, sessionId, records) {
  const dir = projectDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return file;
}

const assistant = (id, iso, write, read) => ({
  type: 'assistant',
  timestamp: iso,
  sessionId: 's1',
  message: {
    id,
    model: 'claude-opus-4-5',
    usage: {
      input_tokens: 2,
      output_tokens: 100,
      cache_creation_input_tokens: write,
      cache_read_input_tokens: read
    }
  }
});

test('per-day cache tallies come from each record`s own timestamp, not the file mtime', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md177-'));
  const realHome = os.homedir;
  os.homedir = () => home;
  t.after(() => { os.homedir = realHome; fs.rmSync(home, { recursive: true, force: true }); });

  const cwd = path.join(home, 'work');
  // Two days in ONE file — the case a file-mtime split gets wrong by filing
  // every historical turn under today.
  writeTranscript(cwd, 's1', [
    assistant('m1', new Date(2026, 7, 26, 10, 0).toISOString(), 130_000, 0),
    assistant('m2', new Date(2026, 7, 27, 10, 0).toISOString(), 2_000, 128_000),
    assistant('m3', new Date(2026, 7, 27, 10, 5).toISOString(), 0, 130_000)
  ]);

  const days = readAgentCacheDays(cwd);
  assert.equal(days.length, 2, 'one file, two days');
  assert.equal(days[0].day, '2026-08-27', 'newest first');
  assert.equal(days[0].cacheWriteTokens, 2_000);
  assert.equal(days[0].cacheReadTokens, 258_000);
  assert.equal(days[0].turns, 2);
  assert.equal(cacheMissPct(days[0]), 1, 'a warm day');
  assert.equal(cacheMissPct(days[1]), 100, 'the cold wake that opened the 26th');
});

test('a response written out as three blocks is ONE turn, not three', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md177-'));
  const realHome = os.homedir;
  os.homedir = () => home;
  t.after(() => { os.homedir = realHome; fs.rmSync(home, { recursive: true, force: true }); });

  const cwd = path.join(home, 'work');
  const iso = new Date(2026, 7, 27, 10, 0).toISOString();
  // Claude Code writes one line per content block (text / thinking / tool_use),
  // each carrying a VERBATIM copy of the same `usage`. Counting lines bills the
  // request three times — the 1.49x overcount transcript.ts already fixes for
  // the totals, and the day split must not reintroduce it.
  writeTranscript(cwd, 's1', [
    assistant('m1', iso, 1_000, 9_000),
    assistant('m1', iso, 1_000, 9_000),
    assistant('m1', iso, 1_000, 9_000)
  ]);

  const [today] = readAgentCacheDays(cwd);
  assert.equal(today.turns, 1);
  assert.equal(today.cacheWriteTokens, 1_000);
  assert.equal(today.cacheReadTokens, 9_000);
});

test('an unreadable or absent project dir yields no days — not a zeroed day', () => {
  assert.deepEqual(readAgentCacheDays('/nope/does/not/exist'), []);
});

// ─── The hold ────────────────────────────────────────────────────────────────

const {
  holdNonUrgentNudge, nudgeHoldDeadline, nudgeIsUrgent, NUDGE_HOLD_GRACE_MS,
  DEFAULT_INBOX_NUDGE_DEBOUNCE_SECONDS, inboxNudgeDebounceMs
} = loadTs('src/shared/inboxNudge.ts');

const W = inboxNudgeDebounceMs(DEFAULT_INBOX_NUDGE_DEBOUNCE_SECONDS);

test('urgency is narrower than actionability — `done` is work, but nobody is blocked on it', () => {
  for (const act of ['request', 'query', 'propose']) {
    assert.equal(nudgeIsUrgent({ act }), true, `${act} is somebody waiting`);
  }
  for (const act of ['inform', 'done', 'agree', 'refuse', '']) {
    assert.equal(nudgeIsUrgent({ act }), false, `${act} can ride the next turn`);
  }
  assert.equal(nudgeIsUrgent({ act: 'inform', requires_reply: true }), true,
    'the opt-in escalation still has to work — that is the whole point of the flag');
  assert.equal(nudgeIsUrgent(null), false);
});

const hold = (over = {}) => holdNonUrgentNudge({
  fresh: [{ act: 'inform' }], recipientBusy: true, firstHeldAt: 1_000, now: 1_000, windowMs: W, ...over
});

test('an FYI to a busy agent waits for the turn boundary it was going to reach anyway', () => {
  assert.equal(hold(), true);
  assert.equal(hold({ fresh: [{ act: 'done' }] }), true, '`done` is non-urgent for the hold');
});

test('one request in the batch releases the WHOLE batch', () => {
  // The nudge carries every waiting message at once (MD-171), so a request
  // cannot be allowed to inherit the FYIs' patience.
  assert.equal(hold({ fresh: [{ act: 'inform' }, { act: 'inform' }, { act: 'request' }] }), false);
  assert.equal(hold({ fresh: [{ act: 'inform', requires_reply: true }] }), false);
});

test('an IDLE agent is never held — there is no coming turn boundary to align with', () => {
  assert.equal(hold({ recipientBusy: false }), false,
    'holding an idle agent delays the mail and saves nothing: its next wake is cold either way');
});

test('the hold expires — window + 60s is a delay, not a drop', () => {
  assert.equal(nudgeHoldDeadline(1_000, W), 1_000 + W + NUDGE_HOLD_GRACE_MS);
  assert.equal(hold({ now: 1_000 + W + NUDGE_HOLD_GRACE_MS - 1 }), true, 'just inside');
  assert.equal(hold({ now: 1_000 + W + NUDGE_HOLD_GRACE_MS }), false, 'the deadline releases it');
  assert.equal(hold({ now: 10 * 60_000 }), false,
    'a long-running turn must not starve the inbox behind it');
  assert.equal(NUDGE_HOLD_GRACE_MS, 60_000, 'the card`s ceiling: never past 60s beyond MD-163`s window');
});

test('turning the debounce off turns the hold off too — one escape hatch, not two', () => {
  assert.equal(hold({ windowMs: 0 }), false);
  assert.equal(hold({ fresh: [] }), false, 'no mail, nothing to hold');
});

test('an unset firstHeldAt starts the clock now rather than expiring instantly', () => {
  assert.equal(hold({ firstHeldAt: undefined, now: 5_000 }), true);
});

// ─── The wiring ──────────────────────────────────────────────────────────────

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the renderer nudge loop applies the hold, and held mail is NOT marked seen', () => {
  const src = read('src/renderer/src/hooks/useHive.ts');
  assert.match(src, /holdNonUrgentNudge\(\{/,
    'without this every FYI buys its own wake, and past the TTL that is a full cache write');
  assert.match(src, /recipientBusy: a\.status !== 'idle'/,
    'the hold aligns with the RECIPIENT`s turn boundary — floorBusy is a different question');
  const branch = /if \(holdNonUrgentNudge\(\{[\s\S]*?continue;\n\s*\}/.exec(src);
  assert.ok(branch, 'the hold branch is gone');
    assert.ok(!/seen\.add/.test(branch[0]),
    'marking held mail seen would silence it forever — the whole point is that it comes back');
  assert.match(src, /delete heldSince\.current\[a\.id\]/,
    'a per-agent clock that is never cleared makes the SECOND backlog expire on the first one`s deadline');
});

test('only the Monitor poll pays for the day split', () => {
  const src = read('src/main/index.ts');
  assert.match(src, /usage:fleet[\s\S]*?cacheDays: true/,
    'the readout the Monitor polls is the one that asks for it');
  const beat = src.split("ipcMain.handle('usage:fleet'")[0];
  assert.ok(!/cacheDays: true/.test(beat),
    'the ~30s breaker/cost beat must not grow a transcript read it has no use for');
});

test('PROTOCOL tells agents the rule the code enforces', () => {
  const src = read('src/main/hive.ts');
  const proto = /const PROTOCOL_MD = `[\s\S]*?\n`;/.exec(src);
  assert.ok(proto, 'the PROTOCOL template is gone');
  assert.match(proto[0], /## Token rules/);
  assert.match(proto[0], /five minutes/,
    'an agent that does not know WHEN a wake is expensive cannot help avoid one');
});
