/**
 * The human's open asks on a card — the pure half, shared by the renderer's
 * ASK ME board and main's Telegram mirror.
 *
 * ASK ME and Telegram are two front doors onto ONE thing: `humanQA[]` on the
 * card. Both write the same entry, both tell the god in the same words, and
 * whichever answers first closes it for the other. That only stays true if the
 * transforms and the message body live in one place — hence this module rather
 * than a copy in main. `src/shared` is the established seam (see publicUrl.ts,
 * integrations.ts): main and renderer both import from here, neither imports
 * from the other.
 */

/** One ask on a card. Mirrors HiveTask['humanQA'][n] in main/hive.ts. */
export interface HumanQAEntry {
  q: string;
  a?: string;
  askedAt?: string;
  answeredAt?: string;
  dismissedAt?: string;
  /** Telegram message_id of the question as posted to the allowed chat. Doubles
   *  as the exactly-once send marker (set ⇒ already mirrored) and as the reply
   *  target the human's answer is matched against. Lives ON THE CARD so it
   *  survives a restart without a second store to keep in sync. */
  tgMessageId?: number;
}

/** The minimum of a card these helpers need. Structural on purpose: main and the
 *  renderer each have their own fuller HiveTask. */
export interface QACard {
  id: string;
  title: string;
  humanQA?: HumanQAEntry[];
}

/** An ask, located: enough to write the answer back into the right slot. */
export interface LocatedQuestion {
  taskId: string;
  title: string;
  /** Index into the card's humanQA — the write target. */
  index: number;
  q: string;
}

/** Open = has a question, and the human has neither answered nor dismissed it. */
export function isOpen(e: HumanQAEntry | undefined | null): boolean {
  return !!e && typeof e.q === 'string' && !!e.q.trim() && !e.a && !e.dismissedAt;
}

/**
 * Every open ask that has NOT been mirrored to the chat yet.
 *
 * The `tgMessageId` marker is what makes this exactly-once across restarts: it
 * is written to the card the moment the send succeeds, so a crash between send
 * and write re-sends (at-least-once, the safe direction) and nothing else does.
 */
export function unsentQuestions(tasks: QACard[] | undefined | null): LocatedQuestion[] {
  const out: LocatedQuestion[] = [];
  for (const t of Array.isArray(tasks) ? tasks : []) {
    if (!t?.id || !Array.isArray(t.humanQA)) continue;
    t.humanQA.forEach((e, index) => {
      if (isOpen(e) && e.tgMessageId === undefined) {
        out.push({ taskId: t.id, title: t.title ?? t.id, index, q: e.q.trim() });
      }
    });
  }
  return out;
}

/**
 * The still-open ask a chat reply is answering, or null.
 *
 * Returns null for an entry that is already answered or dismissed — the human
 * closed it on ASK ME in the meantime, and re-writing it would clobber the real
 * answer. A null here means the reply is NOT an answer, so the caller routes it
 * as an ordinary request instead.
 */
export function findQuestionByMessageId(
  tasks: QACard[] | undefined | null,
  messageId: number | undefined
): LocatedQuestion | null {
  if (typeof messageId !== 'number' || !Number.isFinite(messageId)) return null;
  for (const t of Array.isArray(tasks) ? tasks : []) {
    if (!t?.id || !Array.isArray(t.humanQA)) continue;
    for (let i = 0; i < t.humanQA.length; i++) {
      const e = t.humanQA[i];
      if (e?.tgMessageId === messageId && isOpen(e)) {
        return { taskId: t.id, title: t.title ?? t.id, index: i, q: e.q.trim() };
      }
    }
  }
  return null;
}

/** The card's humanQA with ONE entry patched, by index. Every other entry —
 *  and every field on the patched one — is carried through untouched, because
 *  the whole array is what gets written back. */
export function patchEntry(
  humanQA: HumanQAEntry[] | undefined,
  index: number,
  patch: Partial<HumanQAEntry>
): HumanQAEntry[] {
  const list = Array.isArray(humanQA) ? humanQA : [];
  if (index < 0 || index >= list.length) return list;
  return list.map((e, i) => (i === index ? { ...e, ...patch } : e));
}

/** Telegram's hard message cap. Questions are short; a runaway one is trimmed
 *  rather than 400'd away. */
const CHAT_QUESTION_MAX = 3500;

/** The question as it appears in the chat: `[MD-12] Which region?`. Plain text —
 *  it is sent without parse_mode, so no markup is added that would render raw. */
export function formatQuestionForChat(taskId: string, q: string): string {
  const line = `[${taskId}] ${String(q ?? '').trim()}`;
  return line.length > CHAT_QUESTION_MAX ? `${line.slice(0, CHAT_QUESTION_MAX - 1)}…` : line;
}

/** What the chat says back once the answer is on the card. Turkish, matching
 *  how the human runs the floor from Telegram. */
export function formatAnswerAck(taskId: string): string {
  return `✅ ${taskId} cevaplandı`;
}

export interface OutboundMessage {
  to: string;
  act: 'inform' | 'request' | 'query';
  subject: string;
  body: string;
}

/**
 * What the god is told when the human answers. The answer is already on the
 * card; this is what makes something happen about it.
 *
 * ONE body for both front doors: an answer typed on ASK ME and an answer sent
 * from Telegram must be indistinguishable to the god, or he learns to trust one
 * and not the other.
 */
export function answerMessage(
  task: { id: string; title: string },
  question: string,
  answer: string
): OutboundMessage {
  return {
    to: 'god',
    act: 'inform',
    subject: `HUMAN ANSWER on task "${task.title}"`,
    body: [
      `The human answered the open question on task ${task.id} ("${task.title}"):`,
      `Q: ${question}`,
      `A: ${answer}`,
      "The answer is also recorded in the card's humanQA. Act on it, unblock the card, and continue the work."
    ].join('\n')
  };
}
