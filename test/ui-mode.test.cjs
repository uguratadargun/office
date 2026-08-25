// The two-front-end boot switch (MD-84).
//
// The whole point of `uiMode` is that ONE of the two stylesheets is in the
// document. Two things can break that quietly, and neither shows up as a type
// error, so they are asserted here:
//   1. an unrecognised value on disk falling through to the modern UI, which is
//      the incomplete one;
//   2. either entry module importing the other UI's CSS — which would put
//      Tailwind's preflight on top of ~100 inline-styled pixel screens, or the
//      --cth-* tokens under the modern one.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

// Mirror of shared/uiMode.ts — the module is TS, and the rule is three lines.
function uiMode(value) {
  return value === 'modern' ? 'modern' : 'pixel';
}

test('anything that is not exactly "modern" boots the pixel UI', () => {
  assert.strictEqual(uiMode('modern'), 'modern');
  for (const v of [undefined, null, '', 'pixel', 'Modern', 'MODERN', 'classic', 0, 1, true, {}]) {
    assert.strictEqual(uiMode(v), 'pixel', `${JSON.stringify(v)} must fall back to pixel`);
  }
});

test('shared/uiMode.ts agrees with that rule and defaults to pixel', () => {
  const src = read('shared', 'uiMode.ts');
  assert.match(src, /DEFAULT_UI_MODE: UiMode = 'pixel'/);
  assert.match(src, /value === 'modern' \? 'modern' : DEFAULT_UI_MODE/);
});

test('each entry module imports its OWN stylesheet and only its own', () => {
  const pixel = read('renderer', 'src', 'pixelEntry.ts');
  assert.match(pixel, /import '\.\/design\/global\.css'/);
  assert.ok(
    !/^import .*modern/m.test(pixel),
    'the pixel entry must not import anything from modern/'
  );

  const modern = read('renderer', 'src', 'modern', 'App.tsx');
  assert.match(modern, /import '\.\/modern\.css'/);
  assert.ok(
    !/design\/(global|tokens)\.css/.test(modern),
    'the modern root must not import the pixel stylesheet'
  );
});

test('main.tsx imports neither UI statically — the branch has to stay dynamic', () => {
  const main = read('renderer', 'src', 'main.tsx');
  assert.match(main, /await import\('\.\/modern\/App'\)/);
  assert.match(main, /await import\('\.\/pixelEntry'\)/);
  // A static import of either one defeats the split: both bundles (and both
  // stylesheets) would load whatever the config says.
  assert.ok(!/^import .*from '\.\/App'/m.test(main), 'main.tsx must not statically import ./App');
  assert.ok(!/^import .*\.css'/m.test(main), 'main.tsx must not import a stylesheet');
});

test('the modern tokens are their own palette, not aliases of --cth-*', () => {
  const tokens = read('renderer', 'src', 'modern', 'tokens.css');
  const decls = tokens.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/var\(--cth-/.test(decls), 'modern tokens must not point at pixel tokens');

  // Same rule as the pixel palette: a variable in one theme and not the other
  // falls through and paints a light value on a dark ground.
  const block = (sel) => {
    const i = decls.indexOf(sel);
    assert.ok(i >= 0, `missing block: ${sel}`);
    const open = decls.indexOf('{', i);
    const body = decls.slice(open, decls.indexOf('\n}', open));
    return new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  };
  const light = block(':root {');
  const dark = block(":root[data-cth-theme='dark']");
  assert.deepStrictEqual([...light].filter((k) => !dark.has(k)), [], 'defined in light, missing in dark');
  assert.deepStrictEqual([...dark].filter((k) => !light.has(k)), [], 'defined in dark, missing in light');
});
