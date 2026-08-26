import { useRef } from 'react';
import type { AskOption } from '@shared/askOptions';
import { cn } from '../lib/cn';
import { optionKeyIntent } from './optionKeys';

/**
 * The lettered choices on an ask, made clickable.
 *
 * The human writes questions to the team the way the team writes them back —
 * prose with "(a) … (b) … (c) …" in it — and has always answered with a bare
 * letter. This is the same answer, produced by pointing at it. The letter is
 * still what gets sent (see `composeAnswer`), so nothing downstream of the card
 * learns a new vocabulary.
 *
 * Selecting is NOT committing: picking an option only fills the answer, and the
 * free-text box beside it stays live — a chosen option can be sent with a note,
 * and clicking the chosen option again releases it. That is the whole point of
 * the report ("I can also type my own answer if I dislike the options"), so do
 * not turn a click into a send.
 *
 * Presentational on purpose: no store, no IPC. `AnswerBox` owns the draft and
 * the write, and the pixel ASK ME tab reuses the same parse + payload helpers
 * without importing this file.
 */
export function OptionAnswer({ options, value, onChange, disabled }: {
  options: AskOption[];
  /** The picked letter, or null for "none — I'll write my own". */
  value: string | null;
  onChange: (key: string | null) => void;
  disabled?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  /** Take the selection AND the focus, so arrows keep working after the first
   *  press. The decision itself is `optionKeyIntent` — pure, and tested. */
  function apply(key: string) {
    onChange(key);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-key="${key}"]`)?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    const intent = optionKeyIntent(options, value, e);
    // Not ours: ⌘↵ (send) and every other shortcut must pass through untouched.
    if (!intent) return;
    e.preventDefault();
    apply(intent.select);
  }

  return (
    <div
      ref={listRef}
      role="radiogroup"
      aria-label="Choose an answer"
      onKeyDown={onKeyDown}
      className="flex flex-col gap-1.5"
    >
      {options.map((o) => {
        const picked = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={picked}
            data-key={o.key}
            disabled={disabled}
            // Clicking the picked option releases it — the way back to a
            // free-text answer without reloading the board.
            onClick={() => onChange(picked ? null : o.key)}
            className={cn(
              'flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-sm leading-5',
              // The state ladder at full strength: hover is the accent step,
              // picked is the SELECTED step (never the hover token — that is
              // what made selected and hover the same grey before MD-108).
              'transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              picked && 'border-primary bg-selected ring-2 ring-ring',
              disabled && 'pointer-events-none opacity-60'
            )}
          >
            <span
              className={cn(
                'mt-px flex size-5 shrink-0 items-center justify-center rounded-md border text-xs font-medium',
                picked ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground'
              )}
              aria-hidden
            >
              {/* The LETTER, picked or not: it is what gets sent, and swapping
                  it for a tick would hide the one thing the answer says. */}
              {o.key}
            </span>
            <span className="min-w-0 flex-1">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
