'use strict';

/**
 * MD-123 — the modern floor's letterbox belongs to the modern shell.
 *
 * `Camera.fitToScreen` is a CONTAIN fit, so whenever the frame's aspect differs
 * from the map's there is leftover space, and whatever paints it is what the
 * user reads as "the floor's background". That used to be the office palette's
 * own dark (`ink[900]`) in both front-ends — right in the pixel app, where the
 * whole window is that dark, and wrong in the modern shell, where it landed as a
 * near-black slab covering over half the frame once the inspector narrowed the
 * stage (MD-119 F4).
 *
 * The fix is a transparent letterbox plus a modern-token background on the
 * frame, so the gap follows the theme by construction rather than by a second
 * hard-coded colour that has to be kept in step. Two halves, and the test has to
 * hold BOTH or the bands come back:
 *
 *  1. the modern frame paints a token, and the scene is opted in;
 *  2. the pixel mount is untouched — no prop, so it keeps `ink[900]` and the
 *     `--cth-panel-border` shadow.
 *
 * The second is the one worth a test. The change is a default parameter, and a
 * default is exactly the kind of thing a later edit "simplifies" into always-on,
 * which would silently repaint the pixel floor's letterbox in a colour nothing
 * in that UI ever asked for.
 *
 * There is no surface to render here — Pixi needs WebGL and the fix is a shape
 * in the source — so this reads the source, like `modern-disabled-tooltip`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src/renderer/src');
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');

const FLOOR_VIEW = read('modern/views/FloorView.tsx');
const OFFICE_FLOOR = read('scene/office/OfficeFloor.tsx');
const PIXEL_APP = read('App.tsx');

/** The element that wraps `<OfficeFloor` — the frame whose background fills the
 *  letterbox. Returns its className text. */
function frameClasses(src) {
  const at = src.indexOf('<OfficeFloor');
  assert.notEqual(at, -1, 'expected an <OfficeFloor mount');
  const before = src.slice(0, at);
  const open = before.lastIndexOf('<div');
  assert.notEqual(open, -1, 'expected a wrapping <div');
  const attrs = before.slice(open, before.indexOf('>', open) + 1);
  const m = attrs.match(/className="([^"]*)"/);
  return m ? m[1] : '';
}

test('the modern floor frame paints a background TOKEN, not a colour', () => {
  const classes = frameClasses(FLOOR_VIEW);
  assert.match(
    classes,
    /\bbg-(background|card|muted)\b/,
    `the frame around the scene must carry a modern background token so the ` +
    `letterbox follows the theme; got "${classes}"`
  );
  // A literal is the failure mode this replaced: it is correct in exactly one
  // theme and there are two.
  assert.doesNotMatch(
    classes,
    /\bbg-(black|white|\[#)/,
    'no literal colour on the floor frame — light and dark both have to be right'
  );
});

test('the modern floor opts the scene into a transparent letterbox', () => {
  assert.match(
    FLOOR_VIEW,
    /<OfficeFloor\s+surface="chrome"\s*\/>/,
    'the modern mount must pass surface="chrome" — without it the scene keeps ' +
    'clearing to the office palette and the frame token is never seen'
  );
});

test('the PIXEL floor is mounted with no surface prop, so it keeps its own dark', () => {
  const mount = PIXEL_APP.slice(PIXEL_APP.indexOf('<OfficeFloor'));
  assert.match(
    mount.slice(0, 40),
    /^<OfficeFloor\s*\/>/,
    'the pixel app must mount <OfficeFloor /> bare: the whole point of the ' +
    'default is that the pixel floor cannot be repainted by this change'
  );
});

test('transparency is opt-in — the default surface is the pixel one', () => {
  assert.match(
    OFFICE_FLOOR,
    /surface\s*=\s*'pixel'/,
    "OfficeFloor's `surface` must default to 'pixel'; an always-on transparent " +
    'letterbox would repaint the pixel floor'
  );
  assert.match(
    OFFICE_FLOOR,
    /backgroundAlpha:\s*transparent\s*\?\s*0\s*:\s*1/,
    'the renderer clear must stay opaque unless the chrome asked for otherwise'
  );
});

test('the scene keeps the pixel-only chrome behind the same flag', () => {
  // `--cth-panel-border` is a pixel token and `ink[900]` is the office palette's
  // dark. Both are correct for the pixel mount and both are noise under the
  // modern shell, which draws its own border and background. They must be
  // gated by the SAME flag, or the modern frame ends up with two borders.
  assert.match(
    OFFICE_FLOOR,
    /boxShadow:\s*transparent\s*\?\s*undefined\s*:\s*'var\(--cth-panel-border\)'/,
    'the pixel panel border must not be drawn under the modern frame'
  );
  assert.match(
    OFFICE_FLOOR,
    /background:\s*transparent\s*\?\s*'transparent'\s*:\s*hex\(colors\.ink\[900\]\)/,
    'the host element must be transparent for the chrome surface and ink[900] ' +
    'for the pixel one'
  );
});
