import type { HiveTask } from '@/store/taskLedger';
import { openQuestion } from '@/store/taskLedger';
import type { Selection } from '@/store/taskActions';
import { COLUMNS, type Status } from './status';

/**
 * What a bulk delete is about to do, decided before the dialog draws it.
 *
 * MD-136. The human asked for one press to clear a finished column, which is a
 * reasonable thing to want and a bad thing to guess at: the selection is built
 * by clicking, shift-dragging and "select all", it survives a filter change,
 * and the board repolls underneath it every 5 seconds. By the time Delete is
 * pressed, "what am I deleting" is a question the human genuinely cannot answer
 * by looking. So the dialog answers it, out of one pure function, rather than
 * each of the dialog's three sentences counting the array again.
 *
 * The two CAUTIONS are the point of the card, not decoration. A `done` card is
 * a record of finished work and deleting a hundred of them costs nothing you
 * were using. A `doing` card is work an agent is holding right now, and a card
 * with an unanswered question is work waiting on the HUMAN — deleting either
 * one throws away something nobody has finished with. They are not blocked
 * (this board's owner may legitimately want them gone), but they are never
 * deleted silently inside a count.
 */
export interface DeleteSummary {
  total: number;
  /** Board order, empty columns dropped: "3 in Done, 1 in Todo". */
  byColumn: { key: Status; label: string; count: number }[];
  /** Cards an agent is actively holding. */
  doing: number;
  /** Cards with a question waiting on the human, whatever their column. */
  asking: number;
  /** The extra line the dialog must show, or '' when nothing needs one. */
  caution: string;
}

/** English for a count of things, without a library and without "1 cards". */
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function deleteSummary(tasks: readonly HiveTask[]): DeleteSummary {
  const byColumn = COLUMNS
    .map((c) => ({ key: c.key, label: c.label, count: tasks.filter((t) => t.status === c.key).length }))
    .filter((c) => c.count > 0);
  const doing = tasks.filter((t) => t.status === 'doing').length;
  // `openQuestion` is the ledger's own definition of "waiting on you" — the same
  // one the Asks-me chip and ASK ME count from. Re-deriving it here would be a
  // second answer to a question this app has settled once (MD-83).
  const asking = tasks.filter((t) => !!openQuestion(t)).length;
  const parts: string[] = [];
  if (doing) parts.push(`${plural(doing, 'card')} an agent is working on right now`);
  if (asking) parts.push(`${plural(asking, 'card')} with a question waiting on you`);
  return {
    total: tasks.length,
    byColumn,
    doing,
    asking,
    caution: parts.length ? `This includes ${parts.join(' and ')}.` : ''
  };
}

/** "3 in Done and 1 in Todo" — the dialog's subject line. */
export function columnPhrase(summary: DeleteSummary): string {
  const parts = summary.byColumn.map((c) => `${c.count} in ${c.label}`);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The column header's "Select all", as a toggle.
 *
 * `columnIds` is what is VISIBLE in that column after the active filters — the
 * card asked for that explicitly, and it is the only defensible reading: a
 * button under a header that says "Done 3" must not select a fourth card the
 * filter is hiding.
 *
 * Toggling off when the column is already fully selected keeps one control for
 * both directions, which is what a header checkbox looks like everywhere else.
 * Cards selected in OTHER columns are left alone either way — this button is
 * about its own column, not about the selection as a whole.
 */
export function toggleColumn(current: Selection, columnIds: readonly string[]): Selection {
  if (!columnIds.length) return current;
  const chosen = new Set(current.ids);
  const all = columnIds.every((id) => chosen.has(id));
  if (all) {
    const drop = new Set(columnIds);
    return {
      ids: current.ids.filter((id) => !drop.has(id)),
      // An anchor inside the column we just cleared is no longer a fixed end.
      anchor: current.anchor && drop.has(current.anchor) ? null : current.anchor
    };
  }
  return {
    ids: [...new Set([...current.ids, ...columnIds])],
    // The last card of the run is where a following shift-click should measure
    // from — the same end a manual click-through would have left behind.
    anchor: columnIds[columnIds.length - 1]
  };
}

/** Whether the header control reads checked, indeterminate, or off. */
export function columnSelectState(
  current: Selection, columnIds: readonly string[]
): 'none' | 'some' | 'all' {
  if (!columnIds.length) return 'none';
  const chosen = new Set(current.ids);
  const n = columnIds.filter((id) => chosen.has(id)).length;
  return n === 0 ? 'none' : n === columnIds.length ? 'all' : 'some';
}
