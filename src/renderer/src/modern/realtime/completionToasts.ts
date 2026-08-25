import { toast } from 'sonner';

/**
 * "…finished X" — the voice completion notice, as a call on the shell's single
 * sonner Toaster instead of a component.
 *
 * The pixel UI's `realtime/CompletionToast.tsx` is 166 lines and 130 of them are
 * a toast stack: a visible cap, per-toast auto-dismiss timers, a fixed
 * bottom-right container. sonner IS that stack, so the port is this file — the
 * subscription, the de-dupe, and the message.
 *
 * Mount once, from `modern/App.tsx`: the shell owns the Toaster, so the shell
 * owns the subscription that feeds it — and a completion must still surface when
 * the voice control is not the thing on screen.
 *
 * (Shape taken from Orcun's parked `feat/modern-triggers-handoff`, 589680f3.)
 */
export function subscribeCompletionToasts(bossName: string): () => void {
  const subscribe = window.cth?.onRealtimeCompletion;
  if (!subscribe) return () => { /* older preload — nothing to unsubscribe */ };

  // Main re-delivers a completion it is not sure landed, so the same
  // (correlationId, completedAt) can arrive twice. sonner de-dupes by id.
  const off = subscribe((evt) => {
    // The pixel toast's title/body split, kept: the summary is what happened,
    // the objective is what it was for — and only some events carry one.
    toast(evt.summary, {
      id: `${evt.correlationId}:${evt.completedAt}`,
      description: evt.objective ?? (evt.taskId ? `Task ${evt.taskId}` : `${bossName} · completed`),
      duration: 9000
    });
  });
  return () => off?.();
}
