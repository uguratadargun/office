'use strict';

/**
 * MD-95 — the modern Floor is a picker: clicking a character opens that agent's
 * chat beside the scene, clicking the carpet closes it.
 *
 * The Pixi scene owns its own hit testing and tells the DOM nothing, so the
 * "was that an agent or the carpet?" question is answered by watching the store
 * across the pointer gesture. That inference is what these tests pin down —
 * including the case that would otherwise close the panel of the agent you just
 * clicked.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const sel = loadTs('src/renderer/src/modern/agents/floorSelection.ts');
const insp = loadTs('src/renderer/src/modern/lib/inspector.ts');

const snap = (selectedId, extra = {}) => ({
  selectedId, ccTabRequest: null, agents: extra.agents ?? SHARED_ROSTER, ...extra
});
const SHARED_ROSTER = [{ id: 'a1' }, { id: 'god' }];

test('picking a different agent is a selection touch', () => {
  assert.equal(sel.isSelectionTouch(snap(null), snap('a1')), true);
  assert.equal(sel.isSelectionTouch(snap('a1'), snap('god')), true);
});

test('re-picking the agent that is ALREADY selected still counts as a touch', () => {
  // `select(id)` on the open agent changes nothing observable. Reading that as
  // "missed — must be the carpet" would close the panel under the user.
  assert.equal(sel.isSelectionTouch(snap('a1'), snap('a1')), true);
});

test('roster churn while nothing is selected is not a touch', () => {
  const prev = snap(null);
  const next = snap(null, { agents: [{ id: 'a1' }, { id: 'god' }, { id: 'a2' }] });
  assert.equal(sel.isSelectionTouch(prev, next), false);
});

test('a command-center tab request is not mistaken for a select', () => {
  const prev = snap('a1', { ccTabRequest: null });
  const next = snap('a1', { ccTabRequest: { tab: 'monitor', seq: 3 } });
  // A pending tab request means this write was NOT `select` (which clears it).
  assert.equal(sel.isSelectionTouch(prev, next), false);
});

test('empty floor clears the selection; a hit does not', () => {
  const clear = sel.shouldClearOnFloorClick;
  assert.equal(clear({ before: 'a1', after: 'a1', touched: false }), true, 'carpet');
  assert.equal(clear({ before: 'a1', after: 'a1', touched: true }), false, 're-pick');
  assert.equal(clear({ before: 'a1', after: 'god', touched: true }), false, 'other agent');
  assert.equal(clear({ before: null, after: null, touched: false }), false, 'nothing open');
  // A pick made from empty floor must survive its own gesture.
  assert.equal(clear({ before: null, after: 'a1', touched: true }), false);
});

test('the inspected agent is resolved from the shared selection, and a dead id is nothing', () => {
  assert.equal(sel.inspectedAgent(SHARED_ROSTER, 'god').id, 'god');
  assert.equal(sel.inspectedAgent(SHARED_ROSTER, null), null);
  // Killed while its panel was open: no panel, never a header with no agent.
  assert.equal(sel.inspectedAgent(SHARED_ROSTER, 'gone'), null);
});

test('inspector width clamps to a readable terminal and never eats the floor', () => {
  const { clampInspectorWidth, INSPECTOR_MIN, INSPECTOR_MAX, INSPECTOR_DEFAULT } = insp;
  assert.equal(clampInspectorWidth(10, 1600), INSPECTOR_MIN);
  assert.equal(clampInspectorWidth(5000, 4000), INSPECTOR_MAX);
  assert.equal(clampInspectorWidth(500, 1600), 500);
  // Half the viewport is the ceiling — except that the minimum always wins, or
  // a narrow window would render a terminal too narrow to read.
  assert.equal(clampInspectorWidth(800, 1200), 600);
  assert.equal(clampInspectorWidth(800, 600), INSPECTOR_MIN);
  assert.equal(clampInspectorWidth(NaN, 1600), INSPECTOR_DEFAULT);
});

test('a stored width outside the allowed range falls back to the default', () => {
  const { readInspectorWidth, INSPECTOR_DEFAULT } = insp;
  assert.equal(readInspectorWidth('520'), 520);
  assert.equal(readInspectorWidth(null), INSPECTOR_DEFAULT);
  assert.equal(readInspectorWidth(''), INSPECTOR_DEFAULT);
  assert.equal(readInspectorWidth('9'), INSPECTOR_DEFAULT);
  assert.equal(readInspectorWidth('99999'), INSPECTOR_DEFAULT);
  assert.equal(readInspectorWidth('nope'), INSPECTOR_DEFAULT);
});
