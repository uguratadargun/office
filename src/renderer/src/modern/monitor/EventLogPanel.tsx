import { useCallback, useMemo, useState } from 'react';
import { ArrowRight, ChevronRight, Pause } from 'lucide-react';
import { describeEvent, eventAgents, type EventRow } from '@shared/eventLog';
import { relSince } from '@shared/relTime';
import { useStore } from '@/store/store';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { cn } from '../lib/cn';
import { useEventLog } from './useEventLog';

/** Every option value must be a non-empty string — Radix reserves '' for "no
 *  selection", so the "all" rows carry a sentinel instead. */
const ALL = '__all__';

/**
 * The hive event log: one filterable stream, searched in the main process
 * against the whole file rather than the page the renderer is holding.
 *
 * The live tail pauses while a filter is on or the reader has paged back, and
 * says so — a log that re-sorts itself under someone reading history is a log
 * they stop trusting.
 */
export function EventLogPanel() {
  const log = useEventLog();
  const agents = useStore((s) => s.agents);
  const select = useStore((s) => s.select);
  const requestCommandCenterTab = useStore((s) => s.requestCommandCenterTab);
  const [open, setOpen] = useState<number | null>(null);

  const known = useMemo(() => new Set(agents.map((a) => a.id)), [agents]);
  const nameOf = useCallback(
    (id: string) => agents.find((a) => a.id === id)?.name ?? id,
    [agents]
  );

  /** Click-through: an entry naming a live agent selects it, a board entry opens
   *  the task board. Nothing in the log carries a task id, so the board is the
   *  honest best for those. */
  const jump = (e: EventRow): void => {
    if (e.kind === 'tasks') { requestCommandCenterTab('tasks'); return; }
    const target = eventAgents(e).find((a) => known.has(a));
    if (target) select(target);
  };
  const jumpLabel = (e: EventRow): string | undefined => {
    if (e.kind === 'tasks') return 'Open the task board';
    const target = eventAgents(e).find((a) => known.has(a));
    return target ? `Go to ${nameOf(target)}` : undefined;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-6 pt-6 pb-4">
        <Input
          value={log.search}
          onChange={(e) => { setOpen(null); log.setSearch(e.target.value); }}
          placeholder="Search the event log"
          aria-label="Search the event log"
          className="h-8 max-w-xs"
        />
        <Filter
          label="Filter by kind" all="All kinds"
          value={log.kind} onChange={log.setKind} options={log.page?.kinds ?? []}
        />
        <Filter
          label="Filter by agent" all="Everyone"
          value={log.agent} onChange={log.setAgent} options={log.page?.agents ?? []} render={nameOf}
        />
        {log.paused && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="cursor-help gap-1 font-normal">
                <Pause className="size-3" /> live paused
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-72">
              The tail is held while you are filtering or reading back, so the list does not
              re-sort under you. Clear the filters and return to the top to resume.
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6">
        {log.error && <p className="py-6 text-sm text-destructive">{log.error}</p>}

        {!log.error && log.rows.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {log.filtered
              ? 'No event matches that. Try a shorter search, or clear the filters.'
              : 'Nothing yet. Spawns, messages and task moves land here as they happen.'}
          </p>
        )}

        <div className="rounded-lg border">
          {log.rows.map((e, i) => (
            <Collapsible
              key={e.seq}
              open={open === e.seq}
              onOpenChange={(o) => setOpen(o ? e.seq : null)}
            >
              <div className={cn('flex items-center gap-2 px-3', i > 0 && 'border-t')}>
                <span
                  aria-hidden
                  title={e.kind ?? 'event'}
                  className={cn('size-1.5 shrink-0 rounded-full', kindDot(e.kind))}
                />
                <span className="w-16 shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground">
                  {typeof e.ts === 'number' ? relSince(e.ts) : ''}
                </span>
                <CollapsibleTrigger
                  className="min-w-0 flex-1 truncate py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title="Show the raw event"
                >
                  {describeEvent(e)}
                </CollapsibleTrigger>
                {jumpLabel(e) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost" size="icon-sm"
                        aria-label={jumpLabel(e)}
                        onClick={() => jump(e)}
                      >
                        <ArrowRight />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">{jumpLabel(e)}</TooltipContent>
                  </Tooltip>
                )}
              </div>
              <CollapsibleContent>
                <pre className="max-h-56 overflow-auto border-t bg-muted/40 p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap">
                  {JSON.stringify(e, null, 2)}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>

        {log.page && (
          <div className="flex flex-wrap items-center gap-3 py-4 text-xs text-muted-foreground">
            {log.more && (
              <Button variant="outline" size="sm" onClick={log.loadMore}>Load more</Button>
            )}
            <span>
              {log.rows.length} of {log.page.total}
              {log.filtered ? ` matching · ${log.page.scanned} scanned` : ' events'}
              {/* Never present the scan cap as the whole history. */}
              {log.page.truncated ? ' · older entries not scanned' : ''}
            </span>
          </div>
        )}

        <Collapsible className="group mb-6">
          <CollapsibleTrigger className="flex h-8 items-center gap-1 rounded-md text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
            Board
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="max-h-64 overflow-auto rounded-lg border p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap">
              {log.board || 'The board is empty.'}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}

function Filter({ label, all, value, onChange, options, render }: {
  label: string;
  all: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  render?: (v: string) => string;
}) {
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? '' : v)}>
      <SelectTrigger size="sm" aria-label={label} className="w-40">
        <SelectValue placeholder={all} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{all}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>{render ? render(o) : o}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The dot is a kind cue, not a severity one — only a real failure takes the red. */
function kindDot(kind: string | undefined): string {
  switch (kind) {
    case 'drop': case 'cwd_invalid': case 'voice_action_error': return 'bg-destructive';
    case 'spawn': case 'message': case 'terminal-handoff': case 'drain': case 'tasks':
      return 'bg-foreground/50';
    default: return 'bg-muted-foreground/40';
  }
}
