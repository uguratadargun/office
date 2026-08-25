import { useEffect, useState } from 'react';
import { formatUsd } from '@shared/realtimePricing';
import { useRealtimeCost } from '@/realtime/costStore';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Progress } from '../components/ui/progress';
import { cn } from '../lib/cn';

/**
 * The live voice session's spend, and the ceiling the session reads.
 *
 * Reads `realtime/costStore.ts`, which the session feeds via `resetRealtimeCost()`
 * on connect and `recordRealtimeUsage()` on each usage delta. The actual
 * auto-stop lives in the session (it owns the mic); this surfaces the signal and
 * the cap, plus the two cues that say "wrap up": approaching at ≥80%, over at 100%.
 */

const WARN_RATIO = 0.8;

export function CostCard() {
  const { usd, inputTokens, outputTokens, capUsd, overCap, startedTs, setCap } = useRealtimeCost();
  // Local text state so the field can be cleared and typed in without fighting
  // the store on every keystroke.
  const [capText, setCapText] = useState(capUsd != null ? String(capUsd) : '');

  // Keep the input in sync if the cap is changed elsewhere (e.g. a reset).
  useEffect(() => { setCapText(capUsd != null ? String(capUsd) : ''); }, [capUsd]);

  const commitCap = (raw: string) => {
    const n = parseFloat(raw);
    setCap(Number.isFinite(n) && n > 0 ? n : null);
  };

  const live = startedTs != null;
  const ratio = capUsd != null && capUsd > 0 ? usd / capUsd : 0;
  const near = capUsd != null && !overCap && ratio >= WARN_RATIO;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Label htmlFor="voice-cap" className="text-xs text-muted-foreground">Spend cap</Label>
        <Input
          id="voice-cap"
          type="number"
          min="0"
          step="0.5"
          inputMode="decimal"
          placeholder="none"
          value={capText}
          onChange={(e) => setCapText(e.target.value)}
          onBlur={(e) => commitCap(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commitCap((e.target as HTMLInputElement).value); }}
          className="h-8 w-28 font-mono"
        />
        <span className="text-xs text-muted-foreground">USD{capUsd != null ? '' : ' (off)'}</span>
      </div>

      {live ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className={cn('font-mono text-sm font-medium', overCap && 'text-destructive')}>
              {formatUsd(usd)}{capUsd != null ? ` / ${formatUsd(capUsd)}` : ''}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {inputTokens.toLocaleString()} in · {outputTokens.toLocaleString()} out
            </span>
          </div>
          {capUsd != null && (
            <Progress
              value={Math.min(100, Math.round(ratio * 100))}
              className={cn(overCap && '[&>[data-slot=progress-indicator]]:bg-destructive')}
            />
          )}
          {overCap && <p className="text-xs text-destructive">Over the spend cap — time to wrap up.</p>}
          {near && <p className="text-xs text-muted-foreground">Approaching the spend cap.</p>}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {usd > 0 ? `Last session: ${formatUsd(usd)}` : 'No active voice session.'}
        </p>
      )}
    </div>
  );
}
