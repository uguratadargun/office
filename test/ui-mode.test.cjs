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
const uiModeOf = (config) => uiMode(config && config.ui && config.ui.mode);

test('anything that is not exactly "modern" boots the pixel UI', () => {
  assert.strictEqual(uiMode('modern'), 'modern');
  for (const v of [undefined, null, '', 'pixel', 'Modern', 'MODERN', 'classic', 0, 1, true, {}]) {
    assert.strictEqual(uiMode(v), 'pixel', `${JSON.stringify(v)} must fall back to pixel`);
  }
});

test('the persisted key is ui.mode, and a missing `ui` is not a crash', () => {
  // The shape matters across agents: MD-87's Settings panel reads `config.ui`.
  assert.strictEqual(uiModeOf({ ui: { mode: 'modern' } }), 'modern');
  for (const c of [undefined, null, {}, { ui: undefined }, { ui: {} }, { uiMode: 'modern' }]) {
    assert.strictEqual(uiModeOf(c), 'pixel', `${JSON.stringify(c)} must fall back to pixel`);
  }
  // A flat `uiMode` is the shape this started as — it must NOT still be written.
  for (const f of [
    ['renderer', 'src', 'components', 'SettingsModal.tsx'],
    ['renderer', 'src', 'modern', 'views', 'SettingsView.tsx'],
    ['renderer', 'src', 'modern', 'App.tsx']
  ]) {
    assert.ok(!/updateConfig\(\{\s*uiMode:/.test(read(...f)), `${f.join('/')} still writes a flat uiMode`);
  }
});

test('shared/uiMode.ts agrees with that rule and defaults to pixel', () => {
  const src = read('shared', 'uiMode.ts');
  assert.match(src, /DEFAULT_UI_MODE: UiMode = 'pixel'/);
  assert.match(src, /value === 'modern' \? 'modern' : DEFAULT_UI_MODE/);
});

test('the shell owns the single Toaster and the single overlay host', () => {
  // Two sonner mounts double every toast; two overlay hosts race on z-index.
  // Both are shell-owned so an area never has to (and never gets to) mount one.
  const shell = read('renderer', 'src', 'modern', 'AppShell.tsx');
  assert.match(shell, /<Toaster\b/);
  assert.match(shell, /<OverlayHost\s*\/>/);
  const ui = path.join(SRC, 'renderer', 'src', 'modern', 'components', 'ui');
  const views = path.join(SRC, 'renderer', 'src', 'modern', 'views');
  for (const dir of [ui, views]) {
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      if (f === 'sonner.tsx') continue;
      assert.ok(!/<Toaster\b/.test(src), `${f} mounts a second Toaster`);
      assert.ok(!/<OverlayHost\b/.test(src), `${f} mounts a second overlay host`);
    }
  }
});

test('the shell reads one navigation store, and nothing keeps a private copy', () => {
  // A cross-area link (Integrations -> Settings) has to be able to move the
  // shell from outside its tree. If AppShell ever goes back to `useState` for
  // the active section, `navigate()` becomes a silent no-op — nothing throws,
  // the click just does nothing.
  const shell = read('renderer', 'src', 'modern', 'AppShell.tsx');
  assert.match(shell, /useActiveNavId\(\)/);
  assert.ok(!/useState\([^)]*DEFAULT_NAV_ID/.test(shell), 'AppShell must not hold the active section in local state');
  assert.match(read('renderer', 'src', 'modern', 'navigation.ts'), /export function navigate/);
});

test('the notifications mount is app-wide, not Monitor-only', () => {
  // Update and agent-finished notices have to reach the user whatever is on
  // screen; mounted inside MonitorView they fire only while Monitor is open.
  const app = read('renderer', 'src', 'modern', 'App.tsx');
  assert.match(app, /<MonitorNotifications\s*\/>/);
});

test('shadcn ui/* carries no next-themes dependency', () => {
  // shadcn's sonner ships reading next-themes; this app has one theme store
  // (design/theme.ts). A stray import would be a second source of truth AND an
  // unresolvable module — the package is deliberately not installed.
  const dir = path.join(SRC, 'renderer', 'src', 'modern', 'components', 'ui');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/from ["']next-themes["']/.test(src), `${f} imports next-themes`);
  }
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
