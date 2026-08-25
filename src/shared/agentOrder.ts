/**
 * The order agents are listed in, everywhere they are listed.
 *
 * Sleeping agents sink to the bottom: they are still on the team, but they are
 * not what you are looking for when you scan a roster. Awake agents keep the
 * order they already had — the roster is the user's own drag-reorder (and, for
 * god, "first on the dock"), so this must NOT re-rank anything else.
 *
 * ── Why the split is awake/sleeping and not working/idle/sleeping ───────────
 * `status` is written by the pty parser and flips thinking↔working↔idle every
 * few seconds. Grouping on it would make rows hop over each other continuously
 * while you are trying to click one. `sleeping` changes on a timescale of
 * minutes, so it is the only agent state that can carry a group boundary
 * without the list becoming unclickable. If a working-first tier is ever wanted
 * anyway, `agentListGroup` is the one function to change.
 */

/** The only field ordering depends on. Store `Agent`, roster rows and the
 *  registry record all satisfy it. */
export interface ListedAgent {
  sleeping?: boolean;
}

/** Lower sorts earlier. 0 = awake (working or idle), 1 = hibernated. */
export function agentListGroup(a: ListedAgent): number {
  return a.sleeping ? 1 : 0;
}

/** Comparator: group only. Returning 0 within a group is what makes the sort
 *  preserve the existing order — never add a tiebreak here. */
export function compareAgentsForList(a: ListedAgent, b: ListedAgent): number {
  return agentListGroup(a) - agentListGroup(b);
}

/**
 * A NEW array, awake first. Copies before sorting: the store's `agents` array
 * is shared state and `Array#sort` mutates in place — sorting it directly would
 * reorder the store from inside a render and fight the user's drag-reorder.
 * `sort` is stable by spec (ES2019+), so same-group agents keep their order.
 */
export function sortAgentsForList<T extends ListedAgent>(list: readonly T[]): T[] {
  return [...list].sort(compareAgentsForList);
}
