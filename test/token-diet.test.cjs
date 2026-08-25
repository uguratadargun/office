const test = require('node:test');
const assert = require('node:assert');
const loadTs = require('./load-ts.cjs');

const { beatIsNoop, rosterFingerprint, rosterIsNews, FLEET_DELTA_NONE } =
  loadTs('src/shared/tokenDiet.ts');

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
