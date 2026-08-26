'use strict';

/**
 * MD-141 — a document opened from Issues/PRs is rendered, and rendering it is
 * not a way to run someone else's HTML.
 *
 * Two halves, because they are two different claims:
 *
 *   - WHICH VIEW is a pure decision (`documentMode.ts`), pinned directly;
 *   - INERT MARKUP is a property of the react-markdown configuration the shared
 *     preview uses. It is pinned by actually rendering the hostile input, and
 *     then by a source guard on `MarkdownPreview.tsx` — the guarantee is "no
 *     HTML sink exists", which no single input can demonstrate. One `rehype-raw`
 *     import turns every case below back on.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const loadTs = require('./load-ts.cjs');

const { isMarkdownDoc, documentMode, rawToggleLabel } =
  loadTs('src/renderer/src/modern/issues/documentMode.ts');

// ─── Which view ──────────────────────────────────────────────────────────────

test('markdown is chosen by extension, not by content', () => {
  // The review report `prReviewReport` hands the dialog — the case the human hit.
  assert.equal(isMarkdownDoc('/h/hive/reviews/github-o-r-PR12-2026-08-26.md'), true);
  assert.equal(isMarkdownDoc('NOTES.MARKDOWN'), true);
  assert.equal(isMarkdownDoc('C:\\hive\\reviews\\report.md'), true);

  // A log or a diff keeps the preformatted view: monospace and hard line breaks
  // ARE its rendering, and reflowing it destroys the only structure it has.
  assert.equal(isMarkdownDoc('run.log'), false);
  assert.equal(isMarkdownDoc('change.diff'), false);
  // ".md" in the middle is not an extension — `report.md.bak` is a backup.
  assert.equal(isMarkdownDoc('report.md.bak'), false);
  assert.equal(isMarkdownDoc('md'), false);
  // A missing path must not throw its way into the dialog.
  assert.equal(isMarkdownDoc(undefined), false);
  assert.equal(isMarkdownDoc(''), false);
});

test('Raw shows the source of a markdown file, and never hides a plain one', () => {
  assert.equal(documentMode('report.md', false), 'markdown');
  // The verdict is parsed off the literal text; the source stays one click away.
  assert.equal(documentMode('report.md', true), 'plain');
  // Raw is meaningless on a file that has no rendered view — same either way.
  assert.equal(documentMode('run.log', false), 'plain');
  assert.equal(documentMode('run.log', true), 'plain');
});

test('the toggle names the view it takes you TO', () => {
  assert.equal(rawToggleLabel('markdown'), 'Raw');
  assert.equal(rawToggleLabel('plain'), 'Rendered');
});

// ─── Inert markup ────────────────────────────────────────────────────────────

/** The shared preview's exact configuration: react-markdown + remark-gfm, and
 *  nothing that opens an HTML sink. Rendered for real, not asserted about. */
async function render(source) {
  const ReactMarkdown = (await import('react-markdown')).default;
  const remarkGfm = (await import('remark-gfm')).default;
  return renderToStaticMarkup(
    React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, source)
  );
}

test('a PR description cannot smuggle live HTML through the preview', async () => {
  // A PR body is third-party input: anyone who can open a PR writes it.
  const html = await render('Looks good! <img src=x onerror="alert(1)">');
  // Shown as text — every angle bracket and quote escaped, so the handler is
  // characters in a paragraph and never an attribute on an element.
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html, /<img/);

  const script = await render('hi <script>alert(1)</script> there');
  assert.doesNotMatch(script, /<script/);
  assert.match(script, /&lt;script&gt;/);
});

test('a javascript: link is stripped to an inert href', async () => {
  const link = await render('[click me](javascript:alert(1))');
  assert.match(link, /click me/);
  assert.doesNotMatch(link, /javascript:/);

  const img = await render('![shot](javascript:alert(1))');
  assert.doesNotMatch(img, /javascript:/);
});

test('the preview keeps no HTML sink — the guard the render cases stand on', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', 'src/renderer/src/markdown/MarkdownPreview.tsx'),
    'utf8'
  );
  // rehype-raw is the one plugin that would parse the escaped text above back
  // into elements. dangerouslySetInnerHTML is the same hole by hand.
  // Matched on the IMPORT, not the name: the file's own header warns "never add
  // rehype-raw here", and a guard that forbids saying so would delete the
  // warning that keeps it out.
  assert.doesNotMatch(src, /from\s+['"]rehype-raw['"]/);
  assert.doesNotMatch(src, /rehypePlugins/);
  assert.doesNotMatch(src, /dangerouslySetInnerHTML/);
});

test('the review dialog renders its report through the shared document view', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '..', 'src/renderer/src/modern/issues/IssuesView.tsx'),
    'utf8'
  );
  // The regression this card fixes: a `.md` report drawn into a bare <pre>.
  assert.match(src, /<DocumentBody\s+path=\{preview\.record\.path\}/);
  assert.doesNotMatch(src, /<pre[^>]*>\{preview\.text\}/);
});
