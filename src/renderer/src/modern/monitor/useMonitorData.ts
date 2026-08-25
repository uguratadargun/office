/**
 * Monitor — the data wiring (MD-90).
 *
 * Every seam here already existed for the pixel UI; nothing new was added to
 * the main process for the modern one. Two usage ladders are read on purpose:
 * `useFleetTelemetry` is live OTel (Claude only — it carries the sparkline, the
 * rate, the last tool and the breaker) and `useFleetUsage` is the resolved
 * per-provider reading that answers for every engine. `fleetRows.ts` decides
 * which one wins per agent.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '@/store/store';
import { useFleetTelemetry } from '@/hooks/useTelemetry';
import { useFleetUsage } from '@/hooks/useFleetUsage';
import { buildFleetRow, fleetTotals, type FleetInputs, type FleetRow, type FleetTotals } from './fleetRows';

export interface MonitorData {
  rows: FleetRow[];
  totals: FleetTotals;
  /** config.costCapTokens — undefined means NO floor budget, so no meter. */
  floorCap?: number;
  /** Set or clear one agent's own ceiling. Persists the whole map, because
   *  `updateConfig` replaces the top-level key rather than merging into it. */
  setAgentCap: (id: string, tokens: number | undefined) => void;
}

export function useMonitorData(): MonitorData {
  const agents = useStore((s) => s.agents);
  const toolCounts = useStore((s) => s.toolCounts);
  const { samples, spark, rate, lastTool, breakers } = useFleetTelemetry();
  const usage = useFleetUsage();

  const [floorCap, setFloorCap] = useState<number | undefined>(undefined);
  const [agentCaps, setAgentCaps] = useState<Record<string, number>>({});

  useEffect(() => {
    window.cth.getConfig().then((c) => {
      setFloorCap(c.costCapTokens);
      setAgentCaps(c.agentTokenCaps ?? {});
    }).catch(() => { /* keep the meters off rather than guessing a budget */ });
  }, []);

  const setAgentCap = useCallback((id: string, tokens: number | undefined) => {
    setAgentCaps((prev) => {
      const next = { ...prev };
      if (tokens && tokens > 0) next[id] = tokens; else delete next[id];
      void window.cth.updateConfig({ agentTokenCaps: next }).catch(() => { /* noop */ });
      return next;
    });
  }, []);

  const { rows, totals } = useMemo(() => {
    const inputs: FleetInputs = {
      agents, samples, usage, spark, rate, lastTool, breakers, toolCounts, floorCap, agentCaps
    };
    const built = agents.map((a) => buildFleetRow(a, inputs));
    return { rows: built, totals: fleetTotals(built, inputs) };
  }, [agents, samples, usage, spark, rate, lastTool, breakers, toolCounts, floorCap, agentCaps]);

  return { rows, totals, floorCap, setAgentCap };
}
