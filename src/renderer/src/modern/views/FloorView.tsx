import { useCallback, useEffect, useRef } from 'react';
import { OfficeFloor } from '@/scene/office/OfficeFloor';
import { useStore } from '@/store/store';
import { AgentDetail } from '../agents/AgentDetail';
import {
  inspectedAgent, isSelectionTouch, shouldClearOnFloorClick
} from '../agents/floorSelection';
import { Inspector } from '../inspector';
import { FloorAgentsStrip } from './FloorAgentsStrip';

/**
 * The Pixi office scene, mounted AS-IS, with the picked agent open beside it.
 *
 * `scene/office/**` is a hard boundary in both design systems (DESIGN.md
 * §3.10): it is game art with its own warm palette, and it does not follow the
 * chrome — so the modern UI frames it and changes nothing inside it.
 *
 * OfficeFloor sizes itself to its offset parent, so the wrapper is what decides
 * the stage: `inset-0` inside a positioned, min-height-0 flex child.
 *
 * THE FLOOR IS A PICKER, NOT A POSTER. Clicking a character already called
 * `store.select(id)` — the scene has always done that for the pixel sidebar —
 * so the modern floor only had to render the other half: the SAME AgentDetail
 * the Agents area uses, in the shell's inspector slot, off the SAME store
 * selection. Pick on the floor and the Agents view is already on that agent,
 * and back; there is one selection in this app, not one per screen.
 */
export function FloorView() {
  const agents = useStore((s) => s.agents);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const agent = inspectedAgent(agents, selectedId);

  // Esc closes the panel — the same key that leaves every other transient
  // surface in this UI. Bound while something is open, so it does not swallow
  // Esc from a dialog on an empty floor.
  useEffect(() => {
    if (!agent) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') select(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agent, select]);

  // ── Click the carpet, close the panel ────────────────────────────────────
  // Why this is done by watching the store instead of by asking the scene:
  // see ../agents/floorSelection.ts. Arm on the wrapper's pointerdown CAPTURE
  // (an ancestor, so before Pixi's canvas listener), read on its pointerup
  // BUBBLE (after Pixi's window-capture listener has already run `select`).
  const before = useRef<string | null>(null);
  const touched = useRef(false);
  const unsub = useRef<(() => void) | null>(null);

  const onPointerDownCapture = useCallback(() => {
    before.current = useStore.getState().selectedId;
    touched.current = false;
    unsub.current?.();
    unsub.current = useStore.subscribe((next, prev) => {
      if (isSelectionTouch(prev, next)) touched.current = true;
    });
  }, []);

  const onPointerUp = useCallback(() => {
    unsub.current?.();
    unsub.current = null;
    const clear = shouldClearOnFloorClick({
      before: before.current,
      after: useStore.getState().selectedId,
      touched: touched.current
    });
    if (clear) select(null);
  }, [select]);

  // A gesture that ends off the wrapper (or with the window losing focus) never
  // reaches the bubble handler — drop the subscription rather than leave one
  // watching the store for the rest of the session.
  useEffect(() => () => { unsub.current?.(); unsub.current = null; }, []);

  return (
    <>
      {/* Stage above, roster below (MD-126). The stage takes `flex-1` and the
          strip `shrink-0`, so a floor of fifteen agents scrolls the strip
          sideways instead of eating the animation it sits under. `min-w-0` is
          what lets the strip's own `overflow-x-auto` actually scroll rather than
          widen this column. */}
      <div className="flex h-full min-h-0 min-w-0 flex-col p-4">
        {/* THE STAGE IS A FRAME, AND THE FRAME IS OURS (MD-123).
            The camera contain-fits the map, so a frame whose aspect differs from
            the map's has leftover space — and with the inspector open that is
            most of it. It used to be painted with the office palette's own dark,
            which read as a black slab on a white page (MD-119 F4). `surface`
            makes the scene's letterbox transparent, so the gap is this element's
            background: a modern token, correct in both themes by construction,
            and the scene itself untouched.

            The pointer handlers live HERE, on the stage and nothing else. They
            answer "did that click land on the carpet", read on pointerup, and
            React's onClick fires after that — so a strip card inside them would
            be read as a carpet click and clear the selection a beat before it
            set it. */}
        <div
          className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-background"
          onPointerDownCapture={onPointerDownCapture}
          onPointerUp={onPointerUp}
        >
          <OfficeFloor surface="chrome" />
        </div>

        <FloorAgentsStrip />
      </div>

      {/* Keyed on the agent: switching agents on the floor must give the new
          one a fresh terminal mount, not re-point the old xterm at another
          pty. Unmounting the Inspector closes the shell's slot. */}
      {agent && (
        <Inspector>
          <AgentDetail
            key={agent.id}
            agent={agent}
            variant="inspector"
            onClose={() => select(null)}
          />
        </Inspector>
      )}
    </>
  );
}
