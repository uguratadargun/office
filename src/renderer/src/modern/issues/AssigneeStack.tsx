import { Avatar } from 'radix-ui';

import { avatarStack, initialsFor, loginList, type Person } from '@shared/people';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { cn } from '../lib/cn';

/**
 * Who a row belongs to, as faces.
 *
 * Deliberately its own file and deliberately small: MD-127 (paging) is editing
 * `IssuesView`/`issuesData` on another branch at the same time, so the row's
 * new markup is one import there rather than a hunk in the middle of a list
 * someone else is rewriting.
 *
 * `Avatar.Fallback` is the point of using Radix here rather than a bare `<img>`:
 * it swaps to initials when the image fails, which is what makes "never a
 * broken image" true offline, behind a proxy, or if the CSP host is ever
 * dropped again. `delayMs={0}` because the fallback IS the resting state for
 * everyone whose avatar has not loaded yet — a blank tile that fills in later
 * reads as a bug on a list that repaints every poll.
 */
export function AssigneeStack({ people, size = 20, label = 'Assigned to' }: {
  people: Person[] | undefined;
  /** px. 20 on a row, 24 in the detail pane. */
  size?: number;
  /** Leading words of the tooltip — "Assigned to", "Approved by", … */
  label?: string;
}) {
  const { shown, overflow } = avatarStack(people);
  if (shown.length === 0) return null;

  const box = { width: size, height: size };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* -space-x-* overlaps the tiles; the ring is what keeps the one
            underneath readable, so it has to be the ROW's background, not a
            fixed colour — these sit on a hovered row too. */}
        <span className="flex shrink-0 items-center -space-x-1.5">
          {shown.map((p) => (
            <Avatar.Root
              key={p.login}
              className="relative flex shrink-0 overflow-hidden rounded-full ring-2 ring-background"
              style={box}
            >
              {p.avatarUrl && (
                <Avatar.Image
                  src={p.avatarUrl}
                  alt=""
                  className="aspect-square size-full object-cover"
                />
              )}
              <Avatar.Fallback
                delayMs={0}
                className="flex size-full items-center justify-center bg-muted font-medium text-muted-foreground"
                style={{ fontSize: Math.round(size * 0.4) }}
              >
                {initialsFor(p)}
              </Avatar.Fallback>
            </Avatar.Root>
          ))}
          {overflow > 0 && (
            <span
              className="relative flex shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground ring-2 ring-background"
              style={{ ...box, fontSize: Math.round(size * 0.4) }}
            >
              +{overflow}
            </span>
          )}
        </span>
      </TooltipTrigger>
      {/* The stack shows three; the tooltip is where "and who are the other
          four" gets answered, so it lists EVERY login, not the shown ones. */}
      <TooltipContent className="max-w-xs">{label} {loginList(people)}</TooltipContent>
    </Tooltip>
  );
}

/** The same faces at detail size, with full names — the inspector has the room
 *  a row does not. */
export function AssigneeList({ people, label }: { people: Person[] | undefined; label: string }) {
  const list = (people ?? []).filter((p) => p?.login);
  if (list.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <AssigneeStack people={list} size={24} label={label} />
      <span className={cn('truncate text-xs')}>
        {list.map((p) => p.name || p.login).join(', ')}
      </span>
    </div>
  );
}
