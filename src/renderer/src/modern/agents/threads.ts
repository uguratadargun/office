/**
 * Thread model for one agent's hive mailbox.
 *
 * Pure and in a `.ts` on purpose — `test/load-ts.cjs` cannot transpile TSX, and
 * the grouping/merging rules below are the part that goes wrong silently.
 *
 * A conversation has two halves: what the agent RECEIVED (its inbox) and what it
 * SENT (its outbox). The pixel panel reads the inbox alone, so a thread shows
 * the questions and never the answers. Here both are merged and deduplicated —
 * the router archives a delivered message in the sender's `outbox/.sent` AND the
 * recipient's `inbox/.done`, so the same id can arrive down both paths.
 */
import type { HiveMessage } from '../../../../preload';

export interface Thread {
  conversation: string;
  subject: string;
  messages: HiveMessage[];
  /** Newest activity in the thread, for sorting and for the row's timestamp. */
  lastAt: string;
}

/** Oldest first inside a thread; an unparseable stamp sorts to the bottom
 *  rather than poisoning the comparator (a NaN compare returns 0 for every
 *  pair and silently leaves the list unsorted). */
function stamp(v: string | undefined): number {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : 0;
}

export function mergeThreads(inbox: HiveMessage[], outbox: HiveMessage[] = []): Thread[] {
  const seen = new Map<string, HiveMessage>();
  for (const m of [...inbox, ...outbox]) {
    if (m && typeof m.id === 'string' && !seen.has(m.id)) seen.set(m.id, m);
  }
  const by = new Map<string, HiveMessage[]>();
  for (const m of seen.values()) {
    const key = m.conversation || m.id;
    const arr = by.get(key) ?? [];
    arr.push(m);
    by.set(key, arr);
  }
  return [...by.entries()]
    .map(([conversation, list]) => {
      const messages = [...list].sort((a, b) => stamp(a.created_at) - stamp(b.created_at));
      const last = messages[messages.length - 1];
      return {
        conversation,
        subject: messages[0]?.subject || '(no subject)',
        messages,
        lastAt: last?.created_at ?? ''
      };
    })
    // Newest activity first: the thread that just moved is the one being read.
    .sort((a, b) => stamp(b.lastAt) - stamp(a.lastAt));
}

/**
 * The reply payload.
 *
 * Addressed to THIS AGENT, not to `last.from` as the pixel panel does. Replying
 * to the sender means that from Ada's tab a reply to a message god sent lands in
 * GOD's mailbox — so it appears in neither half of Ada's thread and the human
 * watches their own message vanish. Someone typing into Ada's thread is talking
 * to Ada; that reply lands in Ada's inbox and shows up on the next poll.
 */
export function replyPayload(agentId: string, thread: Thread, body: string) {
  const last = thread.messages[thread.messages.length - 1];
  const subject = thread.subject.startsWith('Re: ') ? thread.subject : `Re: ${thread.subject}`;
  return {
    to: agentId,
    act: 'inform' as const,
    conversation: thread.conversation,
    in_reply_to: last?.id ?? null,
    subject,
    body: body.trim()
  };
}

/** Long bodies are clipped in the row; the full text is one click away. */
export const BODY_CLIP = 240;

export function clipBody(body: string, expanded: boolean): { text: string; clipped: boolean } {
  const clipped = body.length > BODY_CLIP;
  return { text: expanded || !clipped ? body : `${body.slice(0, BODY_CLIP)}…`, clipped };
}
