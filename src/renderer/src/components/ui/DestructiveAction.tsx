import { useCallback, useEffect, useRef, useState } from 'react';
import { PixelButton } from '../PixelButton';
import {
  IDLE, reduce, secondsLeft,
  type DestructiveOptions, type DestructiveState
} from './destructive';

/**
 * The one destructive-action control. The machine it drives — and the reasoning
 * behind the three shapes — is in ./destructive.ts.
 *
 * Colours come from --cth-* tokens only; no hex literals.
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

export interface DestructiveActionProps extends DestructiveOptions {
  /** Resting label, e.g. "clear all". */
  label: string;
  /** Armed label — say what will happen, not "confirm". */
  confirmLabel: string;
  /** Shown while an undoable action is waiting out its window, e.g. "cleared". */
  doneLabel?: string;
  /** What the user is about to lose. REQUIRED for an irreversible action: a prompt
   *  that does not survive on its own has to be worth stopping for. */
  consequence?: string;
  onRun: () => void;
  onAbort?: () => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** Lay the armed/pending row out vertically (narrow panels, sidebars). */
  stack?: boolean;
}

export function DestructiveAction({
  label, confirmLabel, doneLabel, consequence,
  onRun, onAbort, undoable, autoDisarm, size = 'sm', disabled, stack
}: DestructiveActionProps) {
  const { phase, remaining, press, cancel } = useDestructive({ onRun, onAbort, undoable, autoDisarm });

  const row: React.CSSProperties = {
    display: 'flex', gap: 6, flexWrap: 'wrap',
    alignItems: stack ? 'flex-start' : 'center',
    flexDirection: stack ? 'column' : 'row'
  };
  const note: React.CSSProperties = {
    fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-700)',
    // A consequence worth stopping for is a sentence, and these controls sit in
    // narrow panels and inside horizontal rows. Cap the measure so an armed
    // prompt never stretches the row it lives in.
    maxWidth: '44ch'
  };

  if (phase === 'pending') {
    return (
      <div style={row} role="status">
        <span style={note}>
          {doneLabel ?? 'Done'}
          {remaining > 0 && <span style={{ color: 'var(--cth-ink-500)' }}> · undo within {remaining}s</span>}
        </span>
        <PixelButton size={size} variant="secondary" onClick={press}>undo</PixelButton>
      </div>
    );
  }

  if (phase === 'armed') {
    return (
      <div style={row}>
        {consequence && <span style={note}>{consequence}</span>}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <PixelButton size={size} variant="destructive" onClick={press} disabled={disabled}>
            {confirmLabel}
            {/* The countdown is the only thing telling the user this prompt is
                about to leave. An irreversible action has no deadline and shows
                nothing, which is the honest difference between the two. */}
            {remaining > 0 && <span style={{ opacity: 0.75 }}> · {remaining}s</span>}
          </PixelButton>
          <PixelButton size={size} variant="secondary" onClick={cancel}>cancel</PixelButton>
        </div>
      </div>
    );
  }

  return (
    <PixelButton size={size} variant="destructive" onClick={press} disabled={disabled}>
      {label}
    </PixelButton>
  );
}
