import { useStore } from '@/store/store';
import { AgentList } from './AgentList';
import { AgentDetail } from './AgentDetail';
import { AgentsOverview } from './AgentsOverview';
import { AddAgentDialog } from './AddAgentDialog';
import { inspectedAgent } from './floorSelection';

/**
 * The Agents area: a roster rail plus either one agent, or — with nothing
 * selected — the overview that dispatches work and shows every engine at once.
 *
 * SELECTION IS THE STORE'S, not this view's. It used to be local state, on the
 * grounds that `selectedId` also drives the Pixi floor's camera. That is now
 * the reason to share it: the modern Floor opens the same AgentDetail in the
 * shell's inspector off the same id, so picking a character on the floor lands
 * you on that agent here, and picking one here is where the floor's camera
 * goes. One selection, two screens.
 */
export function AgentsView() {
  const agents = useStore((s) => s.agents);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const selected = inspectedAgent(agents, selectedId);

  return (
    // MD-125 — `min-w-0` on the row is what lets the detail/overview column be
    // narrower than its own content. Without it the long-id agent's header set
    // the column's width (1521px measured at a 1024px viewport) and carried the
    // header actions clean off the right edge, which is what "the UI looks
    // broken" was. The 264px list is `shrink-0`, so the column is the only
    // thing that can give.
    <div className="flex h-full min-h-0 min-w-0">
      <AgentList selectedId={selected?.id ?? null} onSelect={select} />
      {selected
        ? <AgentDetail key={selected.id} agent={selected} />
        : <AgentsOverview onSelect={select} />}
      <AddAgentDialog />
    </div>
  );
}
