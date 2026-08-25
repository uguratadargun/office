import { useEffect, useState } from 'react';

import type { HarnessConfig } from '@/store/config';
import { useStore } from '@/store/store';
import { useHive } from '@/hooks/useHive';
import { useRestoreTeam } from '@/hooks/useRestoreTeam';
import { AppShell } from './AppShell';
import { MonitorNotifications } from './monitor/notifications';
import { OnboardingView } from './onboarding/OnboardingView';
import { VoiceStatus } from './realtime/VoiceStatus';
import { HivePickerView, SKIP_KEY } from './hivepicker/HivePickerView';
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
  /**
   * Has the user passed the launch-time hive picker this session?
   *
   * Starts TRUE right after a hive switch: `changeHome` relaunches the process
   * and leaves a one-shot flag, so without this the user would land back on the
   * picker for the hive they just chose. Read and cleared once, on mount. The
   * flag is the pixel UI's own key — a switch can start in one front-end and
   * finish in the other, so there is one flag, not one per UI.
   */
  const [hiveOpened, setHiveOpened] = useState<boolean>(() => {
    try {
      if (window.localStorage.getItem(SKIP_KEY)) {
        window.localStorage.removeItem(SKIP_KEY);
        return true;
      }
    } catch { /* localStorage unavailable — show the picker */ }
    return false;
  });

  useEffect(() => {
    let cancelled = false;
    window.cth.getConfig().then((c) => {
      if (cancelled) return;
      setConfig(c);
      useStore.getState().setFreeflowEnabled(!!c.freeflowEnabled);
    });
    return () => { cancelled = true; };
  }, []);

  // Gated on `hiveOpened`, NOT on onboarding — exactly as the pixel App does it.
  // Bootstrapping on `onboardingComplete` alone would spin up agents, terminals
  // and pollers against the CURRENT hive while the user is still standing in the
  // picker choosing a different one.
  useHive(hiveOpened && config ? config : null);

  /**
   * Restore last session's team, 2.5s after boot — the same automatic restore
   * the pixel UI has always run.
   *
   * IT WAS NEVER MOUNTED IN THIS UI. `useRestoreTeam` runs the auto-restore
   * from its own effect, and the pixel app mounts it on the floor strip; here
   * nothing did, so a modern-only user restarted the app and their whole team
   * silently stayed gone. That is the real shape of MD-92's S1 — not just a
   * missing button, a missing behaviour.
   *
   * It belongs HERE, at boot, and not in the Agents screen that draws the
   * restorable list: mounting the hook inside a view makes "your old agents
   * spawn" a side effect of navigating to that view, 2.5s after it happens to
   * appear. The hook latches module-level, so the Agents overview mounting it
   * as well only reads the state.
   */
  useRestoreTeam(hiveOpened && config ? config : null);

  if (!config) return <div className="h-full w-full bg-background" />;

  // First-run setup, ported to this UI in MD-87 — so the modern UI is no longer
  // a one-way door out of a fresh install. `onComplete` hands back the SAVED
  // config, which is what flips this branch and starts `useHive`.
  if (!config.onboardingComplete) {
    // Someone who just finished setup goes straight into the hive they built —
    // offering to pick a workspace one screen later would be absurd.
    return <OnboardingView onComplete={(next) => { setConfig(next); setHiveOpened(true); }} />;
  }

  // Launch-time workspace selector: open the current hive, switch to a recent
  // one, or open/create another. Skipped right after onboarding and right after
  // a switch-relaunch (see `hiveOpened` above).
  if (!hiveOpened) {
    return <HivePickerView config={config} onOpenCurrent={() => setHiveOpened(true)} />;
  }

  return (
    <>
      {/* App-wide, not Monitor-only: an update notice and an agent-finished
          notice have to reach the user whatever they are looking at, which is
          what the pixel UI did. Renders null; its de-dup keys are module-level,
          so this mount cannot double a toast Monitor also subscribes to. */}
      <MonitorNotifications />
      <AppShell status={<><FloorStatus /><VoiceStatus /></>} />
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
