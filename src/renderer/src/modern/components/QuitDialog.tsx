import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from './ui/alert-dialog';
import { Button } from './ui/button';

/** Renderer-side closing-time view state. Mirrors the main process's
 *  ClosingTimeEvent phases, plus a local 'error' for a failed start. Same shape
 *  the pixel dialog uses — one protocol, two front-ends. */
interface ClosingState {
  phase: 'started' | 'progress' | 'complete' | 'timeout' | 'error';
  acked: number;
  total: number;
  error?: string;
}

/**
 * The quit confirmation, for the modern UI.
 *
 * WHY IT IS A ROOT-LEVEL MOUNT AND NOT A VIEW. `before-quit` in the main process
 * (`src/main/index.ts`) `preventDefault()`s the quit whenever a PTY is alive and
 * pushes `app:closeRequested` to the renderer, then waits for `app:confirmClose`
 * or `app:cancelClose`. Only the pixel `App.tsx` ever answered it, so a modern
 * user's Cmd-Q, red-X and Ctrl-C were all swallowed with no dialog and no reply:
 * the app could only be force-quit. The listener therefore has to exist for as
 * long as the app does, whatever the user is looking at — which is here.
 *
 * It mirrors the pixel `QuitWarningModal` semantics exactly (the same three
 * routes out: keep running / closing time / kill & quit, and the same switch to
 * the closing-time progress view), because the two UIs must not disagree about
 * what quitting means.
 */
export function QuitDialog() {
  const [warn, setWarn] = useState<{ ptyCount: number } | null>(null);
  const [closing, setClosing] = useState<ClosingState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => window.cth.onCloseRequested((info) => setWarn(info)), []);

  // Closing-time progress drives the same dialog: it stays up through the whole
  // protocol and the main process quits by itself moments after 'complete'.
  useEffect(() => window.cth.onClosingTime?.((ev) => {
    if (ev.phase === 'cancelled') { setClosing(null); return; }
    setClosing({ phase: ev.phase, acked: ev.acked, total: ev.total });
    if (ev.phase === 'started' || ev.phase === 'progress') setWarn((w) => w ?? { ptyCount: 0 });
  }), []);

  if (!warn) return null;

  const inClosingTime = !!closing && closing.phase !== 'error';
  const { ptyCount } = warn;

  const cancel = (): void => {
    if (closing) { void window.cth.cancelClosingTime(); setClosing(null); }
    void window.cth.cancelClose();
    setWarn(null);
  };
  const confirm = async (): Promise<void> => {
    setBusy(true);
    await window.cth.confirmClose();
    // No need to clear busy — the app is quitting.
  };
  const startClosingTime = async (): Promise<void> => {
    const res = await window.cth.startClosingTime();
    if (!res.ok) setClosing({ phase: 'error', acked: 0, total: 0, error: res.error });
  };

  return (
    <AlertDialog
      open
      onOpenChange={(open) => { if (!open && !inClosingTime) cancel(); }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {inClosingTime
              ? (closing!.phase === 'complete'
                ? 'Floor saved — see you tomorrow'
                : closing!.phase === 'timeout'
                  ? 'Still wrapping up…'
                  : 'Wrapping up the floor')
              : `${ptyCount} ${ptyCount === 1 ? 'agent' : 'agents'} still running`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {inClosingTime
              ? (closing!.phase === 'complete'
                ? 'Every agent saved its memory and the orchestrator confirmed the shutdown. The harness closes itself in a moment.'
                : 'The orchestrator broadcast closing time. Every worker parks its work, saves its memory, and reports back — the app closes only after the orchestrator confirms nothing will be lost.')
              : <>
                Closing the harness will terminate{' '}
                {ptyCount === 1 ? 'the running claude session' : `all ${ptyCount} running claude sessions`}{' '}
                and discard any unsaved progress they were holding in memory. The conversation
                history inside each session is lost when the PTY exits.
              </>}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {inClosingTime ? (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            {closing!.total > 0
              ? `${closing!.acked} / ${closing!.total} workers confirmed${closing!.acked >= closing!.total ? ' — waiting for the orchestrator' : ''}`
              : 'No workers on the floor — waiting for the orchestrator'}
            {closing!.phase === 'timeout' && (
              <p className="mt-2">
                This is taking a while (an agent may be mid-compaction or deep in a tool call).
                Keep waiting, or force quit and accept the data loss.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            Tip: <span className="text-foreground">closing time</span> is the safe way out — the
            orchestrator has every agent commit its work and save its memory, and the app closes
            itself once the whole floor has confirmed. No data loss.
          </div>
        )}

        {closing?.phase === 'error' && (
          <p className="text-sm text-destructive">
            {closing.error ?? 'Closing time could not start.'}
          </p>
        )}

        <AlertDialogFooter>
          {(!inClosingTime || closing!.phase !== 'complete') && (
            <>
              <AlertDialogCancel disabled={busy} onClick={cancel}>
                {inClosingTime ? 'Cancel — back to work' : 'Keep them running'}
              </AlertDialogCancel>
              {!inClosingTime && (
                <Button variant="outline" disabled={busy} onClick={() => void startClosingTime()}>
                  <Clock className="size-4" /> Closing time
                </Button>
              )}
              <AlertDialogAction variant="destructive" disabled={busy} onClick={(e) => {
                // The dialog must survive the click: the app is still quitting
                // asynchronously and closing it would drop the progress view.
                e.preventDefault();
                void confirm();
              }}>
                {busy
                  ? 'Killing…'
                  : inClosingTime
                    ? 'Force quit now'
                    : `Kill ${ptyCount === 1 ? 'it' : 'all'} & quit`}
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
