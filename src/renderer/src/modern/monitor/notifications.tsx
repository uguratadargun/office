import { useEffect } from 'react';
import { toast } from 'sonner';
import { summarizeReleaseNotes } from '@shared/releaseNotes';
import type { UpdateStatus } from '@shared/updateState';

/**
 * Notifications — the two things this app ever interrupts for, on one channel.
 *
 * The pixel UI raises these as two bespoke fixed-position stacks that each own
 * their own timers, z-index and dismissal. Here they are `toast()` calls into
 * the single `<Toaster/>` the shell mounts, so stacking, dismissal and the
 * close button are the primitive's problem and both notices queue together
 * instead of overlapping in the same corner.
 *
 * What survives from the pixel behaviour, because it was load-bearing:
 *   • Installing is ALWAYS user-initiated — "later" just dismisses.
 *   • No release notes, no notes block: most bodies summarize to nothing, and
 *     an orphan "What's new" heading is worse than no heading.
 *   • Each update version is announced ONCE per app run; a notice that
 *     re-appears on every re-render is the kind of nagging that gets a channel
 *     muted, and the updater has no second channel.
 *
 * Mounting: idempotent by construction. The subscriptions are per-mount but the
 * de-dup keys are module-level, so mounting this in the shell later (to raise
 * toasts while another area is on screen) cannot double any notice.
 */

/** Versions already announced this run — see the "once per run" rule above. */
const announcedUpdates = new Set<string>();
/** Completion ids already toasted; main can re-push on reconnect. */
const announcedCompletions = new Set<string>();

const NOTES_OPTS = { maxBullets: 3, maxChars: 180 };

export function MonitorNotifications() {
  useUpdateToasts();
  useCompletionToasts();
  return null;
}

function useUpdateToasts() {
  useEffect(() => {
    const subscribe = window.cth?.onUpdateStatus;
    if (!subscribe) return;
    return subscribe((status: UpdateStatus) => {
      if (status.state !== 'downloaded' && status.state !== 'available-manual') return;
      const key = `${status.state}:${status.version}`;
      if (announcedUpdates.has(key)) return;
      announcedUpdates.add(key);

      const bullets = summarizeReleaseNotes(status.notes, NOTES_OPTS);
      const description = bullets.length ? bullets.map((b) => `• ${b}`).join('\n') : undefined;

      if (status.state === 'downloaded') {
        toast(`Version ${status.version} is ready`, {
          description,
          duration: Infinity,
          action: {
            label: 'Restart',
            onClick: () => { void window.cth.updateRestartAndInstall(); }
          }
        });
        return;
      }
      toast(`Version ${status.version} is available`, {
        description,
        duration: Infinity,
        action: {
          label: 'Release page',
          onClick: () => { void window.cth.updateOpenRelease(status.url); }
        }
      });
    });
  }, []);
}

function useCompletionToasts() {
  useEffect(() => {
    const subscribe = window.cth?.onRealtimeCompletion;
    if (!subscribe) return;
    return subscribe((e) => {
      if (announcedCompletions.has(e.correlationId)) return;
      announcedCompletions.add(e.correlationId);
      toast(e.summary, {
        description: e.objective,
        duration: 9000
      });
    });
  }, []);
}
