'use strict';

/**
 * MD-96 — "the terminal font is very thin and does not read well."
 *
 * The root cause was NOT the font family and NOT anything in the modern
 * stylesheet: xterm's WebGL renderer rasterises every glyph into a texture
 * atlas with canvas `fillText`, which on macOS is always greyscale-antialiased,
 * and at 1x a 12px Regular face simply lays down very little ink. Measured in
 * the running app by summing the alpha channel of one rendered line:
 *
 *   JetBrains Mono 400 @12  18.7   ← what shipped
 *   JetBrains Mono 500 @13  25.5   (+36%)  ← what ships now
 *   Menlo          400 @12  18.8   (so swapping the face would have done nothing)
 *
 * Neither knob is reachable from CSS — `term.options` is the only route — so
 * this guards them at the source. A regression here has no test that fails and
 * no error: it just gets thin again.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const POOL = read('src/renderer/src/components/terminalPool.ts');
const ZOOM = read('src/renderer/src/components/terminalFontSize.ts');
const TOKENS = read('src/renderer/src/modern/agents/terminal-tokens.css');
const VIEW = read('src/renderer/src/components/PtyTerminalView.tsx');

test('xterm is constructed with a weight, not the default 400', () => {
  assert.match(POOL, /fontWeight:\s*500\b/);
  assert.match(POOL, /fontWeightBold:\s*700\b/);
});

test('the default terminal zoom is 13px', () => {
  assert.match(ZOOM, /DEFAULT_TERMINAL_FONT_SIZE = 13\b/);
});

test('a stored zoom still wins — only installs that never chose one move', () => {
  // The default is a fallback, not an assignment: nothing writes the key on
  // boot, so raising it cannot overwrite a size the user picked on purpose.
  assert.doesNotMatch(ZOOM, /setItem\([^)]*\)\s*;?\s*$(?![\s\S]*setTerminalFontSize)/m);
  assert.match(ZOOM, /function load\(\)[\s\S]*?return DEFAULT_TERMINAL_FONT_SIZE;/);
});

test('every --cth-* token the terminal reads is bridged into the modern document', () => {
  // Undefined, a `var()` is invalid at computed-value time and the declaration
  // silently falls back — the terminal's chrome then inherits whatever the app
  // font is, which is how it ended up in a UI sans nobody chose.
  const used = new Set(VIEW.match(/--cth-[a-z0-9-]+/g) || []);
  assert.ok(used.size >= 8, `expected the view to read several tokens, saw ${used.size}`);
  for (const token of used) {
    assert.match(TOKENS, new RegExp(`${token}:`), `${token} is not bridged in terminal-tokens.css`);
  }
});
