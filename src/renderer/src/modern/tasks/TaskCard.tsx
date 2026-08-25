import { useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Bell, MessageCircleQuestion, Trash2 } from 'lucide-react';
import type { HiveTask } from '@/store/taskLedger';
import { openQuestion } from '@/store/taskLedger';
import { nudge } from '@/store/taskActions';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { cn } from '../lib/cn';
import { column } from './status';

/**
 * One card. The whole card is the button that opens the detail — the pixel
 * board's affordance — and everything else on it stops propagation.
 *
 * Row actions are hidden until hover OR focus: `focus-within` is not a nicety
 * here, it is the only way a keyboard reaches archive and dismiss at all.
 */
export function TaskCard({ task, assigneeName, selected, onSelect, onOpen, onDismiss, onToggleArchive }: {
  task: HiveTask;
  assigneeName?: string;
  selected: boolean;
  onSelect: (shift: boolean) => void;
  onOpen: () => void;
  onDismiss: () => void;
  onToggleArchive: () => void;
}) {
  const col = column(task.status);
  const ask = openQuestion(task);
  const [nudged, setNudged] = useState<'idle' | 'sent' | 'failed'>('idle');
  // Two-press delete, not a confirm dialog: the pixel board arms and confirms in
  // place, and a modal over a board you are scanning costs more than it saves.
  const [armed, setArmed] = useState(false);
  const disarm = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (disarm.current) clearTimeout(disarm.current); }, []);

  function pressDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (armed) { onDismiss(); return; }
    setArmed(true);
    disarm.current = setTimeout(() => setArmed(false), 3000);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      // Only the card itself — Space inside the checkbox is the checkbox's, and
      // would otherwise both toggle the row and open the sheet.
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
      }}
      className={cn(
        'group relative flex cursor-pointer flex-col gap-2 rounded-lg border bg-card p-3 text-left transition-colors',
        'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'border-ring bg-selected hover:bg-selected-hover'
      )}
    >
      {/* Status bar: the column's meaning, repeated on the card so a card read
          out of its column (search, selection) still says where it sits. */}
      <span className={cn('absolute inset-y-2 left-0 w-0.5 rounded-full', col.bar)} aria-hidden />

      <div className="flex items-start gap-2 pl-2">
        <Checkbox
          checked={selected}
          aria-label={`Select ${task.title}`}
          className="mt-0.5"
          onClick={(e) => { e.stopPropagation(); onSelect((e as React.MouseEvent).shiftKey); }}
          onCheckedChange={() => { /* handled on click, which carries shiftKey */ }}
        />
        <span className="min-w-0 flex-1 text-sm leading-5">{task.title}</span>
        <PriorityDots level={task.priority} />
      </div>

      <div className="flex items-center gap-2 pl-2">
        {assigneeName
          ? <Badge variant="secondary" className="font-normal">{assigneeName}</Badge>
          : <span className="text-xs text-muted-foreground">Unassigned</span>}
        {ask && (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* Outline, not a filled destructive pill: an open ask is a call to
                  action, not a failure, and this badge repeats down the board. */}
              <Badge variant="outline" className="gap-1 border-destructive/40 font-normal text-destructive">
                <MessageCircleQuestion className="size-3" />
                Asks you
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom">Open question on this card — answer it in the detail or on Ask Me</TooltipContent>
          </Tooltip>
        )}

        <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {task.assignee && task.status !== 'done' && (
            <IconAction
              label={nudged === 'sent' ? `Asked ${assigneeName ?? 'them'} for a status`
                : nudged === 'failed' ? 'Could not reach them' : `Ask ${assigneeName ?? 'the owner'} where this stands`}
              onClick={(e) => {
                e.stopPropagation();
                void nudge(task).then((ok) => setNudged(ok ? 'sent' : 'failed')).catch(() => setNudged('failed'));
                setTimeout(() => setNudged('idle'), 3000);
              }}
            >
              <Bell className={cn(nudged === 'sent' && 'text-foreground')} />
            </IconAction>
          )}
          <IconAction
            label={task.archived ? 'Unarchive — back onto the board' : 'Archive — kept in the ledger, off the board'}
            onClick={(e) => { e.stopPropagation(); onToggleArchive(); }}
          >
            {task.archived ? <ArchiveRestore /> : <Archive />}
          </IconAction>
          <IconAction
            label={armed ? 'Press again to delete this card from the ledger' : 'Dismiss this card'}
            destructive={armed}
            onClick={pressDelete}
          >
            <Trash2 />
          </IconAction>
        </div>
      </div>
    </div>
  );
}

function IconAction({ label, children, onClick, destructive }: {
  label: string;
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  destructive?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={destructive ? 'destructive' : 'ghost'}
          size="icon-xs"
          aria-label={label}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Priority 1–5. Dots, not a number: the board is scanned, not read. */
export function PriorityDots({ level }: { level: number }) {
  const n = Math.max(1, Math.min(5, level));
  return (
    <span className="mt-1.5 flex shrink-0 gap-0.5" title={`Priority ${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cn('size-1 rounded-full', i <= n ? 'bg-foreground' : 'bg-border')} />
      ))}
    </span>
  );
}
