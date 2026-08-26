import { useDestructive } from '@/components/ui/useDestructive';
import type { DestructiveOptions } from '@/components/ui/destructive';
import { Button } from './ui/button';
import { cn } from '../lib/cn';

/**
 * The app's destructive-action policy, wearing the modern skin.
 *
 * The policy itself — arm → confirm, auto-disarm, and the undo window that
 * DEFERS rather than compensates — is `@/components/ui/destructive`, driven by
 * the headless `useDestructive` hook that was split out for exactly this
 * reason: a front-end that does not draw pixel buttons can still take the
 * behaviour without dragging `PixelButton` into its chunk.
 *
 * So this is not a second policy. It is the same machine with a `<Button>` on
 * it, which is what keeps the two UIs from disagreeing about how hard it is to
 * destroy something. An irreversible action (`autoDisarm: false`) must pass a
 * `consequence`: an armed prompt that does not say what is about to be lost is
 * a confirmation dialog with nothing in it.
 */
export function DestructiveButton({
  label, confirmLabel, doneLabel, consequence, onRun, onAbort,
  undoable, autoDisarm, size = 'sm', disabled, className
}: DestructiveOptions & {
  /** Resting label. */
  label: string;
  /** Armed label — say what will happen, never "confirm". */
  confirmLabel: string;
  /** Shown while an undoable action waits out its window. */
  doneLabel?: string;
  /** What the user is about to lose. Required in spirit for anything with no undo. */
  consequence?: string;
  onRun: () => void;
  onAbort?: () => void;
  size?: 'xs' | 'sm';
  disabled?: boolean;
  className?: string;
}) {
  const { phase, remaining, press, cancel } = useDestructive({ onRun, onAbort, undoable, autoDisarm });

  if (phase === 'pending') {
    return (
      <div className="flex flex-wrap items-center gap-2" role="status">
        <span className="text-xs text-muted-foreground">
          {doneLabel ?? 'Done'}
          {remaining > 0 && ` · undo within ${remaining}s`}
        </span>
        <Button size={size} variant="outline" onClick={press}>Undo</Button>
      </div>
    );
  }

  if (phase === 'armed') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {/* Capped measure: a consequence worth stopping for is a sentence, and
            these sit in narrow panels. */}
        {consequence && <span className="max-w-[44ch] text-xs text-muted-foreground">{consequence}</span>}
        <Button size={size} variant="destructive" onClick={press} disabled={disabled}>
          {confirmLabel}
          {/* The countdown is the only thing saying this prompt is about to
              stand down. An irreversible action has no deadline and shows
              nothing — the honest difference between the two. */}
          {remaining > 0 && <span className="opacity-75"> · {remaining}s</span>}
        </Button>
        <Button size={size} variant="ghost" onClick={cancel}>Cancel</Button>
      </div>
    );
  }

  return (
    <Button size={size} variant="outline" onClick={press} disabled={disabled} className={cn(className)}>
      {label}
    </Button>
  );
}
