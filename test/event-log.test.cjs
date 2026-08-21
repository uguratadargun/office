'use strict';

/**
 * The Activity tab's read side.
 *
 * It used to be `hiveLog(60)` on a 3s poll: the last sixty lines, no search, no
 * filter, no way back. The filtering/paging now runs in the main process against
 * the whole file, which means the arithmetic is worth pinning — an off-by-one in
 * the offset silently repeats or skips a row on "load more", and a filter that
 * narrows its own facet list makes the dropdowns collapse as you use them.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { queryEvents, eventAgents, eventText, describeEvent } = loadTs('src/shared/eventLog.ts');
const { relSince } = loadTs('src/shared/relTime.ts');

/** A log in FILE order — oldest first, the way log.jsonl is written. */
const LOG = [
  { ts: 1000, kind: 'spawn', agentId: 'god', name: 'Michael', isGod: true },
  { ts: 2000, kind: 'spawn', agentId: 'jim-1', name: 'Jim' },
  { ts: 3000, kind: 'message', from: 'god', to: 'jim-1', act: 'request', subject: 'Fix the palette' },
  { ts: 4000, kind: 'drain', agentId: 'jim-1', count: 2 },
  { ts: 5000, kind: 'message', from: 'jim-1', to: 'god', act: 'done', subject: 'Palette shipped' },
  { ts: 6000, kind: 'tasks', count: 4 },
  { ts: 7000, kind: 'archive', agentId: 'jim-1', archived: true }
];

test('the newest event comes first — a feed reads from its live end', () => {
  const p = queryEvents(LOG);
  assert.equal(p.rows[0].kind, 'archive');
  assert.equal(p.rows.at(-1).kind, 'spawn');
  assert.equal(p.total, LOG.length);
});

test('seq is the LINE number, so it survives the log growing under a page', () => {
  // A React key derived from the position in a reversed list shifts every time a
  // line is appended, which re-mounts every row (and eats an open detail).
  const before = queryEvents(LOG).rows.find((r) => r.kind === 'tasks').seq;
  const after = queryEvents([...LOG, { ts: 8000, kind: 'spawn', agentId: 'new' }])
    .rows.find((r) => r.kind === 'tasks').seq;
  assert.equal(before, after, 'seq is stable across appends');
  assert.equal(before, 5, 'and it is the index in the file');
});

test('paging walks the whole result without repeating or skipping a row', () => {
  const seen = [];
  for (let offset = 0; ; offset += 3) {
    const p = queryEvents(LOG, { offset, limit: 3 });
    seen.push(...p.rows.map((r) => r.seq));
    if (offset + p.rows.length >= p.total) break;
  }
  assert.equal(seen.length, LOG.length);
  assert.equal(new Set(seen).size, LOG.length, 'no row served twice');
  assert.deepEqual(seen, [...seen].sort((a, b) => b - a), 'still newest-first across pages');
});

test('an offset past the end is an empty page, not a crash or a wrap', () => {
  const p = queryEvents(LOG, { offset: 999, limit: 10 });
  assert.deepEqual(p.rows, []);
  assert.equal(p.total, LOG.length, 'total still describes the whole match set');
});

test('filtering by agent catches from/to as well as agentId', () => {
  // "everything involving jim-1" has to include the mail god sent him, not just
  // the entries where he is the subject.
  const p = queryEvents(LOG, { agent: 'jim-1' });
  const kinds = p.rows.map((r) => r.kind).sort();
  assert.deepEqual(kinds, ['archive', 'drain', 'message', 'message', 'spawn']);
});

test('filtering by kind is exact — not a substring of another kind', () => {
  const p = queryEvents(LOG, { kind: 'message' });
  assert.equal(p.total, 2);
  for (const r of p.rows) assert.equal(r.kind, 'message');
});

test('search is case-insensitive and reaches the fields a user can see', () => {
  assert.equal(queryEvents(LOG, { search: 'PALETTE' }).total, 2);
  assert.equal(queryEvents(LOG, { search: 'michael' }).total, 1);
  assert.equal(queryEvents(LOG, { search: 'nothing-here' }).total, 0);
});

test('search never matches through the timestamp', () => {
  // `ts` is an epoch integer. Leaving it in the haystack means a search for a
  // digit matches nearly every line through something invisible.
  assert.ok(!eventText({ ts: 1712345678901, kind: 'spawn', agentId: 'a' }).includes('1712345678901'));
  assert.equal(queryEvents(LOG, { search: '3000' }).total, 0);
});

test('filters compose — kind AND agent AND search all narrow together', () => {
  const p = queryEvents(LOG, { kind: 'message', agent: 'jim-1', search: 'shipped' });
  assert.equal(p.total, 1);
  assert.equal(p.rows[0].subject, 'Palette shipped');
});

test('facets are computed over the whole log, not the filtered set', () => {
  // Otherwise picking a kind empties the agent dropdown underneath the user and
  // there is no way back except clearing the filter you cannot see.
  const p = queryEvents(LOG, { kind: 'tasks' });
  assert.equal(p.total, 1);
  assert.deepEqual(p.kinds, ['archive', 'drain', 'message', 'spawn', 'tasks']);
  assert.ok(p.agents.includes('jim-1'), 'agents survive a kind filter');
  assert.ok(p.agents.includes('god'));
});

test('an absurd limit is clamped rather than handed to slice', () => {
  assert.ok(queryEvents(LOG, { limit: 1e9 }).limit <= 500);
  assert.equal(queryEvents(LOG, { limit: 0 }).limit, 1);
  assert.equal(queryEvents(LOG, { offset: -5 }).offset, 0);
});

test('eventAgents de-duplicates and ignores non-string parties', () => {
  assert.deepEqual(eventAgents({ from: 'god', to: 'god' }), ['god']);
  assert.deepEqual(eventAgents({ agentId: 'a', from: 'b', actor: 'voice' }), ['a', 'b', 'voice']);
  assert.deepEqual(eventAgents({ agentId: 42, to: '' }), []);
});

test('every kind the hive actually logs gets a sentence, not a JSON blob', () => {
  // The old tab fell back to JSON.stringify(e), which dropped a raw object —
  // braces, quotes, the epoch stamp — into a list of readable lines.
  const KINDS = ['spawn', 'message', 'drain', 'drop', 'session', 'archive', 'edit',
    'tasks', 'cwd_invalid', 'terminal-handoff', 'voice_action', 'voice_action_error'];
  for (const kind of KINDS) {
    const text = describeEvent({ ts: 1, kind, agentId: 'a', from: 'a', to: 'b', count: 1, sessionId: 'abcdef123456' });
    assert.ok(text && !text.includes('{'), `${kind} renders as prose, got: ${text}`);
  }
});

test('an unknown kind stays readable and stays searchable', () => {
  const e = { ts: 1, kind: 'brand-new-kind', detail: 'something happened' };
  const text = describeEvent(e);
  assert.ok(text.includes('something happened'), 'its own fields are shown');
  assert.ok(eventText(e).includes('something happened'), 'and it can still be found');
  assert.equal(queryEvents([e], { search: 'something' }).total, 1);
});

test('relSince takes the epoch ms the log actually stamps', () => {
  // log.jsonl writes `ts: Date.now()`; the helper took ISO only, and
  // Date.parse(1712345678901) is NaN → every row would have read "unknown".
  const now = 10_000_000;
  assert.equal(relSince(now - 5_000, now), 'just now');
  assert.equal(relSince(now - 120_000, now), '2m ago');
  assert.equal(relSince(now - 7_200_000, now), '2h ago');
  assert.equal(relSince(new Date(now - 120_000).toISOString(), now), '2m ago', 'ISO still works');
  assert.equal(relSince('not a date', now), 'not a date');
  assert.equal(relSince(NaN, now), 'unknown');
});

test('an unparseable line survives as a row instead of vanishing', () => {
  // hive.ts turns a bad line into `{ raw }`. A log that silently skips what it
  // cannot parse is worse than one that shows you the line it choked on.
  const p = queryEvents([{ raw: '{"kind":"spawn"' }], { search: 'spawn' });
  assert.equal(p.total, 1);
  assert.ok(describeEvent(p.rows[0]).includes('raw='));
});
