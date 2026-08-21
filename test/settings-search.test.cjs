'use strict';

/** Settings search (MD-27) — the pure filter behind the Settings search box. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { searchSettings, matchingSections, SETTINGS_INDEX } =
  require('./load-ts.cjs')('src/shared/settingsSearch.ts');

const labels = (ms) => ms.map((m) => m.label);

test('a blank query matches nothing, so the normal nav stays', () => {
  // Returning the whole index would render a "results" list that is really
  // just an unsorted copy of the modal.
  assert.deepEqual(searchSettings(''), []);
  assert.deepEqual(searchSettings('   '), []);
});

test('a label substring matches, case- and whitespace-insensitively', () => {
  assert.deepEqual(labels(searchSettings('auto-update')), ['Auto-update']);
  assert.deepEqual(labels(searchSettings('  AUTO-UPDATE ')), ['Auto-update']);
});

test('searching a group name finds every field under it', () => {
  // The point of the group tag: "slack" is not in "Signing secret".
  const found = labels(searchSettings('slack'));
  assert.ok(found.includes('Signing secret'), found.join(', '));
  assert.ok(found.includes('Bot token'), found.join(', '));
  assert.ok(found.includes('App-level token'), found.join(', '));
});

test('searching a section name finds that section’s settings', () => {
  const found = searchSettings('voice');
  assert.ok(found.length >= 2);
  assert.ok(found.every((m) => m.section === 'Voice' || /voice/i.test(m.label)));
});

test('a label hit outranks a group or section hit', () => {
  const found = searchSettings('token');
  // "App-level token" / "Bot token" name the thing; the other Slack fields only
  // share its neighbourhood.
  assert.ok(found[0].start >= 0, 'first result should be a label match');
  const firstContextHit = found.findIndex((m) => m.start < 0);
  const lastLabelHit = found.map((m) => m.start >= 0).lastIndexOf(true);
  if (firstContextHit >= 0) assert.ok(lastLabelHit < firstContextHit);
});

test('an earlier hit in the label ranks above a later one', () => {
  const found = searchSettings('port');
  assert.equal(found[0].label, 'Port');           // starts at 0
  assert.equal(found[0].start, 0);
});

test('offsets point at the matched text so the highlight cannot drift', () => {
  const [hit] = searchSettings('level');
  assert.equal(hit.label.slice(hit.start, hit.end).toLowerCase(), 'level');
});

test('a context match reports no offsets rather than a bogus range', () => {
  const contextHit = searchSettings('slack').find((m) => !/slack/i.test(m.label));
  assert.ok(contextHit, 'expected at least one group-only match');
  assert.equal(contextHit.start, -1);
  assert.equal(contextHit.end, -1);
});

test('a query nothing matches returns empty — the caller shows its empty state', () => {
  assert.deepEqual(searchSettings('zzzznope'), []);
  assert.deepEqual(matchingSections(searchSettings('zzzznope')), []);
});

test('matchingSections lists each section once, in result order', () => {
  const sections = matchingSections(searchSettings('token'));
  assert.deepEqual(sections, [...new Set(sections)]);
  assert.ok(sections.includes('Connections'));
});

test('a special-character query is treated literally, not as a regex', () => {
  // "(" would throw or match everything if this were built on RegExp.
  assert.deepEqual(searchSettings('('), searchSettings('(')); // does not throw
  assert.ok(labels(searchSettings('(voice dictation)')).includes('Free Flow (voice dictation)'));
  assert.deepEqual(searchSettings('.*'), []);
});

test('every index entry names a section the modal actually has', () => {
  // A stale entry must still land the user on a real tab.
  const SECTIONS = ['General', 'Prerequisites', 'Agents & Models', 'Autonomy & Budgets',
    'Connections', 'Voice', 'Memory & Knowledge'];
  for (const e of SETTINGS_INDEX) {
    assert.ok(SECTIONS.includes(e.section), `unknown section: ${e.section} (${e.label})`);
    assert.ok(e.label.trim().length > 0);
  }
});

test('the index has no duplicate section+label pairs', () => {
  const keys = SETTINGS_INDEX.map((e) => `${e.section}|${e.label}`);
  assert.deepEqual(keys.length, new Set(keys).size);
});
