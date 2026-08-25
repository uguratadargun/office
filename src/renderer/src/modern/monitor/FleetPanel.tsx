import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatTokens, formatUsd, usageSourceNote, USAGE_SOURCE_LABEL, TOKENS_BILLED_LABEL, TOKENS_BILLED_TIP } from '@shared/usageFormat';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { Skeleton } from '../components/ui/skeleton';
import { cn } from '../lib/cn';
import { useMonitorData } from './useMonitorData';
import { AgentSheet } from './AgentSheet';
import { Sparkline } from './Sparkline';
import { TONE_METER, TONE_TEXT } from './tone';
import type { FleetRow } from './fleetRows';

/**
 * Fleet usage and cost — one row per agent, and the fleet's own totals above it.
 *
 * The column that is NOT here is as deliberate as the ones that are: an agent
 * with no budget gets no meter and no percentage, because a made-up denominator
 * turns "unbudgeted" into "58% of the way to something". Spend and context are
 * two columns for the same reason — see `billedVsContextNote`.
 */
export function FleetPanel() {
  const { rows, totals, floorCap, setAgentCap } = useMonitorData();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = rows.find((r) => r.agent.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <Card>
        <CardContent className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
          <Figure
            label={TOKENS_BILLED_LABEL}
            value={formatTokens(totals.tokens)}
            sub="tokens"
            hint={TOKENS_BILLED_TIP}
          />
          <Figure
            label="cost"
            value={totals.usd === null ? (totals.unpriced ? 'unpriced' : 'unknown') : formatUsd({ totalTokens: totals.tokens, usd: totals.usd, source: 'otlp' })}
            hint={totals.usd === null
              ? 'Tokens are measured, but no model on this floor has a row in the price table — so the cost is unpriced rather than zero.'
              : 'Summed across every agent that reports a priced model.'}
          />
          <Figure
            label="inputs"
            value={formatTokens(totals.inputs)}
            sub={`${totals.cachePct}% cached`}
            hint="Fresh plus cached input tokens, and the share served from cache. A high share is why billed dwarfs the context window."
          />
          <Figure
            label="rate"
            value={totals.rate.toLocaleString()}
            sub="tok/min"
            hint="Tokens per minute across the floor, from live telemetry."
          />
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="secondary" className="font-normal">
              {totals.measured} of {rows.length} reporting
            </Badge>
            {!floorCap && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="cursor-help font-normal">no floor budget</Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-72">
                  No floor token budget is set, so agents without their own cap show no meter.
                  Settings sets one; the circuit breaker reads the same number.
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[22%]">Agent</TableHead>
              <TableHead className="w-[10%] text-right">Billed</TableHead>
              <TableHead className="w-[9%] text-right">Cost</TableHead>
              <TableHead className="w-[14%]">Rate</TableHead>
              <TableHead className="w-[15%]">Context</TableHead>
              <TableHead className="w-[18%]">Budget</TableHead>
              <TableHead className="w-[12%]">Last tool</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No agents on the floor yet. Hire one and its usage appears here.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => <Row key={r.agent.id} row={r} onOpen={() => setOpenId(r.agent.id)} />)}
          </TableBody>
        </Table>
      </div>

      <AgentSheet
        row={open}
        floorCap={floorCap}
        onOpenChange={(o) => { if (!o) setOpenId(null); }}
        onSetCap={setAgentCap}
      />
    </div>
  );
}

function Row({ row, onOpen }: { row: FleetRow; onOpen: () => void }) {
  const a = row.agent;
  return (
    <TableRow
      onClick={onOpen}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      aria-label={`Usage detail for ${a.name}`}
      className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <TableCell className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {row.armed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-72">
                Circuit breaker: {row.breaker?.level}. {row.breaker?.reason}
              </TooltipContent>
            </Tooltip>
          )}
          <span className="truncate font-medium">{a.name}</span>
          <Badge variant="secondary" className="shrink-0 font-normal">{a.status}</Badge>
        </div>
      </TableCell>

      <TableCell className="text-right font-mono tabular-nums">{formatTokens(row.tokens)}</TableCell>

      <TableCell className="text-right font-mono tabular-nums">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn('cursor-help', row.source === 'none' && 'text-muted-foreground')}>
              {formatUsd({ totalTokens: row.tokens, usd: row.usd, source: row.source })}
            </span>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-72">
            {USAGE_SOURCE_LABEL[row.source]} — {usageSourceNote({ totalTokens: row.tokens, usd: row.usd, source: row.source })}
          </TooltipContent>
        </Tooltip>
      </TableCell>

      <TableCell>
        {row.hasSpark ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Sparkline series={row.spark} />
            <span className="font-mono text-xs tabular-nums">{formatTokens(row.rate)}/m</span>
          </span>
        ) : (
          // A flat line would read as "idle" when it means "nothing measured".
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      <TableCell>
        {row.context ? (
          <Meter
            pct={row.context.pct}
            tone={row.context.tone}
            label={`${formatTokens(row.context.tokens)} / ${formatTokens(row.context.limit)}`}
            tip={`Context window: ${row.context.tokens.toLocaleString()} of ${row.context.limit.toLocaleString()} tokens. This is headroom before compaction — not the cumulative bill.`}
          />
        ) : (
          <span className="text-muted-foreground">no status tick yet</span>
        )}
      </TableCell>

      <TableCell>
        {row.budget ? (
          <Meter
            pct={row.budget.pct}
            tone={row.tone}
            label={row.budget.label + (row.budget.over ? ' · over' : '')}
            tip={`${row.tokens.toLocaleString()} of ${row.budget.cap.toLocaleString()} tokens${row.agentCap ? " (this agent's own cap)" : ' (floor budget)'}. Cumulative spend, not the context window.`}
          />
        ) : (
          <span className="text-muted-foreground">no budget</span>
        )}
      </TableCell>

      <TableCell className="min-w-0">
        {row.lastTool
          ? <span className="block truncate font-mono text-xs text-muted-foreground">{row.lastTool}</span>
          : <span className="text-muted-foreground">—</span>}
      </TableCell>
    </TableRow>
  );
}

/** A bar and its own number. The label carries the units so the bar never has to
 *  be read on its own. */
function Meter({ pct, tone, label, tip }: { pct: number; tone: FleetRow['tone']; label: string; tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex cursor-help flex-col gap-1">
          {/* The primitive exposes its fill through `data-slot`, so the tone is
              said with a className rather than by re-implementing the bar. */}
          <Progress
            value={pct}
            className={cn(
              'h-1.5 [&_[data-slot=progress-indicator]]:transition-all',
              tone === 'danger' && 'bg-destructive/20',
              TONE_METER[tone]
            )}
          />
          <span className={cn('font-mono text-xs tabular-nums', TONE_TEXT[tone])}>{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-72">{tip}</TooltipContent>
    </Tooltip>
  );
}

/** One headline number. The unit is a separate, quieter word so the figure
 *  itself stays scannable down the row. */
function Figure({ label, value, sub, hint }: { label: string; value: string; sub?: string; hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex cursor-help flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="flex items-baseline gap-1.5">
            <span className="font-mono text-lg font-medium tabular-nums">{value}</span>
            {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-80">{hint}</TooltipContent>
    </Tooltip>
  );
}

/** Shown while the first telemetry poll is in flight. */
export function FleetPanelSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
