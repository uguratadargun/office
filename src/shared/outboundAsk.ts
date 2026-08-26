/**
 * A question an agent types straight into a chat thread — recognised, so it can
 * also be put where the human actually looks (MD-143).
 *
 * The human's report: "when an Ask Me question lands on Telegram it must land
 * here too; only Telegram is absurd." The audit found exactly one path that
 * does that — the loopback `/reply` endpoint behind `md-slack-reply.cjs`, which
 * agents and the god use to answer a chat thread directly. Every other outbound
 * path either IS a card ask (the humanQA mirror) or is not a question at all
 * (the queued ack, the done summary, the answer ack).
 *
 * The protocol already tells agents to raise decisions as a humanQA entry AND
 * post them to the thread. This module exists because they demonstrably do the
 * second half and forget the first, and a question the human is never shown is
 * a stalled card either way.
 *
 * BIASED TO RECALL, deliberately. A false positive costs one entry the human
 * dismisses in a click; a false negative is the bug this card is fixing. Both
 * halves are pure so `test/askme-superset.test.cjs` can hold the line on real
 * message texts.
 */

import { parseAskOptions, type AskOption } from './askOptions';
import type { HumanQAEntry } from './humanQa';

/** Telegram's cap, minus room for the `[id] ` prefix the mirror adds. Questions
 *  are short; a runaway one is trimmed rather than dropped. */
const ASK_MAX = 3000;

/** Trailing markup and whitespace that must not hide the question mark:
 *  `*Which region?*`, `Which region? :thinking_face:`, `Which region?**`. */
const TRAILING_NOISE = /(?:\s|\*|_|`|~|>|"|'|\)|\]|:[a-z0-9_+-]+:|[\p{Emoji_Presentation}\p{Extended_Pictographic}])+$/gu;

/** The last line with anything on it, stripped of trailing markup/emoji. */
function lastMeaningfulLine(text: string): string {
  const lines = String(text ?? '').split('\n').map((l) => l.replace(TRAILING_NOISE, '').trim());
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i]) return lines[i];
  return '';
}

/**
 * Is this reply asking the human something?
 *
 * Two signals, either of which is enough:
 *
 *  1. it ENDS on a question — the shape of every real ask, and the one thing a
 *     result summary does not do;
 *  2. it offers lettered/numbered options AND asks something anywhere in the
 *     body — the god's house style ("… (a) hemen (b) MD-120 girince"), where
 *     the question is often followed by the choices rather than ending the
 *     message.
 *
 * Not enough on its own: a question mark somewhere in the middle. Results
 * routinely quote one ("the test asked 'why?' and the answer was …"), and
 * capturing those would put noise on the board every time an agent reports.
 */
export function looksLikeQuestion(text: string): boolean {
  const body = String(text ?? '').trim();
  if (!body) return false;
  if (lastMeaningfulLine(body).endsWith('?')) return true;
  return body.includes('?') && parseAskOptions(body).options.length >= 2;
}

/** The ask as it goes onto the card: the reply's own words, capped. Kept
 *  verbatim otherwise — the human answers what the agent actually asked, and a
 *  summarised question is a different question. */
export function askFromReply(text: string): string {
  const body = String(text ?? '').trim();
  return body.length > ASK_MAX ? `${body.slice(0, ASK_MAX - 1)}…` : body;
}

/** Title for the card a chat question opens when the thread has none. Names the
 *  surface, because on the board it sits next to cards that came from the god
 *  and the human needs to know where this one is waiting. */
export function chatAskCardTitle(channel: string, question: string): string {
  const surface = String(channel ?? '').startsWith('tg:') ? 'Telegram' : 'Slack';
  const head = String(question ?? '').trim().split('\n')[0].replace(TRAILING_NOISE, '').trim() || 'needs your input';
  const title = `${surface}: ${head}`;
  return title.length > 120 ? `${title.slice(0, 119)}…` : title;
}

/** The answer, as it is posted back into the thread the question came from.
 *  Prefixed with the card id so a thread carrying several asks stays readable,
 *  and plain text because Telegram is sent without `parse_mode`. */
export function formatAnswerForChat(taskId: string, answer: string): string {
  return `[${taskId}] ${String(answer ?? '').trim()}`;
}

/** One reply to post, already addressed and worded. */
export interface ChatPost {
  channel: string;
  thread_ts: string;
  text: string;
}

/**
 * The chat posts a card patch owes, when the human has just answered (MD-143).
 *
 * Answering in either place must resolve both, and this is the half the app was
 * missing: an answer typed on ASK ME wrote the card, mailed the god, and left
 * whoever asked in the chat waiting for a reply that never came.
 *
 * A TRANSITION, not a state: only an entry that had no answer before and has one
 * now is posted. That is what makes the caller idempotent — the board polls and
 * re-patches, and a rule that looked only at the current state would re-announce
 * the same answer on every tick. An entry answered somewhere else (the Telegram
 * reply path patches the card itself and posts its own ack) is already
 * answered in `before`, so it is not posted twice either.
 *
 * A card with no chat coordinates owes nothing: there is no thread to answer in.
 */
export function answerPostsForPatch(
  card: { id: string; slack?: { channel?: string; thread_ts?: string }; humanQA?: HumanQAEntry[] } | undefined | null,
  patch: { humanQA?: HumanQAEntry[] } | undefined | null
): ChatPost[] {
  if (!card?.id || !Array.isArray(patch?.humanQA)) return [];
  const out: ChatPost[] = [];
  patch.humanQA.forEach((entry, i) => {
    const answer = typeof entry?.a === 'string' ? entry.a.trim() : '';
    if (!answer) return;
    if (typeof card.humanQA?.[i]?.a === 'string' && card.humanQA[i].a!.trim()) return; // already answered
    // The ENTRY's thread wins over the card's: an ask raised from a chat reply
    // carries the thread it was asked in, and that is where its answer belongs
    // even if the card was opened by some other message.
    const chat = entry?.chat ?? card.humanQA?.[i]?.chat ?? card.slack;
    if (!chat?.channel || !chat?.thread_ts) return;
    out.push({ channel: chat.channel, thread_ts: chat.thread_ts, text: formatAnswerForChat(card.id, answer) });
  });
  return out;
}

/**
 * The `--options "a: now|b: after MD-120"` flag, as structured choices.
 *
 * MD-142 gave a humanQA entry an explicit `options` field precisely so an asker
 * that KNOWS its choices does not have to be parsed out of its own prose. This
 * is that field arriving from a chat reply. One parser, in shared, because the
 * helper that types the flag and the board that renders the buttons must not
 * disagree about where a choice ends.
 *
 * A malformed flag yields nothing rather than half a list: the prose parser in
 * `askOptions` is still there as the fallback, and half a list of choices is
 * worse than none.
 */
export function parseOptionsFlag(raw: string | undefined | null): AskOption[] {
  const parts = String(raw ?? '').split('|').map((p) => p.trim()).filter(Boolean);
  const out: AskOption[] = [];
  for (const part of parts) {
    const m = /^([a-j])\s*[.):-]\s*(.+)$/i.exec(part);
    if (!m) return [];
    const key = m[1].toLowerCase();
    if (out.some((o) => o.key === key)) return [];
    out.push({ key, label: m[2].trim() });
  }
  return out.length >= 2 ? out : [];
}

/** Whitespace, case and trailing punctuation are not what makes two questions
 *  different. Used only for the duplicate check — the entry keeps the words the
 *  agent actually wrote. */
export function normaliseAsk(q: string): string {
  return String(q ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.!?:;,*_`"'()[\]]+$/g, '')
    .trim();
}

/** How long after an identical ask a second one still counts as the same one.
 *  The protocol asks agents to write the humanQA entry AND post it to the
 *  thread, so the two arrive seconds apart and mean one question. */
export const ASK_DEDUPE_MS = 60_000;

/**
 * Is this ask already on the card?
 *
 * Two ways it can be, and both are ordinary rather than exceptional:
 *
 *  - the same question is still OPEN. Re-asking something already pending is
 *    noise no matter how much time passed — and the loopback endpoint is
 *    at-least-once, so a helper that timed out mid-post retries.
 *  - the same question was recorded moments ago, even if it has since been
 *    answered or dismissed. This is the protocol's own double-write: the agent
 *    appends the entry itself and then posts the question with `--ask`.
 *
 * The same words asked again LATER, after the first was closed, are a new
 * decision and must land — that is a person asking twice, not a duplicate.
 */
export function isDuplicateAsk(
  entries: HumanQAEntry[] | undefined | null,
  q: string,
  now: number = Date.now(),
  windowMs: number = ASK_DEDUPE_MS
): boolean {
  const key = normaliseAsk(q);
  if (!key) return false;
  return (Array.isArray(entries) ? entries : []).some((e) => {
    if (normaliseAsk(e?.q ?? '') !== key) return false;
    if (!e?.a && !e?.dismissedAt) return true; // still open
    const at = Date.parse(e?.askedAt ?? '');
    return Number.isFinite(at) && now - at <= windowMs;
  });
}
