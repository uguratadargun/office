import { useEffect, useState } from 'react';
import { formatTokens, formatUsd, usageSourceNote, USAGE_SOURCE_LABEL, billedVsContextNote } from '@shared/usageFormat';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Progress } from '../components/ui/progress';
import { Separator } from '../components/ui/separator';
import { Badge } from '../components/ui/badge';
import { cn } from '../lib/cn';
import { AgentSpans } from './AgentSpans';
import { TONE_METER } from './tone';
import type { FleetRow } from './fleetRows';

/**
 * One thread, in full: what it has spent, how much window it has left, the cap
 * that governs it, and the tool calls it has actually made.
 *
 * The cap editor lives here rather than in the table because setting a ceiling
 * is a decision about one agent, and the breaker acts on the number the moment
 * it is saved.
 */
export function AgentSheet({ row, floorCap, onOpenChange, onSetCap }: {
  row: FleetRow | null;
  floorCap?: number;
  onOpenChange: (open: boolean) => void;
  onSetCap: (id: string, tokens: number | undefined) => void;
}) {
  return (
    <Sheet open={!!row} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[420px] gap-0 sm:max-w-[420px]">
        {row && <Body row={row} floorCap={floorCap} onSetCap={onSetCap} />}
      </SheetContent>
    </Sheet>
  );
}

function Body({ row, floorCap, onSetCap }: {
  row: FleetRow;
  floorCap?: number;
  onSetCap: (id: string, tokens: number | undefined) => void;
}) {
  const a = row.agent;
  const usageLike = { totalTokens: row.tokens, usd: row.usd, source: row.source };

  return (
    <>
      <SheetHeader className="gap-1">
        <SheetTitle className="flex items-center gap-2 text-base">
          {a.name}
          <Badge variant="secondary" className="font-normal">{a.status}</Badge>
          {row.armed && <Badge variant="destructive" className="font-normal">{row.breaker?.level}</Badge>}
        </SheetTitle>
        <SheetDescription className="font-mono text-xs break-all">{a.cwd}</SheetDescription>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-6">
        {row.armed && row.breaker && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {row.breaker.reason}
          </p>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Spend</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <Pair k="billed" v={formatTokens(row.tokens)} />
            <Pair k="cost" v={formatUsd(usageLike)} />
            <Pair k="rate" v={row.rate > 0 ? `${formatTokens(row.rate)}/min` : '—'} />
            <Pair k="tool calls" v={String(row.toolCalls)} />
            <Pair k="model" v={a.model ?? '—'} />
            <Pair k="source" v={USAGE_SOURCE_LABEL[row.source]} />
          </dl>
          <p className="text-xs text-muted-foreground">{usageSourceNote(usageLike)}</p>
        </section>

        <Separator />

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Context window</h3>
          {row.context ? (
            <>
              <Progress
                value={row.context.pct}
                className={cn('h-1.5', TONE_METER[row.context.tone])}
              />
              <p className="font-mono text-xs tabular-nums">
                {formatTokens(row.context.tokens)} / {formatTokens(row.context.limit)} · {row.context.pct}%
              </p>
              {/* The one place the two numbers sit together, so this is the one
                  place the gap between them has to be explained. */}
              <p className="text-xs text-muted-foreground">
                {billedVsContextNote(
                  { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: row.tokens },
                  row.context.tokens
                )}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No status tick from this agent yet — the window is unknown, not empty.
            </p>
          )}
        </section>

        <Separator />

        <CapEditor row={row} floorCap={floorCap} onSetCap={onSetCap} />

        <Separator />

        <section className="flex min-h-0 flex-col gap-2">
          <h3 className="text-sm font-medium">Recent tool calls</h3>
          <AgentSpans agentId={a.id} />
        </section>
      </div>
    </>
  );
}

/** Set or clear this agent's own token ceiling. Empty clears it, which drops the
 *  agent back to the floor budget — or to no meter at all when there is none. */
function CapEditor({ row, floorCap, onSetCap }: {
  row: FleetRow;
  floorCap?: number;
  onSetCap: (id: string, tokens: number | undefined) => void;
}) {
  const [draft, setDraft] = useState('');
  useEffect(() => { setDraft(row.agentCap ? String(row.agentCap) : ''); }, [row.agent.id, row.agentCap]);

  const parsed = Number(draft.replace(/[_,\s]/g, ''));
  const valid = draft.trim() === '' || (Number.isFinite(parsed) && parsed > 0);
  const dirty = (row.agentCap ? String(row.agentCap) : '') !== draft.trim();

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Token budget</h3>
      {row.budget ? (
        <>
          <Progress value={row.budget.pct} className={cn('h-1.5', TONE_METER[row.tone])} />
          <p className="font-mono text-xs tabular-nums">
            {row.budget.label} · {row.budget.pct}%{row.budget.over ? ' · over' : ''}
            <span className="ml-2 font-sans text-muted-foreground">
              {row.agentCap ? "this agent's own cap" : 'floor budget'}
            </span>
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          No token budget applies to this agent. Set one below, or a floor budget in Settings —
          until then there is nothing honest to draw a bar against.
        </p>
      )}

      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="agent-cap" className="text-xs text-muted-foreground">
            Cap for {row.agent.name} (tokens)
          </Label>
          <Input
            id="agent-cap"
            inputMode="numeric"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={floorCap ? `${floorCap.toLocaleString()} (floor)` : 'no cap'}
            aria-invalid={!valid}
            className="h-8 font-mono"
          />
        </div>
        <Button
          size="sm"
          disabled={!valid || !dirty}
          onClick={() => onSetCap(row.agent.id, draft.trim() === '' ? undefined : parsed)}
        >
          {draft.trim() === '' ? 'Clear' : 'Save'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        The circuit breaker reads this number: crossing it constrains the agent.
      </p>
    </section>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="truncate text-right font-mono tabular-nums">{v}</dd>
    </>
  );
}
