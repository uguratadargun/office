import type { HiveTask } from '@/store/taskLedger';

export type Status = HiveTask['status'];

/**
 * The four board columns, in board order.
 *
 * The pixel board paints each column a hue (`--cth-sky/lemon/coral/mint`).
 * DESIGN-MODERN.md allows exactly three status colours — `--destructive`,
 * `--muted-foreground` and "a single green" — and there is no green token, so
 * the accent here carries MEANING through weight instead of hue: doing is the
 * only column at full foreground contrast, blocked is the only one that is red,
 * and todo/done recede. No new token, no sixth accent.
 */
export const COLUMNS: { key: Status; label: string; dot: string; bar: string }[] = [
  { key: 'todo',    label: 'Todo',    dot: 'bg-muted-foreground/50', bar: 'bg-muted-foreground/50' },
  { key: 'doing',   label: 'Doing',   dot: 'bg-foreground',          bar: 'bg-foreground' },
  { key: 'blocked', label: 'Blocked', dot: 'bg-destructive',         bar: 'bg-destructive' },
  { key: 'done',    label: 'Done',    dot: 'bg-muted-foreground/25', bar: 'bg-muted-foreground/25' }
];

export function column(status: Status): (typeof COLUMNS)[number] {
  return COLUMNS.find((c) => c.key === status) ?? COLUMNS[0];
}
