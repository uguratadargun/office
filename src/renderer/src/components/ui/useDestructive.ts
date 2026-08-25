import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IDLE, reduce, secondsLeft,
  type DestructiveOptions, type DestructiveState
} from './destructive';

/**
 * The arm/countdown machine as a HOOK, with no control attached.
 *
 * Split out of ./DestructiveAction.tsx so a front-end that does not draw pixel
 * buttons can still take the behaviour: importing the hook from that file also
 * pulled `PixelButton` — and the pixel type scale with it — into the modern
 * chunk, for a component the modern UI never renders. The machine itself, and
 * the reasoning behind its three shapes, is in ./destructive.ts.
 */

export interface UseDestructiveArgs extends DestructiveOptions {
  /** Runs when the action actually happens: on the second press, or when the undo
   *  window closes. Never called for an action the user took back. */
  onRun: () => void;
  /** Runs when a pending action was taken back. Optional — most sites have nothing
   *  to say, because deferring means nothing was undone, just not done. */
  onAbort?: () => void;
}

export function useDestructive({ onRun, onAbort, undoable, autoDisarm }: UseDestructiveArgs) {
  const [state, setState] = useState<DestructiveState>(IDLE);
  const [now, setNow] = useState(() => Date.now());

  // Refs so `flush` on unmount and the deadline timer never fire a stale closure —
  // this callback performs a delete, so calling last render's version of it is not
  // a cosmetic bug.
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const onAbortRef = useRef(onAbort);
  onAbortRef.current = onAbort;
  const stateRef = useRef(state);
  stateRef.current = state;
  const optsRef = useRef({ undoable, autoDisarm });
  optsRef.current = { undoable, autoDisarm };

  const apply = useCallback((event: Parameters<typeof reduce>[1]) => {
    const step = reduce(stateRef.current, event, optsRef.current);
    stateRef.current = step.state;
    setState(step.state);
    if (step.effect === 'run') onRunRef.current();
    else if (step.effect === 'abort') onAbortRef.current?.();
  }, []);

  const press = useCallback(() => apply({ type: 'press', now: Date.now() }), [apply]);
  const cancel = useCallback(() => apply({ type: 'cancel' }), [apply]);

  // One timer per window, plus a 1s tick so the countdown label moves. Both are
  // torn down the moment the phase has no deadline, so an idle control costs
  // nothing.
  useEffect(() => {
    if (!state.deadline) return;
    const expire = setTimeout(() => apply({ type: 'expire' }), Math.max(0, state.deadline - Date.now()));
    const tick = setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => { clearTimeout(expire); clearInterval(tick); };
  }, [state.deadline, apply]);

  // Settle on unmount. An armed action was never confirmed and dies with the
  // surface; a pending one was, and dropping it would mean the user pressed delete,
  // watched the row go, and found it back on the next visit.
  useEffect(() => () => {
    const step = reduce(stateRef.current, { type: 'flush' }, optsRef.current);
    if (step.effect === 'run') onRunRef.current();
  }, []);

  return {
    phase: state.phase,
    /** Seconds left in the current window; 0 when nothing is counting down. */
    remaining: secondsLeft(state, now),
    press,
    cancel
  };
}

