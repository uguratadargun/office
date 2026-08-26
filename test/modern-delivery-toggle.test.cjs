'use strict';

/**
 * MD-148 E — the modern UI could see the floor-wide auto-delivery pause and
 * never set it.
 *
 * `TerminalQueue` already reports "held — auto-delivery is paused floor-wide",
 * but the switch itself lived only in the pixel `CommandCenterPanel`. A floor
 * paused from the classic UI could therefore be observed and not undone.
 *
 * One switch means one implementation: `useFloorDelivery` is now what both UIs
 * read and write, so there is no second notion of what "paused" means.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const { floorDeliverySeedId } = loadTs('src/renderer/src/hooks/useFloorDelivery.ts');

const roster = [{ id: 'michael' }, { id: 'jim' }, { id: 'pam' }];

test('the floor pause is read from the agent the caller is looking at', () => {
  assert.equal(floorDeliverySeedId(roster, 'pam'), 'pam');
  // Nothing selected (the shell header) — any agent's snapshot is the floor's.
  assert.equal(floorDeliverySeedId(roster, null), 'michael');
  assert.equal(floorDeliverySeedId(roster), 'michael');
  // A stale selection (the agent was archived) must not be asked.
  assert.equal(floorDeliverySeedId(roster, 'dwight'), 'michael');
  // An empty floor has nothing to pause, so the control has no seed at all.
  assert.equal(floorDeliverySeedId([], 'jim'), null);
});

test('setting the pause writes to EVERY agent, not just the seed', () => {
  const hook = read('src/renderer/src/hooks/useFloorDelivery.ts');
  assert.match(hook, /getState\(\)\.agents/);
  assert.match(hook, /all\.map\(\(a\) => window\.cth\.controlAutoDelivery\(a\.id, next\)/);
});

test('both UIs drive the same switch', () => {
  const pixel = read('src/renderer/src/components/CommandCenterPanel.tsx');
  assert.match(pixel, /useFloorDelivery\(agent\.id\)/, 'the pixel panel no longer shares the switch');
  // No poll interval there: that panel has always read once on mount.
  assert.doesNotMatch(pixel, /useFloorDelivery\(agent\.id, \d/);
  assert.doesNotMatch(pixel, /controlAutoDelivery/, 'the pixel panel still writes the IPC by hand');

  const toggle = read('src/renderer/src/modern/components/DeliveryToggle.tsx');
  assert.match(toggle, /useFloorDelivery\(selectedId, \d+\)/, 'the modern toggle does not re-read the floor');
  assert.doesNotMatch(toggle, /controlAutoDelivery/, 'the modern toggle writes the IPC by hand');
  assert.match(toggle, /if \(!available\) return null/, 'an empty floor still renders a switch');

  const shell = read('src/renderer/src/modern/AppShell.tsx');
  assert.match(shell, /<DeliveryToggle \/>/, 'the switch is not mounted in the shell header');
});
