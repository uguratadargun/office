/**
 * MD-144 — one row of either list, and the hairline under it.
 *
 * Issues had the divider and PRs did not, which read as two lists built by two
 * people rather than two segments of one screen. The separation now lives here,
 * once, so the next row type added to this area cannot quietly leave it out.
 *
 * ONLY the separation lives here. What a row IS — a column of title, labels and
 * PR chips for an issue; a single line behind a verdict rail for a PR — stays
 * with the list that owns it and arrives as `className`. A "row component" that
 * also owned the layout would have to grow a variant per segment, which is the
 * shared component that ends up harder to read than the duplication it replaced.
 */
import type { ElementType, ReactNode } from 'react';
import { cn } from '../lib/cn';

/**
 * The hairline and the space above it. `border-b` takes its colour from the
 * `*` rule in modern.css (`var(--border)`), so this is the theme's divider in
 * both themes and never `currentColor`.
 *
 * `last:border-b-0` fires only when a row really is the final child. In both
 * lists something always follows — the paging sentinel while more is coming,
 * "All N loaded." once it is not — so today it never fires, and it is kept for
 * the host that renders rows with nothing after them, where a divider hanging
 * off the bottom of the list is exactly the artefact it prevents.
 */
const ROW_DIVIDER = 'border-b pb-3 last:border-b-0';

export function ListRow({ as, className, children }: {
  /** `article` for an issue, which is a self-contained thing; the default
   *  `div` for a PR row, which is a line in a table of them. */
  as?: ElementType;
  /** The row's own layout — never its separation. */
  className?: string;
  children: ReactNode;
}) {
  const Tag = as ?? 'div';
  return <Tag className={cn(ROW_DIVIDER, className)}>{children}</Tag>;
}
