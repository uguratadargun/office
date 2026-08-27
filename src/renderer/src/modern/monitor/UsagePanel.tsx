import { useCallback, useEffect, useState } from 'react';

import { formatTokens, formatUsd } from '@shared/usageFormat';
import {
  CONTEXT_BUCKETS, RANGE_IDS, RANGE_LABEL, TRIGGER_KINDS, TRIGGER_LABEL,
  digestHeadline, share,
  type ContextBucket, type RangeId, type TriggerKind, type UsageCell, type UsageDigest
} from '@shared/usageDigest';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { cn } from '../lib/cn';

/** Cost is read from transcripts on disk, so it is always priced — there is no
 *  "no signal" case to render, unlike the live fleet numbers. */
const PRICED = 'transcript' as const;

const money = (usd: number): string => formatUsd({ totalTokens: 0, usd, source: PRICED });

/**
 * USAGE — what the floor spent, by hour, by trigger, and by how full the context
 * was.
 *
 * The Fleet tab answers "what has this agent cost", which is a total, and a
 * total cannot tell a working day from a quiet night spent answering timers.
 * That distinction is the entire subject of the release this ships in: an idle
 * floor was costing ~8M tokens a night, and finding it took a hand-run script
 * over the transcripts because nothing in the app could show cost against the
 * clock. This is that script, kept — and pointed at "last night" by default,
 * because that is the window the question is usually asked about.
 *
 * Read-only and derived: one `usageDigest` call, no state in main, nothing here
 * can change what an agent does. No poll either — a night that has already
 * happened does not move, and the range buttons are the refresh.
 */
export function UsagePanel() {
  const [range, setRange] = useState<RangeId>('last-night');
  const [data, setData] = useState<UsageDigest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback((r: RangeId) => {
    setLoading(true);
    setError(null);
    window.cth.usageDigest({ range: r })
      .then((d) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(range); }, [load, range]);

  const headline = data ? digestHeadline(data) : null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={range} onValueChange={(v) => setRange(v as RangeId)}>
          <TabsList variant="line">
            {RANGE_IDS.map((r) => <TabsTrigger key={r} value={r}>{RANGE_LABEL[r]}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        {data && (
          <span className="text-xs text-muted-foreground">
            {data.filesRead === 0
              ? 'no transcripts found on this machine'
              : `${data.filesRead} transcript${data.filesRead === 1 ? '' : 's'} read`}
          </span>
        )}
      </div>

      {error && (
        <Card>
          <CardContent className="text-sm text-destructive">
            The digest could not be built: {error}
          </CardContent>
        </Card>
      )}

      {loading && !data && <UsagePanelSkeleton bare />}

      {data && (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
              <Figure
                label="cost"
                value={money(data.total.usd)}
                hint={`Every priced turn between ${stamp(data.sinceMs)} and ${stamp(data.untilMs)}, summed from the transcripts on this machine. Estimated from the published per-model rates, not a bill.`}
              />
              <Figure
                label="tokens"
                value={formatTokens(data.total.tokens)}
                hint="Input, output and both cache halves. This is what was BILLED across the window — not the size of anyone's context."
              />
              <Figure
                label="turns"
                value={String(data.total.turns)}
                hint="Assistant responses. One turn is one request against the whole conversation, which is why a fat context is expensive even when the reply is short."
              />
              {headline && (
                <span className="text-xs text-muted-foreground">{headline}</span>
              )}
            </CardContent>
          </Card>

          {data.total.turns === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                Nothing was spent {data.rangeLabel}.
                {data.filesRead > 0 && ' The transcripts are there; no turn falls in this window.'}
              </CardContent>
            </Card>
          ) : (
            <>
              <Section
                title="By hour"
                note="Local time, by hour of day. A plateau across the small hours is the floor talking to itself."
              >
                <HourBars byHour={data.byHour} />
              </Section>

              <div className="grid gap-6 lg:grid-cols-2">
                <Section
                  title="By trigger"
                  note="What asked for the turn, read from the prompt that preceded it. `other` is a reply in a thread or a queued command."
                >
                  <SplitBars
                    keys={TRIGGER_KINDS}
                    label={(k) => TRIGGER_LABEL[k]}
                    cells={data.byTrigger}
                    whole={data.total.usd}
                  />
                </Section>
                <Section
                  title="By context size"
                  note="How much the request carried when it was made. Spend concentrated in the wide bands is what compacting earlier is for."
                >
                  <SplitBars
                    keys={CONTEXT_BUCKETS}
                    label={(k) => k}
                    cells={data.byContext}
                    whole={data.total.usd}
                  />
                </Section>
              </div>

              <Section title="By agent" note={`Ordered by spend ${data.rangeLabel}. An agent that spent nothing in the window is not listed.`}>
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-[30%]">Agent</TableHead>
                        <TableHead className="w-[10%] text-right">Cost</TableHead>
                        <TableHead className="w-[10%] text-right">Tokens</TableHead>
                        <TableHead className="w-[8%] text-right">Turns</TableHead>
                        <TableHead className="w-[42%]">Top trigger · widest context</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.rows.map((a) => (
                        <TableRow key={a.agentId} className="hover:bg-transparent">
                          <TableCell className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-medium">{a.name}</span>
                              {a.shared && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="secondary" className="shrink-0 cursor-help font-normal">shared folder</Badge>
                                  </TooltipTrigger>
                                  <TooltipContent side="right" className="max-w-72">
                                    Several agents run in this folder and these transcripts match none of
                                    their current sessions, so the row is the folder's total rather than
                                    one agent's.
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{money(a.total.usd)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{formatTokens(a.total.tokens)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{a.total.turns}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {topOf(TRIGGER_KINDS, a.byTrigger, (k) => TRIGGER_LABEL[k])} ·{' '}
                            {topOf(CONTEXT_BUCKETS, a.byContext, (k) => k)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Section>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** The busiest key in one split, as "name 62%". Empty when nothing was spent —
 *  "other 0%" is worse than silence. */
function topOf<K extends string>(
  keys: readonly K[],
  cells: Record<K, UsageCell>,
  label: (k: K) => string
): string {
  let best: K | null = null;
  let whole = 0;
  for (const k of keys) {
    whole += cells[k].usd;
    if (!best || cells[k].usd > cells[best].usd) best = k;
  }
  if (!best || cells[best].usd <= 0) return '—';
  return `${label(best)} ${Math.round(share(cells[best].usd, whole) * 100)}%`;
}

/**
 * Twenty-four bars, one per hour, scaled to the busiest.
 *
 * Bars rather than a line: an hour is a bucket, not a sample, and a line drawn
 * through buckets invites reading a slope between two hours that never happened.
 * Axis-less by design (the Sparkline's reasoning) — every bar carries its own
 * tooltip, and the only labels are the four that orient you in the day.
 */
function HourBars({ byHour }: { byHour: UsageCell[] }) {
  const peak = Math.max(...byHour.map((c) => c.usd), 0);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-24 items-end gap-1">
        {byHour.map((c, h) => {
          const pct = peak > 0 ? (c.usd / peak) * 100 : 0;
          return (
            <Tooltip key={h}>
              <TooltipTrigger asChild>
                <div className="flex h-full flex-1 cursor-help items-end">
                  <div
                    className={cn(
                      'w-full rounded-sm',
                      c.turns === 0 ? 'bg-muted' : 'bg-primary/70'
                    )}
                    // An hour with spend never renders as nothing: a 1px floor
                    // keeps "cheap" visibly different from "idle", which at this
                    // height is otherwise the same empty column.
                    style={{ height: c.turns === 0 ? 2 : `max(3px, ${pct}%)` }}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top">
                {String(h).padStart(2, '0')}:00 — {money(c.usd)} · {formatTokens(c.tokens)} · {c.turns} turn{c.turns === 1 ? '' : 's'}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <div className="flex justify-between font-mono text-xs text-muted-foreground">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
      </div>
    </div>
  );
}

/** One horizontal bar per key, share of total cost. The number is the money; the
 *  bar is only there to make the ordering readable at a glance. */
function SplitBars<K extends string>({
  keys, label, cells, whole
}: {
  keys: readonly K[];
  label: (k: K) => string;
  cells: Record<K, UsageCell>;
  whole: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      {keys.map((k) => {
        const c = cells[k];
        const pct = share(c.usd, whole) * 100;
        return (
          <div key={k} className="flex items-center gap-3">
            <span className="w-20 shrink-0 truncate text-xs text-muted-foreground">{label(k)}</span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums">
              {money(c.usd)}
            </span>
            <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
              {Math.round(pct)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs text-muted-foreground">{note}</span>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/** One headline number — the Fleet tab's Figure, same shape so the two tabs read
 *  as one surface. */
function Figure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex cursor-help flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="font-mono text-lg font-medium tabular-nums">{value}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-80">{hint}</TooltipContent>
    </Tooltip>
  );
}

function stamp(ms: number): string {
  if (!ms) return 'the beginning';
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function UsagePanelSkeleton({ bare }: { bare?: boolean } = {}) {
  const body = (
    <>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-56 w-full" />
    </>
  );
  return bare ? <>{body}</> : <div className="flex flex-col gap-6 p-6">{body}</div>;
}
