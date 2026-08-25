/**
 * Did that click on the floor land on an agent, or on the carpet?
 *
 * The Pixi scene owns its own hit testing and never tells the DOM about it: a
 * character's `onClick` calls `store.select(id)` and nothing else happens that
 * a React handler can see. `scene/office/**` is a hard boundary in both design
 * systems, so the modern floor answers the question from OUTSIDE — by watching
 * the store across the pointer gesture.
 *
 * The order is fixed and worth writing down, because it is what makes this
 * work at all. Pixi v8 registers `pointerdown` on the CANVAS (capture) and
 * `pointerup` on `window` (capture, EventSystem.mjs:324/327), and it
 * synthesises its click from the pointerup. So for a wrapper element around
 * the canvas:
 *
 *   pointerdown  → wrapper capture (us, first: ancestor) → canvas (Pixi)
 *   pointerup    → window capture (Pixi → select) → … → wrapper bubble (us)
 *
 * We therefore arm on the wrapper's pointerdown CAPTURE and read on its
 * pointerup BUBBLE, by which point any `select()` has already run.
 */

/** The slice of the store this file reasons about. */
export interface SelectionSnapshot {
  selectedId: string | null;
  ccTabRequest: unknown;
  agents: unknown;
}

/**
 * Was this store write a `select()` call?
 *
 * A change of `selectedId` is obvious. The subtle case is clicking the agent
 * that is ALREADY selected: `select` re-sets the same id and clears
 * `ccTabRequest`, so nothing observable moves — and treating that as "missed
 * the agent" would close the panel of the very agent you just clicked.
 *
 * The fallback therefore matches the SHAPE of a select: an agent is selected,
 * the command-center tab request is clear, and the roster did not move (roster
 * churn is what every unrelated write touches). It errs toward "yes": a false
 * yes leaves the inspector open, a false no would close it under the user.
 */
export function isSelectionTouch(prev: SelectionSnapshot, next: SelectionSnapshot): boolean {
  if (prev.selectedId !== next.selectedId) return true;
  return next.selectedId != null && next.ccTabRequest == null && prev.agents === next.agents;
}

/**
 * Should a completed pointer gesture on the floor clear the selection?
 *
 * Only when something WAS selected and the gesture demonstrably did not touch
 * the selection — i.e. the click landed on empty floor.
 */
export function shouldClearOnFloorClick(
  { before, after, touched }: { before: string | null; after: string | null; touched: boolean }
): boolean {
  if (before == null) return false;
  if (touched) return false;
  return after === before;
}

/** The agent the floor inspector should show, or null for "nothing selected".
 *  An id that no longer exists (the agent was killed while its panel was open)
 *  is nothing selected — never a blank panel with a dead header. */
export function inspectedAgent<T extends { id: string }>(agents: readonly T[], selectedId: string | null): T | null {
  if (!selectedId) return null;
  return agents.find((a) => a.id === selectedId) ?? null;
}
