import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Separator } from '../components/ui/separator';
import { IconButton } from '../components/IconButton';
import { DestructiveButton } from '../components/DestructiveButton';
import { cn } from '../lib/cn';
import {
  clearCopy, emptyCopy, exportJson, firstLine, readLimit, scopeRows, when,
  type HistoryRow
} from './historyModel';

/**
 * Command History — the read side of a table this UI has only ever written to.
 *
 * Every prompt submitted to any agent goes into SQLite (`historyAdd` fires from
 * the terminal in AgentDetail), and modern offered no way to see it, search it,
 * export it or clear it: a forever-log that this front-end feeds and cannot
 * open. That asymmetry is the defect — not the missing tab.
 *
 * It opens FROM an agent, so it opens SCOPED to that agent; the switch widens
 * it to the whole floor. Surfacing a log without an exit would be worse than
 * the quiet version, so delete-one, clear and export are all here — and all
 * three are armed, because two of them lose the log and the third copies every
 * prompt you have ever written onto the system clipboard.
 */
export function HistorySheet({ agentId, agentName, open, onOpenChange }: {
  agentId: string;
  agentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[520px] gap-0 sm:max-w-[520px]">
        {/* Mounted only while open: the panel polls nothing, but it holds the
            rows it read, and keeping another agent's prompts in memory behind a
            closed sheet is not something to do for free. */}
        {open && <Body agentId={agentId} agentName={agentName} />}
      </SheetContent>
    </Sheet>
  );
}

function Body({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  // Opened from an agent ⇒ scoped to that agent. Landing on the whole floor's
  // prompts when you asked about one agent is the surprising default.
  const [mine, setMine] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  const scope = mine ? agentId : undefined;

  const refresh = useCallback(async (q: string): Promise<void> => {
    const term = q.trim();
    try {
      const next = term
        ? await window.cth.historySearch(term, readLimit(!!scope, true))
        : await window.cth.historyList(scope, readLimit(!!scope, false));
      // Search has no agent filter in the store — the scope is applied here or
      // not at all.
      setRows(scopeRows(next, scope));
    } catch {
      setNote('Could not read history.');
    }
  }, [scope]);

  // One effect, debounced: scope changes and keystrokes both mean "read again",
  // and two effects racing the same setRows is how a stale page wins.
  useEffect(() => {
    const t = setTimeout(() => { void refresh(query); }, query.trim() ? 200 : 0);
    return () => clearTimeout(t);
  }, [query, refresh]);

  const open = useMemo(() => rows.find((r) => r.id === openId) ?? null, [rows, openId]);
  const now = useMemo(() => Date.now(), [rows]);

  async function copy(text: string): Promise<void> {
    try { await navigator.clipboard.writeText(text); setNote('Copied.'); }
    catch { setNote('Copy failed.'); }
  }

  async function remove(id: number): Promise<void> {
    try {
      const r = await window.cth.historyDelete(id);
      setNote(r.ok ? 'Deleted.' : 'That prompt was already gone.');
      if (openId === id) setOpenId(null);
      await refresh(query);
    } catch { setNote('Delete failed.'); }
  }

  async function clearAll(): Promise<void> {
    try {
      const r = await window.cth.historyClear(scope);
      setNote(`Cleared ${r.removed} prompt${r.removed === 1 ? '' : 's'}.`);
      setOpenId(null);
      await refresh(query);
    } catch { setNote('Clear failed.'); }
  }

  async function doExport(): Promise<void> {
    try {
      const all = await window.cth.historyExport(scope);
      await navigator.clipboard.writeText(exportJson(all));
      setNote(`Copied ${all.length} prompt${all.length === 1 ? '' : 's'} as JSON.`);
    } catch { setNote('Export failed.'); }
  }

  const clear = clearCopy(!!scope, agentName);

  return (
    <>
      <SheetHeader className="gap-1">
        <SheetTitle className="text-base">Command history</SheetTitle>
        <SheetDescription>
          Every prompt submitted to an agent is recorded here.
        </SheetDescription>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-6">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your prompts"
          aria-label="Search command history"
        />

        <div className="flex items-center gap-2">
          <Switch id="history-scope" checked={mine} onCheckedChange={setMine} />
          <Label htmlFor="history-scope" className="text-xs font-normal text-muted-foreground">
            {agentName} only
          </Label>
        </div>

        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            {emptyCopy(query, !!scope, agentName)}
          </p>
        ) : (
          <div className="flex flex-col">
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setOpenId(openId === r.id ? null : r.id)}
                aria-expanded={openId === r.id}
                className={cn(
                  'flex items-baseline gap-2 border-b px-1 py-1.5 text-left hover:bg-accent',
                  openId === r.id && 'bg-accent'
                )}
              >
                <span className="w-14 shrink-0 text-xs text-muted-foreground">{when(r.ts, now)}</span>
                {/* The agent id earns its place only when the list can hold
                    more than one agent's prompts. */}
                {!scope && <span className="shrink-0 text-xs text-muted-foreground">{r.agentId}</span>}
                <span className="min-w-0 flex-1 truncate text-xs">{firstLine(r.text)}</span>
              </button>
            ))}
          </div>
        )}

        {open && (
          <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3">
            <pre className="max-h-56 overflow-auto font-mono text-xs break-words whitespace-pre-wrap">
              {open.text}
            </pre>
            <div className="flex flex-wrap items-center gap-2">
              <IconButton label="Copy this prompt" size="icon-xs" onClick={() => void copy(open.text)}>
                <Copy />
              </IconButton>
              <DestructiveButton
                size="xs"
                label="Delete"
                confirmLabel="Delete this prompt"
                consequence="This prompt is removed from the log. There is no undo."
                onRun={() => void remove(open.id)}
              />
            </div>
          </div>
        )}

        <Separator />

        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Export copies the log to your clipboard as JSON; clearing is permanent.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {/* Armed too, though it destroys nothing: it puts every prompt you
                have ever written onto the system clipboard, where the next
                paste — into a chat, an issue, an agent — takes all of it. */}
            <DestructiveButton
              size="xs"
              label="Export JSON"
              confirmLabel="Yes, copy to clipboard"
              consequence={scope
                ? `Every prompt recorded for ${agentName} is copied to the clipboard.`
                : 'Every prompt you have sent any agent is copied to the clipboard.'}
              onRun={() => void doExport()}
            />
            <DestructiveButton
              size="xs"
              label={clear.label}
              confirmLabel={clear.confirm}
              consequence={clear.consequence}
              onRun={() => void clearAll()}
            />
            <span className="flex-1" />
            {rows.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {rows.length} shown
              </span>
            )}
          </div>
          {note && <p className="text-xs text-muted-foreground" role="status">{note}</p>}
        </div>
      </div>
    </>
  );
}
