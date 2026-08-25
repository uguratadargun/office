import { useCallback, useEffect, useState } from 'react';
import type { HarnessConfig } from '@/store/config';

/**
 * The one config read/write for the whole Settings panel.
 *
 * `updateConfig` returns the SAVED config, and main normalises on the way in —
 * it expands `~` in `harnessHome` and `registeredRepos`, rounds numbers, drops
 * blanks. Adopting the response instead of the value we sent is therefore not a
 * nicety: a typed `~/dev/foo` that stays literal in renderer state rides along
 * into the next spawn, which is exactly the bug `AddAgentModal` carries a
 * comment about (`components/AddAgentModal.tsx`, `registerProject`).
 *
 * There is no dirty state and no Save button. Every row writes on commit —
 * toggles and selects on change, text and numbers on blur — the same contract
 * the pixel modal has, so the two UIs cannot disagree about when a setting took
 * effect.
 */
export interface ConfigApi {
  config: HarnessConfig | null;
  /** Patch, adopt the saved result, and hand it back for callers that need it. */
  save: (patch: Partial<HarnessConfig>) => Promise<HarnessConfig | null>;
  /** Re-read from disk — for the rows that other surfaces can also change. */
  reload: () => Promise<void>;
}

export function useConfig(): ConfigApi {
  const [config, setConfig] = useState<HarnessConfig | null>(null);

  const reload = useCallback(async () => {
    try { setConfig(await window.cth.getConfig()); } catch { /* keep what we have */ }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const save = useCallback(async (patch: Partial<HarnessConfig>) => {
    try {
      const saved = await window.cth.updateConfig(patch);
      setConfig(saved);
      return saved;
    } catch {
      // The write failed; re-read so the form shows what is actually on disk
      // rather than the value the user typed into a field that did not save.
      await reload();
      return null;
    }
  }, [reload]);

  return { config, save, reload };
}

/** `''` means "unset" for every optional number in HarnessConfig — an empty box
 *  clears the key rather than writing 0, which for maxTurns or a token cap would
 *  mean something very different from "no limit". */
export function numOrUndefined(raw: string, round = true): number | undefined {
  const t = raw.trim();
  if (t === '') return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return round ? Math.round(n) : n;
}

/** Number for display: `undefined` shows as a blank box, not "undefined". */
export function numText(v: number | undefined | null): string {
  return v == null ? '' : String(v);
}
