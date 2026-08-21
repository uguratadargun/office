'use strict';

/**
 * Repo-wide IDE search (MD-31) — the pure parts: parsing each backend's output,
 * locating matches for the highlight, the hit cap, and the path normalization
 * that keeps the two backends interchangeable.
 *
 * The rg fixture lines are REAL `rg --json` output, captured from a run against
 * this repo, not hand-written approximations of the format.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseRgLine, parseGitGrepRecord, buildMatcher, matchRanges,
  capHits, toHit, normalizePath, escapeRegExp, DEFAULT_LIMIT
} = require('./load-ts.cjs')('src/main/search.ts');

// ─── rg --json ───────────────────────────────────────────────────────────────

const RG_MATCH = '{"type":"match","data":{"path":{"text":"src/main/slack.ts"},"lines":{"text":"export class SlackEventRouter {\\n"},"line_number":146,"absolute_offset":6780,"submatches":[{"match":{"text":"SlackEventRouter"},"start":13,"end":29}]}}';
const RG_BEGIN = '{"type":"begin","data":{"path":{"text":"src/main/slack.ts"}}}';

test('a match event becomes a hit with its trailing newline stripped', () => {
  assert.deepEqual(parseRgLine(RG_MATCH), {
    file: 'src/main/slack.ts', line: 146, text: 'export class SlackEventRouter {'
  });
});

test('the begin/end/summary events interleaved with matches are skipped', () => {
  assert.equal(parseRgLine(RG_BEGIN), null);
  assert.equal(parseRgLine('{"type":"end","data":{"path":{"text":"a.ts"}}}'), null);
  assert.equal(parseRgLine('{"type":"summary","data":{}}'), null);
});

test('a binary/non-UTF8 match is dropped rather than rendered as mojibake', () => {
  // rg reports these as {bytes: "..."} with no `text`.
  const bytes = '{"type":"match","data":{"path":{"bytes":"YQ=="},"lines":{"bytes":"YQ=="},"line_number":1}}';
  assert.equal(parseRgLine(bytes), null);
});

test('junk on stdout does not throw or produce a hit', () => {
  for (const junk of ['', 'not json', '{', '{"type":"match"}', 'null', '[]']) {
    assert.equal(parseRgLine(junk), null, junk);
  }
});

// ─── git grep -z -n ──────────────────────────────────────────────────────────

test('a NUL-separated record parses into path, line and text', () => {
  assert.deepEqual(parseGitGrepRecord('src/main/slack.ts\x00146\x00export class SlackEventRouter {'), {
    file: 'src/main/slack.ts', line: 146, text: 'export class SlackEventRouter {'
  });
});

test('a colon in the path or the text parses correctly — that is what -z buys', () => {
  const rec = 'src/a:b.ts\x0012\x00const url = "http://x";';
  assert.deepEqual(parseGitGrepRecord(rec), {
    file: 'src/a:b.ts', line: 12, text: 'const url = "http://x";'
  });
});

test('an empty match line is still a hit, not a parse failure', () => {
  assert.deepEqual(parseGitGrepRecord('a.ts\x005\x00'), { file: 'a.ts', line: 5, text: '' });
});

test('a malformed record yields null instead of a bogus hit', () => {
  assert.equal(parseGitGrepRecord(''), null);
  assert.equal(parseGitGrepRecord('a.ts'), null);              // no fields
  assert.equal(parseGitGrepRecord('a.ts\x0012'), null);        // no text field
  assert.equal(parseGitGrepRecord('a.ts\x00nope\x00text'), null); // line not a number
  assert.equal(parseGitGrepRecord('a.ts\x000\x00text'), null);  // lines are 1-based
  assert.equal(parseGitGrepRecord('\x0012\x00text'), null);     // no path
});

// ─── highlight ranges ────────────────────────────────────────────────────────

test('a literal query is matched literally, not as a regex', () => {
  const m = buildMatcher('a.c', { regex: false });
  assert.deepEqual(matchRanges('a.c', m), [[0, 3]]);
  assert.deepEqual(matchRanges('abc', m), []);   // '.' must not match 'b'
});

test('a regex query is matched as a regex', () => {
  assert.deepEqual(matchRanges('abc', buildMatcher('a.c', { regex: true })), [[0, 3]]);
});

test('case sensitivity follows the toggle', () => {
  assert.deepEqual(matchRanges('Foo', buildMatcher('foo', {})), [[0, 3]]);
  assert.deepEqual(matchRanges('Foo', buildMatcher('foo', { caseSensitive: true })), []);
});

test('every occurrence on a line is highlighted, not just the first', () => {
  assert.deepEqual(matchRanges('x x x', buildMatcher('x', {})), [[0, 1], [2, 3], [4, 5]]);
});

test('ranges are STRING indices, so a non-ASCII line highlights the right text', () => {
  // ripgrep's own submatch offsets are BYTE offsets and would be wrong here —
  // this is why the highlight is computed in JS for both backends.
  const line = 'çğü SlackEventRouter';
  const [range] = matchRanges(line, buildMatcher('SlackEventRouter', {}));
  assert.equal(line.slice(range[0], range[1]), 'SlackEventRouter');
});

test('a zero-width regex terminates instead of looping forever', () => {
  assert.deepEqual(matchRanges('abc', buildMatcher('x*', { regex: true })), []);
  assert.deepEqual(matchRanges('abc', buildMatcher('^', { regex: true })), []);
});

test('an invalid regex yields no matcher, so the caller can report it', () => {
  assert.equal(buildMatcher('[', { regex: true }), null);
  assert.deepEqual(matchRanges('anything', null), []);
  // The same text as a LITERAL is a perfectly good query.
  assert.deepEqual(matchRanges('a[b', buildMatcher('[', { regex: false })), [[1, 2]]);
});

test('escapeRegExp neutralises every metacharacter it claims to', () => {
  const meta = '.*+?^${}()|[]\\';
  assert.deepEqual(matchRanges(meta, buildMatcher(meta, { regex: false })), [[0, meta.length]]);
});

// ─── cap / truncation ────────────────────────────────────────────────────────

const hit = (i) => ({ file: 'a.ts', line: i, text: 'x', ranges: [] });

test('under the cap nothing is truncated', () => {
  const r = capHits([hit(1), hit(2)], 5);
  assert.equal(r.truncated, false);
  assert.equal(r.hits.length, 2);
});

test('exactly at the cap is NOT truncated — there is nothing left behind', () => {
  const r = capHits([hit(1), hit(2), hit(3)], 3);
  assert.equal(r.truncated, false);
  assert.equal(r.hits.length, 3);
});

test('over the cap keeps the first N and says so', () => {
  const r = capHits([hit(1), hit(2), hit(3), hit(4)], 2);
  assert.equal(r.truncated, true);
  assert.deepEqual(r.hits.map((h) => h.line), [1, 2]);
});

test('the default cap is a real number, not undefined', () => {
  assert.ok(Number.isInteger(DEFAULT_LIMIT) && DEFAULT_LIMIT > 0);
  assert.equal(capHits([hit(1)]).truncated, false);
});

// ─── path normalization: the two backends must be interchangeable ────────────

test('ripgrep’s "./" prefix is stripped so both backends report one path', () => {
  // rg reports ./src/x.ts for a `.` pathspec; git grep reports src/x.ts. The
  // renderer opens the file BY this path, so they must agree.
  assert.equal(normalizePath('./src/main/slack.ts'), 'src/main/slack.ts');
  assert.equal(normalizePath('src/main/slack.ts'), 'src/main/slack.ts');
});

test('a filename that merely starts with a dot is left alone', () => {
  assert.equal(normalizePath('.gitignore'), '.gitignore');
  assert.equal(normalizePath('./.gitignore'), '.gitignore');
});

test('toHit normalizes the path and attaches the ranges in one step', () => {
  const h = toHit({ file: './a.ts', line: 3, text: 'foo bar' }, buildMatcher('bar', {}));
  assert.deepEqual(h, { file: 'a.ts', line: 3, text: 'foo bar', ranges: [[4, 7]] });
});

test('a minified mega-line is dropped — it is never a useful result', () => {
  const huge = { file: 'bundle.js', line: 1, text: 'x'.repeat(5000) };
  assert.equal(toHit(huge, buildMatcher('x', {})), null);
});

test('toHit passes null straight through', () => {
  assert.equal(toHit(null, buildMatcher('x', {})), null);
});
