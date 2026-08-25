import { useState } from 'react';
import { Folder, FolderOpen, Plus, ArrowRight } from 'lucide-react';
import type { HarnessConfig } from '@/store/config';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import { ScrollArea } from '../components/ui/scroll-area';
import { cn } from '../lib/cn';

/**
 * The launch-time workspace selector, ported from the pixel UI (MD-87b) — the
 * last screen that existed in only one front-end.
 *
 * A "hive" is a harness home folder: its own agents, memory, tasks and history.
 * Opening the CURRENT one is in-place and instant. Opening any OTHER one goes
 * through `changeHome(path, 'fresh')`, which tears down services and relaunches
 * the process against it — cheap here, before any work is live, and the only
 * honest way to re-point everything main holds open.
 */

/**
 * Set immediately BEFORE a switch so the relaunched app does not land the user
 * back on the picker for the hive they just chose. Shared verbatim with the
 * pixel UI: one flag, whichever front-end wrote it, because a switch can start
 * in one UI and finish in the other.
 */
export const SKIP_KEY = 'cth.skipHivePickerOnce';

function folderName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

export function HivePickerView({
  config,
  onOpenCurrent
}: {
  config: HarnessConfig;
  /** Enter the CURRENT harness home in place — no relaunch. */
  onOpenCurrent: () => void;
}) {
  const current = config.harnessHome;
  const recents = (config.recentHives ?? []).filter((h) => h && h !== current);
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const openHive = async (path: string) => {
    if (!path) return;
    if (current && path === current) { onOpenCurrent(); return; }
    setError(undefined);
    setBusy(path);
    try {
      window.localStorage.setItem(SKIP_KEY, '1');
      const res = await window.cth.changeHome(path, 'fresh');
      // Success never returns — the process relaunches. A return IS the failure
      // path, so the one-shot flag has to be taken back or the next launch would
      // skip the picker for a hive that was never opened.
      if (!res.ok) {
        window.localStorage.removeItem(SKIP_KEY);
        setError(res.error ?? 'Could not open that folder.');
        setBusy(undefined);
      }
    } catch (e) {
      window.localStorage.removeItem(SKIP_KEY);
      setError(e instanceof Error ? e.message : String(e));
      setBusy(undefined);
    }
  };

  const browse = async () => {
    setError(undefined);
    const res = await window.cth.chooseFolder();
    if (res.ok) void openHive(res.path);
    else if (res.error !== 'cancelled') setError(res.error);
  };

  return (
    <div className="flex h-full w-full items-center justify-center overflow-y-auto bg-background p-8">
      <div className="flex w-full max-w-xl flex-col gap-5">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight">Choose a workspace</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            A workspace is one folder holding everything for a setup — its settings, your agents and
            their memory, tasks, triggers and history. Each is self-contained, so you can keep
            different setups side by side.
          </p>
        </header>

        {current && (
          <section className="flex flex-col gap-1.5">
            <h2 className="text-xs font-medium text-muted-foreground">Current</h2>
            <div className="flex items-center gap-3 rounded-lg border border-primary/40 bg-accent p-3">
              <Folder className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{folderName(current)}</div>
                {/* rtl + left-aligned truncates the FRONT of the path, so the
                    folder you are identifying survives and the shared prefix is
                    what gets cut. */}
                <div dir="rtl" className="truncate text-left font-mono text-xs text-muted-foreground">
                  {current}
                </div>
              </div>
              <Button size="sm" disabled={!!busy} onClick={onOpenCurrent}>Open</Button>
            </div>
          </section>
        )}

        {recents.length > 0 && (
          <section className="flex flex-col gap-1.5">
            <h2 className="text-xs font-medium text-muted-foreground">Recent</h2>
            {/* Radix's viewport wraps children in a display:table div, which
                sizes to CONTENT — long paths then push the row wider than the
                panel instead of truncating, and the "Switch" affordance ends up
                off-screen. Forcing that wrapper to block restores normal
                block-level width so `truncate` can do its job. */}
            <ScrollArea className="max-h-56 w-full [&>[data-radix-scroll-area-viewport]>div]:!block">
              <div className="flex w-full flex-col gap-1.5">
                {recents.map((h) => (
                  <button
                    key={h}
                    type="button"
                    disabled={!!busy}
                    onClick={() => void openHive(h)}
                    title={`Switch to ${h} — the app reloads`}
                    className={cn(
                      'group flex w-full min-w-0 items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                      'outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      busy ? 'cursor-default' : 'hover:bg-accent',
                      busy && busy !== h && 'opacity-50'
                    )}
                  >
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{folderName(h)}</div>
                      <div dir="rtl" className="truncate text-left font-mono text-xs text-muted-foreground">
                        {h}
                      </div>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      {busy === h ? 'Opening…' : <>Switch <ArrowRight className="size-3.5" /></>}
                    </span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </section>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {busy && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Opening {folderName(busy)} — the app will reload.
          </p>
        )}

        {/* Both browse to a folder and open it in 'fresh' mode, which either
            bootstraps an empty one or re-points at existing hive data in place.
            Two buttons for one action because the user's INTENT differs, and
            "create new" is undiscoverable behind a button labelled "open". */}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void browse()}>
            <FolderOpen /> Open existing…
          </Button>
          <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void browse()}>
            <Plus /> Create new…
          </Button>
        </div>
      </div>
    </div>
  );
}
