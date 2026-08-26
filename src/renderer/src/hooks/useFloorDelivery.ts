import { useCallback, useEffect, useState } from 'react';

import { useStore } from '@/store/store';

/**
 * THE FLOOR-WIDE AUTO-DELIVERY PAUSE, for whichever UI is asking.
 *
 * There is one switch for the whole floor, but no floor-wide store for it: the
 * pause is main-process control state held PER AGENT, kept in step by this one
 * control writing to every agent at once. So reading it is reading any live
 * agent's snapshot, and setting it is a write to all of them.
 *
 * Lifted out of the pixel `CommandCenterPanel` when the modern shell grew the
 * same switch — the half modern had was read-only, so a floor paused from the
 * classic UI could be seen and not undone (MD-148 E).
 */

/** Whose control snapshot answers "is the floor paused?". Prefer the agent the
 *  caller is looking at — its snapshot is the one the rest of that screen is
 *  already reasoning about — and fall back to whoever is on the roster. */
export function floorDeliverySeedId(
  agents: readonly { id: string }[],
  preferredId?: string | null
): string | null {
  if (preferredId && agents.some((a) => a.id === preferredId)) return preferredId;
  return agents[0]?.id ?? null;
}

export interface FloorDelivery {
  paused: boolean;
  /** No agent on the floor — there is nothing to pause, so the control hides
   *  rather than lying about a state it cannot read. */
  available: boolean;
  toggle: () => Promise<void>;
}

export function useFloorDelivery(
  preferredId?: string | null,
  /** Re-read interval in ms. Omit for a single read on mount, which is what the
   *  pixel panel has always done. */
  pollMs?: number
): FloorDelivery {
  const agents = useStore((s) => s.agents);
  const seedId = floorDeliverySeedId(agents, preferredId);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!seedId) return;
    let alive = true;
    const read = () => {
      window.cth.controlSnapshot(seedId)
        .then((s) => { if (alive && s) setPaused(s.autoDeliveryPaused); })
        .catch(() => { /* main not ready — leave the last known state */ });
    };
    read();
    if (!pollMs) return () => { alive = false; };
    const iv = setInterval(read, pollMs);
    return () => { alive = false; clearInterval(iv); };
  }, [seedId, pollMs]);

  const toggle = useCallback(async () => {
    const next = !paused;
    // Optimistic: the switch answers immediately and a failed write is a
    // per-agent miss that the next read corrects, not a dead control.
    setPaused(next);
    const all = useStore.getState().agents;
    await Promise.all(all.map((a) => window.cth.controlAutoDelivery(a.id, next).catch(() => null)));
  }, [paused]);

  return { paused, available: !!seedId, toggle };
}
