import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@/store/store';
import { type HiveTask, TASK_POLL_MS, parseTasks } from '@/store/taskLedger';

/**
 * The ledger, for every modern view that reads it (the board, the detail sheet,
 * ASK ME). ONE hook rather than three copies of the same poll: the pixel UI has
 * that copy three times over and each one had to relearn that `parseTasks`
 * NORMALIZES — a raw card without `dependsOn` crashed the detail once.
 *
 * `patch` is optimistic-then-resync, the same shape the pixel board uses: main
 * patches the named id against its LATEST on-disk ledger, so a card the god
 * added since this renderer's last poll cannot be lost by our write.
 */
export function useLedger(): {
  tasks: HiveTask[];
  setTasks: React.Dispatch<React.SetStateAction<HiveTask[]>>;
  refresh: () => Promise<void>;
  patch: (id: string, fields: { status?: HiveTask['status']; archived?: boolean }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  removeMany: (ids: string[]) => Promise<{ ok: boolean; deleted: string[]; missing: string[] }>;
  nameFor: (id?: string) => string | undefined;
} {
  const [tasks, setTasks] = useState<HiveTask[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try { setTasks(parseTasks(await window.cth.hiveTasks())); } catch { /* keep last good */ }
  }, []);

  useEffect(() => {
    void refresh();
    timer.current = setInterval(() => { void refresh(); }, TASK_POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [refresh]);

  const patch = useCallback(async (
    id: string,
    fields: { status?: HiveTask['status']; archived?: boolean }
  ) => {
    setTasks((prev) => prev.map((t) => (t.id === id
      ? { ...t, ...fields, archived: 'archived' in fields ? (fields.archived || undefined) : t.archived }
      : t)));
    try {
      const result = await window.cth.hivePatchTask(id, fields);
      if (!result.ok) void refresh();
    } catch { void refresh(); }
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try {
      const result = await window.cth.hiveDeleteTask(id);
      if (!result.ok) void refresh();
    } catch { /* the next poll re-syncs from disk */ }
  }, [refresh]);

  /**
   * Delete a whole selection in ONE ledger write (MD-136).
   *
   * Not `ids.map(remove)`: every call re-reads tasks.json and writes it back, so
   * N calls give the god N chances to append a card between a read and a write
   * — and clearing a finished column is exactly when the god is busiest. The
   * batch endpoint does the read-modify-write once.
   *
   * Optimistic like `remove`, and it RESYNCS on anything unexpected. Unlike
   * `remove` it returns the outcome, because the caller has a count to report
   * and `missing` is a normal answer rather than an error: the board polls every
   * 5s, so an id can legitimately have gone between the selection and the press.
   */
  const removeMany = useCallback(async (ids: string[]) => {
    if (!ids.length) return { ok: true, deleted: [], missing: [] };
    const gone = new Set(ids);
    setTasks((prev) => prev.filter((t) => !gone.has(t.id)));
    try {
      const result = await window.cth.hiveDeleteTasks(ids);
      // Re-read whenever the write did not do exactly what we drew: a refused
      // batch must not leave the board pretending the cards are gone, and a
      // partial one must not leave it pretending they all were.
      if (!result.ok || result.missing.length) void refresh();
      return { ok: result.ok, deleted: result.deleted ?? [], missing: result.missing ?? [] };
    } catch {
      void refresh();
      return { ok: false, deleted: [], missing: [] };
    }
  }, [refresh]);

  const agents = useStore((s) => s.agents);
  const restorable = useStore((s) => s.restorableAgents);
  /** agents → restorable roster → raw id, so a done card keeps its author's
   *  name after that worker's terminal is gone. */
  const nameFor = useCallback((id?: string): string | undefined =>
    id ? (agents.find((a) => a.id === id)?.name ?? restorable.find((a) => a.id === id)?.name ?? id) : undefined,
  [agents, restorable]);

  return { tasks, setTasks, refresh, patch, remove, removeMany, nameFor };
}
