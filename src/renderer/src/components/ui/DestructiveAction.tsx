import { PixelButton } from '../PixelButton';
import { useDestructive } from './useDestructive';
import type { DestructiveOptions } from './destructive';

/**
 * The one destructive-action control. The machine it drives — and the reasoning
 * behind the three shapes — is in ./destructive.ts; the hook that runs it is in
 * ./useDestructive.ts, so a caller that only wants the behaviour does not drag
 * this pixel button along with it.
 *
 * Colours come from --cth-* tokens only; no hex literals.
 */

export { useDestructive } from './useDestructive';
export type { UseDestructiveArgs } from './useDestructive';

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
