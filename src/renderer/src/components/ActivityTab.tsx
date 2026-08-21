import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Scroll, Section, Muted } from './CommandCenterPanel';
import { PixelButton } from './PixelButton';
import { useStore } from '@/store/store';
import { relSince } from '@shared/relTime';
import { describeEvent, eventAgents, type EventPage, type EventRow } from '@shared/eventLog';

/**
 * Activity — the hive event log, read properly.
 *
 * It used to be `hiveLog(60)` on a three-second `setInterval`: the last sixty
 * lines, no search, no filter, no way back past line sixty-one, and an unknown
 * kind rendered as `JSON.stringify(e)` — a raw object dropped into a list of
 * otherwise readable sentences. The data was never the problem; the log has been
 * append-only since the hive shipped.
 *
 * The filtering and paging are in `@shared/eventLog` and run in the MAIN process,
 * against the file, so a search reaches the whole log rather than whatever sixty
 * lines the renderer happened to be holding.
 *
 * Colours come from --cth-* tokens only; no hex literals.
 */

const PAGE = 60;
/** Live tail cadence. Unchanged from the old tab — but it now only refreshes
 *  while the user is looking at page one with no query. Polling underneath
 *  someone who has scrolled back or typed a search is how a log loses their
 *  place, so the poll pauses instead. */
const POLL_MS = 3000;

/** Colour per kind — the same status tokens the floor uses, so "blocked" reads
 *  the same here as it does on an avatar. */
function kindColor(kind: string | undefined): string {
  switch (kind) {
    case 'spawn': return 'var(--cth-status-success)';
    case 'message': case 'terminal-handoff': return 'var(--cth-status-thinking)';
    case 'drain': return 'var(--cth-status-working)';
    case 'drop': case 'cwd_invalid': case 'voice_action_error': return 'var(--cth-danger)';
    case 'archive': return 'var(--cth-status-ghost)';
    case 'tasks': return 'var(--cth-status-compacting)';
    default: return 'var(--cth-ink-300)';
  }
}

export function ActivityTab() {
  const [page, setPage] = useState<EventPage | null>(null);
  const [rows, setRows] = useState<EventRow[]>([]);
  const [board, setBoard] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [agent, setAgent] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [err, setErr] = useState('');

  const agents = useStore((s) => s.agents);
  const select = useStore((s) => s.select);
  const requestCommandCenterTab = useStore((s) => s.requestCommandCenterTab);

  const filtered = !!(search.trim() || kind || agent);
  // Ref, not state: the poll reads it without becoming a dependency that
  // re-arms the interval on every keystroke.
  const pausedRef = useRef(false);
  pausedRef.current = filtered || rows.length > PAGE;

  const load = useCallback(async (offset: number): Promise<void> => {
    try {
      const p = await window.cth.hiveLogQuery({ search, kind, agent, offset, limit: PAGE });
      setPage(p);
      setRows((prev) => (offset === 0 ? p.rows : [...prev, ...p.rows]));
      setErr('');
    } catch {
      setErr('Could not read the event log.');
    }
  }, [search, kind, agent]);

  // Filters re-query from the top. Debounced so typing is one query, not one per
  // keystroke — the main process re-reads the file each time.
  useEffect(() => {
    const t = setTimeout(() => { setOpen(null); void load(0); }, 180);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    const readBoard = async (): Promise<void> => {
      try { setBoard(await window.cth.hiveBoard()); } catch { /* noop */ }
    };
    // Only the board on mount — the debounced effect above already issues the
    // first query, and firing both would query the log twice on every filter
    // change as well as at startup.
    void readBoard();
    const t = setInterval(() => {
      void readBoard();
      if (!pausedRef.current) void load(0);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const known = useMemo(() => new Set(agents.map((a) => a.id)), [agents]);
  const nameOf = useCallback(
    (id: string) => agents.find((a) => a.id === id)?.name ?? id,
    [agents]
  );

  /** Click-through. An entry naming an agent still on the floor selects it; a
   *  board entry opens the Tasks tab. Nothing in the log carries a task ID
   *  today, so a card cannot be opened directly — the tab is the honest best. */
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

  const more = page ? page.offset + page.rows.length < page.total : false;

  return (
    <Scroll>
      <Section title="ACTIVITY">
        <input
          value={search}
          onChange={(ev) => setSearch(ev.target.value)}
          placeholder="search the event log"
          aria-label="Search the event log"
          style={{
            width: '100%', boxSizing: 'border-box', padding: '6px 8px', marginBottom: 6,
            fontFamily: 'var(--cth-font-ui)', fontSize: 13,
            color: 'var(--cth-ink-900)', background: 'var(--cth-paper-100)',
            border: '1px solid var(--cth-ink-300)'
          }}
        />
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, minWidth: 0 }}>
          <FilterSelect
            label="Filter by kind" value={kind} onChange={setKind}
            all="all kinds" options={page?.kinds ?? []}
          />
          <FilterSelect
            label="Filter by agent" value={agent} onChange={setAgent}
            all="everyone" options={page?.agents ?? []} render={nameOf}
          />
        </div>

        {err && <Muted>{err}</Muted>}

        {!err && rows.length === 0 && (
          <Muted>{filtered ? 'No event matches that.' : 'Nothing yet.'}</Muted>
        )}

        {rows.map((e) => {
          const label = jumpLabel(e);
          const when = typeof e.ts === 'number' ? relSince(e.ts) : '';
          return (
            <div
              key={e.seq}
              style={{
                padding: '3px 0', borderBottom: '1px solid var(--cth-ink-100)',
                display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0
              }}
            >
              <span
                title={e.kind ?? 'event'}
                style={{
                  flexShrink: 0, width: 7, height: 7, alignSelf: 'center',
                  background: kindColor(e.kind)
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--cth-ink-500)', flexShrink: 0, minWidth: 52 }}>
                {when}
              </span>
              <button
                onClick={() => setOpen(open === e.seq ? null : e.seq)}
                aria-expanded={open === e.seq}
                title="Show the raw event"
                style={{
                  flex: 1, minWidth: 0, textAlign: 'left', cursor: 'pointer',
                  border: 'none', background: 'transparent', padding: 0,
                  fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                }}
              >
                {describeEvent(e)}
              </button>
              {label && (
                <button
                  onClick={() => jump(e)}
                  title={label}
                  aria-label={label}
                  style={{
                    flexShrink: 0, border: 'none', background: 'transparent', cursor: 'pointer',
                    padding: '0 2px', fontSize: 12, color: 'var(--cth-accent)'
                  }}
                >→</button>
              )}
            </div>
          );
        })}

        {open !== null && (
          <pre style={{
            margin: '8px 0 0', padding: 8, maxHeight: 200, overflow: 'auto',
            background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
            fontFamily: 'var(--cth-font-mono)', fontSize: 12, lineHeight: '16px',
            color: 'var(--cth-ink-900)', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
          }}>
            {JSON.stringify(rows.find((r) => r.seq === open) ?? {}, null, 2)}
          </pre>
        )}

        {page && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {more && (
              <PixelButton size="sm" variant="secondary" onClick={() => void load(rows.length)}>
                load more
              </PixelButton>
            )}
            <Muted>
              {rows.length} of {page.total}
              {filtered ? ` matching · ${page.scanned} scanned` : ' event(s)'}
              {/* Never present the scan cap as the whole history. */}
              {page.truncated ? ' · older entries not scanned' : ''}
              {pausedRef.current ? ' · live updates paused' : ''}
            </Muted>
          </div>
        )}
      </Section>

      <Section title="BOARD">
        <pre style={{
          margin: '6px 0 0', padding: 8, maxHeight: 200, overflow: 'auto',
          background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
          fontFamily: 'var(--cth-font-mono)', fontSize: 12, lineHeight: '16px',
          color: 'var(--cth-ink-900)', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
        }}>{board || 'The board is empty.'}</pre>
      </Section>
    </Scroll>
  );
}

function FilterSelect({ label, value, onChange, all, options, render }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  all: string;
  options: string[];
  render?: (v: string) => string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      title={label}
      style={{
        flex: 1, minWidth: 0, maxWidth: '100%', padding: '3px 6px',
        background: 'var(--cth-paper-100)', border: 'none',
        boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
        fontFamily: 'var(--cth-font-ui)', fontSize: 12,
        color: 'var(--cth-ink-900)', cursor: 'pointer'
      }}
    >
      <option value="">{all}</option>
      {options.map((o) => <option key={o} value={o}>{render ? render(o) : o}</option>)}
    </select>
  );
}
