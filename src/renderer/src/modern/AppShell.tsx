import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Moon, Sun, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAppTheme, toggleAppTheme } from '@/design/theme';
import { NAV, navEntry } from './nav';
import { navigate, useActiveNavId } from './navigation';
import { Button } from './components/ui/button';
import { Separator } from './components/ui/separator';
import { Skeleton } from './components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/tooltip';
import { Toaster } from './components/ui/sonner';
import { InspectorHost } from './inspector';
import { OverlayHost } from './overlay';
import { PlaceholderView } from './views/PlaceholderView';
import { ViewBoundary } from './ViewBoundary';
import { cn } from './lib/cn';

const MIN_W = 180;
const MAX_W = 360;
const DEFAULT_W = 232;
const LS_KEY = 'modern.sidebarWidth';

/** Only macOS draws window controls inside the content area (`hiddenInset`);
 *  Windows and Linux keep their own frame, so the inset would be dead space. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

export interface AppShellProps {
  /** Free-form status shown at the right of the topbar (agent counts, breaker). */
  status?: ReactNode;
}

export function AppShell({ status }: AppShellProps) {
  // Module store, not local state: a cross-area link (an Integrations row
  // jumping to Settings) is raised from deep inside a lazy view the shell knows
  // nothing about. See ./navigation.ts.
  const activeId = useActiveNavId();
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(() => {
    const saved = Number(safeGet(LS_KEY));
    return Number.isFinite(saved) && saved >= MIN_W && saved <= MAX_W ? saved : DEFAULT_W;
  });
  const theme = useAppTheme();
  const active = navEntry(activeId);
  const View = active.component;

  // Sidebar splitter. Hand-rolled rather than shadcn's `resizable`, which is
  // percentage-based (react-resizable-panels) — a nav rail has to stay ~232px
  // when the window resizes, not 16% of it. This is layout, not a control, so
  // it is not the "never hand-roll a primitive" rule from DESIGN-MODERN.md.
  const dragging = useRef(false);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    setWidth(Math.min(MAX_W, Math.max(MIN_W, e.clientX)));
  }, []);
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);
  useEffect(() => { safeSet(LS_KEY, String(width)); }, [width]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <nav
          aria-label="Sections"
          className="flex shrink-0 flex-col overflow-hidden border-r bg-sidebar"
          style={{ width: collapsed ? 56 : width }}
        >
          {/* The rail's top block lines up with the topbar so the two hairlines
              meet, and doubles as the window drag region on macOS.

              THE LEFT PAD IS NOT DECORATION. The window is `titleBarStyle:
              'hiddenInset'`, so on macOS the traffic lights are drawn by the OS
              at the window's top-left — which used to be a full-width title bar
              in the pixel UI and is this header here. Without the inset they sit
              on top of the wordmark. 78px is the lights plus their gutter; the
              collapsed rail is 56px wide, so there the wordmark is hidden anyway
              and the whole block is just the drag region behind them. */}
          <div className={cn(
            'cth-titlebar-drag flex h-12 shrink-0 items-center border-b',
            collapsed ? 'justify-center px-0' : 'pr-3',
            !collapsed && (IS_MAC ? 'pl-[78px]' : 'pl-3')
          )}>
            {!collapsed && (
              <span className="truncate text-sm font-semibold tracking-tight">Office</span>
            )}
          </div>

          <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
            {NAV.map((item) => {
              const Icon = item.icon;
              const Badge = item.badge;
              const isActive = item.id === activeId;
              const button = (
                <button
                  key={item.id}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => navigate(item.id)}
                  className={cn(
                    'flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-sm transition-colors',
                    'focus-visible:ring-ring outline-none focus-visible:ring-2',
                    collapsed && 'justify-center px-0',
                    isActive
                      ? 'bg-selected font-medium text-sidebar-accent-foreground hover:bg-selected-hover'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {/* Collapsed, the rail is 56px of icon — a count would not
                      fit and would not be readable if it did. The tooltip
                      carries the label there; the badge waits for the rail to
                      come back. */}
                  {!collapsed && Badge && <Badge />}
                </button>
              );
              // An icon-only rail has no accessible name on screen, so the
              // tooltip is the label — not decoration (DESIGN-MODERN.md).
              return collapsed ? (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>{button}</TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              ) : button;
            })}
          </div>

          <Separator />
          <div className={cn('flex shrink-0 p-2', collapsed ? 'justify-center' : 'justify-start')}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={() => setCollapsed((v) => !v)}
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </Button>
          </div>
        </nav>

        {/* Drag handle. 1px of line, 5px of target — a hairline you can actually
            grab. Hidden while collapsed, where the width is fixed. */}
        {!collapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="-ml-px w-[5px] shrink-0 cursor-col-resize bg-transparent hover:bg-ring/40"
          />
        )}

        {/* ── Main column ─────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="cth-titlebar-drag flex h-12 shrink-0 items-center gap-3 border-b px-4">
            <h1 className="truncate text-sm font-semibold tracking-tight">{active.label}</h1>
            <div className="ml-auto flex cth-titlebar-nodrag items-center gap-2">
              {status}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                    onClick={() => toggleAppTheme()}
                  >
                    {theme === 'dark' ? <Sun /> : <Moon />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {theme === 'dark' ? 'Light theme' : 'Dark theme'}
                </TooltipContent>
              </Tooltip>
            </div>
          </header>

          <div className="flex min-h-0 flex-1">
            <main className="min-w-0 flex-1 overflow-auto">
              {/* Keyed on the nav id so navigating away and back gives a
                  fresh boundary — a crashed area must not stay crashed once
                  you leave it. The boundary wraps Suspense, not the other way
                  round, so a lazy chunk that fails to LOAD is caught too. */}
              <ViewBoundary key={active.id} area={active.label}>
                <Suspense fallback={<ViewSkeleton />}>
                  {View ? <View /> : <PlaceholderView title={active.label} blurb={active.blurb} />}
                </Suspense>
              </ViewBoundary>
            </main>
            {/* The right-hand inspector. It used to be a render prop, which put
                the SELECTION state of whichever area had one in the shell; it
                is a portal host now (see ./inspector.tsx), so an area fills it
                from inside its own lazy chunk — and it is resizable and
                remembers its width, because it holds a terminal. */}
            <InspectorHost />
          </div>
        </div>

        {/* Shell-owned, mounted once. The overlay host is where any area portals
            a fullscreen surface (see ./overlay.tsx); the Toaster is the single
            sonner mount — a second one anywhere would double every toast. */}
        <OverlayHost />
        <Toaster position="bottom-right" closeButton />
      </div>
    </TooltipProvider>
  );
}

/** Skeleton, not a spinner: a lazy area is loading its own bundle, and a
 *  spinner over an empty pane says less than the shape of what is coming. */
function ViewSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-6">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

function safeGet(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* private mode */ }
}
