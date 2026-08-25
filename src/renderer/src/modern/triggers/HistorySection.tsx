import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TriggerHistoryEntry } from '@shared/triggers';
import { useStore } from '@/store/store';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger
} from '../components/ui/alert-dialog';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { cn } from '../lib/cn';
import { relTime } from './interval';

/**
 * TRIGGER HISTORY — the ledger of everything an outside party said to this hive
 * and everything we said back, read as CONVERSATIONS rather than log lines.
 *
 * The ledger is flat (one row per message, newest first). The operator's actual
 * question is never "what rows exist" but "what did they ask, and what did we
 * answer" — so rows are folded into exchanges by `correlationId` here, in the
 * renderer, and drawn as one card per exchange with both bodies in full.
 *
 * The only actionable rows are inbound messages a `strict` / `communication-only`
 * mode held back (`decision: 'pending'`). Those float to the top, because
 * approving one dispatches real work and a held message that scrolls out of
 * sight is a message that never gets answered.
 *
 * Only the `webhook` source is offered: `org` has no transport yet (see
 * @shared/triggers), exactly as in the pixel tab.
 */

/* ─────────────────────────────── ipc surface ─────────────────────────────── */

/** Narrow local surface + one cast, matching the pixel tab: these members are
 *  installed by preload, so they are read lazily off `window.cth`. */
interface TriggerHistoryApi {
  listTriggerHistory?: () => Promise<TriggerHistoryEntry[]>;
  onTriggerHistoryUpdated?: (cb: () => void) => () => void;
  decideTriggerHistory?: (input: { id: string; decision: 'approved' | 'rejected' }) =>
    Promise<{ ok?: boolean; error?: string } | undefined>;
  clearTriggerHistory?: (source?: 'webhook' | 'org') => Promise<unknown>;
}

function api(): TriggerHistoryApi {
  return (window.cth ?? {}) as unknown as TriggerHistoryApi;
}

/* ─────────────────────────────── exchanges ───────────────────────────────── */

interface Exchange {
  key: string;
  /** Oldest first — an exchange reads downward, the way it happened. */
  msgs: TriggerHistoryEntry[];
  head: TriggerHistoryEntry;
  pending: TriggerHistoryEntry | null;
  answered: boolean;
  latestAt: number;
}

/**
 * Fold the flat ledger into exchanges. `correlationId` is the pairing key; a row
 * without one becomes its own one-sided exchange keyed by its id (an
 * un-correlated inbound still deserves a card — it may be pending). A group may
 * hold more than two rows; those render in time order rather than being dropped.
 */
function buildExchanges(rows: TriggerHistoryEntry[]): Exchange[] {
  const buckets = new Map<string, TriggerHistoryEntry[]>();
  const order: string[] = [];
  for (const e of rows) {
    const key = e.correlationId ? `c:${e.correlationId}` : `e:${e.id}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(e);
    else { buckets.set(key, [e]); order.push(key); }
  }
  const list = order.map<Exchange>((key) => {
    const msgs = (buckets.get(key) ?? []).slice().sort((a, b) => a.at - b.at);
    const inbound = msgs.find((m) => m.direction === 'inbound');
    return {
      key,
      msgs,
      head: inbound ?? msgs[0],
      pending: msgs.find((m) => m.direction === 'inbound' && m.decision === 'pending') ?? null,
      answered: msgs.some((m) => m.direction === 'outbound'),
      latestAt: msgs.reduce((max, m) => Math.max(max, m.at), 0)
    };
  });
  return list.sort((a, b) => {
    if (!!a.pending !== !!b.pending) return a.pending ? -1 : 1;
    return b.latestAt - a.latestAt;
  });
}

const CLAMP_CHARS = 320;
const CLAMP_LINES = 8;

/** Collapse a long body for the resting state. Expanding always shows all of it. */
function clampBody(body: string): { text: string; clipped: boolean } {
  const lines = body.split('\n');
  if (body.length <= CLAMP_CHARS && lines.length <= CLAMP_LINES) return { text: body, clipped: false };
  const head = lines.slice(0, CLAMP_LINES).join('\n');
  const cut = head.length > CLAMP_CHARS ? head.slice(0, CLAMP_CHARS).replace(/\s+\S*$/, '') : head;
  return { text: `${cut.trimEnd()}…`, clipped: true };
}

/* ──────────────────────────────── the section ────────────────────────────── */

export function HistorySection({ onSummary }: { onSummary: (s: string) => void }) {
  const boss = useStore((s) => s.bossName);
  const [entries, setEntries] = useState<TriggerHistoryEntry[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const list = api().listTriggerHistory;
    if (!list) return;
    list()
      .then((rows) => setEntries(Array.isArray(rows) ? rows : []))
      .catch(() => { /* main not ready; the update event will bring us back */ });
  }, []);

  useEffect(() => {
    load();
    const off = api().onTriggerHistoryUpdated?.(load);
    return () => { if (typeof off === 'function') off(); };
  }, [load]);

  const rows = useMemo(() => entries.filter((e) => e.source === 'webhook'), [entries]);
  const pendingCount = rows.filter((e) => e.direction === 'inbound' && e.decision === 'pending').length;
  const exchanges = useMemo(() => buildExchanges(rows), [rows]);

  useEffect(() => {
    onSummary(rows.length === 0
      ? 'none'
      : pendingCount > 0 ? `${pendingCount} waiting` : `${exchanges.length} exchanges`);
  }, [rows.length, pendingCount, exchanges.length, onSummary]);

  const toggle = useCallback((id: string) => {
    setExpanded((e) => ({ ...e, [id]: !e[id] }));
  }, []);

  const decide = useCallback((id: string, decision: 'approved' | 'rejected') => {
    const call = api().decideTriggerHistory;
    if (!call) return;
    setBusy((b) => ({ ...b, [id]: true }));
    setError(null);
    // Optimistic: the verdict is the operator's own input, so it lands the
    // instant they click. The update event reconciles either way.
    setEntries((all) => all.map((r) => (r.id === id ? { ...r, decision } : r)));
    call({ id, decision })
      .then((res) => {
        if (res && res.ok === false) {
          setError(res.error || 'That did not go through. Try again.');
          load();
        }
      })
      .catch(() => { setError('That did not go through. Try again.'); load(); })
      .finally(() => setBusy((b) => { const n = { ...b }; delete n[id]; return n; }));
  }, [load]);

  const clear = useCallback(() => {
    const call = api().clearTriggerHistory;
    if (!call) return;
    setEntries((all) => all.filter((r) => r.source !== 'webhook'));
    call('webhook').catch(() => { setError('Could not clear it. Try again.'); load(); });
  }, [load]);

  return (
    <>
      <p className="text-sm leading-5 text-muted-foreground">
        Everything posted to your webhook endpoints, next to what {boss} sent back.
      </p>

      {pendingCount > 0 && (
        <Alert>
          <AlertDescription>
            {pendingCount === 1
              ? 'One message is held, waiting on your yes or no.'
              : `${pendingCount} messages are held, waiting on your yes or no.`}
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {exchanges.length === 0 ? (
        <div className="rounded-lg border p-4">
          <p className="text-sm">No webhook messages yet.</p>
          <p className="mt-1 text-xs leading-4 text-muted-foreground">
            When something posts to one of your endpoints it lands here with {boss}&rsquo;s reply
            underneath. Nothing has called in so far. Add an endpoint under Webhooks to get a URL
            you can hand out.
          </p>
        </div>
      ) : (
        exchanges.map((ex) => (
          <ExchangeCard
            key={ex.key}
            ex={ex}
            boss={boss}
            expanded={expanded}
            toggle={toggle}
            busy={busy}
            onDecide={decide}
          />
        ))
      )}

      {rows.length > 0 && (
        <div className="flex">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                Clear history
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete all {rows.length} webhook messages?</AlertDialogTitle>
                <AlertDialogDescription>
                  The ledger of what callers sent and what {boss} answered is erased. Held messages
                  waiting on you go with it. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction onClick={clear}>Delete all {rows.length}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </>
  );
}

/* ────────────────────────────── one exchange ─────────────────────────────── */

function DecisionBadge({ decision }: { decision: NonNullable<TriggerHistoryEntry['decision']> }) {
  switch (decision) {
    case 'pending': return <Badge className="font-normal">needs you</Badge>;
    case 'approved': return <Badge variant="secondary" className="font-normal">approved</Badge>;
    case 'rejected': return <Badge variant="destructive" className="font-normal">rejected</Badge>;
    default: return <Badge variant="outline" className="font-normal">auto-allowed</Badge>;
  }
}

function ExchangeCard({ ex, boss, expanded, toggle, busy, onDecide }: {
  ex: Exchange;
  boss: string;
  expanded: Record<string, boolean>;
  toggle: (id: string) => void;
  busy: Record<string, boolean>;
  onDecide: (id: string, decision: 'approved' | 'rejected') => void;
}) {
  const head = ex.head;
  const hasInbound = ex.msgs.some((m) => m.direction === 'inbound');
  const pending = ex.pending;
  const taskId = ex.msgs.find((m) => m.taskId)?.taskId;

  // The trailing line for an exchange with nothing sent back yet. Silence here
  // is normal — a message still in flight, never a failure.
  const tail = (() => {
    if (pending || ex.answered) return null;
    if (head.decision === 'rejected') return 'You turned this down. Nothing was sent to the hive.';
    return `No reply yet. ${boss} has this one.`;
  })();

  return (
    <div className={cn('flex flex-col gap-3 rounded-lg border p-3', pending && 'border-foreground/40 bg-accent/40')}>
      {pending && (
        <p className="text-xs font-medium">Waiting for you</p>
      )}

      <div className="flex flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-sm" title={head.sourceName}>
            {head.sourceName || 'unnamed source'}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{relTime(Date.now() - ex.latestAt)}</span>
        </div>
        <span className="truncate text-xs text-muted-foreground" title={head.peer}>
          {hasInbound ? 'from' : 'to'} {head.peer || 'unknown'}
        </span>
        {head.title && <span className="truncate text-sm text-muted-foreground" title={head.title}>{head.title}</span>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className="font-normal">{head.kind}</Badge>
        {head.decision && <DecisionBadge decision={head.decision} />}
      </div>

      {ex.msgs.map((m) => (
        <MessageBlock
          key={m.id}
          msg={m}
          label={m.direction === 'inbound' ? 'They sent' : hasInbound ? 'We replied' : 'We sent'}
          expanded={!!expanded[m.id]}
          onToggle={() => toggle(m.id)}
        />
      ))}

      {pending && (
        <div className="flex flex-col gap-2">
          <p className="text-xs leading-4 text-muted-foreground">
            {pending.kind === 'directive'
              ? `Approve and this goes to ${boss}, who will put the hive to work on it. Reject and it is dropped — nothing runs.`
              : `Approve and ${boss} reads this. Reject and it is dropped — nothing runs.`}
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={!!busy[pending.id]} onClick={() => onDecide(pending.id, 'approved')}>
              {busy[pending.id] ? 'One sec…' : 'Approve'}
            </Button>
            <Button variant="outline" size="sm" disabled={!!busy[pending.id]} onClick={() => onDecide(pending.id, 'rejected')}>
              Reject
            </Button>
          </div>
        </div>
      )}

      {tail && <p className="text-xs text-muted-foreground">{tail}</p>}
      {taskId && <p className="truncate font-mono text-xs text-muted-foreground">Task {taskId}</p>}
    </div>
  );
}

function MessageBlock({ msg, label, expanded, onToggle }: {
  msg: TriggerHistoryEntry;
  label: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const body = msg.body ?? '';
  const { text, clipped } = useMemo(() => clampBody(body), [body]);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{relTime(Date.now() - msg.at)}</span>
      </div>
      <div className="rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-xs leading-5 break-words whitespace-pre-wrap">
        {body.trim() ? (expanded ? body : text) : '(empty message)'}
      </div>
      {clipped && (
        <button type="button" onClick={onToggle} className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
          {expanded ? 'Show less' : `Show all ${body.length} characters`}
        </button>
      )}
    </div>
  );
}
