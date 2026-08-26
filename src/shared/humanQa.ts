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

import type { AskOption } from './askOptions';

/** One ask on a card. Mirrors HiveTask['humanQA'][n] in main/hive.ts. */
export interface HumanQAEntry {
  q: string;
  a?: string;
  /** Lettered choices the asker offers, when it has them to hand. Optional and
   *  additive: the god has always written its options into the prose of `q`, and
   *  `@shared/askOptions` still recovers those — this field is for an asker that
   *  would rather say so explicitly than be parsed (MD-142). */
  options?: AskOption[];
  askedAt?: string;
  answeredAt?: string;
  dismissedAt?: string;
  /** Telegram message_id of the question as posted to the allowed chat. Doubles
   *  as the exactly-once send marker (set ⇒ already mirrored) and as the reply
   *  target the human's answer is matched against. Lives ON THE CARD so it
   *  survives a restart without a second store to keep in sync. */
  tgMessageId?: number;
  /** Id of the hive message this ask was raised from, when it came in as mail
   *  addressed to the human rather than as a hand-written card entry. It is the
   *  exactly-once marker for that route: the router records an ask only if no
   *  entry on any card already carries this id, so redelivery of the same
   *  message can never stack duplicate asks on the board. */
  fromMessageId?: string;
}

/** The minimum of a card these helpers need. Structural on purpose: main and the
 *  renderer each have their own fuller HiveTask. */
export interface QACard {
  id: string;
  title: string;
  humanQA?: HumanQAEntry[];
  /** Read by `askTargetCard` only, to pick which of a sender's cards a mailed
   *  ask attaches to. It is deliberately NOT part of `waitsOnHuman` — see there. */
  status?: string;
  assignee?: string;
  archived?: boolean;
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
 * The card's currently open ask, or undefined. Newest first: the god appends,
 * so the last unresolved entry is the live one and the ones above it are the
 * decision trail.
 */
export function openAsk<T extends HumanQAEntry>(humanQA: T[] | undefined | null): T | undefined {
  if (!Array.isArray(humanQA)) return undefined;
  for (let i = humanQA.length - 1; i >= 0; i--) if (isOpen(humanQA[i])) return humanQA[i];
  return undefined;
}

/**
 * THE ASK ME predicate. A card belongs on the ASK ME board iff it carries an
 * open ask — full stop.
 *
 * `status` is deliberately NOT part of this (MD-83). It used to be: ASK ME
 * required `status === 'blocked'`, while the Tasks board's answer box, the
 * Telegram mirror and the `mine` chip all used the status-free test. So an ask
 * on a card the god left in `doing` — or moved to `done` with the ask still
 * open — was answerable INSIDE the card and invisible on ASK ME, which is
 * exactly the report this fix came from. One predicate, four readers: the board
 * on the floor, the ASK ME tab, the tab badge, and the chat mirror.
 *
 * The card's status is still how the god parks the work; it is just not what
 * decides whether the human is being asked something.
 */
export function waitsOnHuman(card: { humanQA?: HumanQAEntry[] } | undefined | null): boolean {
  return !!openAsk(card?.humanQA);
}

/** Every open ask across the ledger, located. The one enumeration behind both
 *  the ASK ME board and the chat mirror. */
export function openAsks(tasks: QACard[] | undefined | null): LocatedQuestion[] {
  const out: LocatedQuestion[] = [];
  for (const t of Array.isArray(tasks) ? tasks : []) {
    if (!t?.id || !Array.isArray(t.humanQA)) continue;
    t.humanQA.forEach((e, index) => {
      if (isOpen(e)) out.push({ taskId: t.id, title: t.title ?? t.id, index, q: e.q.trim() });
    });
  }
  return out;
}

/**
 * Every open ask that has NOT been mirrored to the chat yet.
 *
 * The `tgMessageId` marker is what makes this exactly-once across restarts: it
 * is written to the card the moment the send succeeds, so a crash between send
 * and write re-sends (at-least-once, the safe direction) and nothing else does.
 */
export function unsentQuestions(tasks: QACard[] | undefined | null): LocatedQuestion[] {
  const byId = new Map((Array.isArray(tasks) ? tasks : []).map((t) => [t?.id, t]));
  return openAsks(tasks).filter((a) => byId.get(a.taskId)?.humanQA?.[a.index]?.tgMessageId === undefined);
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

/* ─── raising an ask (the one write path onto the board) ────────────────────── */

/** The status a card takes when an ask is raised on it: the work genuinely
 *  cannot proceed, and the kanban should say so. `waitsOnHuman` no longer reads
 *  it, so a card the god leaves in `doing` still shows up — this is about the
 *  board being honest, not about visibility. */
export const ASK_STATUS = 'blocked';

/** A mailed ask, flattened to one question. Subject alone is usually the ask;
 *  the body carries the detail the human needs to answer it, so both go in
 *  rather than making the human open the card to find out what was meant. */
export function formatAskFromMessage(
  msg: { from?: string; subject?: string; body?: string }
): string {
  const subject = String(msg?.subject ?? '').trim();
  const body = String(msg?.body ?? '').trim();
  const from = String(msg?.from ?? '').trim();
  const head = subject || body.split('\n')[0] || 'needs your input';
  const detail = subject && body && body !== subject ? `\n\n${body}` : (subject ? '' : '');
  return `${from ? `[${from}] ` : ''}${head}${detail}`.trim();
}

/** The card's humanQA with one fresh ask appended. Every earlier entry is
 *  carried through untouched — the Q&A history is the card's decision trail and
 *  is never rewritten. */
export function withNewAsk(
  humanQA: HumanQAEntry[] | undefined,
  q: string,
  now: string,
  fromMessageId?: string
): HumanQAEntry[] {
  const entry: HumanQAEntry = { q: String(q ?? '').trim(), askedAt: now };
  if (fromMessageId) entry.fromMessageId = fromMessageId;
  return [...(Array.isArray(humanQA) ? humanQA : []), entry];
}

/** True when this hive message has ALREADY been recorded as an ask on some
 *  card. The router is at-least-once (a redelivered message is a normal event),
 *  so without this the same question would stack a new entry every time. */
export function askAlreadyRecorded(
  tasks: QACard[] | undefined | null,
  messageId: string | undefined
): boolean {
  if (!messageId) return false;
  return (Array.isArray(tasks) ? tasks : []).some((t) =>
    Array.isArray(t?.humanQA) && t.humanQA.some((e) => e?.fromMessageId === messageId));
}

/**
 * Which card a mailed ask attaches to, or null for "none — open a fresh one".
 *
 * Preferring the sender's own live card keeps the question next to the work it
 * is about, and keeps the board from growing a card per question. `doing` beats
 * `blocked` beats `todo` (the card they are actually on), archived and done are
 * never targets, and a tie falls to the last one in the ledger — the most
 * recently added.
 */
export function askTargetCard(tasks: QACard[] | undefined | null, from: string | undefined): string | null {
  const rank = (s: string | undefined): number => (s === 'doing' ? 3 : s === 'blocked' ? 2 : s === 'todo' ? 1 : 0);
  if (!from) return null;
  let best: { id: string; r: number } | null = null;
  for (const t of Array.isArray(tasks) ? tasks : []) {
    if (!t?.id || t.archived || t.assignee !== from) continue;
    const r = rank(t.status);
    if (r === 0) continue; // done / unknown — not somewhere to hang a live question
    if (!best || r >= best.r) best = { id: t.id, r };
  }
  return best?.id ?? null;
}

/** Title for the card a mailed ask opens when the sender has nothing in flight.
 *  Short, and says who is waiting — it is what the human reads on the board. */
export function askCardTitle(msg: { from?: string; subject?: string }): string {
  const subject = String(msg?.subject ?? '').trim() || 'needs your input';
  const from = String(msg?.from ?? '').trim();
  const title = from ? `${from}: ${subject}` : subject;
  return title.length > 120 ? `${title.slice(0, 119)}…` : title;
}
