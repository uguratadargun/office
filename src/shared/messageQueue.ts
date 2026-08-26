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
 * Every gate the drain actually applies, named.
 *
 * `QueueHold` above is the older, coarser set: it collapsed "the agent is
 * working" and "the agent is paused by the operator" into `busy`, and it knew
 * nothing about the two clocks (boot grace, the one-at-a-time cooldown), so a
 * queue held by either of those was reported as `sending` — the composer said
 * it was on its way while nothing moved for seconds (MD-155).
 */
export type QueueGateName =
  | 'noProcess'
  | 'agentHalted'
  | 'agentPaused'
  | 'busy'
  | 'floorPaused'
  | 'bootGrace'
  | 'draft'
  | 'picker'
  | 'exited'
  | 'cooldown'
  | 'sending';

export interface QueueGateInput {
  /** How many messages are waiting. Zero ⇒ nothing to report. */
  count: number;
  /** The agent's status is 'idle' — the drain's first gate. */
  idle: boolean;
  /** The agent's display name, for the label. */
  name?: string;
  /** There is a terminal at all. A parked agent keeps its queue. */
  hasProcess?: boolean;
  /** `control.paused` — the operator's Pause. It denies the agent's TOOL CALLS;
   *  it is not itself a delivery gate, but it is why the agent is not going
   *  idle, which is the answer the operator is actually looking for. */
  agentPaused?: boolean;
  /** `control.halted`, same reasoning as `agentPaused`. */
  agentHalted?: boolean;
  /** `control.autoDeliveryPaused` — the floor-wide switch. */
  floorPaused?: boolean;
  /** The front message was released with "send now" — it bypasses the pause. */
  frontManual?: boolean;
  /** Milliseconds left of the target's boot grace. */
  bootGraceMsLeft?: number;
  /** The terminal's automation block, from the terminal pool. */
  block?: 'draft' | 'picker' | 'exited' | 'settling' | null;
  /** Milliseconds left of the one-at-a-time cooldown. */
  cooldownMsLeft?: number;
}

export interface QueueGateReport {
  gate: QueueGateName;
  /** One sentence naming the gate and, where it is known, when it lifts. */
  label: string;
}

/** "3s" / "under a second" — a hold nobody can wait out is worse than one with
 *  a number on it, and rounding up never promises sooner than it delivers. */
function inSeconds(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return s <= 1 ? 'under a second' : `${s}s`;
}

/**
 * The single answer, in the drain's own gate order.
 *
 * `useHive`'s flush loop gates, in this order: a front message at all → the
 * target has a pty and reads idle → the floor-wide pause (which a `manual`
 * message bypasses) → the boot grace → the terminal's own automation block (a
 * half-typed line or an open picker owns the prompt) → the one-at-a-time
 * cooldown. Reporting them in a different order is how a composer ends up
 * saying "sending…" while something upstream has been holding for a minute.
 *
 * Returns null only when there is nothing queued.
 */
export function queueGate(input: QueueGateInput): QueueGateReport | null {
  if (!input.count) return null;
  const who = input.name ?? 'this agent';
  const n = input.count;
  const plural = n === 1 ? '1 message is' : `${n} messages are`;

  if (input.hasProcess === false) {
    return { gate: 'noProcess', label: `${plural} waiting — ${who} has no terminal. Wake it to deliver.` };
  }
  if (!input.idle) {
    // The operator's own Pause/Halt is why it is not going idle — saying "busy"
    // when the answer is "you paused it" sends people hunting for a bug.
    if (input.agentHalted) {
      return { gate: 'agentHalted', label: `held — ${who} is halted. Resume it and the queue moves.` };
    }
    if (input.agentPaused) {
      return { gate: 'agentPaused', label: `held — ${who} is paused. Resume it and the queue moves.` };
    }
    return { gate: 'busy', label: `${who} is working — ${plural} waiting; delivery starts the moment it goes idle.` };
  }
  if (input.floorPaused && !input.frontManual) {
    return { gate: 'floorPaused', label: 'held — auto-delivery is paused floor-wide. "Send now" releases one.' };
  }
  if (input.bootGraceMsLeft && input.bootGraceMsLeft > 0) {
    return { gate: 'bootGrace', label: `held — ${who} is still booting; delivery resumes in ${inSeconds(input.bootGraceMsLeft)}.` };
  }
  // 'settling' is a sub-second gap between writes — not worth telling anyone.
  if (input.block && input.block !== 'settling') {
    if (input.block === 'draft') {
      return { gate: 'draft', label: `held — ${who}'s terminal has unsent text on its prompt.` };
    }
    if (input.block === 'picker') {
      return { gate: 'picker', label: `held — a slash-command picker is open in ${who}'s terminal.` };
    }
    return { gate: 'exited', label: `held — ${who}'s terminal has exited.` };
  }
  if (input.cooldownMsLeft && input.cooldownMsLeft > 0) {
    return { gate: 'cooldown', label: `next message in ${inSeconds(input.cooldownMsLeft)} — they are delivered one at a time.` };
  }
  return { gate: 'sending', label: `delivering to ${who}, one at a time…` };
}

/**
 * The older, coarser hold. Kept because the two composers' row-level affordances
 * key on it; it is derived from `queueGate` so there is exactly one gate order.
 */
export function queueHoldReason(input: {
  count: number;
  idle: boolean;
  paused?: boolean;
  frontManual?: boolean;
  block?: 'draft' | 'picker' | 'exited' | 'settling' | null;
}): QueueHold {
  const report = queueGate({
    count: input.count,
    idle: input.idle,
    floorPaused: input.paused,
    frontManual: input.frontManual,
    block: input.block
  });
  if (!report) return null;
  switch (report.gate) {
    case 'noProcess':
    case 'agentHalted':
    case 'agentPaused':
    case 'busy':
      return 'busy';
    case 'floorPaused':
      return 'paused';
    case 'draft':
    case 'picker':
    case 'exited':
      return report.gate;
    default:
      return 'sending';
  }
}
