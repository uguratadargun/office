'use strict';

/**
 * MD-104 — quitting the modern UI hung.
 *
 * `before-quit` in main does not quit while a PTY is alive: it preventDefault()s
 * and pushes `app:closeRequested` to the renderer, then waits for the renderer
 * to answer with `app:confirmClose` or `app:cancelClose`. Only the pixel
 * `App.tsx` ever subscribed. In the modern UI nothing did, so Cmd-Q, the red X
 * and Ctrl-C were all swallowed silently — no dialog, no reply, no quit — and
 * the only way out was a force quit (which is also how the roster kept dying).
 *
 * The listener must live at the ROOT, beside every screen and not inside one:
 * a dialog mounted in a view leaves quit dead everywhere else in the app.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src', p), 'utf8');
const APP = read('modern/App.tsx');
const DIALOG = read('modern/components/QuitDialog.tsx');
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src/main/index.ts'), 'utf8');

test('the modern root mounts the quit dialog', () => {
  assert.match(APP, /import \{ QuitDialog \}/, 'the root imports it');
  assert.match(APP, /<QuitDialog \/>/, 'and renders it');
  // Outside the onboarding / hive-picker / shell branch, so the listener exists
  // on every screen — that is the whole bug.
  const mount = APP.indexOf('<QuitDialog />');
  assert.ok(mount > 0 && mount < APP.indexOf('if (!config.onboardingComplete)'),
    'the dialog must be mounted before the screen branches, not inside one');
});

test('it subscribes to the request main is waiting on, and answers it', () => {
  assert.match(DIALOG, /onCloseRequested/, 'subscribes to app:closeRequested');
  assert.match(DIALOG, /confirmClose/, 'the quit reply');
  assert.match(DIALOG, /cancelClose/, 'the stay-here reply — without it main never re-enables quit');
});

test('it offers the same three ways out as the pixel dialog', () => {
  assert.match(DIALOG, /startClosingTime/, 'closing time — the safe shutdown');
  assert.match(DIALOG, /cancelClosingTime/);
  assert.match(DIALOG, /onClosingTime/, 'and follows its progress');
  assert.match(DIALOG, /still running/, 'the N-terminals warning');
});

test('it is built from shadcn primitives, with no inline style', () => {
  assert.match(DIALOG, /from '\.\/ui\/alert-dialog'/);
  assert.doesNotMatch(DIALOG, /style=\{\{/, 'DESIGN-MODERN.md: utilities only');
  assert.doesNotMatch(DIALOG, /--cth-/, 'no pixel tokens in the modern UI');
});

test('main still needs an answer — the contract these tests are about', () => {
  assert.match(MAIN, /app:closeRequested/);
  assert.match(MAIN, /app:confirmClose/);
});
