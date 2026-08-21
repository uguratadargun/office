'use strict';

/**
 * Command history — the read and privacy sides.
 *
 * Every prompt submitted to any agent has been recorded to SQLite since the
 * table shipped, and nothing ever read it back: `historyAdd` fired from three
 * call sites while `historyList`/`historySearch` had zero callers. So the data
 * was accumulating, invisibly, with no way to see, search, export or delete it.
 *
 * Surfacing it makes the delete path load-bearing rather than optional — a
 * visible forever-log with no way out is worse than a quiet one. These tests
 * pin the search escaping (a literal % must not become a wildcard), the
 * delete/clear semantics, and the deliberate uncapped export.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

// db.ts imports `app` from electron only for the default db path; we always pass
// an explicit one, but the import still has to resolve outside Electron.
const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { app: { getPath: () => os.tmpdir() } }
};

// better-sqlite3 is compiled against ELECTRON's ABI (electron-rebuild runs on
// postinstall), so `node --test` cannot dlopen it — which is why this store had
// no coverage at all. Node 22 ships a compatible-enough SQLite; PersistStore
// takes a driver factory so the tests can supply it. Production uses the default.
const { DatabaseSync } = require('node:sqlite');
const nodeSqlite = (file) => {
  const db = new DatabaseSync(file);
  // The two better-sqlite3 methods db.ts actually uses. node:sqlite has neither,
  // and a no-op pragma() silently skips every migration (user_version reads
  // undefined, so the loop never starts and no tables exist).
  db.pragma = (stmt, opts) => {
    if (/=/.test(stmt)) { db.exec(`PRAGMA ${stmt}`); return undefined; }
    const row = db.prepare(`PRAGMA ${stmt}`).get();
    const value = row ? Object.values(row)[0] : undefined;
    return opts && opts.simple ? value : [row];
  };
  db.transaction = (fn) => () => {
    db.exec('BEGIN');
    try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  return db;
};

const { PersistStore } = loadTs('src/main/db.ts');

function store(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = new PersistStore(path.join(dir, 'test.db'), nodeSqlite);
  s.open();
  t.after(() => { try { s.close(); } catch { /* already closed */ } });
  return s;
}

const seed = (s, rows) => rows.forEach((r) => s.addHistory(r));

test('list returns newest first, and scopes to one agent', (t) => {
  const s = store(t);
  seed(s, [
    { agentId: 'jim', text: 'first' },
    { agentId: 'pam', text: 'second' },
    { agentId: 'jim', text: 'third' }
  ]);
  assert.deepEqual(s.listHistory().map((r) => r.text), ['third', 'second', 'first']);
  assert.deepEqual(s.listHistory('jim').map((r) => r.text), ['third', 'first']);
});

test('empty or agent-less prompts are never recorded', (t) => {
  const s = store(t);
  seed(s, [
    { agentId: 'jim', text: '   ' },
    { agentId: '', text: 'orphan' },
    { agentId: 'jim', text: '  kept  ' }
  ]);
  const rows = s.listHistory();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, 'kept', 'stored trimmed');
});

test('search is a substring match, and a literal % is not a wildcard', (t) => {
  const s = store(t);
  seed(s, [
    { agentId: 'jim', text: 'deploy the thing' },
    { agentId: 'jim', text: 'raise timeout to 50%' },
    { agentId: 'jim', text: 'unrelated' }
  ]);
  assert.deepEqual(s.searchHistory('deploy').map((r) => r.text), ['deploy the thing']);
  // Without LIKE escaping this would match every row.
  assert.deepEqual(s.searchHistory('50%').map((r) => r.text), ['raise timeout to 50%']);
  assert.deepEqual(s.searchHistory('_nrelated'), [], 'a literal _ is not a single-char wildcard');
  assert.deepEqual(s.searchHistory('   '), [], 'a blank query returns nothing, not everything');
});

test('delete removes one row and reports whether it existed', (t) => {
  const s = store(t);
  seed(s, [{ agentId: 'jim', text: 'a' }, { agentId: 'jim', text: 'b' }]);
  const [newest] = s.listHistory();
  assert.equal(s.deleteHistory(newest.id), true);
  assert.deepEqual(s.listHistory().map((r) => r.text), ['a']);
  assert.equal(s.deleteHistory(newest.id), false, 'already gone is not a delete');
  assert.equal(s.deleteHistory(999999), false);
  assert.equal(s.deleteHistory('1'), false, 'a non-integer id is refused, not coerced');
});

test('clear empties everything, or just one agent, and counts what it removed', (t) => {
  const s = store(t);
  seed(s, [
    { agentId: 'jim', text: 'a' }, { agentId: 'jim', text: 'b' }, { agentId: 'pam', text: 'c' }
  ]);
  assert.equal(s.clearHistory('jim'), 2);
  assert.deepEqual(s.listHistory().map((r) => r.text), ['c']);
  assert.equal(s.clearHistory(), 1);
  assert.deepEqual(s.listHistory(), []);
  assert.equal(s.clearHistory(), 0, 'clearing an empty table removes nothing');
});

test('export is oldest-first and UNCAPPED — a silently truncated export is a lie', (t) => {
  const s = store(t);
  for (let i = 0; i < 250; i++) s.addHistory({ agentId: 'jim', text: `p${i}` });
  s.addHistory({ agentId: 'pam', text: 'other' });

  const all = s.exportHistory();
  assert.equal(all.length, 251, 'every row, past listHistory’s 100-row cap');
  assert.equal(all[0].text, 'p0', 'oldest first');
  assert.equal(s.listHistory().length, 100, 'list still caps — export is the uncapped path');

  const mine = s.exportHistory('jim');
  assert.equal(mine.length, 250);
  assert.ok(mine.every((r) => r.agentId === 'jim'));
});

test('rows carry the fields the panel renders', (t) => {
  const s = store(t);
  s.addHistory({ agentId: 'jim', cwd: '/repo', text: 'hello' });
  const [row] = s.listHistory();
  assert.equal(row.agentId, 'jim');
  assert.equal(row.cwd, '/repo');
  assert.equal(row.text, 'hello');
  assert.ok(Number.isInteger(row.id) && row.ts > 0);
  s.addHistory({ agentId: 'jim', text: 'no cwd' });
  assert.equal(s.listHistory()[0].cwd, null, 'a missing cwd is null, not undefined');
});
