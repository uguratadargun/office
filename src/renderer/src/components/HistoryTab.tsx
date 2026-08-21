import { useEffect, useMemo, useState } from 'react';
import { Scroll, Section, Muted } from './CommandCenterPanel';
import { PixelButton } from './PixelButton';
import { DestructiveAction } from './ui/DestructiveAction';

/**
 * Command History — the read side of a table that has been recording since it
 * shipped.
 *
 * Every prompt submitted to any agent goes into SQLite (`historyAdd` fires from
 * three call sites) and nothing ever read it back. This panel is that read side:
 * list, search, open one in full, copy it, and — because surfacing a forever-log
 * without an exit would be worse than the quiet version — delete one, clear all,
 * and export.
 *
 * Colours come from --cth-* tokens only; no hex literals.
 */
type Entry = Awaited<ReturnType<typeof window.cth.historyList>>[number];

const LIMIT = 100;

function when(ts: number): string {
  const d = new Date(ts);
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString();
}

/** The prompt's first line, for the collapsed row. */
function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? '';
  return line.trim();
}

export function HistoryTab({ agentId }: { agentId?: string }) {
  const [rows, setRows] = useState<Entry[]>([]);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [mine, setMine] = useState(false);
  const [note, setNote] = useState('');

  const scope = mine && agentId ? agentId : undefined;

  const refresh = async (q = query): Promise<void> => {
    try {
      const next = q.trim()
        ? await window.cth.historySearch(q.trim(), LIMIT)
        : await window.cth.historyList(scope, LIMIT);
      // Search has no agent scope in the store, so apply it here rather than
      // quietly returning other agents' prompts under a "this agent" filter.
      setRows(scope ? next.filter((r) => r.agentId === scope) : next);
    } catch { setNote('Could not read history.'); }
  };

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mine, agentId]);
  // Debounce so typing doesn't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { void refresh(query); }, 200);
    return () => clearTimeout(t);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [query]);

  const open = useMemo(() => rows.find((r) => r.id === openId) ?? null, [rows, openId]);

  const copy = async (text: string): Promise<void> => {
    try { await navigator.clipboard.writeText(text); setNote('Copied.'); }
    catch { setNote('Copy failed.'); }
  };

  const remove = async (id: number): Promise<void> => {
    try {
      const r = await window.cth.historyDelete(id);
      setNote(r.ok ? 'Deleted.' : 'Already gone.');
      if (openId === id) setOpenId(null);
      await refresh();
    } catch { setNote('Delete failed.'); }
  };

  const clearAll = async (): Promise<void> => {
    try {
      const r = await window.cth.historyClear(scope);
      setNote(`Cleared ${r.removed} prompt(s).`);
      setOpenId(null);
      await refresh();
    } catch { setNote('Clear failed.'); }
  };

  const exportJson = async (): Promise<void> => {
    try {
      const all = await window.cth.historyExport(scope);
      await navigator.clipboard.writeText(JSON.stringify(all, null, 2));
      setNote(`Copied ${all.length} prompt(s) as JSON.`);
    } catch { setNote('Export failed.'); }
  };

  return (
    <Scroll>
      <Section title="COMMAND HISTORY">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search your prompts"
          aria-label="Search command history"
          style={{
            width: '100%', boxSizing: 'border-box', padding: '6px 8px', marginBottom: 6,
            fontFamily: 'var(--cth-font-ui)', fontSize: 13,
            color: 'var(--cth-ink-900)', background: 'var(--cth-paper-100)',
            border: '1px solid var(--cth-ink-300)'
          }}
        />
        {agentId && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            <span style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-700)' }}>
              This agent only
            </span>
          </label>
        )}

        {rows.length === 0 && (
          <Muted>{query.trim() ? 'No prompt matches that.' : 'No prompts recorded yet.'}</Muted>
        )}

        {rows.map((r) => (
          <div
            key={r.id}
            style={{
              padding: '4px 0', borderBottom: '1px solid var(--cth-ink-100)',
              display: 'flex', gap: 6, alignItems: 'baseline'
            }}
          >
            <span style={{ fontSize: 11, color: 'var(--cth-ink-300)', flexShrink: 0, minWidth: 52 }}>{when(r.ts)}</span>
            <span style={{ fontSize: 11, color: 'var(--cth-ink-500)', flexShrink: 0 }}>{r.agentId}</span>
            <button
              onClick={() => setOpenId(openId === r.id ? null : r.id)}
              aria-expanded={openId === r.id}
              title="Show the full prompt"
              style={{
                flex: 1, minWidth: 0, textAlign: 'left', cursor: 'pointer',
                border: 'none', background: 'transparent', padding: 0,
                fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}
            >
              {firstLine(r.text) || '(blank)'}
            </button>
          </div>
        ))}

        {open && (
          <div style={{ marginTop: 8, padding: 8, background: 'var(--cth-paper-100)', border: '1px solid var(--cth-ink-300)' }}>
            <pre style={{
              margin: 0, maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              fontFamily: 'var(--cth-font-mono)', fontSize: 12, color: 'var(--cth-ink-900)'
            }}>{open.text}</pre>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <PixelButton size="sm" variant="secondary" onClick={() => void copy(open.text)}>copy</PixelButton>
              <DestructiveAction
                label="delete" confirmLabel="delete this prompt"
                doneLabel="Deleted." undoable
                onRun={() => void remove(open.id)}
              />
            </div>
          </div>
        )}
      </Section>

      <Section title="YOUR DATA">
        <Muted>
          Every prompt you send an agent is recorded here. Export copies it as JSON; clearing is permanent.
        </Muted>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <PixelButton size="sm" variant="secondary" onClick={() => void exportJson()}>export json</PixelButton>
          <DestructiveAction
            label={scope ? 'clear this agent' : 'clear all'}
            confirmLabel={scope ? 'yes, clear this agent' : 'yes, clear everything'}
            doneLabel="Cleared." undoable
            onRun={() => void clearAll()}
          />
        </div>
        {note && (
          <div style={{ marginTop: 6, fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-700)' }}>{note}</div>
        )}
      </Section>
    </Scroll>
  );
}
