'use strict';

/**
 * OpenCode usage — read out of its SQLite, not guessed.
 *
 * OpenCode was one of the engines reporting $0, which is what made `costCapUsd`
 * and the breaker's cost arm decorative for it. Unlike codex and gemini it keeps
 * no per-session transcript: everything is in one `opencode.db`, and it prices
 * calls itself.
 *
 * Two things were verified against the opencode installed on this machine before
 * any of this was written, and both changed the design:
 *   - `session.directory` IS the agent cwd, so there is no project_directory →
 *     project → session walk to do.
 *   - `session.tokens_input/output` equal the sum of that session's per-message
 *     JSON exactly (checked on sessions of 61, 70 and 49 messages), so the
 *     session row is the messages, not an approximation of them.
 *
 * The `session` DDL below is copied VERBATIM from that installation. A binary
 * fixture is deliberately not committed: the real db also holds `account`
 * access/refresh tokens and every session title and path, and none of that
 * belongs in a repo.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { DatabaseSync } = require('node:sqlite');

const {
  readOpenCode, parseOpenCodeSessions, opencodeSchemaOk, opencodeModelId,
  opencodeDbPath, OPENCODE_REQUIRED_COLUMNS
} = loadTs('src/main/providerUsage.ts');

// Verbatim from `sqlite3 ~/.local/share/opencode/opencode.db '.schema session'`,
// minus the foreign key (the fixture has no `project` table to point at).
const SESSION_DDL = `CREATE TABLE \`session\` (
  \`id\` text PRIMARY KEY,
  \`project_id\` text NOT NULL,
  \`workspace_id\` text,
  \`parent_id\` text,
  \`slug\` text NOT NULL,
  \`directory\` text NOT NULL,
  \`path\` text,
  \`title\` text NOT NULL,
  \`version\` text NOT NULL,
  \`share_url\` text,
  \`metadata\` text,
  \`cost\` real DEFAULT 0 NOT NULL,
  \`tokens_input\` integer DEFAULT 0 NOT NULL,
  \`tokens_output\` integer DEFAULT 0 NOT NULL,
  \`tokens_reasoning\` integer DEFAULT 0 NOT NULL,
  \`tokens_cache_read\` integer DEFAULT 0 NOT NULL,
  \`tokens_cache_write\` integer DEFAULT 0 NOT NULL,
  \`agent\` text,
  \`model\` text,
  \`time_created\` integer NOT NULL,
  \`time_updated\` integer NOT NULL
)`;

/** A db on disk at opencode's real path under a throwaway XDG_DATA_HOME. */
function fixture(t, rows, { ddl = SESSION_DDL } = {}) {
  const xdg = fs.mkdtempSync(path.join(os.tmpdir(), 'md-oc-'));
  t.after(() => fs.rmSync(xdg, { recursive: true, force: true }));
  const dir = path.join(xdg, 'opencode');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'opencode.db');
  const db = new DatabaseSync(file);
  db.exec(ddl);
  for (const [i, r] of rows.entries()) {
    db.prepare(`INSERT INTO session
      (id, project_id, slug, directory, title, version, cost, tokens_input, tokens_output,
       tokens_reasoning, tokens_cache_read, tokens_cache_write, model, time_created, time_updated)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `ses_${i}`, 'prj', `s${i}`, r.directory, 'a title', '1.0',
      r.cost ?? 0, r.input ?? 0, r.output ?? 0, r.reasoning ?? 0,
      r.cacheRead ?? 0, r.cacheWrite ?? 0, r.model ?? null, 1, r.updated ?? 1
    );
  }
  db.close();
  const prev = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = xdg;
  t.after(() => { if (prev === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = prev; });
  return (file) => new DatabaseSync(file, { readOnly: true });
}

const CWD = '/Users/someone/Projects/thing';
const CLAUDE = JSON.stringify({ id: 'claude-sonnet-5', providerID: 'anthropic', variant: 'high' });
const LOCAL = JSON.stringify({ id: 'Qwen3.8-27B', providerID: 'vllm', variant: 'xhigh' });

test('sums only the sessions run in this agent cwd', (t) => {
  const open = fixture(t, [
    { directory: CWD, input: 100, output: 10, cacheRead: 5, cacheWrite: 2, cost: 0.25, model: CLAUDE, updated: 1_700_000_000_000 },
    { directory: CWD, input: 300, output: 20, cost: 0.75, model: CLAUDE, updated: 1_700_000_001_000 },
    { directory: '/somewhere/else', input: 999_999, output: 999_999, cost: 500, model: CLAUDE }
  ]);
  const u = readOpenCode(CWD, os.homedir(), open);
  assert.equal(u.inputTokens, 400, 'the other project is not our spend');
  assert.equal(u.outputTokens, 30);
  assert.equal(u.cacheReadTokens, 5);
  assert.equal(u.cacheWriteTokens, 2);
  assert.equal(u.estimatedCostUsd, 1, "opencode's own priced cost is trusted when it is positive");
  assert.equal(u.lastActivityMs, 1_700_000_001_000, 'newest session wins');
});

test('reasoning tokens are billed as output, the way gemini thoughts are', () => {
  const u = parseOpenCodeSessions([{ tokens_output: 10, tokens_reasoning: 90, cost: 1 }]);
  assert.equal(u.outputTokens, 100);
});

test('a zero cost is unknown, not free — it falls through to our own price table', () => {
  // A local vllm model: opencode records cost 0 because it has no rate for it.
  // Real data on this machine looks exactly like this, and reporting $0 for it is
  // the bug the whole module exists to remove.
  const local = parseOpenCodeSessions([{ tokens_input: 1_000_000, cost: 0, model: LOCAL }]);
  assert.equal(local.inputTokens, 1_000_000, 'tokens are still real and reported');
  assert.equal(local.estimatedCostUsd, null, 'cost is unknown, NOT 0');

  // A known model with a zero recorded cost still gets priced from the table.
  const known = parseOpenCodeSessions([{ tokens_input: 1_000_000, cost: 0, model: CLAUDE }]);
  assert.equal(known.estimatedCostUsd, 3, 'claude-sonnet-5 input is $3/Mtok');
});

test('one unpriced session poisons the total rather than understating it', () => {
  const u = parseOpenCodeSessions([
    { tokens_input: 1_000_000, cost: 2, model: CLAUDE },
    { tokens_input: 1_000_000, cost: 0, model: LOCAL }
  ]);
  assert.equal(u.inputTokens, 2_000_000);
  assert.equal(u.estimatedCostUsd, null, 'a partial total is a silent understatement of spend');
});

test('no sessions for this cwd is null — never a zeroed row', (t) => {
  const open = fixture(t, [{ directory: '/elsewhere', input: 5, cost: 1, model: CLAUDE }]);
  assert.equal(readOpenCode(CWD, os.homedir(), open), null);
  assert.equal(parseOpenCodeSessions([]), null);
});

test('a schema that lost a column we read is refused, not half-read', (t) => {
  const ddl = SESSION_DDL.replace('`tokens_cache_read` integer DEFAULT 0 NOT NULL,\n  ', '');
  // The insert in fixture() names that column, so build this one by hand.
  const xdg = fs.mkdtempSync(path.join(os.tmpdir(), 'md-oc-bad-'));
  t.after(() => fs.rmSync(xdg, { recursive: true, force: true }));
  fs.mkdirSync(path.join(xdg, 'opencode'), { recursive: true });
  const file = path.join(xdg, 'opencode', 'opencode.db');
  const db = new DatabaseSync(file);
  db.exec(ddl);
  db.close();
  const prev = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = xdg;
  t.after(() => { if (prev === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = prev; });

  assert.equal(readOpenCode(CWD, os.homedir(), (f) => new DatabaseSync(f, { readOnly: true })), null,
    'an unrecognised schema reads unknown, not a partial sum');
});

test('the fingerprint asks only about the columns we read', () => {
  assert.equal(opencodeSchemaOk([...OPENCODE_REQUIRED_COLUMNS]), true);
  assert.equal(opencodeSchemaOk([...OPENCODE_REQUIRED_COLUMNS, 'some_new_opencode_column']), true,
    'an unrelated new column must not stop us reading');
  assert.equal(opencodeSchemaOk(OPENCODE_REQUIRED_COLUMNS.slice(1)), false);
});

test('the model column is JSON, and unparseable values never become a fake price', () => {
  assert.equal(opencodeModelId(CLAUDE), 'anthropic/claude-sonnet-5');
  assert.equal(opencodeModelId(JSON.stringify({ id: 'gpt-5' })), 'gpt-5');
  assert.equal(opencodeModelId('claude-opus-5'), 'claude-opus-5', 'a plain string is taken as-is');
  assert.equal(opencodeModelId(null), undefined);
  assert.equal(opencodeModelId('{}'), undefined);
});

test('a missing db is null, and XDG_DATA_HOME wins over the home dir when set', () => {
  const missing = readOpenCode(CWD, path.join(os.tmpdir(), 'no-such-home-' + process.pid));
  assert.equal(missing, null, 'no opencode installed → unknown');
  assert.equal(opencodeDbPath('/h', {}), path.join('/h', '.local', 'share', 'opencode', 'opencode.db'));
  assert.equal(opencodeDbPath('/h', { XDG_DATA_HOME: '/xdg' }), path.join('/xdg', 'opencode', 'opencode.db'));
  assert.equal(opencodeDbPath('/h', { XDG_DATA_HOME: '  ' }), path.join('/h', '.local', 'share', 'opencode', 'opencode.db'),
    'a blank XDG_DATA_HOME is not a path');
});
