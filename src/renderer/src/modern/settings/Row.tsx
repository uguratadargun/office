import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/**
 * The row grammar for the whole panel: a label (and optional help line) on the
 * left, one control right-aligned. Every setting is this shape, which is what
 * makes 50 of them scan as a list rather than 50 individually-designed forms.
 *
 * The `id` comes from `settings/index.ts` and is what a search result scrolls
 * to — so a row that is not in the index cannot be found, and the coverage test
 * is what stops that happening by accident.
 */
export function Row({
  id,
  label,
  help,
  htmlFor,
  children,
  stacked = false
}: {
  id: string;
  label: ReactNode;
  help?: ReactNode;
  /** id of the control, when the label should focus it. */
  htmlFor?: string;
  children?: ReactNode;
  /** Put the control under the label — for anything wider than a field. */
  stacked?: boolean;
}) {
  return (
    <div
      id={id}
      className={cn(
        'flex scroll-mt-4 gap-4 py-2',
        stacked ? 'flex-col items-stretch' : 'items-center justify-between'
      )}
    >
      <div className="min-w-0 flex-1">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-sm font-medium">{label}</label>
        ) : (
          <div className="text-sm font-medium">{label}</div>
        )}
        {help && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{help}</p>}
      </div>
      {children && <div className={cn(stacked ? 'w-full' : 'shrink-0')}>{children}</div>}
    </div>
  );
}

/** A titled block of rows. Sentence case, not the pixel UI's caps —
 *  DESIGN-MODERN.md rules out uppercase headings. */
export function Group({
  title,
  description,
  children
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col">
      <h3 className="text-sm font-medium">{title}</h3>
      {description && (
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      )}
      <div className="mt-2 flex flex-col divide-y divide-border/60">{children}</div>
    </section>
  );
}

/** Page-level heading for a section pane. */
export function SectionHeader({ title, blurb }: { title: string; blurb?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {blurb && <p className="text-sm text-muted-foreground">{blurb}</p>}
    </div>
  );
}

/** Feedback after a write, e.g. "saved". Deliberately quiet: an ordinary save
 *  is not news, and a toast for every blur would be. */
export function SaveHint({ show, children = 'Saved' }: { show: boolean; children?: ReactNode }) {
  return (
    <span
      aria-live="polite"
      className={cn(
        'text-xs text-muted-foreground transition-opacity duration-150',
        show ? 'opacity-100' : 'opacity-0'
      )}
    >
      {show ? children : ' '}
    </span>
  );
}
