/**
 * The per-agent usage readout, polled the way the fleet snapshot is.
 *
 * One call for the whole floor rather than one per card: the main-process
 * handler already walks the registry, so asking per agent would multiply
 * round-trips by floor size to learn the same map. `telemetryUsage` is
 * deliberately not used here — it answers only the live-telemetry rung, which
 * exists for Claude and nothing else, so a codex agent would read as null and
 * the UI could not tell "spent nothing" from "cannot see".
 */
import { useEffect, useState } from 'react';
import type { ResolvedUsage } from '../../../preload';

/** Matches the main-process fleet snapshot cadence — the numbers behind it move
 *  no faster, so polling harder would just re-read the same files. */
const POLL_MS = 8_000;

export function useFleetUsage(): Record<string, ResolvedUsage> {
  const [usage, setUsage] = useState<Record<string, ResolvedUsage>>({});

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const next = await window.cth.fleetUsage();
        if (alive) setUsage(next);
      } catch { /* keep the last good reading rather than blanking the meters */ }
    };
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return usage;
}
