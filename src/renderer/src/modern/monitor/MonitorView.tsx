import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { FleetPanel } from './FleetPanel';
import { EventLogPanel } from './EventLogPanel';
import { WorkersPanel } from './WorkersPanel';
import { UsagePanel } from './UsagePanel';
import { MonitorNotifications } from './notifications';

/**
 * Monitor — what the floor is spending, and what it has been doing.
 *
 * Four surfaces under one nav entry because they answer the same question from
 * four angles: Fleet is the state right now, Activity is how it got there,
 * Workers is the half of the floor that is not on the roster — the ephemeral
 * Slack workers, which this UI could not see at all until MD-158 — and Usage is
 * the same spend laid against the clock, which is the only view that can tell a
 * working day from a night spent answering timers (MD-178).
 * `nav.ts` has one row per area, so the split is a tab rather than a second
 * entry in a registry that is not mine to grow.
 */
export function MonitorView() {
  const [tab, setTab] = useState('fleet');

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Mounted here so the two notification channels are live whenever this
          area is. `notifications.tsx` de-dups at module scope, so the shell can
          mount it as well without doubling anything. */}
      <MonitorNotifications />

      <Tabs value={tab} onValueChange={setTab} className="flex h-full min-h-0 flex-col gap-0">
        <div className="flex h-11 shrink-0 items-center border-b px-6">
          <TabsList variant="line">
            <TabsTrigger value="fleet">Fleet</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="workers">Workers</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="fleet" className="min-h-0 overflow-y-auto">
          <FleetPanel />
        </TabsContent>
        <TabsContent value="activity" className="min-h-0 overflow-hidden">
          <EventLogPanel />
        </TabsContent>
        <TabsContent value="workers" className="min-h-0 overflow-y-auto">
          <WorkersPanel />
        </TabsContent>
        <TabsContent value="usage" className="min-h-0 overflow-y-auto">
          <UsagePanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
