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
 * The persisted key is `ui.mode`, nested rather than a flat `uiMode`, because
 * `ui` is the namespace anything else about the shell will land in — and a
 * settings panel written against `config.ui` should not have to move when the
 * second key arrives. Light/dark is NOT here: `design/theme.ts` already owns it
 * and both UIs read that one switch.
 *
 * Default is 'pixel': the modern UI is opt-in until the human flips it.
 */
export type UiMode = 'pixel' | 'modern';

export const DEFAULT_UI_MODE: UiMode = 'pixel';

/** The `ui` namespace in HarnessConfig. */
export interface UiConfig {
  mode?: UiMode;
}

/** Coerce whatever is on disk (or missing) to a mode. Anything unrecognised —
 *  a value from a newer build, a hand-edited config, `undefined` — falls back to
 *  the pixel UI, which is the one that is always complete. */
export function uiMode(value: unknown): UiMode {
  return value === 'modern' ? 'modern' : DEFAULT_UI_MODE;
}

/** Read the mode off a config object, tolerating a missing `ui`. */
export function uiModeOf(config: { ui?: UiConfig } | null | undefined): UiMode {
  return uiMode(config?.ui?.mode);
}
