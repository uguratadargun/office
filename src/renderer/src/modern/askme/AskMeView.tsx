import { useState } from 'react';
import { Send, X } from 'lucide-react';
import { useStore } from '@/store/store';
import { type HiveTask, type HumanQA, openQuestion, waitsOnHuman } from '@/store/taskLedger';
import { dismissAsk, withDismissal } from '@/store/taskActions';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { cn } from '../lib/cn';
import { AnswerBox } from '../tasks/AnswerBox';
import { TaskDetailSheet } from '../tasks/TaskDetailSheet';
import { useLedger } from '../tasks/useLedger';
import { column } from '../tasks/status';

/**
 * ASK ME — everything the team is waiting on YOU for.
 *
 * An entry is not necessarily a question: it can be a to-do only a human can
 * perform (make an account, approve a spend, provide a credential, test on real
 * hardware). Each card shows the ask, somewhere to answer it, and the CASCADE of
 * work stuck behind it — so "why isn't X done?" reads as "ah, because I still
 * owe something here."
 *
 * `waitsOnHuman` comes from `@shared/humanQa` through `store/taskLedger` (MD-83)
 * and does NOT look at status: the god does not always move a card to blocked
 * when it appends an ask, and a card can reach done with one still open. Do not
 * add a status filter here — that disagreement between the two boards is the
 * exact bug MD-83 closed.
 */
export function AskMeView() {
  const taskDetailId = useStore((s) => s.taskDetailId);
  const openTaskDetail = useStore((s) => s.openTaskDetail);
  const closeTaskDetail = useStore((s) => s.closeTaskDetail);
  const { tasks, setTasks, patch, nameFor } = useLedger();
  const [busy, setBusy] = useState<string | null>(null);

  const waiting = tasks.filter(waitsOnHuman);
  const detail = tasks.find((t) => t.id === taskDetailId);

  /** Clear an ask off this board WITHOUT answering it: the entry is marked
   *  `dismissedAt` — no fabricated answer — so the question stays on the card and
   *  the Q&A history is never dropped. The task keeps its status; the god can
   *  re-ask by appending a fresh entry. */
  async function dismiss(task: HiveTask) {
    const ask = openQuestion(task);
    if (!ask || busy === task.id) return;
    setBusy(task.id);
    const before = tasks;
    // Optimistic through the SAME transform the write uses, so the card that
    // disappears and the card that is saved can never disagree.
    const shown = withDismissal(task, ask, new Date().toISOString());
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, humanQA: shown } : t)));
    try {
      if (!await dismissAsk(task)) setTasks(before);
    } catch { setTasks(before); }
    setBusy(null);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
        <span className="text-[13px] text-muted-foreground">
          {waiting.length === 0 ? 'Nothing open' : `${waiting.length} open`}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* These are prose, not a grid: one column, capped, centred. */}
        <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
          {waiting.length === 0 && (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <p className="text-sm">Nothing needs you right now.</p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                When the team needs your input on a task — a question to answer, or a to-do only you
                can perform — it shows up here, whatever column the card is sitting in.
              </p>
            </div>
          )}

          {waiting.map((t) => (
            <AskCard
              key={t.id}
              task={t}
              assigneeName={nameFor(t.assignee)}
              nameFor={nameFor}
              all={tasks}
              busy={busy === t.id}
              onOpen={() => openTaskDetail(t.id)}
              onDismiss={() => void dismiss(t)}
              onAnswered={(qa) => setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, humanQA: qa } : x)))}
            />
          ))}
        </div>
      </div>

      <TaskDetailSheet
        task={detail}
        all={tasks}
        assigneeName={nameFor(detail?.assignee)}
        onMove={(s) => { if (detail) void patch(detail.id, { status: s }); }}
        onAssigned={(ids, assignee) =>
          setTasks((prev) => prev.map((t) => (ids.includes(t.id) ? { ...t, assignee } : t)))}
        onAnswered={(qa: HumanQA[]) =>
          setTasks((prev) => prev.map((t) => (t.id === detail?.id ? { ...t, humanQA: qa } : t)))}
        onClose={closeTaskDetail}
      />
    </div>
  );
}

function AskCard({ task, assigneeName, nameFor, all, busy, onOpen, onDismiss, onAnswered }: {
  task: HiveTask;
  assigneeName?: string;
  nameFor: (id?: string) => string | undefined;
  all: HiveTask[];
  busy: boolean;
  onOpen: () => void;
  onDismiss: () => void;
  onAnswered: (qa: HumanQA[]) => void;
}) {
  const ask = openQuestion(task)!;
  const stuck = dependentsTree(task.id, all);
  const answered = (task.humanQA ?? []).filter((e) => e.a).length;

  return (
    <article className="flex flex-col rounded-lg border bg-card">
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <button
          onClick={onOpen}
          className="min-w-0 flex-1 truncate text-left text-[13px] font-medium hover:underline"
          title="Open the full task"
        >
          {task.title}
        </button>
        {assigneeName && <Badge variant="secondary" className="font-normal">{assigneeName}</Badge>}
        {/* Read-only: the ask has been mirrored to the chat, so an answer typed
            there and an answer typed here land on the same entry. */}
        {typeof ask.tgMessageId === 'number' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="gap-1 font-normal">
                <Send className="size-3" />
                Telegram
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom">Mirrored to Telegram — you can answer there too</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost" size="icon-xs" disabled={busy}
              aria-label="Dismiss this ask"
              onClick={onDismiss}
            >
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Dismiss — clears this off the board without answering. The question stays on the card.
          </TooltipContent>
        </Tooltip>
      </header>

      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm leading-6 whitespace-pre-wrap">{ask.q}</p>

        <AnswerBox task={task} onAnswered={onAnswered} />

        {answered > 0 && (
          <button onClick={onOpen} className="self-start text-xs text-muted-foreground hover:underline">
            View {answered} earlier {answered === 1 ? 'answer' : 'answers'}
          </button>
        )}

        {stuck.length > 0 && (
          <>
            <Separator />
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-destructive">
                Blocking {stuck.length} downstream {stuck.length === 1 ? 'task' : 'tasks'}
              </p>
              {stuck.slice(0, 6).map((d, i) => (
                <div
                  key={d.id}
                  className={cn('flex items-center gap-2 text-xs text-muted-foreground',
                    i === 0 ? 'pl-0' : i === 1 ? 'pl-3' : i === 2 ? 'pl-6' : 'pl-9')}
                >
                  <span className={cn('size-1.5 shrink-0 rounded-full', column(d.status).dot)} aria-hidden />
                  <span className="min-w-0 truncate">{d.title}</span>
                  {nameFor(d.assignee) && <span className="shrink-0">· {nameFor(d.assignee)}</span>}
                </div>
              ))}
              {stuck.length > 6 && (
                <p className="text-xs text-muted-foreground/70">… and {stuck.length - 6} more</p>
              )}
            </div>
          </>
        )}
      </div>
    </article>
  );
}

/** Everything transitively waiting on `id`, cycle-safe. */
function dependentsTree(id: string, all: HiveTask[], seen = new Set<string>()): HiveTask[] {
  if (seen.has(id)) return [];
  seen.add(id);
  const direct = all.filter((t) => Array.isArray(t.dependsOn) && t.dependsOn.includes(id) && t.status !== 'done');
  return direct.flatMap((d) => [d, ...dependentsTree(d.id, all, seen)]);
}
