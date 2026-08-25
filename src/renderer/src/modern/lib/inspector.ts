/**
 * Geometry for the shell's right-hand inspector — kept out of the component so
 * the clamp is testable without a DOM.
 *
 * The inspector holds an AgentDetail: a terminal, a message composer and a row
 * of controls. That is why the floor is 360px and not the 180px the nav rail
 * gets — an xterm narrower than that wraps every claude line and the pane stops
 * being readable, which is the whole point of opening it.
 */
export const INSPECTOR_MIN = 360;
export const INSPECTOR_MAX = 900;
export const INSPECTOR_DEFAULT = 460;
export const INSPECTOR_LS_KEY = 'modern.inspectorWidth';

/**
 * Clamp a dragged width into range, and never let the inspector eat the view it
 * is inspecting: on a narrow window the ceiling is half the viewport, so the
 * floor scene always keeps at least as much room as the panel beside it.
 */
export function clampInspectorWidth(px: number, viewportWidth?: number): number {
  const ceiling = viewportWidth && viewportWidth > 0
    ? Math.max(INSPECTOR_MIN, Math.min(INSPECTOR_MAX, Math.floor(viewportWidth / 2)))
    : INSPECTOR_MAX;
  if (!Number.isFinite(px)) return Math.min(INSPECTOR_DEFAULT, ceiling);
  return Math.min(ceiling, Math.max(INSPECTOR_MIN, Math.round(px)));
}

/** A stored width is only honoured if it is still a width we would allow. */
export function readInspectorWidth(raw: string | null): number {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n < INSPECTOR_MIN || n > INSPECTOR_MAX) return INSPECTOR_DEFAULT;
  return Math.round(n);
}
