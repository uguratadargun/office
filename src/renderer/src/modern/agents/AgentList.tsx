import { History, Users } from 'lucide-react';
import { useStore, type Agent } from '@/store/store';
import { useFleetUsage } from '@/hooks/useFleetUsage';
import { useHasTerminalDraft } from '@/components/terminalPool';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Progress } from '../components/ui/progress';
import { ScrollArea } from '../components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { cn } from '../lib/cn';
import { billedChip, contextGauge, rowSubtitle, sortAgentsForModernList, statusBadge } from './agentsModel';
import { isProcessless } from '@shared/agentPresence';

/**
 * The roster rail. Three lines per agent — identity, what it is doing (or where
 * it lives), and the context gauge with its chips — because the pixel card
 * learned that a fourth row pushes the gauge off the bottom edge.
 */
export function AgentList({ selectedId, onSelect }: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const agents = useStore((s) => s.agents);
  const setAddAgentOpen = useStore((s) => s.setAddAgentOpen);
  const restorable = useStore((s) => s.restorableAgents);
  const usage = useFleetUsage();
  const rows = sortAgentsForModernList(agents);

  return (
    <div className="flex h-full min-h-0 w-[264px] shrink-0 flex-col border-r">
      <div className="flex h-12 shrink-0 items-center justify-between px-3">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(
            'flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
            selectedId === null ? 'bg-selected hover:bg-selected-hover' : 'hover:bg-accent'
          )}
        >
          <Users className="size-4" /> Agents
          <span className="text-muted-foreground">{agents.length}</span>
        </button>
        <Button size="sm" variant="outline" onClick={() => setAddAgentOpen(true)}>Add</Button>
      </div>
      {/* MD-125 — the `!block` is what makes `truncate` on the rows work at all.
          Radix gives its viewport's content wrapper `display: table;
          min-width: 100%`, which is SHRINK-TO-FIT: the table grows to the
          widest row, `w-full` on a row then resolves against that width, and a
          long agent id is simply never asked to shrink — it was clipped mid-
          character at the list's edge with the status badge pushed out of sight
          entirely. As a block box the wrapper is the viewport's 264px and the
          rows truncate as written. Scoped here rather than in the shared
          ui/scroll-area, whose horizontal scrolling other views may rely on. */}
      <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block">
        <div className="flex flex-col gap-1 p-2">
          {rows.map((a) => (
            <AgentRow
              key={a.id}
              agent={a}
              selected={a.id === selectedId}
              billed={billedChip(usage[a.id])}
              onSelect={() => onSelect(a.id)}
            />
          ))}
          {rows.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No agents yet — “Add” hires the first one.
            </p>
          )}
        </div>
      </ScrollArea>

      {/* Last session's team is restored from the overview, which is only on
          screen with nothing selected — so with an agent open the whole list
          would be unreachable. This is the way back to it, not a second
          restore control. */}
      {restorable.length > 0 && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="flex shrink-0 items-center gap-2 border-t px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent"
        >
          <History className="size-3.5 shrink-0" />
          <span className="truncate">Previous session · {restorable.length} to restore</span>
        </button>
      )}
    </div>
  );
}

function AgentRow({ agent, selected, billed, onSelect }: {
  agent: Agent;
  selected: boolean;
  billed: string | null;
  onSelect: () => void;
}) {
  // The user holding unsent text on an agent's prompt is what holds its queue,
  // and otherwise looks exactly like an idle agent with nothing to do.
  const typing = useHasTerminalDraft(agent.ptyId);
  const gauge = contextGauge(agent.progress, agent.contextTokens, agent.contextLimit);
  const subtitle = rowSubtitle(agent);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group w-full rounded-lg border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-ring bg-selected hover:bg-selected-hover' : 'border-transparent hover:bg-accent'
      )}
    >
      {/* MD-119 F2 — the fade goes on the CONTENT, never on the row.
          `opacity-60` on the button composited the whole MD-108 ladder down by
          0.6, fill included: a selected asleep row landed 4/255 from the awake
          HOVER fill in light and exactly on it in dark, so the loud half of the
          selection disappeared for the row type that, after MD-114, most of a
          real roster now is. Fading the text and badges instead says "no
          process" just as plainly and leaves the fill and the ring at the
          strength the ladder was measured at. Note the contrast test greps
          class strings, so it passed on the old shape — the halving happened at
          composite time, which is why this is a comment and not just a diff. */}
      <span className={cn('block', isProcessless(agent) && 'opacity-60')}>
        {/* MD-125 — `truncate` is `min-width:auto` away from doing nothing: a
            flex item refuses to shrink below its content unless it is told it
            may, and a Windows path has no soft-break opportunity to shrink at.
            Without `min-w-0` here a long name or id widened the row, pushed the
            status badge out of the viewport and stopped the page fitting. */}
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={agent.name}>{agent.name}</span>
          {agent.isGod && <Badge variant="outline" className="h-5 px-1.5 text-xs shrink-0">boss</Badge>}
          {agent.note && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="shrink-0 text-xs text-muted-foreground">✻</span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs whitespace-pre-wrap">{agent.note}</TooltipContent>
            </Tooltip>
          )}
          {typing && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="shrink-0 text-xs text-muted-foreground">✎</span>
              </TooltipTrigger>
              <TooltipContent>Unsent text on this agent’s prompt — its queue is held</TooltipContent>
            </Tooltip>
          )}
          <Badge variant={statusBadge(agent).tone} className="h-5 shrink-0 px-1.5 text-xs font-normal">
            {statusBadge(agent).label}
          </Badge>
        </div>

        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={subtitle}>
          {subtitle || '—'}
        </p>

        <div className="mt-2 flex items-center gap-2">
          <Progress
            value={gauge.pct}
            title={gauge.title}
            aria-label={gauge.title}
            className={cn(
              'h-1 flex-1',
              gauge.tone === 'danger' ? '[&>[data-slot=progress-indicator]]:bg-destructive'
                : gauge.tone === 'warn' ? '[&>[data-slot=progress-indicator]]:bg-muted-foreground'
                  : undefined
            )}
          />
          {billed && <span className="shrink-0 font-mono text-xs text-muted-foreground">{billed}</span>}
        </div>
      </span>
    </button>
  );
}
