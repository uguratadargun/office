import { useEffect, useState } from 'react';

import type { HarnessConfig } from '@/store/config';
import { useStore } from '@/store/store';
import { useHive } from '@/hooks/useHive';
import { AppShell } from './AppShell';
import { MonitorNotifications } from './monitor/notifications';
import { OnboardingView } from './onboarding/OnboardingView';
import { Badge } from './components/ui/badge';

// THE ONLY PLACE THIS STYLESHEET IS IMPORTED. main.tsx dynamically imports
// either the pixel entry or this module, so Tailwind (preflight included) and
// the modern tokens enter the document only when the modern UI is running —
// which is what keeps the ~100 inline-styled pixel screens untouched.
import './modern.css';

/**
 * Root of the modern UI. It owns nothing but boot: config, the hive bootstrap,
 * and the shell. Every screen lives under `modern/<area>/` and reaches the app
 * through `modern/nav.ts`.
 *
 * The store and IPC are REUSED EXACTLY as the pixel UI uses them — `useHive` is
 * the same hook `App.tsx` calls, so both front-ends see one hive, one set of
 * terminals and one event stream. A second implementation of that plumbing is
 * the one thing that would make these two UIs actually diverge.
 */
export function App() {
  const [config, setConfig] = useState<HarnessConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.cth.getConfig().then((c) => {
      if (cancelled) return;
      setConfig(c);
      useStore.getState().setFreeflowEnabled(!!c.freeflowEnabled);
    });
    return () => { cancelled = true; };
  }, []);

  // Same bootstrap the pixel App runs; null until config lands, exactly as there.
  useHive(config?.onboardingComplete ? config : null);

  if (!config) return <div className="h-full w-full bg-background" />;

  // First-run setup, ported to this UI in MD-87 — so the modern UI is no longer
  // a one-way door out of a fresh install. `onComplete` hands back the SAVED
  // config, which is what flips this branch and starts `useHive`.
  if (!config.onboardingComplete) {
    return <OnboardingView onComplete={(next) => setConfig(next)} />;
  }

  return (
    <>
      {/* App-wide, not Monitor-only: an update notice and an agent-finished
          notice have to reach the user whatever they are looking at, which is
          what the pixel UI did. Renders null; its de-dup keys are module-level,
          so this mount cannot double a toast Monitor also subscribes to. */}
      <MonitorNotifications />
      <AppShell status={<FloorStatus />} />
    </>
  );
}

function FloorStatus() {
  const agents = useStore((s) => s.agents);
  const godStatus = useStore((s) => s.godStatus);
  const busy = agents.filter((a) => a.status === 'working' || a.status === 'thinking').length;
  return (
    <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
      <Badge variant="secondary" className="font-normal">
        {agents.length} {agents.length === 1 ? 'agent' : 'agents'}
      </Badge>
      {busy > 0 && <Badge variant="secondary" className="font-normal">{busy} working</Badge>}
      {godStatus === 'booting' && <Badge variant="secondary" className="font-normal">booting</Badge>}
    </div>
  );
}
