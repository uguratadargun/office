/**
 * The per-agent terminal queue — its transforms and the one answer to "why is
 * this message not moving?".
 *
 * The queue itself is the store's `messageQueues[agentId]`, and ONE drain
 * delivers it (useHive's flush loop): when the agent goes idle, front first,
 * one at a time. Both terminals — the classic composer and the modern Terminal
 * tab — are only front-ends onto that. What lives here is what they must not
 * each re-derive: how a list is reordered, edited and promoted, and which of
 * the several possible holds is the one to tell the user about.
 *
 * Pure on purpose (`src/shared`): the store applies the transforms, the two
 * composers render the reason, and a node test can drive all of it without a
 * renderer.
 */

/** The shape the transforms need. Structural — the store's `QueuedMessage` has
 *  more on it (slack coords, timestamps), and every field is carried through. */
export interface QueueItem {
  id: string;
  text: string;
  /** What is actually typed into the PTY when set — see the store's
   *  QueuedMessage. Editing the text must not leave this behind. */
  instruction?: string;
  /** Released with "send now": the drain bypasses the floor-wide pause for it. */
  manual?: boolean;
}

/** "Send now": mark it manual and move it to the front, so the next delivery
 *  slot takes it. Unknown id ⇒ the list is returned unchanged. */
export function promoteInQueue<T extends QueueItem>(list: T[], id: string): T[] {
  const target = (list ?? []).find((m) => m.id === id);
  if (!target) return list ?? [];
  return [{ ...target, manual: true }, ...list.filter((m) => m.id !== id)];
}

/**
 * Move one message `delta` places. Clamped, not wrapped: "up" on the front
 * message is a no-op, because a queue that silently sends the top item to the
 * bottom would deliver the wrong thing next.
 */
export function moveInQueue<T extends QueueItem>(list: T[], id: string, delta: number): T[] {
  const from = (list ?? []).findIndex((m) => m.id === id);
  if (from < 0 || !delta) return list ?? [];
  const to = Math.max(0, Math.min(list.length - 1, from + delta));
  if (to === from) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Replace a queued message's text.
 *
 * `instruction` is DROPPED, deliberately. It is the authoritative string the
 * drain types, so an edit that changed only `text` would show the user their
 * new wording and type the old one — the queue's worst possible lie. An empty
 * edit is refused rather than queueing a blank line into someone's prompt.
 */
export function editInQueue<T extends QueueItem>(list: T[], id: string, text: string): T[] {
  const trimmed = String(text ?? '').trim();
  // Unchanged in, same array out — the store persists only when the reference
  // moves, so a refused edit must not rewrite the roster file.
  if (!trimmed || !(list ?? []).some((m) => m.id === id)) return list ?? [];
  return list.map((m) => {
    if (m.id !== id) return m;
    const { instruction: _dropped, ...rest } = m;
    return { ...rest, text: trimmed } as T;
  });
}

/** Why the front of the queue is not being delivered right now — or null when
 *  it is on its way. `null` with an empty queue simply means nothing to say. */
export type QueueHold = 'busy' | 'paused' | 'draft' | 'picker' | 'exited' | 'sending' | null;

/**
 * The single answer, ordered the way the drain actually gates.
 *
 * The drain checks: the agent is idle → the floor-wide pause (which a `manual`
 * message bypasses) → the boot grace → the terminal's own automation block (the
 * user's half-typed line or open picker owns the prompt). Reporting them in a
 * different order is how a composer ends up saying "sending…" while something
 * upstream has been holding for a minute.
 */
export function queueHoldReason(input: {
  count: number;
  /** The agent's status is 'idle' — the drain's first gate. */
  idle: boolean;
  /** Floor-wide auto-delivery pause (Command Center switch). */
  paused?: boolean;
  /** The front message was released with "send now" — it bypasses the pause. */
  frontManual?: boolean;
  /** The terminal's automation block, from the terminal pool. */
  block?: 'draft' | 'picker' | 'exited' | 'settling' | null;
}): QueueHold {
  if (!input.count) return null;
  if (!input.idle) return 'busy';
  if (input.paused && !input.frontManual) return 'paused';
  // 'settling' is a sub-second gap between writes — not worth telling anyone.
  if (input.block && input.block !== 'settling') return input.block;
  return 'sending';
}
