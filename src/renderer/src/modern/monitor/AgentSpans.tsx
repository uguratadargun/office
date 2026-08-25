import { useAgentSpans } from '@/hooks/useTelemetry';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { cn } from '../lib/cn';

/** Keep the view legible — the tail is what anyone is actually reading. */
const RECENT = 40;

/**
 * Per-thread detail: the agent's recent tool calls as a waterfall, width ∝
 * duration. The pixel `ToolWaterfall` in mint/coral; here a failure is the only
 * thing that takes colour, everything else is ink at two weights.
 */
export function AgentSpans({ agentId }: { agentId: string }) {
  const spans = useAgentSpans(agentId);
  const recent = spans.slice(-RECENT);
  const maxDur = Math.max(1, ...recent.map((s) => s.durationMs));

  if (recent.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No tool calls recorded yet. Spans arrive with live telemetry, which only
        Claude-engine agents emit.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {recent.map((s, i) => (
        <Tooltip key={`${s.ts}-${i}`}>
          <TooltipTrigger asChild>
            <div className="flex h-5 items-center gap-2 rounded-md px-1 hover:bg-accent">
              <span className="w-28 shrink-0 truncate font-mono text-[12px]">{s.tool}</span>
              <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className={cn(
                    'absolute inset-y-0 left-0 rounded-full',
                    s.success ? 'bg-primary/70' : 'bg-destructive'
                  )}
                  style={{ width: `${Math.max(2, (s.durationMs / maxDur) * 100)}%` }}
                />
              </span>
              <span className="w-14 shrink-0 text-right font-mono text-[12px] text-muted-foreground">
                {fmtMs(s.durationMs)}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="left">
            {s.tool} · {fmtMs(s.durationMs)} · {s.success ? 'ok' : 'failed'}
            {s.error ? ` · ${s.error}` : ''}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}
