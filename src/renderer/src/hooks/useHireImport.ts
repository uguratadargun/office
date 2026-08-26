import { useEffect, useRef } from 'react';

import { latestHire, type HireManifest } from '@shared/hire';
import { useStore } from '@/store/store';

/**
 * THE PUSH HALF OF THE HIRE FLOW, for whichever UI is mounted.
 *
 * An agent hiring another agent (`office://hire`, or main importing a manifest
 * on its own) completes in the main process and then has to reach a window.
 * That was three subscriptions hand-rolled in the PIXEL root only, so in the
 * modern UI the documented hand-off "here is a role, hire it" finished in main,
 * changed nothing on screen, and a failure was swallowed entirely (MD-148).
 *
 * Lifted here unchanged so both roots share one implementation: it STAGES the
 * manifest and opens the Add-Agent surface, and never spawns anything — a
 * pushed hire is reviewed and confirmed by a human exactly like an imported
 * file. The handlers are the only per-UI part (the pixel root wants none; the
 * modern root navigates to its Agents screen and toasts).
 *
 * Deliberately NOT folded into `useHive`: that hook no-ops until the user has
 * picked a hive, and a deep link that lands while the picker is still up must
 * still be caught.
 */
export interface HireImportHandlers {
  /** A manifest has been staged and the Add-Agent surface asked to open. Bring
   *  it on screen if this UI keeps it behind navigation. */
  onImported?: (manifest: HireManifest) => void;
  /** The import failed in main — nothing was staged. Surface it; the hook has
   *  already logged it. */
  onError?: (error: string) => void;
}

export function useHireImport(handlers: HireImportHandlers = {}): void {
  // Held in a ref, not in the dependency list: the callers pass inline closures,
  // so depending on them would tear down and re-subscribe on every render — and
  // re-drain the queue with it.
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const stage = (manifest: HireManifest) => {
      const { setPendingHire, setAddAgentOpen } = useStore.getState();
      setPendingHire(manifest);
      setAddAgentOpen(true);
      latest.current.onImported?.(manifest);
    };

    const unsubImport = window.cth.onHireImport?.(stage);
    // Pull anything that arrived before this subscription existed (cold-start
    // deep links; packaged renderers load too fast for push-on-load).
    void window.cth.drainPendingHires?.().then((queued) => {
      const manifest = latestHire(queued);
      if (manifest) stage(manifest);
    });
    const unsubError = window.cth.onHireError?.((info) => {
      console.error('[hire] import failed:', info.error);
      latest.current.onError?.(info.error);
    });

    return () => { unsubImport?.(); unsubError?.(); };
  }, []);
}
