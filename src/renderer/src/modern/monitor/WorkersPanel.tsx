import { useCallback, useEffect, useState } from 'react';

import { useStore } from '@/store/store';
import { TOKENS_BILLED_TIP } from '@shared/usageFormat';
import {
  preservedAgeLabel, stopWorkerConsequence, workerCapacityLabel, workerMetaRow, workerStatusLabel
} from '@shared/workers';
import { Badge } from '../components/ui/badge';
import { Card, CardContent } from '../components/ui/card';
import { DestructiveButton } from '../components/DestructiveButton';
import { Skeleton } from '../components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';

type WorkersData = Awaited<ReturnType<typeof window.cth.listWorkers>>;

/** Live workers change on their own, and there is nothing to subscribe to —
 *  main keeps the map. The classic panel's 2s is what this list was tuned at. */
const POLL_MS = 2000;

/**
 * WORKERS — the ephemeral Slack workers the god spins up: fresh isolated
 * worktree, one job, a reply in-thread, teardown.
 *
 * This UI could not see them at ALL (MD-147 card C), which is the part that
 * matters: a worker is a real process spending real tokens against a real
 * worktree, and the only way to watch or stop one was to switch front-ends.
 * It sits under Monitor rather than in the nav because it answers Monitor's
 * question — what is running right now — for the half of the floor that is not
 * on the roster.
 *
 * Stopping is `DestructiveButton`: it kills a live process mid-job, so it arms
 * first and says what that costs. It does NOT claim the work is lost — teardown
 * preserves a worktree that still holds un-integrated work, and a wrong warning
 * there is what makes people leave a runaway worker running.
 */
export function WorkersPanel() {
  const [data, setData] = useState<WorkersData | null>(null);
  const [stopping, setStopping] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const boss = useStore((s) => s.bossName);

  const refresh = useCallback(() => {
    window.cth.listWorkers().then(setData).catch(() => { /* main not ready */ });
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const stop = useCallback((workerId: string) => {
    setStopping((s) => ({ ...s, [workerId]: true }));
    setError(null);
    window.cth.stopWorker(workerId)
      // A failed stop is the one outcome the classic panel swallowed: the row
      // just stayed put and looked like the button had done nothing.
      .then((res) => { if (!res.ok) setError(res.error ?? 'The worker could not be stopped.'); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setStopping((s) => { const { [workerId]: _gone, ...rest } = s; return rest; });
        refresh();
      });
  }, [refresh]);

  if (!data) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const live = data.live ?? [];
  const preserved = data.preserved ?? [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-semibold tracking-tight">Live workers</h2>
          <span className="font-mono text-xs text-muted-foreground">
            {workerCapacityLabel(live.length, data.maxWorkers ?? 4)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Isolated workers {boss} spins up to handle Slack messages — they run to completion,
          reply in-thread, then tear down.
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {live.length === 0 ? (
          <Card>
            <CardContent className="text-sm text-muted-foreground">No workers running right now.</CardContent>
          </Card>
        ) : (
          live.map((w) => (
            <Card key={w.workerId}>
              <CardContent className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant={w.releasing ? 'secondary' : 'default'}>{workerStatusLabel(w)}</Badge>
                    <span className="truncate text-sm font-medium">{w.name}</span>
                    {w.hasSlack && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline">slack</Badge>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Replies to a Slack thread</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <DestructiveButton
                    size="xs"
                    label={w.releasing || stopping[w.workerId] ? 'Stopping…' : 'Stop'}
                    confirmLabel={`Stop ${w.name}`}
                    consequence={stopWorkerConsequence(w)}
                    // No undo: the process is gone the moment this runs, so the
                    // prompt has to be the last chance rather than the first.
                    autoDisarm={false}
                    disabled={w.releasing || !!stopping[w.workerId]}
                    onRun={() => stop(w.workerId)}
                  />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
                  {workerMetaRow(w).map((m) => (
                    <Tooltip key={m.key}>
                      <TooltipTrigger asChild>
                        <span className="truncate">{m.text}</span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        {m.key === 'billed' ? TOKENS_BILLED_TIP : m.title}
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </section>

      {preserved.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-tight">Preserved worktrees ({preserved.length})</h2>
          <p className="text-xs text-muted-foreground">
            Finished workers whose worktree held un-integrated work — kept (never auto-discarded) and
            auto-reclaimed once the work lands in its base branch.
          </p>
          {preserved.map((p) => (
            <Card key={p.wtPath}>
              <CardContent className="flex flex-col gap-1">
                <span className="text-sm font-medium">{p.workerId}</span>
                <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
                  <span className="break-all">{p.wtPath}</span>
                  <span>base: {p.baseBranch}</span>
                  <span>{preservedAgeLabel(p, Date.now())}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
