/**
 * Read a `--cth-*` token's value for the CURRENTLY active theme.
 *
 * Most of the renderer styles itself with `var(--cth-…)` and never needs this.
 * xterm and Monaco do: both take literal colour strings and cannot resolve CSS
 * custom properties, so their palettes used to be hand-copied hexes with a
 * `// = --cth-paper-100` comment next to them — and drifted the moment the
 * tokens moved, leaving a terminal sitting a visible step apart from the panel
 * holding it. Reading the resolved value keeps one source of truth.
 *
 * `design/theme.ts` stamps `data-cth-theme` on <html> synchronously, and
 * `getComputedStyle` forces a style recalc, so a read taken right after a theme
 * switch already sees the new palette.
 */
export function readToken(name: string, fallback = ''): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    // No DOM (tests, SSR). The caller's fallback is the honest answer.
    return fallback;
  }
}
