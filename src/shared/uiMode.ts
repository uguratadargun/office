/**
 * Which of the two UIs the renderer boots (MD-84).
 *
 * There are two full front-ends in this repo: the original pixel UI
 * (`src/renderer/src/App.tsx`, `design/tokens.css`, DESIGN.md) and the modern
 * one (`src/renderer/src/modern/`, DESIGN-MODERN.md). They share the store, the
 * IPC surface and the theme switch, and NOTHING else — not a token, not a
 * stylesheet. `main.tsx` dynamically imports exactly one of them, so each UI's
 * CSS (Tailwind's preflight included) only enters the document when that UI is
 * the one running.
 *
 * Default is 'pixel': the modern UI is opt-in until the human flips it.
 */
export type UiMode = 'pixel' | 'modern';

export const DEFAULT_UI_MODE: UiMode = 'pixel';

/** Coerce whatever is on disk (or missing) to a mode. Anything unrecognised —
 *  a value from a newer build, a hand-edited config, `undefined` — falls back to
 *  the pixel UI, which is the one that is always complete. */
export function uiMode(value: unknown): UiMode {
  return value === 'modern' ? 'modern' : DEFAULT_UI_MODE;
}
