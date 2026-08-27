const test = require('node:test');
const assert = require('node:assert');
const loadTs = require('./load-ts.cjs');

const {
  beatIsNoop, rosterFingerprint, rosterIsNews, FLEET_DELTA_NONE,
  fleetDeltaFrom, hasNonGodDelta, standupIsNoop, reengageAllowed, quietWindowReset,
  QUIET_REENGAGE_CAP
} = loadTs('src/shared/tokenDiet.ts');

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

// ─── (MD-164) the overnight burn: god's own row fed the wake loop ───────────
// God is a row in fleet.json. Re-engaging him spends tokens, which moves that
// row, which made the NEXT beat read as "something changed" — a ~7-minute wake
// loop on a floor where literally nothing was happening.

const GOD = 'michael-god';
const row = (id, tokens, extra = {}) => ({ id, name: id, tokens, ...extra });

test("god's own spend is never news to god", () => {
  const b = { prev: null };
  fleetDeltaFrom([row(GOD, 100), row('jim', 50)], GOD, b);          // baseline
  // God burned 200k re-engaging himself; Jim did not move.
  const d = fleetDeltaFrom([row(GOD, 200_100), row('jim', 50)], GOD, b);
  assert.equal(d, FLEET_DELTA_NONE);
  assert.equal(hasNonGodDelta(d), false);
});

test('a worker that moves is still reported', () => {
  const b = { prev: null };
  fleetDeltaFrom([row(GOD, 100), row('jim', 50)], GOD, b);
  const d = fleetDeltaFrom([row(GOD, 100), row('jim', 1_050)], GOD, b);
  assert.match(d, /jim: \+1000 tok/);
  assert.equal(hasNonGodDelta(d), true);
});

test('a floor with nothing but god on it reports NONE, never null', () => {
  // THE TRAP: null means "no baseline yet" and counts as news. With god filtered
  // out, a god-only floor has no rows — returning null there would re-arm the
  // exact loop this fix removes, forever.
  const b = { prev: null };
  assert.equal(fleetDeltaFrom([row(GOD, 100)], GOD, b), FLEET_DELTA_NONE);
  assert.equal(fleetDeltaFrom([row(GOD, 999_999)], GOD, b), FLEET_DELTA_NONE);
});

test('the first beat on a populated floor has no baseline and is news', () => {
  assert.equal(fleetDeltaFrom([row('jim', 50)], GOD, { prev: null }), null);
});

test('each consumer needs its OWN baseline', () => {
  // One shared baseline would mean whichever timer fired first ate the delta and
  // the other reported "nothing changed" forever.
  const beat = { prev: null }, standup = { prev: null };
  fleetDeltaFrom([row('jim', 50)], GOD, beat);
  fleetDeltaFrom([row('jim', 50)], GOD, standup);
  const rows = [row('jim', 150)];
  assert.match(fleetDeltaFrom(rows, GOD, beat), /jim/);
  assert.match(fleetDeltaFrom(rows, GOD, standup), /jim/);
});

// ─── (MD-164) the hourly standup that nobody could act on ───────────────────

test('the standup fires when a non-god agent is awake and the last one was read', () => {
  // The behaviour the gate must NOT break.
  assert.equal(standupIsNoop({ previousUnread: false, awakeNonGod: 1, delta: '• jim: +9 tok' }), false);
  // First look, no baseline yet: still news.
  assert.equal(standupIsNoop({ previousUnread: false, awakeNonGod: 1, delta: null }), false);
});

test('no non-god agent awake means there is nobody to stand up about', () => {
  assert.equal(standupIsNoop({ previousUnread: false, awakeNonGod: 0, delta: '• jim: +9 tok' }), true);
});

test('a standup still unread in the inbox is not repeated', () => {
  assert.equal(standupIsNoop({ previousUnread: true, awakeNonGod: 3, delta: '• jim: +9 tok' }), true);
});

test('an awake but motionless floor gets no standup', () => {
  assert.equal(standupIsNoop({ previousUnread: false, awakeNonGod: 2, delta: FLEET_DELTA_NONE }), true);
});

// ─── (MD-164) one re-engage per quiet stretch ───────────────────────────────

test('a beat with news re-engages once, then the cap holds it', () => {
  const news = '• jim: +1000 tok';
  assert.equal(reengageAllowed({ actionable: 0, delta: news, sentThisWindow: 0 }), true);
  assert.equal(reengageAllowed({ actionable: 0, delta: news, sentThisWindow: 1 }), false);
  assert.equal(QUIET_REENGAGE_CAP, 1);
});

test('a beat with nothing to say never re-engages, cap or no cap', () => {
  assert.equal(reengageAllowed({ actionable: 0, delta: FLEET_DELTA_NONE, sentThisWindow: 0 }), false);
});

test('the quiet stretch ends when a worker moves or NEW mail lands', () => {
  assert.equal(quietWindowReset({ delta: '• jim: +1 tok', actionable: 0, lastActionable: 0 }), true);
  assert.equal(quietWindowReset({ delta: FLEET_DELTA_NONE, actionable: 2, lastActionable: 1 }), true);
  // The SAME unread message counted again is not new mail — that re-open would
  // hand the loop its budget back on every single beat.
  assert.equal(quietWindowReset({ delta: FLEET_DELTA_NONE, actionable: 1, lastActionable: 1 }), false);
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

// ─── (MD-75) the FIXED PREFIX budget ────────────────────────────────────────
// Every request an agent makes re-sends its whole prefix, so a sentence added
// here is paid for hundreds of times. Two pieces are ours: the injected hive
// protocol (--append-system-prompt) and the bundled-skill descriptions, which
// Claude Code lists in full for EVERY skill in the agent's .claude/skills.
// Measured 2026-08-25 at 1,568 chars of prose / 4,220 chars; these ceilings leave a
// little headroom and fail the moment the prose creeps back.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROMPT_CHAR_BUDGET = 1650;   // worker --append-system-prompt, paths excluded
const SKILL_DESC_BUDGET = 2600;    // the 12 temporal alias descriptions, summed

test('the injected worker protocol stays inside its prefix budget', async () => {
  const { HiveManager } = loadTs('src/main/hive.ts');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-prefix-'));
  try {
    const hive = new HiveManager(() => home);
    const inj = await hive.ensureAgent(
      { id: 'w-1', name: 'Worker', provider: 'claude', cwd: home },
      { semanticMemory: true }
    );
    const prompt = inj.args[inj.args.indexOf('--append-system-prompt') + 1];
    // The absolute paths are the irreducible part (and vary with the tmpdir),
    // so budget the PROSE: the prompt with every workspace/root path removed.
    const dir = path.join(home, 'hive', 'agents', 'w-1');
    const root = path.join(home, 'hive');
    const prose = prompt.split(dir).join('').split(root).join('');
    assert.ok(prose.length <= PROMPT_CHAR_BUDGET,
      `worker protocol prose grew to ${prose.length} chars (budget ${PROMPT_CHAR_BUDGET})`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the temporal alias skills describe themselves in one line, not a paragraph', () => {
  // 12 aliases that all shell out to temporal/when.mjs. Each one's description
  // is injected verbatim into every agent's context; they were 4,220 chars of
  // near-identical prose about UTC instants.
  const aliases = ['today', 'yesterday', 'thisWeek', 'lastWeek', 'last7Days', 'last30Days',
    'thisMonth', 'lastMonth', 'thisQuarter', 'lastQuarter', 'thisYear', 'lastYear'];
  let total = 0;
  for (const a of aliases) {
    const md = fs.readFileSync(path.join('resources', 'skills', a, 'SKILL.md'), 'utf8');
    const lines = md.split('\n');
    const i = lines.findIndex((l) => l.startsWith('description:'));
    assert.ok(i >= 0, `${a}: no description`);
    let j = i + 1;
    while (j < lines.length && /^[ \t]/.test(lines[j])) j++;
    total += lines.slice(i, j).join('\n').length;
  }
  assert.ok(total <= SKILL_DESC_BUDGET,
    `temporal alias descriptions grew to ${total} chars (budget ${SKILL_DESC_BUDGET})`);
});
