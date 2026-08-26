import { Trash2 } from 'lucide-react';
import type { HiveTask } from '@/store/taskLedger';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from '../components/ui/alert-dialog';
import { Button } from '../components/ui/button';
import { columnPhrase, deleteSummary } from './bulkDelete';

/**
 * "Delete 12 cards?" — with the twelve described before they go.
 *
 * ONE confirm, not the arm-and-countdown the other destructive controls use,
 * and that is a deliberate difference rather than an oversight. The arm pattern
 * exists for a control you can hit by accident on the way to something else —
 * an ✕ on a card, a Kill beside a Restart. Getting here takes a selection, a
 * press on Delete and a press in a modal, and the modal can say what an armed
 * button cannot: which columns, how many, and what is still in flight. The same
 * reasoning `settings/RestRegistry.tsx` wrote down for revoking a credential.
 *
 * There is no undo. That is stated in the copy rather than implied by its
 * absence: `tasks.json` is the god's ledger and nothing in this app can put a
 * deleted card back.
 */
export function DeleteTasksDialog({ tasks, onConfirm }: {
  /** The selected cards, in board order. */
  tasks: HiveTask[];
  onConfirm: () => void;
}) {
  const summary = deleteSummary(tasks);
  if (!summary.total) return null;
  const phrase = columnPhrase(summary);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
          <Trash2 /> Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {summary.total} {summary.total === 1 ? 'card' : 'cards'}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {/* The columns, named. A count on its own is not something a human
                can check against what they meant to select — "3 in Done" is. */}
            {phrase && <span className="block">Removing {phrase} from the board.</span>}
            {/* The cautions the card asked for: never a silent deletion of work
                that is still moving, or of a question waiting on this human. */}
            {summary.caution && (
              <span className="mt-2 block font-medium text-foreground">{summary.caution}</span>
            )}
            <span className="mt-2 block">
              They are removed from the shared task ledger for every agent, not just this
              view. This cannot be undone.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Delete {summary.total} {summary.total === 1 ? 'card' : 'cards'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
