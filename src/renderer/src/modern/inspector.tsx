import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode
} from 'react';
import { createPortal } from 'react-dom';
import {
  clampInspectorWidth, readInspectorWidth, INSPECTOR_LS_KEY
} from './lib/inspector';

/**
 * THE ONE RIGHT-HAND INSPECTOR SLOT.
 *
 * Same shape as ./overlay.tsx and for the same reason: an area (the Floor)
 * needs to render a panel that lives OUTSIDE its own `<main>` — beside it, in
 * the shell's chrome — and threading a render prop up to AppShell would put
 * that area's selection state in the one file no area may touch.
 *
 * So the shell mounts one host and areas portal into it:
 *
 *   {agent && <Inspector><AgentDetail … /></Inspector>}
 *
 * The aside stays in the DOM even when empty (a portal needs its host to
 * exist before the child mounts) and is `hidden` — display:none, so it costs
 * no layout — until something is actually in it.
 */
const HOST_ID = 'modern-inspector-root';

/** Open/closed is a module store, not React state: the aside is rendered by
 *  AppShell and filled by a lazy view, and neither owns the other. */
let openCount = 0;
const listeners = new Set<() => void>();
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function setOpen(delta: number): void {
  openCount = Math.max(0, openCount + delta);
  listeners.forEach((l) => l());
}

/** Rendered once by AppShell. Nothing else should mount this. */
export function InspectorHost(): React.JSX.Element {
  const open = useSyncExternalStore(subscribe, () => openCount > 0, () => false);
  const [width, setWidth] = useState(() => readInspectorWidth(safeGet(INSPECTOR_LS_KEY)));

  // Hand-rolled splitter, mirroring the sidebar's in AppShell — the panel has
  // to stay the width the user left it at when the window resizes, which is a
  // pixel width, not the percentage react-resizable-panels deals in.
  const dragging = useRef(false);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    // Dragged from the LEFT edge of a right-hand panel: the width is what is
    // left between the pointer and the window edge.
    setWidth(clampInspectorWidth(window.innerWidth - e.clientX, window.innerWidth));
  }, []);
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);
  useEffect(() => { safeSet(INSPECTOR_LS_KEY, String(width)); }, [width]);

  return (
    <>
      {open && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize inspector"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="-mr-px w-[5px] shrink-0 cursor-col-resize bg-transparent hover:bg-ring/40"
        />
      )}
      <aside
        hidden={!open}
        aria-label="Inspector"
        style={open ? { width } : undefined}
        className="flex min-h-0 shrink-0 flex-col overflow-hidden border-l bg-sidebar"
      >
        <div id={HOST_ID} className="contents" />
      </aside>
    </>
  );
}

/** Fill the shell's inspector. Mount it and the panel opens; unmount it (or
 *  navigate away from the area) and it closes. */
export function Inspector({ children }: { children: ReactNode }): React.JSX.Element | null {
  // The host only exists after AppShell's first paint, so resolve it in an
  // effect rather than during render, where it would be null on mount.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.getElementById(HOST_ID)); }, []);
  useEffect(() => {
    setOpen(1);
    return () => setOpen(-1);
  }, []);
  if (!host) return null;
  return createPortal(children, host);
}

function safeGet(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* private mode */ }
}
