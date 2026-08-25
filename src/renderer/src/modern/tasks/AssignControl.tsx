import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useStore } from '@/store/store';
import type { HiveTask } from '@/store/taskLedger';
import { MICHAEL_DECIDES, assignTasks } from '@/store/taskActions';
import { sortAgentsForList } from '@shared/agentOrder';
import { Button } from '../components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '../components/ui/select';

/**
 * Hand cards to someone — the app's ONE assign path, `store/taskActions`.
 *
 * "{boss} decides" is the empty option and writes NO assignee: picking the owner
 * is the thing being delegated. It therefore repaints nothing either — showing
 * an owner the ledger does not have is exactly the lie this control avoids.
 *
 * A partial bulk is REPORTED, never hidden.
 */
export function AssignControl({ tasks, onAssigned, className }: {
  tasks: HiveTask[];
  onAssigned: (ids: string[], assignee: string) => void;
  className?: string;
}) {
  const boss = useStore((s) => s.bossName);
  const agents = useStore((s) => s.agents);
  const [to, setTo] = useState<string>(MICHAEL_DECIDES);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const target = agents.find((a) => a.id === to);
  const n = tasks.length;

  async function run() {
    if (!n || busy) return;
    setBusy(true); setNote('');
    try {
      const { assigned, failed } = await assignTasks(tasks, to, target?.name ?? boss);
      if (failed.length) setNote(`${assigned.length} assigned, ${failed.length} refused`);
      else setNote(to === MICHAEL_DECIDES ? `sent to ${boss}` : `assigned to ${target?.name ?? to}`);
      if (assigned.length) onAssigned(assigned, to);
    } catch {
      setNote('could not send — nothing changed');
    }
    setBusy(false);
    setTimeout(() => setNote(''), 4000);
  }

  return (
    <div className={className ?? 'flex items-center gap-2'}>
      {/* Radix Select has no empty-string value, so "decides" carries a real
          sentinel here and is mapped back to MICHAEL_DECIDES at the call. */}
      <Select value={to === MICHAEL_DECIDES ? DECIDES : to} onValueChange={(v) => setTo(v === DECIDES ? MICHAEL_DECIDES : v)}>
        <SelectTrigger size="sm" className="w-44" aria-label="Assign to">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DECIDES}>{boss} decides</SelectItem>
          {sortAgentsForList(agents.filter((a) => !a.isGod)).map((a) => (
            <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="secondary" size="sm" onClick={() => void run()} disabled={!n || busy}>
        <ArrowRight />
        {busy ? 'Sending…' : `Assign${n > 1 ? ` ${n}` : ''}`}
      </Button>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}

/** Radix treats "" as "no value" and would render the placeholder instead. */
const DECIDES = '__decides__';
