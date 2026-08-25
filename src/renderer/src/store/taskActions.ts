/**
 * Acting on a task card: answering its open ask, assigning it, nudging its owner.
 *
 * Split out of the components for one reason: the SAME answer has to be sendable
 * from ASK ME and from the board, and an answer is two writes that must both
 * happen — the humanQA entry on the card, and the mail that tells the god to
 * unblock it. Two copies of that would drift, and the copy that forgot the mail
 * would look like it worked.
 *
 * The transforms and the message bodies are pure and exported for tests; the
 * async wrappers are thin and are the only things that touch `window.cth`.
 *
 * ONE RULE runs through all of it: the god is the ledger's writer. When a human
 * assigns from the board, the god is TOLD, in words, that the human did it — a
 * ledger write nobody was told about is how a card ends up assigned twice.
 */
import type { HiveTask, HumanQA } from './taskLedger';
import { openQuestion } from './taskLedger';
import { answerMessage as buildAnswerMessage, type OutboundMessage } from '@shared/humanQa';

/** The empty owner every picker in this app uses for "the god decides". Kept as
 *  a name so a bare `''` never has to be recognised on sight. */
export const MICHAEL_DECIDES = '';

/** The card's humanQA with `open` answered. Matches by identity first and by
 *  (question text + still open) second, because the array is re-parsed from disk
 *  every 5s and the object the caller is holding may not be the one in `task`. */
export function withAnswer(task: HiveTask, open: HumanQA, text: string, now: string): HumanQA[] {
  return (task.humanQA ?? []).map((e) =>
    e === open || (e.q === open.q && !e.a && !e.dismissedAt)
      ? { ...e, a: text, answeredAt: now }
      : e
  );
}

/** The card's humanQA with `open` dismissed — marked, never deleted. The
 *  question stays on the card so the decision history survives; only
 *  openQuestion() stops returning it. */
export function withDismissal(task: HiveTask, open: HumanQA, now: string): HumanQA[] {
  return (task.humanQA ?? []).map((e) =>
    e === open || (e.q === open.q && !e.a && !e.dismissedAt)
      ? { ...e, dismissedAt: now }
      : e
  );
}

/** An agent id, or 'god' — with the three acts these actions use, spelled out
 *  rather than importing MessageAct from main (the renderer does not reach into
 *  the main package; same convention as store/config.ts). */
export type { OutboundMessage } from '@shared/humanQa';

/** What the god is told when the human answers. Defined in `@shared/humanQa`
 *  and re-exported here because Telegram (main) sends the SAME message for an
 *  answer that arrives in the chat — two bodies would teach the god that one
 *  front door is less trustworthy than the other. */
export { answerMessage } from '@shared/humanQa';

/** One line per card, for a message that hands over several at once. */
function cardLines(tasks: HiveTask[]): string {
  return tasks.map((t) => `- ${t.id}: ${t.title}`).join('\n');
}

/** The work request sent to an agent the HUMAN picked. Says who assigned it, so
 *  the agent knows this did not come through the god's usual dispatch. */
export function assignMessage(tasks: HiveTask[], assigneeName: string): OutboundMessage {
  const one = tasks.length === 1;
  return {
    to: '',
    act: 'request',
    subject: one
      ? `Assigned to you by the human: ${tasks[0].id} — ${tasks[0].title}`
      : `Assigned to you by the human: ${tasks.length} tasks`,
    body: [
      `The human assigned ${one ? 'this card' : 'these cards'} to you (${assigneeName}) directly from the Tasks board:`,
      cardLines(tasks),
      '',
      'The ledger already records you as the assignee. Read the card in hive/tasks.json for the'
      + ' full contract, move it to doing when you start, and report back as usual.'
    ].join('\n')
  };
}

/** Told to the god after a human assignment, so the ledger's writer is never the
 *  last to know that one of its cards changed hands. */
export function assignNoticeMessage(tasks: HiveTask[], assigneeName: string): OutboundMessage {
  return {
    to: 'god',
    act: 'inform',
    subject: `The human assigned ${tasks.length} task${tasks.length === 1 ? '' : 's'} to ${assigneeName}`,
    body: [
      `The human assigned the following from the Tasks board — YOU did not, so do not re-assign ${tasks.length === 1 ? 'it' : 'them'}:`,
      cardLines(tasks),
      '',
      `Assignee is already written to the ledger as ${assigneeName}. ${assigneeName} has been messaged directly.`
    ].join('\n')
  };
}

/** "Michael decides": no assignee is written at all — picking the owner IS the
 *  thing being delegated, so the god gets the list and does it. */
export function decideMessage(tasks: HiveTask[]): OutboundMessage {
  const one = tasks.length === 1;
  return {
    to: 'god',
    act: 'request',
    subject: one
      ? `Assign this: ${tasks[0].id} — ${tasks[0].title}`
      : `Assign these ${tasks.length} unassigned tasks`,
    body: [
      `The human wants you to pick the owner for ${one ? 'this card' : 'these cards'} — they deliberately did not choose:`,
      cardLines(tasks),
      '',
      'Assign each to the right agent, set "assignee" in hive/tasks.json, and dispatch the work.'
    ].join('\n')
  };
}

/** A status check on a card that is already in doing. */
export function nudgeMessage(task: HiveTask): OutboundMessage {
  return {
    to: '',
    act: 'query',
    subject: `Status on ${task.id}?`,
    body: [
      `The human is asking where ${task.id} ("${task.title}") stands.`,
      'Reply with what is done, what is left, and anything blocking you.'
    ].join('\n')
  };
}

/* ─── selection ────────────────────────────────────────────────────────────── */

export interface Selection {
  ids: string[];
  /** The last card clicked WITHOUT shift — the fixed end of a range. */
  anchor: string | null;
}

export const EMPTY_SELECTION: Selection = { ids: [], anchor: null };

/**
 * Click semantics for a multi-select list, as one pure function.
 *
 * Plain click toggles one card and becomes the new anchor. Shift-click selects
 * the run between the anchor and the clicked card in the order they are ON
 * SCREEN — `ordered` is the visible, filtered, column-flattened list, so a range
 * never quietly includes a card the filter is hiding.
 *
 * A shift-click with no anchor (or an anchor that has since been filtered away)
 * degrades to a plain toggle rather than doing nothing: the user asked for
 * something, and selecting one card is the closest honest answer.
 */
export function nextSelection(current: Selection, id: string, shift: boolean, ordered: string[]): Selection {
  const anchorAt = current.anchor === null ? -1 : ordered.indexOf(current.anchor);
  const clickedAt = ordered.indexOf(id);
  if (shift && anchorAt !== -1 && clickedAt !== -1) {
    const [from, to] = anchorAt <= clickedAt ? [anchorAt, clickedAt] : [clickedAt, anchorAt];
    const run = ordered.slice(from, to + 1);
    // Union, not replace: shift-click extends what you have rather than throwing
    // away a selection you built up with earlier clicks.
    return { ids: [...new Set([...current.ids, ...run])], anchor: current.anchor };
  }
  const has = current.ids.includes(id);
  return {
    ids: has ? current.ids.filter((x) => x !== id) : [...current.ids, id],
    // Deselecting leaves no sensible fixed end, so the anchor goes with it.
    anchor: has ? null : id
  };
}

/** Selection minus anything no longer on the board — cards get filtered, archived
 *  and deleted underneath it every 5s, and acting on an id that has gone is how a
 *  bulk action half-fails. */
export function pruneSelection(current: Selection, ordered: string[]): Selection {
  const live = new Set(ordered);
  const ids = current.ids.filter((id) => live.has(id));
  if (ids.length === current.ids.length) return current; // no churn, no re-render
  return { ids, anchor: current.anchor && live.has(current.anchor) ? current.anchor : null };
}

/* ─── the writes ───────────────────────────────────────────────────────────── */

/** Answer the card's open ask: document it on the card, then tell the god.
 *  Returns the new humanQA for the caller's optimistic copy, or null if the
 *  ledger write failed — in which case NOTHING was sent and the draft stands. */
export async function answerTask(task: HiveTask, text: string): Promise<HumanQA[] | null> {
  const open = openQuestion(task);
  const answer = text.trim();
  if (!open || !answer) return null;
  const qa = withAnswer(task, open, answer, new Date().toISOString());
  const res = await window.cth.hivePatchTask(task.id, { humanQA: qa });
  if (!res.ok) return null;
  // Only after the card is written: a mail about an answer that was not saved
  // sends the god looking for something that is not there.
  await window.cth.hiveSend(buildAnswerMessage(task, open.q, answer), 'human');
  return qa;
}

/** Take the ask off the ASK ME board without answering it. No mail: nothing
 *  happened that the god has to act on. */
export async function dismissAsk(task: HiveTask): Promise<HumanQA[] | null> {
  const open = openQuestion(task);
  if (!open) return null;
  const qa = withDismissal(task, open, new Date().toISOString());
  const res = await window.cth.hivePatchTask(task.id, { humanQA: qa });
  return res.ok ? qa : null;
}

export interface AssignOutcome {
  /** Cards whose assignee was written (empty for "Michael decides"). */
  assigned: string[];
  /** Cards the ledger refused. A partial bulk is reported, never hidden. */
  failed: string[];
}

/**
 * Assign one or many cards.
 *
 * `agentId === MICHAEL_DECIDES` writes NO assignee — choosing the owner is the
 * thing being delegated — and asks the god to do it. Otherwise every card is
 * patched, the agent is messaged once for the whole batch, and the god is told
 * separately so it does not re-assign work that already has an owner.
 *
 * Patches go one card at a time on purpose: main merges each into the ledger it
 * has on disk right now, so a card a webhook added since the last poll cannot be
 * clobbered by a whole-ledger write.
 */
export async function assignTasks(
  tasks: HiveTask[],
  agentId: string,
  agentName: string
): Promise<AssignOutcome> {
  if (!tasks.length) return { assigned: [], failed: [] };

  if (agentId === MICHAEL_DECIDES) {
    await window.cth.hiveSend(decideMessage(tasks), 'human');
    return { assigned: [], failed: [] };
  }

  const assigned: string[] = [];
  const failed: string[] = [];
  for (const t of tasks) {
    try {
      const res = await window.cth.hivePatchTask(t.id, { assignee: agentId });
      (res.ok ? assigned : failed).push(t.id);
    } catch {
      failed.push(t.id);
    }
  }
  // Message only about what actually landed, so nobody is asked to do a card the
  // ledger never accepted.
  const done = tasks.filter((t) => assigned.includes(t.id));
  if (done.length) {
    await window.cth.hiveSend({ ...assignMessage(done, agentName), to: agentId }, 'human');
    await window.cth.hiveSend(assignNoticeMessage(done, agentName), 'human');
  }
  return { assigned, failed };
}

/** Ask a card's owner where it stands. */
export async function nudge(task: HiveTask): Promise<boolean> {
  if (!task.assignee) return false;
  const res = await window.cth.hiveSend({ ...nudgeMessage(task), to: task.assignee }, 'human');
  return res.ok !== false;
}
