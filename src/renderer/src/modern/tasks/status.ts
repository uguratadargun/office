import { TASK_COLUMNS, taskColumn, type Status, type TaskColumn } from '@/store/taskColumns';

export type { Status };

/**
 * How the modern board PAINTS each column. The columns themselves — their
 * order and their words — are `@/store/taskColumns`, shared with the classic
 * board (MD-153).
 *
 * The pixel board paints each column a hue (`--cth-sky/lemon/coral/mint`).
 * DESIGN-MODERN.md allows exactly three status colours — `--destructive`,
 * `--muted-foreground` and "a single green" — and there is no green token, so
 * the accent here carries MEANING through weight instead of hue: doing is the
 * only column at full foreground contrast, blocked is the only one that is red,
 * and todo/done recede. No new token, no sixth accent.
 *
 * Keyed by column key rather than written as a parallel array: a styling table
 * that repeats the order is a second place for the order to be wrong.
 */
const ACCENT: Record<Status, { dot: string; bar: string }> = {
  todo:    { dot: 'bg-muted-foreground/50', bar: 'bg-muted-foreground/50' },
  doing:   { dot: 'bg-foreground',          bar: 'bg-foreground' },
  blocked: { dot: 'bg-destructive',         bar: 'bg-destructive' },
  done:    { dot: 'bg-muted-foreground/25', bar: 'bg-muted-foreground/25' }
};

export interface ModernColumn extends TaskColumn {
  dot: string;
  bar: string;
}

/** The four board columns, in board order, with this UI's accents on them. */
export const COLUMNS: ModernColumn[] = TASK_COLUMNS.map((c) => ({ ...c, ...ACCENT[c.key] }));

export function column(status: Status): ModernColumn {
  const c = taskColumn(status);
  return { ...c, ...ACCENT[c.key] };
}
