'use strict';

/**
 * The theme store has to notify on a PREFERENCE change, not just a resolved one.
 *
 * `setThemePreference` used to bail early when the resolved light/dark was
 * unchanged — so on a light Mac, choosing "Match system" while showing light
 * wrote the preference and told nobody. Nothing subscribed to the preference
 * back then, so it stayed latent until the modern Settings appearance row bound
 * to it: the control would snap back to "Light" on the next repaint, because
 * the store never announced the value it was now holding.
 *
 * The fix keeps the STAMP conditional (no pointless DOM write / repaint) and
 * makes the NOTIFY unconditional. `useAppTheme` is unharmed because
 * useSyncExternalStore drops a re-render when the snapshot is identical — which
 * is asserted here too, since that is the whole reason the fix is safe.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// --- browser globals the module touches at import -------------------------
const ls = {};
let osDark = false;              // the Mac is in light mode for these tests
const mediaListeners = [];
const html = { dataset: {} };

global.window = {
  localStorage: {
    getItem: (k) => (k in ls ? ls[k] : null),
    setItem: (k, v) => { ls[k] = String(v); },
    removeItem: (k) => { delete ls[k]; }
  },
  matchMedia: () => ({
    get matches() { return osDark; },
    addEventListener: (_e, fn) => { mediaListeners.push(fn); }
  })
};
global.localStorage = global.window.localStorage;
global.document = { documentElement: html };

// --- a one-component stand-in for useSyncExternalStore ---------------------
// Real React is not worth booting for a module store: the contract under test
// is "subscriber fires, and the snapshot the hook re-reads is the new value".
const mounted = [];
require('react').useSyncExternalStore = (subscribe, getSnapshot) => {
  const cell = { renders: 0, value: getSnapshot(), getSnapshot };
  subscribe(() => {
    const next = cell.getSnapshot();
    if (Object.is(next, cell.value)) return;   // what React itself does
    cell.value = next;
    cell.renders += 1;
  });
  mounted.push(cell);
  return cell.value;
};

const loadTs = require('./load-ts.cjs');
const theme = loadTs('src/renderer/src/design/theme.ts');

/** Mount both hooks and hand back their live cells. */
function mountHooks() {
  mounted.length = 0;
  theme.useAppTheme();
  theme.useThemePreference();
  const [resolved, pref] = mounted;
  return { resolved, pref };
}

test('light -> system on a light Mac notifies subscribers', () => {
  theme.setThemePreference('light');
  const { pref } = mountHooks();

  theme.setThemePreference('system');

  assert.equal(theme.themePreference(), 'system', 'preference is stored');
  assert.equal(theme.appTheme(), 'light', 'resolved theme is unchanged on a light Mac');
  // This is the regression: with the early return, no subscriber ever ran, so
  // the mounted hook still holds 'light' and renders stays 0.
  assert.equal(pref.value, 'system', 'a control bound to useThemePreference sees the new choice');
  assert.equal(pref.renders, 1, 'and it re-rendered exactly once');
});

test('an unchanged resolved theme does not re-render useAppTheme', () => {
  theme.setThemePreference('light');
  const { resolved, pref } = mountHooks();

  theme.setThemePreference('system');   // light OS: resolves to light again

  assert.equal(resolved.renders, 0, 'identical snapshot, no re-render');
  assert.equal(pref.renders, 1, 'the preference hook still moved');
});

test('a real light/dark change still stamps the document and moves both hooks', () => {
  theme.setThemePreference('light');
  const { resolved, pref } = mountHooks();

  theme.setThemePreference('dark');

  assert.equal(html.dataset.cthTheme, 'dark', '<html data-cth-theme> follows');
  assert.equal(resolved.value, 'dark');
  assert.equal(pref.value, 'dark');
  assert.equal(resolved.renders, 1);
});

test('the OS flipping under "system" reaches both hooks', () => {
  theme.setThemePreference('system');
  const { resolved, pref } = mountHooks();

  osDark = true;
  mediaListeners.forEach((fn) => fn());
  osDark = false;

  assert.equal(resolved.value, 'dark', 'resolved theme follows the OS');
  assert.equal(pref.value, 'system', 'the CHOICE stays "system" — the control must not snap to Dark');
});

test('the modern Settings appearance row binds to the preference hook', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src/renderer/src/modern/settings/GeneralSection.tsx'), 'utf8');
  assert.match(src, /useThemePreference/,
    'the Theme row reads the store, not a local copy that drifts');
  assert.doesNotMatch(src, /setPref\(/,
    'no local mirror of the preference: the store is the single source');
});
