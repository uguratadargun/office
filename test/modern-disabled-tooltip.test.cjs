'use strict';

/**
 * MD-100 / MD-111 / MD-115 — the disabled-tooltip trap, which this floor has
 * now shipped twice.
 *
 * `<TooltipTrigger asChild><Button disabled>` is ALWAYS broken: `disabled`
 * sets `pointer-events: none`, so the trigger never receives a hover and the
 * tooltip whose entire job is to explain WHY the control is off can never
 * open. The state that most needs a reason is the one that silently loses it.
 * The fix is one element — wrap the control in a `<span>`, which becomes the
 * trigger and keeps live pointer events while the control inside stays
 * properly disabled.
 *
 * There is no pure surface to test here; the defect is a SHAPE in the source.
 * So this scans the modern UI's TSX for a `disabled` attribute inside the
 * element that sits directly under a `TooltipTrigger`, deliberately coarse:
 * it does not care what the condition is, only that a raw control — not a
 * wrapper — is the trigger.
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

/** The tag that TooltipTrigger's `asChild` hands the trigger role to: the first
 *  element opened after it. Returns its name plus its attribute text. */
function triggerChild(src, from) {
  const open = src.indexOf('<', from);
  if (open < 0) return null;
  const name = /^<\s*([A-Za-z][\w.]*)/.exec(src.slice(open, open + 40))?.[1];
  if (!name) return null;
  // Attribute text runs to the end of this tag, honouring `{...}` nesting so a
  // `disabled={a || b}` with braces inside is not cut short.
  let i = open + 1 + name.length, depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) break;
  }
  return { name, attrs: src.slice(open, i) };
}

test('no disabled control is used directly as a TooltipTrigger', () => {
  const offenders = [];
  for (const file of tsxFiles(MODERN)) {
    const src = fs.readFileSync(file, 'utf8');
    const re = /<TooltipTrigger\b[^>]*>/g;
    let m;
    while ((m = re.exec(src))) {
      const child = triggerChild(src, m.index + m[0].length);
      if (!child) continue;
      if (child.name === 'span' || child.name === 'div') continue; // wrapped — correct
      if (!/\bdisabled[=\s>]/.test(child.attrs)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      offenders.push(`${path.relative(MODERN, file)}:${line} — <${child.name} disabled …>`);
    }
  }
  assert.deepEqual(
    offenders, [],
    'a disabled control cannot be its own TooltipTrigger — `disabled` sets\n' +
    'pointer-events:none, so the tooltip explaining why it is off never opens.\n' +
    'Wrap the control in a <span> and let the span be the trigger:\n  ' +
    offenders.join('\n  ')
  );
});

test('the rule is written down where a designer will meet it', () => {
  const design = fs.readFileSync(path.join(__dirname, '..', 'docs/DESIGN-MODERN.md'), 'utf8');
  assert.match(design, /never put `disabled` on a\n`TooltipTrigger`/);
  assert.match(design, /Wrap the disabled control in a `<span>`/);
});
