import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * THE ONE FULLSCREEN OVERLAY SLOT.
 *
 * A fullscreen surface (the terminal, a file viewer) is opened from deep inside
 * a view but has to render above the shell — outside the scrolling `<main>`, the
 * sidebar and the topbar. Threading a render prop up to `AppShell` for each one
 * would put every area's overlay state in the shell, which is exactly the file
 * no area is allowed to touch.
 *
 * So the shell mounts ONE host node and areas portal into it:
 *
 *   {isFullscreen && <Overlay><FullscreenTerminal … /></Overlay>}
 *
 * One host, not one per caller, so two overlays can never fight over z-index —
 * whichever is open is simply the one in the node.
 */
const HOST_ID = 'modern-overlay-root';

/** Rendered once by AppShell. Nothing else should mount this. */
export function OverlayHost() {
  return <div id={HOST_ID} className="contents" />;
}

export function Overlay({ children }: { children: ReactNode }) {
  // The host exists only after AppShell's first paint, so resolve it in an
  // effect rather than during render (where it would be null on mount).
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.getElementById(HOST_ID)); }, []);
  if (!host) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 bg-background">{children}</div>,
    host
  );
}
