import { useState } from 'react';
import { useStore } from '@/store/store';
import { AgentList } from './AgentList';
import { AgentDetail } from './AgentDetail';
import { AgentsOverview } from './AgentsOverview';
import { AddAgentDialog } from './AddAgentDialog';

/**
 * The Agents area: a roster rail plus either one agent, or — with nothing
 * selected — the overview that dispatches work and shows every engine at once.
 *
 * Selection is local to this view rather than the pixel store's `selectedId`:
 * that one also drives the Pixi floor's camera and the pixel sidebar, and the
 * two UIs never render together, so borrowing it would only couple them.
 */
export function AgentsView() {
  const agents = useStore((s) => s.agents);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = agents.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="flex h-full min-h-0">
      <AgentList selectedId={selected?.id ?? null} onSelect={setSelectedId} />
      {selected
        ? <AgentDetail key={selected.id} agent={selected} />
        : <AgentsOverview onSelect={setSelectedId} />}
      <AddAgentDialog />
    </div>
  );
}
