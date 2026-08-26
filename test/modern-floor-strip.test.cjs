'use strict';

/**
 * MD-126 — the agents strip under the Floor's stage.
 *
 * The human asked to see the agents from the Floor. The scene shows where
 * everyone is; it answers "who is here and what are they doing" only if you can
 * recognise a sprite and read a speech bubble. The strip is that roster in
 * words — and the whole risk of a SECOND place that describes an agent is that
 * it grows a second dialect. So what this pins is mostly agreement: the order,
 * the word and the second line are the rail's, by reuse, and a change that made
 * this list disagree with the rail would have to break one of these.
 *
 * The card's own JSX is not testable here (`load-ts.cjs` transpiles TS, not
 * TSX), which is exactly why the logic lives in `floorStrip.ts`. What the TSX
 * does with it — `select(id)` on click, the stage keeping its height — is
 * checked by a source-shape assertion at the bottom and by the screenshots.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const m = loadTs('src/renderer/src/modern/views/floorStrip.ts');

/** Running means a process. MD-114: `status` is the parser's last word and
 *  nothing clears it when the pty dies, so a fixture that is meant to be live
 *  carries a ptyId. */
const live = (id, name, status, extra = {}) => ({ id, name, status, ptyId: `pty-${id}`, ...extra });
/** Hibernated on purpose. */
const asleep = (id, name, extra = {}) => ({ id, name, status: 'idle', sleeping: true, ...extra });
/** No process and nobody said so: a released worker, a crash, a kill from
 *  outside the app. The MD-114 zombie. */
const parked = (id, name, extra = {}) => ({ id, name, status: 'working', ...extra });

test('one card per agent, working → idle → asleep, with the boss pinned', () => {
  const roster = [
    asleep('kevin', 'Kevin'),
    live('jim', 'Jim', 'idle'),
    live('michael', 'Michael', 'idle', { isGod: true }),
    live('andy', 'Andy', 'working'),
    parked('dwight', 'Dwight')
  ];
  assert.deepEqual(
    m.stripRows(roster).map((r) => r.id),
    ['michael', 'andy', 'jim', 'kevin', 'dwight'],
    'the strip must use the rail order: god, then live, then idle, then processless'
  );
  assert.equal(m.stripRows(roster).length, roster.length, 'one card per agent, none dropped');
});

test('a PARKED agent reads asleep — never the stale word the parser left behind', () => {
  // The whole of MD-114 in one row: Dwight's `status` still says `working` and
  // his `action` still says what he was doing, because a released worker's pty
  // went away without anything rewriting either. A strip that read `status`
  // would put a dead agent at the top of the floor saying it was busy.
  const [row] = m.stripRows([parked('dwight', 'Dwight', {
    action: 'writing the migration', project: 'hive'
  })]);
  assert.equal(row.badge.label, 'asleep');
  assert.equal(row.badge.tone, 'outline', 'asleep is never a filled badge — it is not doing anything');
  assert.equal(
    row.subtitle, 'hive',
    'a processless agent is not doing anything, whatever `action` still claims: ' +
    'the line reverts to where it lives'
  );
});

test('a deliberately hibernated agent reads the same as a parked one', () => {
  // `presenceWord` is one word wide and both states take the same action, so
  // splitting the vocabulary here would buy a distinction the user cannot act
  // on. The honest difference is spelled out in the detail pane, not here.
  const [row] = m.stripRows([asleep('pam', 'Pam', { project: 'hive' })]);
  assert.equal(row.badge.label, 'asleep');
});

test('a working agent says what it is doing; the rest say where they live', () => {
  const rows = m.stripRows([
    live('andy', 'Andy', 'working', { action: 'auditing Issues filters', project: 'hive' }),
    live('jim', 'Jim', 'idle', { action: 'auditing Issues filters', project: 'hive' })
  ]);
  assert.equal(rows[0].subtitle, 'auditing Issues filters');
  assert.equal(rows[1].subtitle, 'hive');
});

test('a path second line leads with the basename, on both separators', () => {
  // MD-111 S3 / MD-125: the card is narrow and truncates at the END, so a raw
  // absolute path loses the half that identifies it. `title` still carries the
  // whole thing.
  const posix = m.stripRows([live('a', 'A', 'idle', { project: '/Users/ugur/Projects/munder-difflin' })])[0];
  assert.match(posix.subtitle, /^munder-difflin/, 'the folder name comes first');
  assert.equal(posix.full, '/Users/ugur/Projects/munder-difflin', 'title keeps the untruncated path');

  const windows = m.stripRows([live('b', 'B', 'idle', { project: 'C:\\Users\\ugur\\office' })])[0];
  assert.match(
    windows.subtitle, /^office/,
    'a Windows path split on "/" alone has no basename at all — both separators or neither'
  );

  const plain = m.stripRows([live('c', 'C', 'idle', { project: 'hive' })])[0];
  assert.equal(plain.subtitle, 'hive', 'a line with no separator is left exactly as the rail says it');
});

test('the avatar initial survives an emoji, an accent and a blank name', () => {
  assert.equal(m.avatarInitial('Dwight'), 'D');
  assert.equal(m.avatarInitial('  ugur '), 'U');
  assert.equal(m.avatarInitial('émile'), 'É');
  // A surrogate pair sliced in half renders as a replacement glyph.
  assert.equal(m.avatarInitial('🐝 Buzz'), '🐝');
  assert.equal(m.avatarInitial('   '), '?', 'an empty avatar reads as a broken card, not a nameless agent');
});

test('the strip is open unless the user closed it, and storage may fail', () => {
  const mem = (init) => {
    const map = new Map(Object.entries(init ?? {}));
    return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
  };
  assert.equal(m.readStripOpen(mem()), true, 'the human asked for this strip — first run shows it');
  assert.equal(m.readStripOpen(mem({ [m.STRIP_OPEN_KEY]: '0' })), false);
  assert.equal(m.readStripOpen(mem({ [m.STRIP_OPEN_KEY]: '1' })), true);
  assert.equal(
    m.readStripOpen(mem({ [m.STRIP_OPEN_KEY]: 'yes-please' })), true,
    'only an exact "0" closes it; anything else is no preference, not an instruction'
  );

  const store = mem();
  m.writeStripOpen(false, store);
  assert.equal(store.map.get(m.STRIP_OPEN_KEY), '0');
  m.writeStripOpen(true, store);
  assert.equal(store.map.get(m.STRIP_OPEN_KEY), '1');

  // A browser set to block site data throws from the accessor itself. A floor
  // that will not render because it could not remember a toggle is a far worse
  // bug than a toggle that forgets.
  const hostile = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(m.readStripOpen(hostile), true);
  assert.doesNotThrow(() => m.writeStripOpen(false, hostile));
  assert.equal(m.readStripOpen(undefined), true, 'no storage at all is no preference');
});

/* ── The half that only the source can answer ──────────────────────────── */

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src', p), 'utf8');
const STRIP = read('modern/views/FloorAgentsStrip.tsx');
const VIEW = read('modern/views/FloorView.tsx');

test('clicking a card drives the ONE selection the stage and Agents share', () => {
  assert.match(
    STRIP, /onClick=\{\(\) => select\(r\.id\)\}/,
    'a card must call the store `select` — the same call the scene makes when you ' +
    'click a character, so one Esc and one carpet click clear both'
  );
});

test('a card is a real button: focusable, with the ladder ring', () => {
  assert.match(STRIP, /focus-visible:ring-2 focus-visible:ring-ring/);
  assert.doesNotMatch(
    STRIP, /focus-visible:ring-\[3px\]|ring-ring\/50/,
    'MD-108: the ladder is ring-2 ring-ring at full strength'
  );
});

test('the strip cannot take the stage\'s height', () => {
  assert.match(STRIP, /max-h-24/, 'capped at ~96px');
  assert.match(STRIP, /overflow-x-auto/, 'a long roster scrolls sideways rather than wrapping down');
  assert.match(STRIP, /className="shrink-0"/, 'the strip never grows at the stage\'s expense');
  assert.match(VIEW, /min-h-0 flex-1[^"]*"\s*\n?\s*onPointerDownCapture/,
    'the stage takes the remaining height AND owns the carpet-click handlers');
});

test('the carpet handlers are on the stage only, not around the strip', () => {
  // React's onClick fires after pointerup, so a card inside the handlers would
  // be read as a carpet click and clear the selection a beat before setting it.
  const stageAt = VIEW.indexOf('onPointerUp={onPointerUp}');
  const stripAt = VIEW.indexOf('<FloorAgentsStrip');
  assert.ok(stageAt !== -1 && stripAt !== -1);
  const between = VIEW.slice(stageAt, stripAt);
  assert.match(between, /<\/div>/, 'the handler element must close before the strip is rendered');
});

test('no inline style and no px literals in the strip', () => {
  assert.doesNotMatch(STRIP, /style=\{\{/, 'DESIGN-MODERN.md: no inline style in modern/');
  assert.doesNotMatch(STRIP, /\[\d+px\]/, 'no px literals — every value on the utility scale');
});
