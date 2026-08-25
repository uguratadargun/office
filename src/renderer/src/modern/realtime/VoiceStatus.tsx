import { useEffect, useState } from 'react';
import { Loader2, Mic, MicOff } from 'lucide-react';
import { useStore } from '@/store/store';
import { useRealtimeMichael, type RealtimeStatus } from '@/realtime/session';
import { useRealtimeCost } from '@/realtime/costStore';
import { formatUsd } from '@shared/realtimePricing';
import { Button } from '../components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Separator } from '../components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { cn } from '../lib/cn';
import { DevicePicker } from './DevicePicker';
import { CostCard } from './CostCard';
import { subscribeCompletionToasts } from './completionToasts';

/**
 * VOICE, as one topbar control.
 *
 * Everything with logic in it — the WebRTC session, the token mint, the cost
 * meter, the tool surface — is `realtime/{session,costStore,actions,tools}.ts`
 * and is REUSED VERBATIM. Only `session.ts`'s three .tsx neighbours in the pixel
 * UI are rebuilt here, and one of them (`CompletionToast`) disappears entirely
 * in favour of the shell's sonner Toaster (see `completionToasts.ts`).
 *
 * It is a topbar control rather than a nav view because voice is never the thing
 * you are looking at — it is a thing you turn on while looking at something
 * else. The full surface (devices, cost, cap) hangs off it in a Popover.
 *
 * (Shape and rationale from Orcun's parked `feat/modern-triggers-handoff`,
 * 589680f3; the BYOK key gate below is the one thing it was missing.)
 */

/** Status → what the button and the dot say. `working` is the mic muted while
 *  the orchestrator acts on what it was told, which is why it is not just "on".
 *  One green and one neutral, per DESIGN-MODERN.md — no sixth accent. */
const LOOK: Record<RealtimeStatus, { label: string; dot: string; live: boolean }> = {
  off: { label: 'Voice off', dot: 'bg-muted-foreground/50', live: false },
  connecting: { label: 'Connecting…', dot: 'bg-muted-foreground', live: false },
  listening: { label: 'Listening', dot: 'bg-success', live: true },
  responding: { label: 'Speaking', dot: 'bg-success', live: true },
  working: { label: 'Working', dot: 'bg-foreground', live: true }
};

export function VoiceStatus() {
  const { status, error, connect, disconnect } = useRealtimeMichael();
  const boss = useStore((s) => s.bossName);
  // Mounted once by the shell's topbar and never unmounted, so this is where the
  // app-wide completion subscription belongs: a voice-dispatched task finishing
  // has to toast whatever view is open, and the shell owns the one Toaster.
  useEffect(() => subscribeCompletionToasts(boss), [boss]);
  const cost = useRealtimeCost();
  const hasKey = useHasOpenAiKey();
  const look = LOOK[status];
  const busy = status === 'connecting';

  // Without a key the control stays VISIBLE but disabled, so `connect()` and
  // `getUserMedia` are never reached — the pixel toggle's rule, and the reason
  // rides in the tooltip rather than in a dead click.
  const tip = !hasKey
    ? `Voice needs your OpenAI API key — it mints the Realtime session. Add it in Settings.`
    : error ?? (look.live ? `Stop talking to ${boss}` : `Talk to ${boss}`);

  return (
    <div className="flex items-center gap-1.5">
      {look.live && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="xs" className="gap-1.5 font-normal">
              <span className={cn('size-1.5 rounded-full', look.dot)} />
              {look.label}
              {cost.usd > 0 && <span className="text-muted-foreground">{formatUsd(cost.usd)}</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            <VoicePanel />
          </PopoverContent>
        </Popover>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={look.live ? 'default' : 'ghost'}
            size="icon-sm"
            disabled={busy || !hasKey}
            aria-label={look.live ? `Stop talking to ${boss}` : `Talk to ${boss}`}
            aria-pressed={look.live}
            onClick={() => (look.live ? disconnect() : void connect())}
          >
            {busy ? <Loader2 className="animate-spin" /> : look.live ? <Mic /> : <MicOff />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tip}</TooltipContent>
      </Tooltip>
    </div>
  );
}

/** Devices, spend and cap — everything that does not belong in a 32px topbar. */
export function VoicePanel() {
  const { model, expiresAt, error } = useRealtimeMichael();
  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-xs text-destructive">{error}</p>}
      <DevicePicker />
      <Separator />
      <CostCard />
      {model && (
        <p className="font-mono text-xs text-muted-foreground">
          {model}
          {expiresAt != null && ` · token expires ${new Date(expiresAt * 1000).toLocaleTimeString()}`}
        </p>
      )}
    </div>
  );
}

/**
 * Whether a BYOK OpenAI key exists — the gate on `connect()`.
 *
 * `store.hasOpenAiKey` is seeded by the PIXEL root (`App.tsx`), which never runs
 * in this UI, so this component SEEDS it itself from the boolean-only IPC and
 * then reads the store. Reading the store is what makes Settings › Voice work:
 * this control is mounted in the topbar and never unmounts, so a local
 * `useState` here would keep saying "no key" for the rest of the session after
 * the user pasted one (MD-94 S3, and the half that made the S1 fix pointless).
 * The key itself never leaves main.
 */
function useHasOpenAiKey(): boolean {
  const has = useStore((s) => s.hasOpenAiKey);
  const setHas = useStore((s) => s.setHasOpenAiKey);
  useEffect(() => {
    let cancelled = false;
    window.cth.realtimeHasOpenAiKey()
      .then((v) => { if (!cancelled) setHas(!!v); })
      .catch(() => { /* no key, no voice — the disabled tooltip already says why */ });
    return () => { cancelled = true; };
  }, [setHas]);
  return has;
}
