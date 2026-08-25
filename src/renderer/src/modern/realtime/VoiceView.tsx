import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Loader2, Volume2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/store/store';
import { useRealtimeMichael, type RealtimeStatus } from '@/realtime/session';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { cn } from '../lib/cn';
import { DevicePicker } from './DevicePicker';
import { CostCard } from './CostCard';

/**
 * VOICE — talk to the orchestrator out loud.
 *
 * The voice loop itself is a module-level singleton (`realtime/session.ts`): one
 * WebRTC session, one mic, whoever is on screen. This view is a consumer of that
 * hook and owns no session state, which is why mounting and unmounting it (a tab
 * switch) never drops a live call.
 *
 * Gating mirrors the pixel toggle: the button stays VISIBLE but DISABLED without
 * a BYOK OpenAI key, so `connect()` / `getUserMedia` are never reached without
 * one, and the reason is on screen rather than in a dead click.
 */

/** Per-status presentation. Colour comes from the token set only — status is the
 *  one place DESIGN-MODERN.md allows it, and never a sixth accent. */
const STATE_VIEW: Record<RealtimeStatus, {
  label: string;
  icon: typeof Mic;
  spin?: boolean;
  pulse?: boolean;
  help: (boss: string) => string;
}> = {
  off: {
    label: 'Talk',
    icon: Mic,
    help: (boss) => `Start a voice session with ${boss}.`
  },
  connecting: {
    label: 'Connecting…',
    icon: Loader2,
    spin: true,
    help: (boss) => `Connecting to ${boss}…`
  },
  listening: {
    label: 'Listening',
    icon: Mic,
    pulse: true,
    help: (boss) => `${boss} is hearing you. Click to stop.`
  },
  responding: {
    label: 'Speaking',
    icon: Volume2,
    pulse: true,
    help: (boss) => `${boss} is speaking. Click to stop.`
  },
  working: {
    label: 'Working',
    icon: Wrench,
    help: (boss) => `${boss} is running a tool — your mic is muted until it returns.`
  }
};

export function VoiceView() {
  const boss = useStore((s) => s.bossName);
  const hasOpenAiKey = useHasOpenAiKey();
  const { status, error, muted, model, expiresAt, connect, disconnect } = useRealtimeMichael();

  useCompletionToasts();

  const view = STATE_VIEW[status];
  const Icon = view.icon;
  const live = status !== 'off';
  const noKey = !hasOpenAiKey;

  const onClick = () => {
    if (noKey) return;
    if (status === 'off') void connect();
    else disconnect();
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[16px]">
            <span
              aria-hidden
              className={cn(
                'size-2 rounded-full',
                status === 'off' ? 'bg-muted-foreground/50' : 'bg-foreground',
                view.pulse && 'animate-pulse'
              )}
            />
            Talk to {boss}
          </CardTitle>
          <CardDescription>
            {noKey
              ? `Voice needs your OpenAI API key — it mints the Realtime session. Add it under Settings → Agents & Models, then come back.`
              : view.help(boss)}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={onClick}
              disabled={noKey || status === 'connecting'}
              variant={live ? 'outline' : 'default'}
              aria-label={live ? `Stop the voice session with ${boss}` : `Start a voice session with ${boss}`}
            >
              {live && status !== 'connecting' ? <MicOff /> : <Icon className={cn(view.spin && 'animate-spin')} />}
              {live ? `Stop · ${view.label}` : view.label}
            </Button>
            {muted && (
              <span className="text-[12px] text-muted-foreground">Mic muted while a tool runs.</span>
            )}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {live && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
              <dt className="text-muted-foreground">Model</dt>
              <dd className="font-mono">{model ?? 'unknown'}</dd>
              {expiresAt != null && (
                <>
                  <dt className="text-muted-foreground">Token expires</dt>
                  <dd className="font-mono">{new Date(expiresAt * 1000).toLocaleTimeString()}</dd>
                </>
              )}
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-[16px]">Devices</CardTitle>
          <CardDescription>Which mic {boss} hears, and which speaker answers.</CardDescription>
        </CardHeader>
        <CardContent><DevicePicker /></CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-[16px]">Session cost</CardTitle>
          <CardDescription>
            Realtime audio is billed per token. The cap is what the session watches to know when to wrap up.
          </CardDescription>
        </CardHeader>
        <CardContent><CostCard /></CardContent>
      </Card>
    </div>
  );
}

/**
 * Whether a BYOK OpenAI key exists — the gate on `connect()`.
 *
 * Read here rather than off `store.hasOpenAiKey`: that mirror is seeded by the
 * PIXEL root (`App.tsx`), which never runs in this UI, so reading it would leave
 * the button permanently disabled. The key itself never leaves main; this is the
 * same boolean-only IPC the pixel toggle gates on.
 */
function useHasOpenAiKey(): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    let cancelled = false;
    window.cth.realtimeHasOpenAiKey()
      .then((v) => { if (!cancelled) setHas(!!v); })
      .catch(() => { /* no key, no voice — the disabled state already says why */ });
    return () => { cancelled = true; };
  }, []);
  return has;
}

/**
 * A voice-dispatched task finished — main pushes it over `realtime:completion`
 * while a session is live. Michael SPEAKS it; this raises
 * the matching toast so the human has a glanceable record when audio is missed
 * or several land at once.
 *
 * The pixel UI mounts its own fixed overlay app-wide. Here the single `<Toaster/>`
 * is the shell's, so this is just a `toast()` — but the SUBSCRIPTION lives with
 * this view, so completions only toast while Voice is on screen. Making it
 * app-wide needs a one-line mount in `AppShell`, which no area may edit.
 */
function useCompletionToasts() {
  const seen = useRef(new Set<string>());
  useEffect(() => {
    return window.cth.onRealtimeCompletion((evt) => {
      // Main may re-push a queued completion on warm start; a correlationId we
      // already toasted is the same event, not a second one.
      const key = `${evt.correlationId}:${evt.completedAt}`;
      if (seen.current.has(key)) return;
      seen.current.add(key);
      toast(evt.summary, {
        description: evt.taskId ? `Task ${evt.taskId}` : evt.objective
      });
    });
  }, []);
}
