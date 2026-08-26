'use strict';

/**
 * MD-140 — memory.md is editable by hand, and the edit cannot silently win.
 *
 * The human asked why memory could not be edited; MD-138 shipped the view
 * read-only because these files have OTHER writers — the agent itself, and the
 * condenser on its own timer. So the write is conditional: it carries the mtime
 * the editor loaded, and main refuses if the file moved since. Without that, a
 * human save landing on top of a condense pass destroys the condense and
 * NOTHING anywhere says so.
 *
 * Pinned here: the refusal, the confinement (nothing validated the agent id
 * before this — `agentDir` joins it straight onto the hive root), the atomicity
 * (a half-written memory is worse than a stale one), and the two rules that
 * decide whether the editor may open at all.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { HiveManager } = loadTs('src/main/hive.ts');
const {
  editState,
  memoryWriteMessage,
  memoryDir,
  MEMORY_FILE,
  MEMORY_SOFT_CAP_BYTES
} = loadTs('src/shared/memoryWrite.ts');
const { memoryFileMeta } = loadTs('src/renderer/src/modern/memory/memoryModel.ts');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function fixture(text = '# Ada — memory\n') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-edit-'));
  const dir = path.join(home, 'hive', 'agents', 'ada');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, MEMORY_FILE);
  if (text !== null) fs.writeFileSync(file, text, 'utf8');
  const hive = new HiveManager(() => home);
  const mtime = text === null ? 0 : fs.statSync(file).mtimeMs;
  return { home, dir, file, hive, mtime };
}

/* ── 1. The stale check ─────────────────────────────────────────────────── */

test('a write carrying the mtime it loaded goes through', () => {
  const { hive, file, mtime } = fixture();
  const res = hive.writeMemory('ada', '# Ada\n\n- edited by hand\n', mtime);
  assert.equal(res.ok, true);
  assert.equal(fs.readFileSync(file, 'utf8'), '# Ada\n\n- edited by hand\n');
  assert.equal(res.mtime, fs.statSync(file).mtimeMs, 'the caller needs the NEW stamp for its next save');
});

test('a write whose file moved underneath it is refused, not merged', () => {
  const { hive, file, mtime } = fixture();
  // The condenser (or the agent) rewrites the file while the human types.
  // `utimes` rather than luck: two writes inside the same millisecond carry the
  // same stamp, and this test is about the check, not about the clock.
  fs.writeFileSync(file, '# Ada — condensed\n', 'utf8');
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
  const now = fs.statSync(file).mtimeMs;
  assert.notEqual(now, mtime, 'fixture precondition: the stamp actually moved');

  const res = hive.writeMemory('ada', '# Ada — my hand edit\n', mtime);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'stale');
  assert.equal(res.mtime, now, 'the refusal hands back the CURRENT stamp so a reload can adopt it');
  assert.equal(fs.readFileSync(file, 'utf8'), '# Ada — condensed\n', 'the other writer keeps its version');
});

test('expecting no file, but finding one, is the same conflict', () => {
  // The editor sends 0 for "there was nothing here". A file that has appeared
  // since is somebody else's, and creating over it is a clobber like any other.
  const { hive } = fixture(null);
  assert.equal(hive.writeMemory('ada', 'mine\n', 0).ok, true, 'no file + expected none = create');
  const second = hive.writeMemory('ada', 'mine again\n', 0);
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'stale');
});

test('the same stamp twice is not a conflict — no false staleness', () => {
  // Both stamps come off the same `mtimeMs`, so the check is exact. If that
  // ever drifted, every save in the app would start refusing itself.
  const { hive, mtime } = fixture();
  assert.equal(hive.writeMemory('ada', 'one\n', mtime).ok, true);
  const after = fs.statSync(fixtureFile(hive)).mtimeMs;
  assert.equal(hive.writeMemory('ada', 'two\n', after).ok, true, 'the stamp handed back by a save must work as the next expectation');
});

test('a stale refusal says what to do about it', () => {
  const msg = memoryWriteMessage('stale');
  assert.match(msg, /changed since you opened it/);
  assert.match(msg, /reload/i);
});

/** The memory file inside a fixture's hive — the write path recreates it, so
 *  the test asks the manager's own root rather than remembering a path. */
function fixtureFile(hive) {
  return path.join(hive.root(), 'agents', 'ada', MEMORY_FILE);
}

/* ── 2. Confinement ─────────────────────────────────────────────────────── */

test('an agent id that climbs out of the hive is rejected', () => {
  // `agentDir` is `join(root, 'agents', id)` and NOTHING upstream validated the
  // id — this is the write path, so it is the one that has to.
  const { hive, home } = fixture();
  for (const bad of ['../../escape', '..', 'ada/../../escape', '/etc/passwd']) {
    const res = hive.writeMemory(bad, 'pwned\n', 0);
    assert.equal(res.ok, false, `${bad} must not be written`);
    assert.equal(res.reason, 'badid', `${bad} → ${res.reason}`);
  }
  assert.equal(fs.existsSync(path.join(home, 'escape')), false);
  assert.equal(fs.existsSync(path.join(path.dirname(home), 'escape')), false);
  assert.equal(fs.existsSync(path.join(home, 'hive', 'escape')), false);
});

test('an empty id writes nothing', () => {
  const { hive } = fixture();
  assert.equal(hive.writeMemory('', 'x', 0).reason, 'badid');
});

test('no harness home means no write, and no crash', () => {
  const hive = new HiveManager(() => null);
  const res = hive.writeMemory('ada', 'x', 0);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'nohome');
});

/* ── 3. Atomicity ───────────────────────────────────────────────────────── */

test('the write is tmp + rename, and leaves no tmp behind', () => {
  const { hive, dir, mtime } = fixture();
  assert.equal(hive.writeMemory('ada', 'x'.repeat(50_000), mtime).ok, true);
  const leftovers = fs.readdirSync(dir).filter((n) => n.includes('.tmp-'));
  assert.deepEqual(leftovers, [], 'a temp file left in the agent folder is a file agents will read');
  assert.equal(fs.readFileSync(path.join(dir, MEMORY_FILE), 'utf8').length, 50_000);
  assert.match(read('src/main/hive.ts'), /renameSync\(tmp, p\);/, 'rename, not a truncating write');
});

test('a write into a folder that has vanished fails without destroying the file', () => {
  const { hive, home } = fixture();
  // The whole hive folder goes away mid-session (a workspace switch, a delete).
  fs.rmSync(path.join(home, 'hive'), { recursive: true, force: true });
  const res = hive.writeMemory('ada', 'x', 0);
  assert.equal(res.ok, true, 'the folder is recreated — this is a create, not a clobber');
  assert.equal(fs.readFileSync(path.join(home, 'hive', 'agents', 'ada', MEMORY_FILE), 'utf8'), 'x');
});

/* ── 4. Whether the editor may open ─────────────────────────────────────── */

const base = { original: 'a', draft: 'a', owner: true, mtimeKnown: true, busy: false };

test('an unchanged draft is not saveable', () => {
  // Re-writing identical bytes still moves the mtime, which breaks every other
  // reader's stale check for nothing.
  const s = editState(base);
  assert.equal(s.dirty, false);
  assert.equal(s.canEdit, true);
  assert.equal(s.canSave, false);
  assert.equal(s.blocked, null);
});

test('a changed draft is saveable — unless a save is already in flight', () => {
  assert.equal(editState({ ...base, draft: 'b' }).canSave, true);
  assert.equal(editState({ ...base, draft: 'b', busy: true }).canSave, false);
});

test('a window that does not own the workspace cannot edit, and says why', () => {
  // MD-139: the other instance's agents are the ones writing these files.
  const s = editState({ ...base, draft: 'b', owner: false });
  assert.equal(s.canEdit, false);
  assert.equal(s.canSave, false);
  assert.equal(s.blocked, memoryWriteMessage('readonly'));
});

test('without the file’s timestamp the editor stays shut', () => {
  // The save is conditional ON that stamp. Opening an editor that cannot make
  // the promise is how you get a clobber the user was never warned about.
  const s = editState({ ...base, draft: 'b', mtimeKnown: false });
  assert.equal(s.canEdit, false);
  assert.match(s.blocked, /timestamp/);
});

/* ── 5. The soft cap ────────────────────────────────────────────────────── */

test('the 6 KB cap warns and never blocks', () => {
  assert.equal(MEMORY_SOFT_CAP_BYTES, 6 * 1024);
  assert.equal(memoryFileMeta('x'.repeat(MEMORY_SOFT_CAP_BYTES)).overSoftCap, false, 'exactly at the cap is not over it');
  assert.equal(memoryFileMeta('x'.repeat(MEMORY_SOFT_CAP_BYTES + 1)).overSoftCap, true);
  // Nothing in the editor consults the cap to decide whether a save may happen.
  const s = editState({ ...base, draft: 'x'.repeat(MEMORY_SOFT_CAP_BYTES * 4) });
  assert.equal(s.canSave, true);
});

/* ── 6. The wiring ──────────────────────────────────────────────────────── */

test('the channel is refused outright in a read-only window', () => {
  const main = read('src/main/index.ts');
  const handler = main.slice(main.indexOf("ipcMain.handle('hive:memoryWrite'"), main.indexOf("ipcMain.handle('hive:inbox'"));
  assert.match(handler, /if \(!hiveOwner\) return \{ ok: false, reason: 'readonly'/);
  assert.match(handler, /hive\.writeMemory\(id, text, typeof expectedMtime === 'number' \? expectedMtime : null\)/);
  assert.match(read('src/preload/index.ts'), /memoryWrite: \(id: string, text: string, expectedMtime: number \| null\)/);
});

test('both UIs edit through the same channel and the same rules', () => {
  const modern = read('src/renderer/src/modern/memory/MemoryView.tsx');
  const pixel = read('src/renderer/src/components/CommandCenterPanel.tsx');
  for (const [name, src] of [['modern', modern], ['pixel', pixel]]) {
    assert.match(src, /window\.cth\.memoryWrite\(who, draft, mtime \?\? 0\)/, `${name} sends the loaded stamp`);
    assert.match(src, /editState\(\{/, `${name} asks the shared rules whether it may edit`);
    assert.match(src, /memoryWriteMessage\(res\.reason\)/, `${name} shows the refusal, not a generic failure`);
    assert.match(src, /metaKey \|\| e\.ctrlKey\) && e\.key\.toLowerCase\(\) === 's'/, `${name} saves on Cmd/Ctrl-S`);
  }
  assert.match(modern, /import \{ MEMORY_FILE, editState, memoryDir, memoryWriteMessage \} from '@shared\/memoryWrite'/);
  assert.match(pixel, /import \{ MEMORY_FILE, editState, memoryDir, memoryWriteMessage \} from '@shared\/memoryWrite'/);
});

test('the hive path both UIs read the stamp from is one function', () => {
  assert.equal(memoryDir('/h', 'ada'), '/h/hive/agents/ada');
  assert.equal(MEMORY_FILE, 'memory.md');
});
