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
import { billedChip, contextGauge, rowSubtitle, sortAgentsForModernList, statusTone } from './agentsModel';

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
      <ScrollArea className="min-h-0 flex-1">
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
        selected ? 'border-ring bg-selected hover:bg-selected-hover' : 'border-transparent hover:bg-accent',
        agent.sleeping && 'opacity-60'
      )}
    >
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-medium">{agent.name}</span>
        {agent.isGod && <Badge variant="outline" className="h-4 px-1 text-[10px]">boss</Badge>}
        <span className="flex-1" />
        {agent.note && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground">✻</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs whitespace-pre-wrap">{agent.note}</TooltipContent>
          </Tooltip>
        )}
        {typing && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground">✎</span>
            </TooltipTrigger>
            <TooltipContent>Unsent text on this agent’s prompt — its queue is held</TooltipContent>
          </Tooltip>
        )}
        <Badge variant={statusTone(agent.status)} className="h-5 px-1.5 text-[10px] font-normal">
          {agent.sleeping ? 'asleep' : agent.status}
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
        {billed && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{billed}</span>}
      </div>
    </button>
  );
}
