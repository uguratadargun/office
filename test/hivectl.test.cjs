'use strict';

// hivectl's pure half — the parts that DECIDE what gets written to a shared
// file. Each of these has a real incident behind it: a card whose assignee was
// cleared by a full-file rewrite, a changelog that came out of a union merge
// with `### Fixed` twice, a `test:focused` list that lost a branch's new test
// because one side of a package.json conflict won outright.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseArgs, buildMessage, applyCardEdit,
  unionConflicts, foldChangelog, isWellFormed, hasRepeatedLine,
  parseFocused, mergeFocused, resolvePackageJson, parseTestTotals,
  mergedRefName, mergePostSteps,
  ACTS, STATUSES
} = require('../resources/hivectl.cjs');

// ─── arg parsing ────────────────────────────────────────────────────────────

test('both --key value and --key=value reach the same place', () => {
  assert.deepEqual(
    parseArgs(['send', '--to', 'god', '--act=done', '--requires-reply']),
    { _: ['send'], to: 'god', act: 'done', 'requires-reply': true }
  );
});

test('a body that starts with a dash is a value, not the next flag', () => {
  // `--body --no-op` would silently send an empty body. The parser only takes a
  // following token when it does NOT look like a flag, so this must stay `true`
  // and be caught by validation rather than shipped as text.
  const a = parseArgs(['--subject', 's', '--body', '--oops']);
  assert.equal(a.body, true);
  assert.equal(a.oops, true);
});

test('a body containing spaces and newlines survives --body=', () => {
  assert.equal(parseArgs(['--body=one two\nthree']).body, 'one two\nthree');
});

// ─── message shaping ────────────────────────────────────────────────────────

const SEND = { to: 'god', act: 'done', subject: 's', body: 'b' };

test('a valid message carries only the fields the sender owns', () => {
  // id/from/hops/timestamps are the harness's — writing our own would either be
  // ignored or, worse, believed.
  assert.deepEqual(buildMessage(SEND), { to: 'god', act: 'done', subject: 's', body: 'b' });
});

test('every act PROTOCOL.md defines is accepted, and nothing else is', () => {
  for (const act of ACTS) assert.ok(buildMessage({ ...SEND, act }));
  assert.throws(() => buildMessage({ ...SEND, act: 'inform-god' }), /not one of/);
});

test('each required field is named when it is missing', () => {
  for (const k of ['to', 'act', 'subject', 'body']) {
    assert.throws(() => buildMessage({ ...SEND, [k]: '' }), new RegExp(`--${k} is required`));
  }
});

test('requires-reply is refused on a terminal act', () => {
  // `inform`/`done` are terminal. requires_reply on one asks for a reply the
  // recipient is told never to send — the message just sits there unanswered.
  assert.throws(() => buildMessage({ ...SEND, act: 'inform', requiresReply: true }), /requires-reply/);
  assert.equal(buildMessage({ ...SEND, act: 'query', requiresReply: true }).requires_reply, true);
});

test('reply-to and conversation are carried through under their schema names', () => {
  const m = buildMessage({ ...SEND, replyTo: 'god-md169', conversation: 'md-169' });
  assert.equal(m.in_reply_to, 'god-md169');
  assert.equal(m.conversation, 'md-169');
});

// ─── card edits ─────────────────────────────────────────────────────────────

const DOC = () => ({
  tasks: [
    { id: 'MD-1', title: 'a', status: 'todo', assignee: 'jim' },
    { id: 'MD-2', title: 'b', status: 'doing', assignee: 'pam' }
  ]
});

test('an absent flag changes nothing at all', () => {
  const r = applyCardEdit(DOC(), 'MD-1', {});
  assert.deepEqual(r.changed, []);
  assert.deepEqual(r.doc, DOC());
});

test('assignee is NEVER cleared', () => {
  // Standing rule 1. The way it got cleared was a rewrite that wrote back every
  // field it knew about, including the ones it had no opinion on.
  for (const empty of [undefined, '', null, true]) {
    const r = applyCardEdit(DOC(), 'MD-1', { status: 'done', assignee: empty });
    assert.equal(r.card.assignee, 'jim');
    assert.deepEqual(r.changed, ['status']);
  }
});

test('only the named card moves, and the file keeps its shape', () => {
  const r = applyCardEdit(DOC(), 'MD-2', { status: 'done', note: 'merged' });
  assert.equal(r.doc.tasks[0].status, 'todo');
  assert.equal(r.doc.tasks[1].status, 'done');
  assert.equal(r.doc.tasks[1].note, 'merged');
  assert.deepEqual(r.changed, ['status', 'note']);
});

test('a status outside the kanban is refused, not written', () => {
  for (const s of STATUSES) assert.ok(applyCardEdit(DOC(), 'MD-1', { status: s }));
  assert.throws(() => applyCardEdit(DOC(), 'MD-1', { status: 'in-progress' }), /not one of/);
});

test('an unknown card id is an error, never a silent no-op', () => {
  assert.throws(() => applyCardEdit(DOC(), 'MD-999', { status: 'done' }), /no card MD-999/);
});

test('a bare array of tasks is edited in place too', () => {
  const r = applyCardEdit([{ id: 'MD-1', status: 'todo', assignee: 'jim' }], 'MD-1', { status: 'done' });
  assert.ok(Array.isArray(r.doc));
  assert.equal(r.doc[0].status, 'done');
});

// ─── changelog folding ──────────────────────────────────────────────────────

const CONFLICTED = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '### Added',
  '',
  '### Fixed',
  '<<<<<<< HEAD',
  '- ours: the standup gate.',
  '=======',
  '- theirs: the nudge batching.',
  '>>>>>>> feat/x',
  '',
  '## [0.5.0] — 2026-08-26',
  '',
  '### Added',
  '- shipped.',
  ''
].join('\n');

test('a conflict hunk becomes BOTH sides, ours first', () => {
  const u = unionConflicts(CONFLICTED);
  assert.ok(!/[<>=]{7}/.test(u), 'conflict markers survived');
  assert.ok(u.indexOf('- ours:') < u.indexOf('- theirs:'));
});

test('diff3 output drops the base section and keeps both real sides', () => {
  const u = unionConflicts([
    '<<<<<<< HEAD', '- ours', '||||||| base', '- ancestor', '=======', '- theirs', '>>>>>>> b'
  ].join('\n'));
  assert.equal(u, '- ours\n- theirs');
});

test('folding leaves each release block with each section exactly once', () => {
  const folded = foldChangelog(unionConflicts([
    '## [Unreleased]', '', '### Fixed', '- one.', '', '### Fixed', '- two.', ''
  ].join('\n')));
  assert.equal((folded.match(/^### Fixed$/gm) || []).length, 1);
  assert.match(folded, /- one\./);
  assert.match(folded, /- two\./);
});

test('sections come out in the Keep a Changelog order the shape test demands', () => {
  const folded = foldChangelog([
    '## [Unreleased]', '', '### Removed', '- r', '', '### Added', '- a', '', '### Fixed', '- f', ''
  ].join('\n'));
  const order = (folded.match(/^### (\w+)$/gm) || []).map((h) => h.slice(4));
  assert.deepEqual(order, ['Added', 'Fixed', 'Removed']);
});

test('the same bullet arriving from both sides appears once', () => {
  const folded = foldChangelog(unionConflicts([
    '## [Unreleased]', '', '### Fixed',
    '<<<<<<< HEAD', '- same line.', '- ours only.', '=======', '- same line.', '>>>>>>> b', ''
  ].join('\n')));
  assert.equal((folded.match(/- same line\./g) || []).length, 1);
  assert.match(folded, /- ours only\./);
});

test('the preamble and every other release block are left alone', () => {
  const folded = foldChangelog(CONFLICTED.replace(/<<<<<<< HEAD\n|=======\n|>>>>>>> feat\/x\n/g, ''));
  assert.ok(folded.startsWith('# Changelog\n'));
  assert.match(folded, /## \[0\.5\.0\] — 2026-08-26/);
  assert.match(folded, /- shipped\./);
});

test('a block that is already well-formed is left byte-for-byte alone', () => {
  // The first real run reflowed every shipped release block: 157 lines of churn
  // that buried the two entries the merge had actually changed.
  const released = [
    '## [0.5.0] — 2026-08-26', '', '### Added', '- a', '', '### Fixed',
    '-   odd    spacing kept', '', '  indented continuation', ''
  ].join('\n');
  const src = `# Changelog\n\n## [Unreleased]\n\n### Fixed\n- x\n\n### Fixed\n- y\n\n${released}\n`;
  const folded = foldChangelog(src);
  assert.ok(folded.includes(released), 'the untouched release block was reflowed');
  // ...while the block that DID need folding still got folded.
  assert.equal((folded.split('## [0.5.0]')[0].match(/^### Fixed$/gm) || []).length, 1);
});

test('trailing blank lines are punctuation, not a repeated bullet', () => {
  // THE trap the first live merge hit: counting blank lines as duplicates made
  // every well-formed file take the reflow path — 157 lines of churn in a merge
  // that changed two entries.
  assert.equal(hasRepeatedLine(['- a', '', '  continued', '', '']), false);
  assert.equal(hasRepeatedLine(['- a', '', '- a']), true);
});

test('a folded release block keeps its blank line under the heading', () => {
  const folded = foldChangelog('## [Unreleased]\n\n### Fixed\n- x\n\n### Fixed\n- y\n');
  assert.match(folded, /^## \[Unreleased\]\n\n### Fixed\n/);
});

test('well-formed means unique sections in the agreed relative order', () => {
  assert.equal(isWellFormed(['Added', 'Fixed']), true);
  assert.equal(isWellFormed(['Fixed', 'Added']), false);
  assert.equal(isWellFormed(['Fixed', 'Fixed']), false);
  // An unknown section is not ranked, so it never makes a block ill-formed.
  assert.equal(isWellFormed(['Added', 'Security', 'Fixed']), true);
});

test('an empty section survives the fold', () => {
  // `[Unreleased]` ships with all four headings and no bullets; dropping the
  // empty ones fails the repo's own changelog-shape test.
  const folded = foldChangelog('## [Unreleased]\n\n### Added\n\n### Changed\n\n### Fixed\n\n### Removed\n');
  assert.deepEqual((folded.match(/^### (\w+)$/gm) || []).map((h) => h.slice(4)),
    ['Added', 'Changed', 'Fixed', 'Removed']);
});

// ─── package.json / test:focused ────────────────────────────────────────────

const OURS = 'node --test test/a.cjs test/b.cjs';
const THEIRS = 'node --test test/a.cjs test/c.cjs';
const all = () => true;

test('the runner prefix survives the round trip', () => {
  assert.deepEqual(parseFocused('node --test --concurrency=1 test/a.cjs'),
    { prefix: 'node --test --concurrency=1', files: ['test/a.cjs'] });
});

test('two focused lists merge into their union, in a stable order', () => {
  assert.equal(mergeFocused(OURS, THEIRS, all), 'node --test test/a.cjs test/b.cjs test/c.cjs');
});

test("a branch's new test is never dropped by taking one side", () => {
  // The failure this exists for: a fix merges, its test file lands, and the test
  // is silently unregistered because ours won the package.json conflict.
  assert.match(mergeFocused(OURS, THEIRS, all), /test\/c\.cjs/);
});

test('a file that no longer exists is dropped, not carried into a broken run', () => {
  // `node --test` on a missing path fails the whole suite, so a renamed or
  // deleted test on either side has to go.
  const exists = (f) => f !== 'test/b.cjs';
  assert.equal(mergeFocused(OURS, THEIRS, exists), 'node --test test/a.cjs test/c.cjs');
});

test('package.json resolves with the focused list unioned', () => {
  const ours = JSON.stringify({ version: '0.5.0', scripts: { build: 'x', 'test:focused': OURS } });
  const theirs = JSON.stringify({ version: '0.5.0', scripts: { build: 'x', 'test:focused': THEIRS } });
  const r = resolvePackageJson(ours, theirs, all);
  assert.equal(JSON.parse(r.text).scripts['test:focused'],
    'node --test test/a.cjs test/b.cjs test/c.cjs');
  assert.deepEqual(r.warnings, []);
});

test('a key only one side has is kept', () => {
  const r = resolvePackageJson(
    JSON.stringify({ scripts: { a: '1' }, devDependencies: { x: '1' } }),
    JSON.stringify({ scripts: { a: '1', b: '2' }, devDependencies: { x: '1', y: '2' } }),
    all
  );
  const p = JSON.parse(r.text);
  assert.equal(p.scripts.b, '2');
  assert.equal(p.devDependencies.y, '2');
});

test('a real disagreement keeps ours and SAYS so', () => {
  // A version bump or a dependency pinned two ways is a decision. Auto-picking
  // one silently is how a release ships at the wrong version.
  const r = resolvePackageJson(
    JSON.stringify({ version: '0.5.0', dependencies: { dep: '1.0.0' } }),
    JSON.stringify({ version: '0.6.0', dependencies: { dep: '2.0.0' } }),
    all
  );
  assert.equal(JSON.parse(r.text).version, '0.5.0');
  assert.equal(JSON.parse(r.text).dependencies.dep, '1.0.0');
  assert.deepEqual(r.warnings.sort(), ['dependencies.dep differs — kept ours', 'version differs — kept ours']);
});

test('the resolved file is 2-space JSON with a trailing newline', () => {
  const r = resolvePackageJson('{"name":"office"}', '{"name":"office"}', all);
  assert.equal(r.text, '{\n  "name": "office"\n}\n');
});

// ─── test totals ────────────────────────────────────────────────────────────

test('the summary line reads its numbers out of the real runner output', () => {
  assert.deepEqual(parseTestTotals('# tests 1521\n# pass 1520\n# fail 1\n'), { pass: 1520, fail: 1 });
  assert.deepEqual(parseTestTotals('nothing here'), { pass: null, fail: null });
});

// ─── merge: anchoring and publishing ────────────────────────────────────────

test('a merged branch gets one flat ref under refs/hive/merged', () => {
  assert.equal(mergedRefName('feat/hivectl-merge-ref'), 'refs/hive/merged/feat-hivectl-merge-ref');
  // The reason it is flattened: git cannot hold a ref that is both a directory
  // and a file, so nesting would make merging `feat` break every later
  // `feat/<x>` merge (and vice versa). These two must not collide.
  assert.ok(!mergedRefName('feat/x').startsWith(mergedRefName('feat') + '/'));
  assert.equal(mergedRefName('refs/heads/fix/a b'), 'refs/hive/merged/fix-a-b');
  // Names git itself rejects: a trailing '.lock', '..', a leading/trailing dot.
  assert.equal(mergedRefName('.weird..name.lock'), 'refs/hive/merged/weird.name');
  assert.throws(() => mergedRefName('///'), /nothing to make a ref/);
});

test('a passing merge anchors the commit, and without --push touches no remote', () => {
  const steps = mergePostSteps({ ok: true, push: false, branch: 'feat/a', sha: 'deadbeef' });
  assert.deepEqual(steps.map((s) => s.label), ['ref']);
  assert.deepEqual(steps[0].argv, ['update-ref', 'refs/hive/merged/feat-a', 'deadbeef']);
});

test('--push fast-forwards main and retires the branch, in that order', () => {
  const steps = mergePostSteps({ ok: true, push: true, branch: 'feat/a', sha: 'deadbeef' });
  assert.deepEqual(steps.map((s) => s.label), ['ref', 'push', 'unbranch']);
  // The ref goes FIRST: if the push fails the commit is still reachable.
  assert.deepEqual(steps[1].argv, ['push', 'origin', 'deadbeef:refs/heads/main']);
  assert.deepEqual(steps[2].argv, ['push', 'origin', '--delete', 'feat/a']);
  // A branch that was never pushed must not fail an otherwise-good merge.
  assert.equal(steps[2].optional, true);
  assert.equal(steps[1].optional, undefined);
});

test('the push can never overwrite someone else\'s main', () => {
  // Not a style check — '--force', '-f' or a leading '+' on the refspec each
  // turn a rejected non-fast-forward into a silent overwrite of origin/main.
  const argv = mergePostSteps({ ok: true, push: true, branch: 'feat/a', sha: 'deadbeef' })
    .flatMap((s) => s.argv);
  for (const a of argv) {
    assert.doesNotMatch(a, /^(--force|-f|--force-with-lease)$/);
    assert.doesNotMatch(a, /^\+/);
  }
});

test('a FAILED gate leaves no ref and no push', () => {
  // The whole safety property: nothing downstream of the gate happens, so a red
  // merge cannot be mistaken for a green one by anything that reads the refs.
  assert.deepEqual(mergePostSteps({ ok: false, push: true, branch: 'feat/a', sha: 'deadbeef' }), []);
  assert.deepEqual(mergePostSteps({ ok: false, push: false, branch: 'feat/a', sha: 'deadbeef' }), []);
});
