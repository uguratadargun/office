import type { HiveTask } from './taskLedger';

export type Status = HiveTask['status'];

/** One board column, said once. `label` is the CANONICAL word for the status —
 *  the one that reads as prose ("3 in Done", "moved to Blocked"). A skin that
 *  wants to shout it may upper-case its own headers; it must not invent a
 *  different word. */
export interface TaskColumn {
  key: Status;
  label: string;
}

/**
 * The four board columns, in board order — and nothing about how they look.
 *
 * This table used to live in `modern/tasks/status.ts` with a Tailwind class on
 * every row, which made the whole module modern-only: the classic board could
 * not import the column ORDER or the prose labels without pulling `bg-foreground`
 * into a UI that has no Tailwind. So the bulk-delete summary — which is a
 * decision about the ledger, not about a skin — sat under `modern/` and the
 * classic board had to reach into it (MD-152's flag B).
 *
 * Order is meaning, not decoration: it is the order the board reads left to
 * right and the order "3 in Done and 1 in Todo" lists things in, so both UIs
 * take it from here rather than each writing the array out again.
 *
 * Each front-end keeps its own STYLING map keyed by `key`: modern's weight-based
 * accents in `modern/tasks/status.ts`, the classic board's `--cth-*` hues in
 * `TasksKanban.tsx`.
 */
export const TASK_COLUMNS: TaskColumn[] = [
  { key: 'todo',    label: 'Todo' },
  { key: 'doing',   label: 'Doing' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done',    label: 'Done' }
];

/** The column a status belongs to. An unknown status falls to the first column
 *  rather than returning undefined — a card with a typo'd status still has to
 *  render somewhere. */
export function taskColumn(status: Status): TaskColumn {
  return TASK_COLUMNS.find((c) => c.key === status) ?? TASK_COLUMNS[0];
}
