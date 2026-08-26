import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { OWNERSHIP_BANNER_HINT } from '@shared/hiveOwnership';

/**
 * "Another Office instance owns this workspace."
 *
 * MD-139. Two copies of the app on one workspace used to both run the floor —
 * the boot sweep, the outbox router, the sleep reaper, the PR loop — and the
 * second one archived three agents the first one was running. Only one instance
 * writes now; the rest read. That is the correct behaviour, and it is also
 * completely invisible: a read-only window looks exactly like a working one that
 * has stopped doing anything, which is the state a human spent an afternoon
 * diagnosing. So it says so.
 *
 * Root-level and above every view, for the same reason the quit dialog is: the
 * fact is about the whole window, not about whatever is on screen. Renders
 * nothing in the ordinary single-instance case, which is everybody's.
 */
export function ReadOnlyBanner() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Ownership is decided once, at bootstrap, and only changes when the
    // workspace folder does — which reloads the renderer anyway. One read.
    void window.cth.hiveOwnership?.()
      .then((r) => { if (!cancelled) setMessage(r.owner ? null : r.message); })
      .catch(() => { /* older main: assume the ordinary single-instance case */ });
    return () => { cancelled = true; };
  }, []);

  if (!message) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-foreground"
    >
      <Lock className="size-4 shrink-0 text-warning" />
      <span className="min-w-0">
        {message}{' '}
        <span className="text-muted-foreground">{OWNERSHIP_BANNER_HINT}</span>
      </span>
    </div>
  );
}
