// Modern UI typography + contrast — the check behind MD-101.
//
// The modern palette (modern/tokens.css) had no test: theme-contrast.test.cjs
// guards the pixel UI's `--cth-*` tokens only. Measured in the built app before
// this file existed, 48–74% of the characters on Agents / Settings were
// `--muted-foreground`, 52–69% were 12px `text-xs`, and the light muted token
// sat at 4.83:1 on white and 4.10:1 on a selected sidebar row — legal on the
// screenshot it was picked against, illegible where it actually landed.
//
// Three things are asserted, because each regresses silently:
//   1. every text token clears its floor on EVERY surface it can appear on, in
//      both themes (the same-list rule from theme-contrast.test.cjs included);
//   2. the type scale in modern.css has no step below 13px — `text-xs` is what
//      most of the UI is set in, so Tailwind's 12px default is the bug;
//   3. body has no `-webkit-font-smoothing: antialiased` — on macOS Chromium it
//      lays down 10–38% less ink for the same glyphs (alpha-sum, MD-101).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MODERN = path.join(__dirname, '..', 'src', 'renderer', 'src', 'modern');
const TOKENS = fs.readFileSync(path.join(MODERN, 'tokens.css'), 'utf8');
const SHEET = fs.readFileSync(path.join(MODERN, 'modern.css'), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function block(css, selector) {
  const body = strip(css);
  const i = body.indexOf(selector);
  assert.ok(i >= 0, `missing block: ${selector}`);
  const open = body.indexOf('{', i);
  const close = body.indexOf('\n}', open);
  const out = {};
  for (const m of body.slice(open, close).matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out['--' + m[1]] = m[2].trim();
  return out;
}

const LIGHT = block(TOKENS, ':root {');
const DARK = block(TOKENS, ":root[data-cth-theme='dark']");

function rgb(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
}
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

/** Every surface a text token can land on: the app ground, a card, a quiet
 *  fill (hover / selected row / muted box), the nav and a selected nav row. */
const SURFACES = ['--background', '--card', '--popover', '--muted', '--secondary', '--accent', '--sidebar', '--sidebar-accent'];

for (const [name, T] of [['light', LIGHT], ['dark', DARK]]) {
  const worst = (fg) => Math.min(...SURFACES.map((s) => ratio(T[fg], T[s])));
  const floor = (token, min, label) => {
    const got = worst(token);
    assert.ok(got >= min, `${name}: ${token} (${T[token]}) is ${got.toFixed(2)}:1 at worst — ${label} needs >= ${min}:1`);
  };

  test(`${name}: primary text is comfortably readable (>= 7:1) on every surface`, () => {
    floor('--foreground', 7, 'primary text');
    floor('--sidebar-foreground', 7, 'nav text');
  });

  test(`${name}: secondary text clears a real floor (>= 5.3:1) on every surface`, () => {
    // 4.5 is the legal minimum for body text; muted is most of the UI's text,
    // so it is held higher. The failing value this replaced was 4.10:1.
    floor('--muted-foreground', 5.3, 'secondary text');
  });

  test(`${name}: secondary text is still secondary`, () => {
    // Lifting muted must not collapse the hierarchy: primary stays clearly
    // stronger than muted on the app ground.
    const fg = ratio(T['--foreground'], T['--background']);
    const mf = ratio(T['--muted-foreground'], T['--background']);
    assert.ok(fg / mf >= 1.8, `${name}: foreground ${fg.toFixed(1)}:1 vs muted ${mf.toFixed(1)}:1 — too close to read as two levels`);
  });

  test(`${name}: destructive is readable as text on every ground it sits on`, () => {
    // `text-destructive` lands on the ground, on cards and on quiet fills. Dark
    // #ef4444 also has to carry near-white lettering as a fill, which pulls the
    // other way, so the dark token is only held on grounds, not on fills.
    const grounds = name === 'light' ? SURFACES : ['--background', '--card', '--popover', '--sidebar'];
    const got = Math.min(...grounds.map((s) => ratio(T['--destructive'], T[s])));
    assert.ok(got >= 4.5, `${name}: --destructive (${T['--destructive']}) is ${got.toFixed(2)}:1 at worst`);
  });

  test(`${name}: filled controls keep their lettering readable`, () => {
    for (const [fg, bg] of [
      ['--primary-foreground', '--primary'],
      ['--sidebar-primary-foreground', '--sidebar-primary'],
      ['--destructive-foreground', '--destructive']
    ]) {
      const got = ratio(T[fg], T[bg]);
      // 3:1 is the large-text/UI-component floor; the destructive fill is a
      // 14px 500 label on a saturated red and cannot reach 4.5 in dark
      // without the red going dull.
      assert.ok(got >= 3, `${name}: ${fg} on ${bg} is ${got.toFixed(2)}:1`);
    }
  });
}

test('both palettes define the same tokens', () => {
  const missing = Object.keys(LIGHT).filter((k) => !(k in DARK));
  const extra = Object.keys(DARK).filter((k) => !(k in LIGHT));
  assert.deepStrictEqual(missing, [], 'tokens in :root with no dark counterpart');
  assert.deepStrictEqual(extra, [], 'tokens in the dark block with no light counterpart');
});

test('color-scheme is set per theme so native controls follow', () => {
  assert.match(TOKENS, /:root\s*\{[\s\S]*?color-scheme:\s*light/);
  assert.match(TOKENS, /data-cth-theme='dark'\]\s*\{[\s\S]*?color-scheme:\s*dark/);
});

// ── Type scale ───────────────────────────────────────────────────────────────

/** The `@theme { --text-*: … }` block that overrides Tailwind's 12/14/16. */
function typeScale() {
  const body = strip(SHEET);
  const out = {};
  for (const m of body.matchAll(/--text-(xs|sm|base|lg|xl)(--line-height)?\s*:\s*([\d.]+)px/g)) {
    out[m[1] + (m[2] || '')] = parseFloat(m[3]);
  }
  return out;
}

test('the type scale is overridden in modern.css, not left at Tailwind defaults', () => {
  const s = typeScale();
  for (const step of ['xs', 'sm', 'base', 'xl']) {
    assert.ok(step in s, `--text-${step} is not set in modern.css — utilities fall back to Tailwind's rem scale`);
    assert.ok(`${step}--line-height` in s, `--text-${step}--line-height is not set`);
  }
});

test('no step of the scale is below 13px', () => {
  // `text-xs` is 52–69% of the characters on a typical screen. 12px was the
  // single biggest reason the UI read as "too small".
  const s = typeScale();
  assert.ok(s.xs >= 13, `--text-xs is ${s.xs}px`);
  assert.ok(s.sm >= 14, `--text-sm is ${s.sm}px`);
  assert.ok(s.xs < s.sm && s.sm < s.base && s.base < s.xl, 'the scale must stay monotonic');
});

test('body is set at the UI default and it matches the `sm` step', () => {
  const m = strip(SHEET).match(/\n\s*body\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(m, 'no body rule in modern.css');
  const size = m[1].match(/font-size:\s*([\d.]+)px/);
  assert.ok(size && parseFloat(size[1]) >= 14, `body font-size is ${size && size[1]}px, expected >= 14`);
  assert.strictEqual(parseFloat(size[1]), typeScale().sm, 'body and text-sm should be one step, not two');
});

test('body text is not thinned with -webkit-font-smoothing: antialiased', () => {
  // Measured in the built app (MD-101), same string, same size and weight:
  //   light 1x  Inter 400 @13  antialiased 1290  auto 1429  (-10%)
  //   dark  1x  Inter 400 @13  antialiased 1282  auto 1773  (-28%)
  //   dark  2x  Inter 400 @13  antialiased 1189  auto 1549  (-23%)
  // and zero subpixel fringe either way. There is nothing to buy with it.
  assert.doesNotMatch(strip(SHEET), /-webkit-font-smoothing\s*:\s*antialiased/);
});

// ── Components use the scale, not literals ───────────────────────────────────
// Before MD-101 the tree carried 88 `text-[12px]`, 81 `text-[13px]` and 6
// `text-[14px]` — the "13px UI default" mostly existed as a literal, so moving
// the scale moved nothing. A size that IS a step of the scale is written as
// the step; the scale is then the only place a size lives.
function tsxFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tsxFiles(p, out);
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

test('no component hard-codes a font size that is a step of the scale', () => {
  const hits = [];
  for (const f of tsxFiles(MODERN)) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/text-\[(1[2-9]|2\d)px\]/g)) hits.push(`${path.relative(MODERN, f)}: ${m[0]}`);
  }
  assert.deepStrictEqual(hits, [], 'use text-xs / text-sm / text-base / text-lg / text-xl instead');
});

test('no sub-scale literal survives — the scale is the only place a size lives', () => {
  // Twenty-one of these remained after MD-101: h-4/h-5 badges and status
  // footers where 13px was assumed not to fit. MD-100 mapped every one onto
  // `text-xs` and grew the two boxes that genuinely were too short (a 16px
  // badge became 20px). Nothing needed a sub-scale step, so there is none —
  // this now asserts zero rather than ratcheting a number down.
  const hits = [];
  for (const f of tsxFiles(MODERN)) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/text-\[(\d+)px\]/g)) hits.push(`${path.relative(MODERN, f)}: ${m[0]}`);
  }
  assert.deepStrictEqual(hits, [], 'use text-xs / text-sm / text-base / text-lg / text-xl');
});

// ── Status hues live in tokens.css, never at a call site (MD-100) ────────────

test('success and warning are tokens, in both palettes, like every other colour', () => {
  for (const t of ['--success', '--success-foreground', '--warning', '--warning-foreground']) {
    assert.ok(t in LIGHT, `${t} missing from :root`);
    assert.ok(t in DARK, `${t} missing from the dark block`);
  }
});

test('a filled status chip keeps its lettering readable', () => {
  for (const [name, T] of [['light', LIGHT], ['dark', DARK]]) {
    for (const [fg, bg] of [['--success-foreground', '--success'], ['--warning-foreground', '--warning']]) {
      const got = ratio(T[fg], T[bg]);
      assert.ok(got >= 4.5, `${name}: ${fg} on ${bg} is ${got.toFixed(2)}:1`);
    }
  }
});

test('a status dot is distinguishable from the ground it sits on', () => {
  // These are 8px dots and 2px rails, so the bar is the UI-component floor of
  // 3:1 — but against `--background` AND `--card`, since rows sit on both.
  for (const [name, T] of [['light', LIGHT], ['dark', DARK]]) {
    for (const tok of ['--success', '--warning']) {
      for (const ground of ['--background', '--card', '--muted']) {
        const got = ratio(T[tok], T[ground]);
        assert.ok(got >= 3, `${name}: ${tok} on ${ground} is ${got.toFixed(2)}:1`);
      }
    }
  }
});

test('no modern view hard-codes a status hue', () => {
  // The tell is a `dark:` colour utility: if a value needs a dark twin at the
  // call site, it belongs in tokens.css, which answers for both once.
  // components/ui/* is vendored shadcn and is not authored here.
  const hits = [];
  for (const f of tsxFiles(MODERN)) {
    if (f.includes(`${path.sep}components${path.sep}ui${path.sep}`)) continue;
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\b(?:bg|text|border|border-l)-(?:emerald|green|amber|yellow|lime|teal|orange|rose|sky|blue|violet|indigo)-\d{3}\b/g)) {
      hits.push(`${path.relative(MODERN, f)}: ${m[0]}`);
    }
  }
  assert.deepStrictEqual(hits, [], 'use bg-success / bg-warning / bg-destructive, defined in tokens.css');
});

// ── State ladder (MD-108) ────────────────────────────────────────────────────
// Measured in the built app before this: light hover sat 2–3 L* off rest and
// selected 1.8 L* off hover; dark hover on a card went DARKER (bg-accent/50
// over --card); the focus ring (ring-ring/50, 3px) was 1.5:1 on white. Nothing
// read as hovered, selected or focused. The ladder is lightness only — the
// system has no hue to spend on state — and is held on every ground a row can
// sit on, because the sidebar, the app and a card are three different greys.
function Lstar(hex) {
  const Y = lum(hex);
  const f = Y > 0.008856 ? Math.cbrt(Y) : 7.787 * Y + 16 / 116;
  return 116 * f - 16;
}

for (const [name, T] of [['light', LIGHT], ['dark', DARK]]) {
  // Light steps go darker, dark steps go lighter: a signed delta in the
  // direction of the ladder, so a step that reverses fails too.
  const dir = name === 'light' ? -1 : 1;
  const step = (from, to) => dir * (Lstar(T[to]) - Lstar(T[from]));
  const GROUNDS = ['--background', '--card', '--popover', '--sidebar'];

  test(`${name}: the ladder tokens exist and --accent is the hover step`, () => {
    for (const t of ['--accent', '--selected', '--selected-hover', '--selected-foreground']) assert.ok(t in T, `${name}: missing ${t}`);
    assert.strictEqual(T['--sidebar-accent'], T['--accent'], 'nav hover must be the same step as content hover, not a third grey');
  });

  test(`${name}: rest → hover is >= ${name === 'light' ? 4 : 5} L* on every ground`, () => {
    const min = name === 'light' ? 4 : 5;
    for (const g of GROUNDS) {
      const got = step(g, '--accent');
      assert.ok(got >= min, `${name}: hover (${T['--accent']}) is only ${got.toFixed(1)} L* off ${g} (${T[g]})`);
    }
  });

  test(`${name}: hover → selected is >= 6 L*`, () => {
    const got = step('--accent', '--selected');
    assert.ok(got >= 6, `${name}: selected (${T['--selected']}) is only ${got.toFixed(1)} L* past hover (${T['--accent']})`);
  });

  test(`${name}: selected → selected+hover is >= 3 L* in the same direction`, () => {
    const got = step('--selected', '--selected-hover');
    assert.ok(got >= 3, `${name}: selected+hover (${T['--selected-hover']}) is ${got.toFixed(1)} L* off selected — must move further, never back toward hover`);
  });

  test(`${name}: the focus ring clears 3:1 on every surface it is drawn over`, () => {
    for (const s of [...GROUNDS, '--muted', '--accent', '--selected']) {
      const got = ratio(T['--ring'], T[s]);
      assert.ok(got >= 3, `${name}: --ring (${T['--ring']}) is ${got.toFixed(2)}:1 on ${s} (${T[s]})`);
    }
    assert.strictEqual(T['--sidebar-ring'], T['--ring'], 'one ring, not two');
  });

  test(`${name}: text stays readable on the selected fills`, () => {
    assert.ok(ratio(T['--foreground'], T['--selected']) >= 7, `${name}: foreground on --selected`);
    assert.ok(ratio(T['--selected-foreground'], T['--selected']) >= 7, `${name}: selected-foreground on --selected`);
    assert.ok(ratio(T['--foreground'], T['--selected-hover']) >= 7, `${name}: foreground on --selected-hover`);
    assert.ok(ratio(T['--sidebar-foreground'], T['--selected']) >= 7, `${name}: nav text on a selected row`);
    // A selected row still carries its subtitle in muted; hovering it is momentary.
    assert.ok(ratio(T['--muted-foreground'], T['--selected']) >= 5.3, `${name}: muted on --selected is ${ratio(T['--muted-foreground'], T['--selected']).toFixed(2)}:1`);
    assert.ok(ratio(T['--muted-foreground'], T['--selected-hover']) >= 4.5, `${name}: muted on --selected-hover is ${ratio(T['--muted-foreground'], T['--selected-hover']).toFixed(2)}:1`);
    if (name === 'light') assert.ok(ratio(T['--destructive'], T['--selected']) >= 4.5, `light: a dismiss icon on a selected card`);
  });
}

test('the ladder is applied at full strength — no halved hover fills, no 50% focus rings', () => {
  // `hover:bg-accent/50` is how the hover step was halved before MD-108, and
  // `ring-ring/50 ring-[3px]` is how the ring went to 1.5:1. A state fill is
  // the token, not the token through an opacity.
  const hits = [];
  for (const f of tsxFiles(MODERN)) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/hover:bg-(?:accent|sidebar-accent|muted|secondary|selected|input)\/\d+|focus-visible:ring-ring\/\d+|focus-visible:ring-\[\d+px\]/g)) {
      hits.push(`${path.relative(MODERN, f)}: ${m[0]}`);
    }
  }
  assert.deepStrictEqual(hits, [], 'use hover:bg-accent / bg-selected / ring-2 ring-ring');
});

test('a selected state uses --selected, not the hover token', () => {
  // The rows and cards that can be selected: their selected class must be the
  // selected step. `bg-accent` as a selected fill is what made selected and
  // hover the same grey.
  const checks = [
    ['AppShell.tsx', /isActive\s*\?\s*'[^']*bg-selected/],
    ['agents/AgentList.tsx', /selected \? '[^']*bg-selected/],
    ['tasks/TaskCard.tsx', /selected && '[^']*bg-selected/],
    ['ide/FileTree.tsx', /activeRel === n\.rel && '[^']*bg-selected/],
    ['settings/SettingsView.tsx', /bg-selected font-medium/]
  ];
  for (const [file, re] of checks) {
    assert.match(fs.readFileSync(path.join(MODERN, file), 'utf8'), re, `${file}: selected state should be bg-selected`);
  }
});
