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

  const agents = useStore((s) => s.agents);
  const restorable = useStore((s) => s.restorableAgents);
  /** agents → restorable roster → raw id, so a done card keeps its author's
   *  name after that worker's terminal is gone. */
  const nameFor = useCallback((id?: string): string | undefined =>
    id ? (agents.find((a) => a.id === id)?.name ?? restorable.find((a) => a.id === id)?.name ?? id) : undefined,
  [agents, restorable]);

  return { tasks, setTasks, refresh, patch, remove, nameFor };
}
