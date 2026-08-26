/**
 * MD-141 — how a document opened from Issues/PRs is displayed.
 *
 * The one decision here is EXTENSION, not content. Sniffing ("does it start
 * with a `#`?") gets a plain-text log with a comment header wrong in one
 * direction and a markdown file that opens with a paragraph wrong in the other;
 * the file name is what the writer actually declared.
 *
 * `raw` is the reader's override and always wins. The review report is parsed
 * by `parseVerdict` off its literal text, so "what you read is what was parsed"
 * has to stay one click away — rendering it is the default, not the only view.
 */

/** Extensions that mean "this is markdown". Deliberately short: `.mdx` is a
 *  different language (it embeds JSX) and `remark-gfm` alone does not render it,
 *  so calling it markdown would show a component tag as literal text. */
const MARKDOWN_EXT = /\.(md|markdown)$/i;

/** Does this path name a markdown file? Absolute or relative, either separator. */
export function isMarkdownDoc(path: string | undefined | null): boolean {
  return MARKDOWN_EXT.test((path ?? '').trim());
}

export type DocumentMode = 'markdown' | 'plain';

/**
 * What to draw. Markdown only when the file says so AND the reader has not
 * asked for the source — anything else keeps the preformatted view, which is
 * the correct rendering for a log, a diff or a `.txt`.
 */
export function documentMode(path: string | undefined | null, raw: boolean): DocumentMode {
  return !raw && isMarkdownDoc(path) ? 'markdown' : 'plain';
}

/** Label for the toggle: it names the view you GET by pressing it, never the
 *  one you are already looking at. A button reading "Rendered" while rendered
 *  is a state readout wearing a button's clothes. */
export function rawToggleLabel(mode: DocumentMode): string {
  return mode === 'markdown' ? 'Raw' : 'Rendered';
}
