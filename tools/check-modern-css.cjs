#!/usr/bin/env node
/**
 * BUILD GATE: the modern UI's stylesheet must actually contain its utilities,
 * and the page must actually load it.
 *
 * This exists because of a failure mode with no symptom until the app is on
 * screen: Tailwind emits its `@layer theme` and `@layer base` (preflight) from
 * the CSS file alone, but the `utilities` layer only fills if the class scan
 * found the source files. A build where that scan came up empty produces a
 * perfectly valid, perfectly large stylesheet — tens of kilobytes of preflight
 * and custom properties — with not one utility class in it. Nothing errors.
 * `npm run build` is green. The packaged app then renders the whole modern UI
 * as unstyled block elements, which reads as "the new UI is broken", not as
 * "the CSS pipeline regressed".
 *
 * Two things are checked, because either alone can be true while the app is
 * still unstyled:
 *   1. the Tailwind stylesheet CONTAINS the utilities the shell needs, and
 *   2. the entry bundle REFERENCES that stylesheet, so the page loads it —
 *      the modern root is a dynamic import, and its CSS is emitted as a
 *      separate asset that only gets injected if Vite wired it up.
 *
 * Wired into `npm run build`, so a broken CSS pipeline fails the build instead
 * of shipping. Run directly: `npm run check:modern-css`.
 */
const fs = require('node:fs');
const path = require('node:path');

const ASSETS = path.join(__dirname, '..', 'out', 'renderer', 'assets');
const INDEX = path.join(__dirname, '..', 'out', 'renderer', 'index.html');

/** Utilities the shell itself renders with. If the scan silently produced
 *  nothing, every one of these is missing and the UI is a stack of blocks. */
const REQUIRED = ['.flex', '.grid', '.hidden', '.absolute', '.w-full'];

function fail(msg) {
  console.error(`\n[check-modern-css] ${msg}\n`);
  process.exit(1);
}

if (!fs.existsSync(ASSETS)) fail(`no build output at ${ASSETS} — run \`npm run build\` first.`);

const cssFiles = fs.readdirSync(ASSETS).filter((f) => f.endsWith('.css'));
const tailwind = cssFiles
  .map((f) => ({ file: f, text: fs.readFileSync(path.join(ASSETS, f), 'utf8') }))
  .filter((c) => c.text.includes('tailwindcss v') || c.text.includes('@layer theme'));

if (tailwind.length === 0) {
  fail(
    'no Tailwind stylesheet in the build output.\n' +
    `  Looked in ${ASSETS} at: ${cssFiles.join(', ') || '(no .css files at all)'}\n` +
    '  The modern UI imports modern.css from modern/App.tsx — check @tailwindcss/vite is still\n' +
    '  in electron.vite.config.ts under `renderer.plugins`.'
  );
}
if (tailwind.length > 1) {
  // Two Tailwind sheets means the CSS entered the graph from two chunks, and
  // only one of them gets injected — the exact shape of a UI that renders with
  // preflight applied and no utilities at all.
  fail(
    `${tailwind.length} Tailwind stylesheets were emitted (${tailwind.map((c) => c.file).join(', ')}).\n` +
    '  Exactly one chunk may import modern.css, or the page loads the wrong one.'
  );
}

const { file, text } = tailwind[0];

// `.flex{` when minified, `.flex {` when not — match the selector, not the
// formatting, so this survives a change to the build's css minifier.
const missing = REQUIRED.filter((sel) => !new RegExp(`\\${sel}\\s*\\{`).test(text));
if (missing.length > 0) {
  fail(
    `${file} has no utility classes (missing ${missing.join(', ')}).\n` +
    `  It is ${text.length.toLocaleString()} chars of theme + preflight with an EMPTY utilities layer,\n` +
    '  which means the Tailwind source scan found no files. Check the `@source` directive in\n' +
    '  src/renderer/src/modern/modern.css resolves to the modern tree from the Vite root.'
  );
}

if (!fs.existsSync(INDEX)) fail(`no ${INDEX}`);
const html = fs.readFileSync(INDEX, 'utf8');
const entry = html.match(/src="\.?\/?(assets\/[^"]+\.js)"/)?.[1];
if (!entry) fail('could not find the entry script in out/renderer/index.html');

const entryJs = fs.readFileSync(path.join(__dirname, '..', 'out', 'renderer', entry), 'utf8');
const referenced = html.includes(file) || entryJs.includes(file);
if (!referenced) {
  fail(
    `${file} is emitted but never referenced by ${entry} or index.html, so the page never loads it.\n` +
    '  The modern root is a dynamic import; its CSS is a separate asset that Vite has to wire up.'
  );
}

console.log(
  `[check-modern-css] ok — ${file} (${text.length.toLocaleString()} chars) has ${REQUIRED.length}/${REQUIRED.length} ` +
  `sampled utilities and is referenced by ${entry}.`
);
