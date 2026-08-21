'use strict';

/**
 * Release drops render REMOTE, AUTHOR-CONTROLLED HTML inside the app. The
 * renderer it would otherwise reach has `window.cth` bridged onto it — spawnPty,
 * writeFileText, updateConfig — so script execution there is arbitrary code
 * execution with the app's authority, available to anyone who can publish a
 * release.
 *
 * The controls are (1) `sandbox=""` on the iframe and (2) `default-src 'none'`
 * in the document's own CSP. This file pins the half that lives in shared code.
 * The sandbox attribute is asserted in ReleaseDrop.tsx and is deliberately NOT
 * the only thing standing between a release body and the user's machine.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { extractDropHtml, buildDropSrcDoc } = loadTs('src/shared/releaseDrop.ts');

const wrap = (inner) => `# Release\n\nblurb\n\n<!-- drop -->\n${inner}\n<!-- /drop -->\n\nfooter`;

test('extracts the authored block and leaves the surrounding markdown behind', () => {
  const html = extractDropHtml(wrap('<h1>Hello</h1>'));
  assert.equal(html, '<h1>Hello</h1>');
});

test('a release body with no drop block returns null (digest path stays default)', () => {
  assert.equal(extractDropHtml('## What\'s new\n\n- a bullet'), null);
  assert.equal(extractDropHtml(''), null);
  assert.equal(extractDropHtml(null), null);
  assert.equal(extractDropHtml(undefined), null);
});

test('an unbalanced marker pair returns null rather than half a document', () => {
  assert.equal(extractDropHtml('intro <!-- drop --> <h1>truncated'), null);
  assert.equal(extractDropHtml('intro <!-- /drop --> trailing'), null);
});

test('an empty drop block is treated as no drop', () => {
  assert.equal(extractDropHtml(wrap('   \n  ')), null);
});

test('the CSP denies scripts by omission, not by an allowlist that could widen', () => {
  const doc = buildDropSrcDoc('<h1>hi</h1>');
  // Match the CSP meta specifically — a bare /content="…"/ picks up the
  // viewport tag, which precedes it.
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(doc);
  assert.ok(csp, 'a CSP meta tag is present');
  const policy = csp[1];
  assert.match(policy, /default-src 'none'/);
  // The point of default-src 'none': an unlisted directive DENIES. If someone
  // ever adds an explicit script-src, this catches it.
  assert.doesNotMatch(policy, /script-src/);
  assert.doesNotMatch(policy, /connect-src/);
  assert.doesNotMatch(policy, /'unsafe-eval'/);
  // Media a launch page genuinely needs, https/data only — never http:.
  assert.match(policy, /img-src https: data: blob:/);
  assert.match(policy, /media-src https: data: blob:/);
  assert.doesNotMatch(policy, /img-src[^;]*\bhttp:/);
});

test('defence in depth: script tags and inline handlers are stripped from the body', () => {
  const doc = buildDropSrcDoc([
    '<h1>Launch</h1>',
    '<script>window.parent.cth.spawnPty({})</script>',
    '<script src="https://evil.example/x.js"></script>',
    '<img src="x.png" onerror="window.parent.cth.writeFileText(\'/tmp/x\',\'y\')">',
    '<div ONCLICK=steal()>click</div>'
  ].join('\n'));
  assert.doesNotMatch(doc, /<script/i);
  assert.doesNotMatch(doc, /onerror/i);
  assert.doesNotMatch(doc, /onclick/i);
  // …while the legitimate content around them survives intact.
  assert.match(doc, /<h1>Launch<\/h1>/);
  assert.match(doc, /<img src="x\.png"/);
});

test('authored markup that merely LOOKS active is preserved', () => {
  // A drop describing the update mechanism shouldn't have its prose mangled.
  const doc = buildDropSrcDoc('<p>We removed the old <code>onclick</code> handler.</p>');
  assert.match(doc, /<code>onclick<\/code>/);
});

test('the document is self-contained and declares its charset before content', () => {
  const doc = buildDropSrcDoc('<h1>é — 🎉</h1>');
  assert.match(doc, /^<!doctype html>/i);
  assert.ok(doc.indexOf('charset') < doc.indexOf('<body'), 'charset precedes the body');
  assert.match(doc, /🎉/);
});

/**
 * Theming. The drop is a sandboxed iframe with `default-src 'none'` — nothing in
 * it can read the app's stylesheet — so the frame's four base colours are handed
 * in and everything else in FRAME_BASE_CSS derives from them. Two things break
 * silently here: a baked rgba() literal that quietly stays light, and a palette
 * value interpolated into CSS without being checked.
 */
test('no palette leaves the document byte-identical to the un-themed one', () => {
  // Anything rendering a drop outside the app (docs, a preview) still gets the
  // designed light page with no argument.
  assert.equal(buildDropSrcDoc('<h1>hi</h1>'), buildDropSrcDoc('<h1>hi</h1>', undefined));
});

test('a palette re-points the frame and sets color-scheme inside the iframe', () => {
  const doc = buildDropSrcDoc('<h1>hi</h1>', {
    paper: '#0F1216', ink: '#E4E8ED', inkSoft: '#8B94A1', accent: '#7FA8CC', scheme: 'dark'
  });
  assert.match(doc, /:root\{color-scheme:dark;/);
  assert.match(doc, /--paper:#0F1216/);
  assert.match(doc, /--ink:#E4E8ED/);
  assert.match(doc, /--accent:#7FA8CC/);
  // The override must come AFTER the base stylesheet or the cascade drops it.
  assert.ok(doc.indexOf('--paper: #FBFAF8') < doc.indexOf('--paper:#0F1216'), 'override wins');
});

test('every colour in the frame derives from the four — no baked literals', () => {
  // The regression this pins: one `rgba(20,19,26,.16)` left in the stylesheet is a
  // light-mode wash that survives the palette and sits invisibly on a dark page.
  const doc = buildDropSrcDoc('<h1>hi</h1>');
  // Comments first: the stylesheet's own prose explains the rule in terms of the
  // literals it bans, and a doc line is not a declaration.
  const css = doc.slice(doc.indexOf('<style>'), doc.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
  const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
  const outside = css.replace(root, '');
  const literals = outside.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? [];
  assert.deepEqual(literals, [], `frame CSS still hardcodes: ${literals.join(', ')}`);
});

test('a palette value that is not plainly a colour never reaches the stylesheet', () => {
  // These come from getComputedStyle over our own tokens, not from a drop author —
  // but this is where a string becomes CSS inside the frame, and a value carrying
  // `}` would close the rule and author everything after it.
  const doc = buildDropSrcDoc('<h1>hi</h1>', {
    paper: '#fff}body{display:none',
    ink: 'url(https://evil.example/x)',
    inkSoft: 'rgb(139, 148, 161)',
    accent: '#7FA8CC',
    scheme: 'light'
  });
  assert.doesNotMatch(doc, /body\{display:none/);
  assert.doesNotMatch(doc, /evil\.example/);
  // …while the well-formed channels in the same call still land.
  assert.match(doc, /--ink-soft:rgb\(139, 148, 161\)/);
  assert.match(doc, /--accent:#7FA8CC/);
});
