/**
 * Which of the two UIs the renderer boots (MD-84; default flipped in MD-124).
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
 * Default is 'modern' (MD-124): the modern UI is what a fresh install boots,
 * and the classic pixel office is one Settings -> Interface choice away. Only
 * the MISSING/unrecognised case moved — a config that already says
 * `ui.mode: 'pixel'` keeps pixel, which is why `uiMode` below matches BOTH
 * known values before falling back. `DEFAULTS` in `src/main/config.ts`
 * deliberately carries no `ui` key: the default lives here, once.
 */
export type UiMode = 'pixel' | 'modern';

export const DEFAULT_UI_MODE: UiMode = 'modern';

/** The `ui` namespace in HarnessConfig. */
export interface UiConfig {
  mode?: UiMode;
}

/** Coerce whatever is on disk (or missing) to a mode. Both known values are
 *  honoured exactly as written — an explicit choice always wins over the
 *  default. Anything else — a value from a newer build, a hand-edited config,
 *  `undefined` — falls back to `DEFAULT_UI_MODE`. */
export function uiMode(value: unknown): UiMode {
  if (value === 'modern' || value === 'pixel') return value;
  return DEFAULT_UI_MODE;
}

/** Read the mode off a config object, tolerating a missing `ui`. */
export function uiModeOf(config: { ui?: UiConfig } | null | undefined): UiMode {
  return uiMode(config?.ui?.mode);
}
