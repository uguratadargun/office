import { useEffect, type ReactNode } from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

/**
 * The bar that appears when the human has selected things, and costs nothing
 * when they have not.
 *
 * MD-136. The Tasks board grew one of these inline; ASK ME and Messages will
 * want the same thing, and three hand-rolled bars is three answers to "how do I
 * clear a selection" and three places for the Escape key to be forgotten. So it
 * is a component, wired only to Tasks in this card.
 *
 * What it OWNS, rather than leaving to each caller:
 *  - the count, phrased once, so nobody ships "1 items selected";
 *  - Clear, always last and always present — a selection you cannot get out of
 *    is the reason people reload the page;
 *  - ESCAPE. It is the shortcut every list has and the one every hand-rolled
 *    bar forgets. It is bound here, on the window, only while a selection
 *    exists, so it costs nothing on a board nobody has clicked.
 *
 * What it does NOT own is the actions: they are `children`, because "delete
 * these" and "hand these over" are the caller's verbs and the caller's
 * confirmations. This bar never destroys anything itself.
 */
export function SelectionBar({ count, noun = 'selected', onClear, children }: {
  /** How many things are selected. The bar renders nothing at 0. */
  count: number;
  /** The word after the number. Kept a plain string: "3 selected" is right for
   *  cards and "3 messages selected" for a thread, and neither needs a rule. */
  noun?: string;
  onClear: () => void;
  /** The caller's actions, in the order they should read. */
  children?: ReactNode;
}) {
  // Bound to the window rather than to the bar: the human's hands are on the
  // board when they change their mind, and a listener that only fires while the
  // bar has focus is a shortcut nobody can reach.
  useEffect(() => {
    if (count <= 0) return undefined;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClear(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, onClear]);

  if (count <= 0) return null;
  return (
    <div
      role="toolbar"
      aria-label={`${count} ${noun}`}
      className="flex shrink-0 items-center gap-3 border-t px-4 py-2.5"
    >
      <Badge variant="secondary" className="font-normal">{count} {noun}</Badge>
      {children}
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
        {/* Named rather than an ✕: this un-selects, it does not delete, and an
            ✕ beside a Delete button is a coin toss nobody should have to call. */}
        Clear
      </Button>
    </div>
  );
}
