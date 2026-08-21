/**
 * One policy for destructive actions, as a pure state machine.
 *
 * The app had five different answers to "the user is about to destroy something":
 * a two-step arm in the webhook list, an instant silent delete in the integration
 * registry, an in-modal confirm for factory reset, another two-step in the command
 * history, a third in the trigger history — and, in a few places, nothing at all.
 * None of the two-steps disarmed themselves, so a half-pressed "sure?" sat live on
 * the screen indefinitely, waiting for a stray click.
 *
 * Three shapes cover every case, and they are the SAME machine with two options:
 *
 *   ordinary      arm → confirm → run.            Auto-disarms.
 *   reversible    arm → confirm → UNDO window.    Auto-disarms; the operation is
 *                 deferred, so "undo" is `clearTimeout`, not a compensating write.
 *   irreversible  arm → confirm → run.            Does NOT auto-disarm, and the
 *                 armed state has to spell out the consequence.
 *
 * DEFERRED, NOT COMPENSATED. Undo delays the operation rather than reversing it.
 * A compensating write needs every site to supply an inverse, and for half of them
 * (clearing history, deleting a secret) no inverse exists — so those sites would
 * have quietly kept the old all-or-nothing behaviour under a friendlier button.
 * Deferring is one timer and it works everywhere.
 *
 * This file is `.ts` on purpose: the machine is testable with `node --test` without
 * a DOM, a renderer or a React testing library. The hook and the components that
 * drive it live in DestructiveAction.tsx.
 */

/** How long an armed action waits for its second press before standing down.
 *  Long enough to move the mouse and read the label, short enough that it is gone
 *  before the user forgets it is live. */
export const ARM_TIMEOUT_MS = 4000;

/** How long a committed-but-reversible action can still be taken back. */
export const UNDO_WINDOW_MS = 6000;

export type DestructivePhase =
  /** Nothing pending. The button shows its ordinary label. */
  | 'idle'
  /** One press in. The next press runs it; the window may expire first. */
  | 'armed'
  /** Confirmed, not yet done. The operation fires when the window closes. */
  | 'pending';

export interface DestructiveState {
  phase: DestructivePhase;
  /** Epoch ms at which this phase expires. `0` means "never" — idle, and the
   *  armed phase of an irreversible action, which waits for a real answer. */
  deadline: number;
}

export interface DestructiveOptions {
  /** Offer an undo window after confirming instead of running immediately. */
  undoable?: boolean;
  /** Irreversible actions do not stand down on their own: an armed prompt that
   *  vanishes while the user is reading the consequence is worse than one that
   *  waits. */
  autoDisarm?: boolean;
}

export type DestructiveEvent =
  /** The user pressed the action's own button. What that means depends on phase:
   *  arm it, confirm it, or (in `pending`) take it back. */
  | { type: 'press'; now: number }
  /** An explicit stand-down — a cancel button, Escape, the panel closing. */
  | { type: 'cancel' }
  /** The current phase's deadline arrived. */
  | { type: 'expire' }
  /** The surface is going away and the machine must settle NOW. A pending
   *  operation the user already confirmed is honoured, not silently dropped. */
  | { type: 'flush' };

/** What the caller has to actually do about a transition. */
export type DestructiveEffect =
  | 'none'
  /** Perform the destructive operation. */
  | 'run'
  /** A pending operation was taken back; it never happened. */
  | 'abort';

export interface DestructiveStep {
  state: DestructiveState;
  effect: DestructiveEffect;
}

export const IDLE: DestructiveState = { phase: 'idle', deadline: 0 };

/**
 * One transition. Pure: same state + event + options in, same step out.
 *
 * `now` rides on the press event rather than being read here so the deadlines are
 * deterministic under test — `Date.now()` inside a reducer is the thing that makes
 * a timing state machine untestable.
 */
export function reduce(
  state: DestructiveState,
  event: DestructiveEvent,
  opts: DestructiveOptions = {}
): DestructiveStep {
  const autoDisarm = opts.autoDisarm ?? true;

  switch (event.type) {
    case 'press':
      switch (state.phase) {
        case 'idle':
          return {
            state: { phase: 'armed', deadline: autoDisarm ? event.now + ARM_TIMEOUT_MS : 0 },
            effect: 'none'
          };
        case 'armed':
          // Confirmed. Either hand the caller the operation now, or hold it open
          // for the undo window and hand it over when that closes.
          return opts.undoable
            ? { state: { phase: 'pending', deadline: event.now + UNDO_WINDOW_MS }, effect: 'none' }
            : { state: IDLE, effect: 'run' };
        case 'pending':
          // The only button on screen during `pending` is "undo", so a press here
          // takes it back rather than firing a second one.
          return { state: IDLE, effect: 'abort' };
      }
      break;

    case 'cancel':
      // Cancelling a pending operation takes it back. It has not run yet — that is
      // the whole point of deferring — so there is nothing to compensate.
      return { state: IDLE, effect: state.phase === 'pending' ? 'abort' : 'none' };

    case 'expire':
      switch (state.phase) {
        case 'armed':
          // Stood down on its own. Nothing happened, and nothing should be said
          // about it — the user simply moved on.
          return { state: IDLE, effect: 'none' };
        case 'pending':
          // The undo window closed. This is where a reversible action actually runs.
          return { state: IDLE, effect: 'run' };
        case 'idle':
          return { state: IDLE, effect: 'none' };
      }
      break;

    case 'flush':
      // Unmounting mid-window. An armed action was never confirmed, so it dies with
      // the surface; a pending one WAS confirmed, and dropping it would mean the
      // user pressed delete, saw it disappear, and found it still there later.
      return { state: IDLE, effect: state.phase === 'pending' ? 'run' : 'none' };
  }
  return { state, effect: 'none' };
}

/** Seconds left in the current window, rounded up for a countdown label. `0` when
 *  nothing is ticking (idle, or an irreversible prompt that waits indefinitely). */
export function secondsLeft(state: DestructiveState, now: number): number {
  if (!state.deadline) return 0;
  return Math.max(0, Math.ceil((state.deadline - now) / 1000));
}
