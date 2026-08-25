import { useEffect, useState } from 'react';
import { Pause, Play, Send, Square } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { cn } from '../lib/cn';

interface Snapshot {
  paused: boolean;
  halted: boolean;
  autoDeliveryPaused: boolean;
  gatedTools: string[];
  pendingSteers: number;
}

const PAUSE_TIP =
  'Pause — deny every tool call from the next one onward. The agent keeps thinking and talking but cannot read, write or run anything. Immediate and reversible.';
const RESUME_TIP =
  'Resume — allow tool calls again. The agent keeps its session and picks up where it stopped.';
const HALT_TIP =
  'Halt — ask the agent to stop CLEANLY at its next hook boundary instead of killing the process. Its session survives, so Restart & Continue can resume it. Use ✕ in the header to end the process outright.';

/**
 * Operator controls for one agent: pause (deny tools at the next boundary),
 * halt (clean stop, session survives) and steering (inject context without
 * typing into the TUI). All ride the hook-return protocol — no PTY keystrokes.
 *
 * Neither button kills anything, and the one-word labels never said so, so the
 * difference lives in the tooltips.
 */
export function AgentControls({ agentId }: { agentId: string }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [steer, setSteer] = useState('');

  useEffect(() => {
    let alive = true;
    window.cth.controlSnapshot(agentId)
      .then((s) => { if (alive && s) setSnap(s); })
      .catch(() => { /* no control channel for this agent */ });
    return () => { alive = false; };
  }, [agentId]);

  // The shell mounts the one <Toaster/>, so a transient confirmation is a
  // toast rather than a fourth piece of state in this strip.
  const flash = (m: string) => toast(m);

  const togglePause = async () => {
    const paused = !!snap?.paused;
    const s = paused ? await window.cth.controlResume(agentId) : await window.cth.controlPause(agentId, true);
    if (s) setSnap(s);
    flash(paused ? 'resumed' : 'paused — tool calls will be denied');
  };

  const halt = async () => {
    const s = await window.cth.controlHalt(agentId);
    if (s) setSnap(s);
    flash('halt requested — stops cleanly at the next hook');
  };

  const send = async () => {
    const text = steer.trim();
    if (!text) return;
    const s = await window.cth.controlSteer(agentId, text);
    if (s) setSnap(s);
    setSteer('');
    flash('steer queued — delivered on the next turn');
  };

  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm" variant="outline" aria-pressed={!!snap?.paused}
            className={cn(snap?.paused && 'border-ring bg-accent')}
            onClick={() => void togglePause()}
          >
            {snap?.paused ? <Play /> : <Pause />}
            {snap?.paused ? 'Resume' : 'Pause'}
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm">{snap?.paused ? RESUME_TIP : PAUSE_TIP}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="outline" onClick={() => void halt()}>
            <Square /> Halt
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm">{HALT_TIP}</TooltipContent>
      </Tooltip>

      <Input
        value={steer}
        onChange={(e) => setSteer(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
        placeholder="Steer this agent — injected as context, not typed into its terminal"
        className="h-8 min-w-0 flex-1"
      />
      <Button size="sm" variant="outline" disabled={!steer.trim()} onClick={() => void send()}>
        <Send /> Steer
      </Button>

      <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        {snap?.halted && <span className="text-destructive">halting…</span>}
        {!!snap?.pendingSteers && <span>{snap.pendingSteers} queued</span>}
        {snap?.autoDeliveryPaused && <span>delivery paused (floor)</span>}
      </div>
    </div>
  );
}
