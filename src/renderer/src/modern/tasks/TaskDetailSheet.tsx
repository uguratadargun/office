import { useStore } from '@/store/store';
import { type HiveTask, type HumanQA, openQuestion } from '@/store/taskLedger';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { Separator } from '../components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '../components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { cn } from '../lib/cn';
import { askOptions, chosenOption } from '@shared/askOptions';
import { AnswerBox } from './AnswerBox';
import { AssignControl } from './AssignControl';
import { PriorityDots } from './TaskCard';
import { COLUMNS, column, type Status } from './status';

/**
 * The whole card. A side Sheet rather than a modal Dialog: the board behind it
 * stays readable, and Radix gives the same focus trap, restore and Escape the
 * pixel UI got from a native `<dialog>`.
 *
 * Everything the ledger holds is shown — description, RESULT and the human Q&A
 * trail included. `result` was written by every finishing agent and rendered
 * nowhere for months; that is the failure mode this section exists to prevent.
 */
export function TaskDetailSheet({ task, all, assigneeName, onMove, onAssigned, onAnswered, onClose }: {
  task: HiveTask | undefined;
  all: HiveTask[];
  assigneeName?: string;
  onMove: (s: Status) => void;
  onAssigned: (ids: string[], assignee: string) => void;
  onAnswered: (qa: HumanQA[]) => void;
  onClose: () => void;
}) {
  const boss = useStore((s) => s.bossName);
  const open = !!task;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="flex w-[640px] max-w-[92vw] flex-col gap-0 p-0 sm:max-w-[92vw]">
        {task ? <Body
          task={task} all={all} assigneeName={assigneeName} boss={boss}
          onMove={onMove} onAssigned={onAssigned} onAnswered={onAnswered}
        /> : (
          <SheetHeader>
            <SheetTitle>Task</SheetTitle>
            <SheetDescription>This card is no longer in the ledger.</SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Body({ task, all, assigneeName, boss, onMove, onAssigned, onAnswered }: {
  task: HiveTask;
  all: HiveTask[];
  assigneeName?: string;
  boss: string;
  onMove: (s: Status) => void;
  onAssigned: (ids: string[], assignee: string) => void;
  onAnswered: (qa: HumanQA[]) => void;
}) {
  const col = column(task.status);
  const ask = openQuestion(task);
  // Belt and braces: parseTasks normalizes these, but the ledger is a
  // hand-written file — never trust a card's shape at the point of use.
  const deps = (task.dependsOn ?? [])
    .map((id) => all.find((t) => t.id === id))
    .filter((t): t is HiveTask => !!t);
  const created = new Date(task.createdAt);
  const closed = task.closedAt ? new Date(task.closedAt) : null;
  const qa = task.humanQA ?? [];

  return (
    <>
      <SheetHeader className="gap-2 border-b p-5">
        <div className="flex items-start gap-2.5">
          <span className={cn('mt-1.5 h-4 w-0.5 shrink-0 rounded-full', col.bar)} aria-hidden />
          <SheetTitle className="text-base leading-6 font-semibold">{task.title}</SheetTitle>
        </div>
        <SheetDescription asChild>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary" className="font-normal">{col.label}</Badge>
            {assigneeName
              ? <Badge variant="secondary" className="font-normal">{assigneeName}</Badge>
              : <span>Unassigned</span>}
            <PriorityDots level={task.priority} />
            {task.origin && <span className="max-w-64 truncate" title={task.origin}>from {task.origin}</span>}
            <span className="ml-auto shrink-0">
              {isNaN(created.getTime()) ? '' : created.toLocaleString()}
              {closed && !isNaN(closed.getTime()) ? ` → ${closed.toLocaleString()}` : ''}
            </span>
          </div>
        </SheetDescription>
      </SheetHeader>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-6 p-5">
          <Section title="Description">
            <Pre muted={!task.description?.trim()}>
              {task.description?.trim() || 'No description on this card.'}
            </Pre>
          </Section>

          {task.result && (
            <Section title="Result">
              <Pre>{task.result}</Pre>
            </Section>
          )}

          {qa.length > 0 && (
            <Section title="Human Q&A">
              <div className="flex flex-col gap-4">
                {qa.map((e, i) => (
                  <div key={i} className="flex flex-col gap-2">
                    <div className="rounded-lg border bg-muted/40 p-3 text-sm leading-5 whitespace-pre-wrap">
                      {/* The open ask shows its stem — its options are the list
                          inside AnswerBox below. Answered ones keep the whole
                          question: that is the decision trail. */}
                      {e === ask ? askOptions(e).stem : e.q}
                    </div>
                    {e.a ? (
                      <div className="ml-4 flex flex-col gap-1 rounded-lg border p-3 text-sm leading-5">
                        <span className="whitespace-pre-wrap">{e.a}</span>
                        {/* A bare letter is unreadable a week later — say which
                            option it was. */}
                        {chosenOption(e) && (
                          <span className="text-xs text-muted-foreground">{chosenOption(e)!.label}</span>
                        )}
                      </div>
                    ) : e === ask ? (
                      // The board knew what was needed and sent you to another
                      // screen to type it. Answer it where you are reading it.
                      <div className="ml-4"><AnswerBox task={task} onAnswered={onAnswered} /></div>
                    ) : (
                      <div className="ml-4 text-xs text-muted-foreground">
                        No answer — superseded by a later ask.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {deps.length > 0 && (
            <Section title="Depends on">
              <div className="flex flex-col gap-1.5">
                {deps.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                    <span className={cn('size-1.5 shrink-0 rounded-full', column(d.status).dot)} aria-hidden />
                    <span className="min-w-0 truncate">{d.title}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{column(d.status).label}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </ScrollArea>

      <Separator />
      <div className="flex items-center gap-2 p-4">
        <Select value={task.status} onValueChange={(v) => onMove(v as Status)}>
          <SelectTrigger size="sm" className="w-36" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COLUMNS.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <AssignControl tasks={[task]} onAssigned={onAssigned} />
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{boss} writes this board</span>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** The contract, preserved line by line — it is written as text, not markup. */
function Pre({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div className={cn(
      'rounded-lg border p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap',
      muted && 'text-muted-foreground'
    )}>{children}</div>
  );
}
