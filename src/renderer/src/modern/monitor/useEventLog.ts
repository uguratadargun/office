/**
 * The hive event log, read the way ActivityTab reads it (MD-90).
 *
 * The filtering and paging run in the MAIN process against the file
 * (`hive:logQuery`), so a search reaches the whole log rather than whichever
 * page the renderer happens to be holding.
 *
 * The one behaviour worth naming: the live tail PAUSES while the user is
 * filtering or has paged back. Polling underneath someone who has scrolled into
 * history is how a log loses their place.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventPage, EventRow } from '@shared/eventLog';

const PAGE = 60;
const POLL_MS = 3000;

export interface EventLogState {
  rows: EventRow[];
  page: EventPage | null;
  board: string;
  error: string;
  search: string;
  kind: string;
  agent: string;
  /** True when any filter is active — drives the empty-state wording. */
  filtered: boolean;
  /** True when the live tail is held back (filtered, or paged past page one). */
  paused: boolean;
  /** More rows exist beyond what has been loaded. */
  more: boolean;
  setSearch: (v: string) => void;
  setKind: (v: string) => void;
  setAgent: (v: string) => void;
  loadMore: () => void;
}

export function useEventLog(): EventLogState {
  const [page, setPage] = useState<EventPage | null>(null);
  const [rows, setRows] = useState<EventRow[]>([]);
  const [board, setBoard] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [agent, setAgent] = useState('');
  const [error, setError] = useState('');

  const filtered = !!(search.trim() || kind || agent);
  // A ref, not state: the poll reads it without becoming a dependency that
  // would re-arm the interval on every keystroke.
  const pausedRef = useRef(false);
  const paused = filtered || rows.length > PAGE;
  pausedRef.current = paused;

  const load = useCallback(async (offset: number): Promise<void> => {
    try {
      const p = await window.cth.hiveLogQuery({ search, kind, agent, offset, limit: PAGE });
      setPage(p);
      setRows((prev) => (offset === 0 ? p.rows : [...prev, ...p.rows]));
      setError('');
    } catch {
      setError('Could not read the event log.');
    }
  }, [search, kind, agent]);

  // Filters re-query from the top, debounced — the main process re-reads the
  // file on each query, so one query per pause beats one per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { void load(0); }, 180);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    const readBoard = async (): Promise<void> => {
      try { setBoard(await window.cth.hiveBoard()); } catch { /* noop */ }
    };
    // Only the board on mount: the debounced effect above already issues the
    // first query, and firing both would query the log twice at startup and
    // again on every filter change.
    void readBoard();
    const t = setInterval(() => {
      void readBoard();
      if (!pausedRef.current) void load(0);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const more = page ? page.offset + page.rows.length < page.total : false;
  const loadMore = useCallback(() => { void load(rows.length); }, [load, rows.length]);

  return {
    rows, page, board, error, search, kind, agent,
    filtered, paused, more,
    setSearch, setKind, setAgent, loadMore
  };
}
