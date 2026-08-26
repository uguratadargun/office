'use strict';

/**
 * MD-131 — "the icon buttons at the top of the agent view show no tooltip".
 *
 * They all HAD tooltips. Every one of them mounted, with the right text, at
 * `translate(0, -200%)` — off the top of the window, in every theme, on every
 * screen in the modern UI.
 *
 * The cause is a version seam, not a missing prop. shadcn generates
 * `components/ui/*` in REACT 19 style, where a function component receives
 * `ref` as an ordinary prop. This app runs REACT 18, where React strips `ref`
 * out before the function is called. So `function Button(props)` silently
 * swallowed it.
 *
 * That is invisible until a Radix primitive needs the DOM node.
 * `<TooltipTrigger asChild><Button/></TooltipTrigger>` makes the Button the
 * popper's ANCHOR, and Radix reads the anchor through exactly that ref: null
 * ref -> null anchor -> floating-ui never gets a reference element ->
 * `isPositioned` never flips -> the content keeps the un-positioned
 * placeholder transform forever. Nothing throws. Nothing warns in production.
 * The markup is perfect and the tooltip is off-screen.
 *
 * So the invariant this pins is NOT "the control has a tooltip" — the floor
 * already got that right and shipped it broken anyway. It is:
 *
 *   any component of ours handed the `asChild` role must forward its ref.
 *
 * Second test keeps the older rule (MD-100) honest: an icon-only button has no
 * visible name, so it needs a tooltip to have a name at all.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MODERN = path.join(__dirname, '..', 'src/renderer/src/modern');

function tsxFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsxFiles(p));
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const FILES = tsxFiles(MODERN).map((file) => ({
  file,
  rel: path.relative(MODERN, file),
  src: fs.readFileSync(file, 'utf8')
}));

const lineOf = (src, i) => src.slice(0, i).split('\n').length;

/** The tag `asChild` hands the role to: the first element opened after the
 *  trigger's `>`, skipping a JSX comment if one sits in between. */
function asChildTarget(src, from) {
  let i = from;
  for (;;) {
    const open = src.indexOf('<', i);
    if (open < 0) return null;
    // `{/* … */}` between the trigger and its child is the house style.
    const comment = src.indexOf('{/*', i);
    if (comment >= 0 && comment < open) {
      const end = src.indexOf('*/}', comment);
      if (end < 0) return null;
      i = end + 3;
      continue;
    }
    return { name: /^<\s*([A-Za-z][\w.]*)/.exec(src.slice(open, open + 60))?.[1] || null, at: open };
  }
}

/** Resolve a module specifier the way the app's bundler does, but only far
 *  enough to answer "is this one of ours?". Anything that is not a file under
 *  modern/ — lucide, radix — already forwards its ref and is not our problem. */
function resolveImport(fromRel, spec) {
  let base;
  if (spec.startsWith('.')) base = path.resolve(path.dirname(path.join(MODERN, fromRel)), spec);
  else if (spec.startsWith('@/modern/')) base = path.join(MODERN, spec.slice('@/modern/'.length));
  else return null;
  for (const cand of [base + '.tsx', base + '.ts', path.join(base, 'index.tsx')]) {
    if (fs.existsSync(cand)) return path.relative(MODERN, cand);
  }
  return null;
}

/** name -> the modern/ file it comes from, for one file: its imports first,
 *  then itself. Reading the IMPORT rather than scanning the whole tree for the
 *  name matters — `AppShell.tsx` has a local `const Badge = item.badge`, and a
 *  tree-wide index happily blames that for `components/ui/badge.tsx`. */
function originsFor({ rel, src }) {
  const map = new Map();
  const re = /import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const target = resolveImport(rel, m[3]);
    if (!target) continue;
    const names = [];
    if (m[1]) names.push(m[1]);
    for (const part of (m[2] || '').split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop();
      if (n && /^[A-Za-z_$]/.test(n)) names.push(n);
    }
    for (const n of names) if (!map.has(n)) map.set(n, target);
  }
  return map;
}

const SRC_BY_REL = new Map(FILES.map((f) => [f.rel, f.src]));

/** How `name` is defined in `rel`: is `React.forwardRef` the first thing that
 *  opens it? Returns null when the name is not defined there at all. */
function definitionIn(rel, name) {
  const src = SRC_BY_REL.get(rel);
  if (!src) return null;
  const re = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:const\\s+${name}\\s*(?::[^=]+)?=|function\\s+${name}\\s*[<(])`);
  const m = re.exec(src);
  if (!m) return null;
  return {
    rel,
    line: lineOf(src, m.index),
    forwardsRef: /forwardRef\s*[<(]/.test(src.slice(m.index, m.index + 200))
  };
}

test('every component we hand `asChild` to forwards its ref', () => {
  const offenders = [];
  const checked = new Set();

  for (const entry of FILES) {
    const { rel, src } = entry;
    const origins = originsFor(entry);
    const re = /<([A-Za-z][\w.]*)\b[^>]*\basChild\b[^>]*>/g;
    let m;
    while ((m = re.exec(src))) {
      const child = asChildTarget(src, m.index + m[0].length);
      if (!child?.name) continue;
      if (child.name.includes('.')) continue;               // Radix primitive
      if (!/^[A-Z]/.test(child.name)) continue;             // host element
      const def = definitionIn(origins.get(child.name) ?? rel, child.name);
      if (!def) continue;                                   // not ours (lucide, …)
      checked.add(child.name);
      if (def.forwardsRef) continue;
      offenders.push(
        `${rel}:${lineOf(src, child.at)} — <${m[1]} asChild><${child.name}>, ` +
        `but ${def.rel}:${def.line} defines ${child.name} without forwardRef`
      );
    }
  }

  // A guard on the guard: if the scan silently matched nothing, this test is
  // green for the wrong reason. Button is the one every trigger in the tree
  // reaches for, so its absence means the scanner broke, not that the tree did.
  assert.ok(checked.has('Button'), 'the asChild scan found no <Button> — the scanner is broken, not the tree');

  assert.deepEqual(
    offenders, [],
    'React 18 does not pass `ref` to a plain function component, so an `asChild`\n' +
    'child that is not wrapped in React.forwardRef gives Radix a NULL anchor and\n' +
    'its popper stays at translate(0, -200%) — mounted, correct, off-screen.\n' +
    'Wrap the component in React.forwardRef and put the ref on its root element:\n  ' +
    offenders.join('\n  ')
  );
});

test('an icon-only button carries a tooltip, so it has a name at all', () => {
  const offenders = [];
  for (const { rel, src } of FILES) {
    if (rel === 'components/IconButton.tsx') continue;      // this IS the tooltip
    const re = /<Button\b[\s\S]{0,400}?>/g;
    let m;
    while ((m = re.exec(src))) {
      if (!/size=(["'])icon(-\w+)?\1/.test(m[0])) continue;
      // Coarse on purpose (same shape as modern-disabled-tooltip): a
      // TooltipTrigger opened in the 12 lines above and not yet closed.
      const before = src.slice(0, m.index).split('\n').slice(-12).join('\n');
      const opened = before.lastIndexOf('<TooltipTrigger');
      if (opened >= 0 && before.indexOf('</TooltipTrigger>', opened) < 0) continue;
      offenders.push(`${rel}:${lineOf(src, m.index)}`);
    }
  }
  assert.deepEqual(
    offenders, [],
    'an icon-only Button shows no text, so without a tooltip it has no name on\n' +
    'screen. Use <IconButton label="…"> — one prop that is both the tooltip and\n' +
    'the aria-label — or wrap this Button in a Tooltip:\n  ' + offenders.join('\n  ')
  );
});

test('the rule is written down where the next person will meet it', () => {
  const design = fs.readFileSync(path.join(__dirname, '..', 'docs/DESIGN-MODERN.md'), 'utf8');
  assert.match(design, /React\.forwardRef/);
  assert.match(design, /translate\(0, -200%\)/);
});
