import { useState } from 'react';
import { Sunrise } from 'lucide-react';
import type { Agent } from '@/store/store';
import { wakeSleepingAgent } from '@/hooks/useRestoreTeam';
import { Button } from '../components/ui/button';

/** Wake a hibernated agent. Thin on purpose: `wakeSleepingAgent` is the same
 *  path the hive takes when work arrives for a sleeping agent, so there is one
 *  respawn to keep correct rather than a second one drawn in this UI. */
export function WakeButton({ agent, size = 'sm' }: { agent: Agent; size?: 'sm' | 'xs' }) {
  const [busy, setBusy] = useState(false);
  // MD-114 — a respawn can genuinely fail (no saved command, a worktree that
  // will not open, main refusing the spawn), and it used to fail into the
  // console. A button that does nothing and says nothing is the exact complaint
  // this card came from, so the failure STAYS on screen until the next attempt.
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-center gap-1.5">
      <Button
        size={size}
        variant="outline"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void wakeSleepingAgent(agent.id)
            .then((r) => { if (!r.ok) setError(r.error ?? 'spawn failed'); })
            .finally(() => setBusy(false));
        }}
      >
        <Sunrise /> {busy ? 'Waking…' : 'Wake'}
      </Button>
      {error && <p className="text-xs text-destructive">could not wake — {error}</p>}
    </div>
  );
}
