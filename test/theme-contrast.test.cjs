// Theme contrast — the check behind the claims in tokens.css.
//
// The palette is not eyeballed: every colour token is asserted against WCAG for
// the surfaces it can actually appear on, in BOTH themes. This is what caught
// the old dark theme, where `ink-300` (the 1px border on every control in the
// app) measured 1.7:1 and the UI read as flat grey washes.
//
// It also asserts the two palettes define the SAME token list — the structural
// promise of "two first-class palettes, not a theme plus patches". A token
// present in :root but missing from the dark block would silently fall through
// and paint a light value on a dark ground.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'src', 'design', 'tokens.css'),
  'utf8'
);

/** Pull one `:root...{ }` block's `--token: value;` pairs. Comments are stripped
 *  first so a hex inside prose can't be read as a declaration. */
function block(selector) {
  const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const i = body.indexOf(selector);
  assert.ok(i >= 0, `missing block: ${selector}`);
  const open = body.indexOf('{', i);
  const close = body.indexOf('\n}', open);
  const out = {};
  for (const m of body.slice(open, close).matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    out['--' + m[1]] = m[2].trim();
  }
  return out;
}

const LIGHT = block(':root {');
const DARK = block(":root[data-cth-theme='dark']");

/** The one token with its own, lower floor — see the ghost test below. */
const GHOST = '--cth-status-ghost';
/** Non-colour tokens live once in :root and are shared on purpose. */
const SHARED = /^--cth-(space|font|text|lh)-/;

function rgb(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
}

/** WCAG relative luminance. */
function lum(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

for (const [name, T] of [['light', LIGHT], ['dark', DARK]]) {
  // Every surface a foreground token can land on. A colour must clear its floor
  // on ALL of them, not on the one screenshot it was picked against.
  const SURFACES = ['--cth-cream-50', '--cth-cream-100', '--cth-cream-200', '--cth-paper-100', '--cth-paper-200']
    .map((k) => T[k]);

  const worst = (fg) => Math.min(...SURFACES.map((bg) => ratio(fg, bg)));

  function floor(token, min, label) {
    const got = worst(T[token]);
    assert.ok(
      got >= min,
      `${name}: ${token} (${T[token]}) is ${got.toFixed(2)}:1 at worst — ${label} needs >= ${min}:1`
    );
  }

  test(`${name}: body text clears 4.5:1 on every surface`, () => {
    for (const t of ['--cth-ink-900', '--cth-ink-700', '--cth-ink-500']) floor(t, 4.5, 'body text');
  });

  test(`${name}: borders are perceivable (>= 3:1)`, () => {
    // ink-300 is the app's entire structural language: a 1px inset on every
    // button, input, panel, card and chip. Below 3:1 those edges are not there.
    floor('--cth-ink-300', 3.0, 'structural borders');
  });

  test(`${name}: semantic text clears 4.5:1`, () => {
    for (const t of ['--cth-danger', '--cth-warn', '--cth-success', '--cth-info']) floor(t, 4.5, 'semantic text');
  });

  test(`${name}: status marks are findable (>= 3:1)`, () => {
    for (const t of Object.keys(T).filter((k) => k.startsWith('--cth-status-') && k !== GHOST)) {
      floor(t, 3.0, 'status mark');
    }
  });

  test(`${name}: the ghost mark recedes without disappearing`, () => {
    // The ONE deliberate exemption from the 3:1 mark floor, called out rather
    // than quietly skipped. `status-ghost` means "pane closed, fading out" — a
    // mark held to 3:1 is not fading, it is just another grey dot. It still has
    // to be visible at all, so it carries a 2:1 floor of its own.
    floor(GHOST, 2.0, 'the fading-out mark');
    assert.ok(worst(T[GHOST]) < 3.0, `${name}: ${GHOST} is loud enough to be a normal status mark — use the 3:1 rule`);
  });

  test(`${name}: syntax colours clear 4.5:1 on the editor surface`, () => {
    const paper = T['--cth-paper-100'];
    for (const t of Object.keys(T).filter((k) => k.startsWith('--cth-code-'))) {
      const got = ratio(T[t], paper);
      assert.ok(got >= 4.5, `${name}: ${t} (${T[t]}) is ${got.toFixed(2)}:1 on paper-100 — syntax needs >= 4.5:1`);
    }
  });

  test(`${name}: on-accent text is readable on every agent accent`, () => {
    for (const hue of ['coral', 'mint', 'sky', 'lemon', 'lilac', 'peach']) {
      const got = ratio(T['--cth-on-accent'], T[`--cth-${hue}`]);
      assert.ok(got >= 4.5, `${name}: on-accent on --cth-${hue} (${T[`--cth-${hue}`]}) is ${got.toFixed(2)}:1`);
    }
  });

  test(`${name}: ink-900 is readable on every accent -light chip fill`, () => {
    for (const hue of ['coral', 'mint', 'sky', 'lemon', 'lilac', 'peach']) {
      const got = ratio(T['--cth-ink-900'], T[`--cth-${hue}-light`]);
      assert.ok(got >= 4.5, `${name}: ink-900 on --cth-${hue}-light is ${got.toFixed(2)}:1`);
    }
  });

  test(`${name}: semantic text is readable on its own -light fill`, () => {
    for (const s of ['danger', 'warn', 'success', 'info']) {
      const got = ratio(T[`--cth-${s}`], T[`--cth-${s}-light`]);
      assert.ok(got >= 4.5, `${name}: --cth-${s} on --cth-${s}-light is ${got.toFixed(2)}:1`);
    }
  });

  test(`${name}: filled controls keep their lettering readable`, () => {
    // PixelButton's primary and destructive variants fill with these and letter
    // with `paper-100` — the content surface, which is the far end of the ramp
    // from the fills in both themes. If a fill drifts toward the middle, this
    // is what catches it.
    for (const fill of ['--cth-accent', '--cth-accent-hover', '--cth-danger', '--cth-danger-hover']) {
      const got = ratio(T['--cth-paper-100'], T[fill]);
      assert.ok(got >= 4.5, `${name}: paper-100 lettering on ${fill} (${T[fill]}) is ${got.toFixed(2)}:1`);
    }
  });

  test(`${name}: the surface ramp is monotonic`, () => {
    // 50 is always the app ground and 300 the most contrasted fill, so the ramp
    // runs one direction in light and the other in dark — but it never zig-zags,
    // or "one step up" stops meaning "one step of elevation".
    const ls = ['50', '100', '200', '300'].map((w) => lum(T[`--cth-cream-${w}`]));
    const down = ls.every((v, i) => i === 0 || v < ls[i - 1]);
    const up = ls.every((v, i) => i === 0 || v > ls[i - 1]);
    assert.ok(down || up, `${name}: cream ramp is not monotonic: ${ls.map((v) => v.toFixed(3)).join(' ')}`);
  });
}

test('both palettes define the same tokens', () => {
  const lightColors = Object.keys(LIGHT).filter((k) => !SHARED.test(k));
  const missing = lightColors.filter((k) => !(k in DARK));
  const extra = Object.keys(DARK).filter((k) => !(k in LIGHT));
  assert.deepStrictEqual(missing, [], 'tokens in :root with no dark counterpart');
  assert.deepStrictEqual(extra, [], 'tokens in the dark block with no light counterpart');
});

test('dark is actually dark and light is actually light', () => {
  assert.ok(lum(LIGHT['--cth-cream-50']) > 0.8, 'light ground should be near-white');
  assert.ok(lum(DARK['--cth-cream-50']) < 0.05, 'dark ground should be near-black');
  // Not #000 and not #FFF: maximum contrast is not the same as comfortable.
  assert.notStrictEqual(DARK['--cth-cream-50'].toUpperCase(), '#000000');
  assert.notStrictEqual(DARK['--cth-ink-900'].toUpperCase(), '#FFFFFF');
});

test('color-scheme is set per theme so native controls follow', () => {
  // Without this the OS paints form controls with the wrong UA scheme — most
  // visibly an invisible text caret and light scrollbars in the dark theme.
  assert.match(CSS, /:root\s*\{[\s\S]*?color-scheme:\s*light/);
  assert.match(CSS, /data-cth-theme='dark'\]\s*\{[\s\S]*?color-scheme:\s*dark/);
});

// ── Terminal ANSI ───────────────────────────────────────────────────────────
// xterm cannot read CSS custom properties, so its 16 ANSI slots are literals in
// PtyTerminalView. They are the most-read text in the app and get the same
// treatment as the tokens: every slot must clear 4.5:1 as foreground on its own
// theme's terminal ground.
const PTY = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'src', 'components', 'PtyTerminalView.tsx'),
  'utf8'
);

function ansi(constName) {
  const i = PTY.indexOf(`const ${constName} = {`);
  assert.ok(i >= 0, `missing ANSI set: ${constName}`);
  const slice = PTY.slice(i, PTY.indexOf('\n};', i));
  const out = {};
  for (const m of slice.matchAll(/(\w+):\s*'(#[0-9A-Fa-f]{6})'/g)) out[m[1]] = m[2];
  assert.strictEqual(Object.keys(out).length, 16, `${constName} should have 16 ANSI slots`);
  return out;
}

for (const [name, set, ground] of [
  ['light', ansi('LIGHT_ANSI'), LIGHT['--cth-paper-100']],
  ['dark', ansi('DARK_ANSI'), DARK['--cth-paper-100']]
]) {
  test(`${name}: every ANSI colour is readable on the terminal ground`, () => {
    for (const [slot, hex] of Object.entries(set)) {
      // `black` on a dark terminal is a BACKGROUND slot, not something read as
      // text — the only exemption, and it only applies to the dark set.
      if (name === 'dark' && slot === 'black') continue;
      const got = ratio(hex, ground);
      assert.ok(got >= 4.5, `${name} ANSI ${slot} (${hex}) is ${got.toFixed(2)}:1 on ${ground}`);
    }
  });

  test(`${name}: ANSI brights are actually brighter`, () => {
    // "bright" means lighter, in both themes — that is what programs printing
    // bright-red expect to see. On the light ground that moves a slot TOWARD
    // the background, which is why the floor above is checked first and these
    // are only a step, not a pastel.
    for (const slot of ['Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan']) {
      const normal = lum(set[slot.toLowerCase()]);
      const bright = lum(set['bright' + slot]);
      assert.ok(bright > normal, `${name}: bright${slot} is not lighter than ${slot.toLowerCase()}`);
    }
  });
}
