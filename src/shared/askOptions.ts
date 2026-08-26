/**
 * Lettered choices inside a humanQA ask — parsed out so the human can CLICK one
 * instead of retyping the letter.
 *
 * The god has always written its questions as prose with lettered options in it
 * ("… (a) hemen / (b) MD-120 girince (c) pixel kalsın"), and the human has
 * always answered with a bare letter. Nothing about that contract changes here:
 * the answer this module composes for a chosen option is still exactly the
 * letter, so every agent reading `humanQA[n].a` sees what it always saw. What
 * changes is only how the human produces it.
 *
 * Two sources, in order:
 *   1. `entry.options` — a structured list an asker passed explicitly. It wins,
 *      because it is what the asker MEANT, not what a regex recovered.
 *   2. the prose of `entry.q`, parsed below.
 *
 * Pure and shared (`src/shared`): the renderer's answer box uses it, and a
 * future chat mirror can use the same option list to build a keyboard without
 * re-deriving the letters.
 */

/** One selectable choice. `key` is the letter the agents expect as the answer. */
export interface AskOption {
  key: string;
  /** What the option says, verbatim from the question. May be long — clamp at
   *  the render site, never here: trimming it is a display decision, and the
   *  full text is what makes an option make sense. */
  label: string;
}

/** A question split into what is being asked and what can be picked. */
export interface ParsedAsk {
  /** The question minus the option run — what to show above the choices. Falls
   *  back to the whole question when there are no options. */
  stem: string;
  options: AskOption[];
}

/** Letters we recognise, in order. Ten is far past anything the god writes and
 *  keeps the run short enough to keyboard-select with one keypress. */
const LETTERS = 'abcdefghij';

/**
 * A lettered marker: `(a)` or `a)`, at the start or after whitespace or one of
 * the separators the god actually uses between inline options (`:` `/` `·` `,`
 * and dashes), and followed by whitespace.
 *
 * The trailing-whitespace requirement is what keeps `MD-120/121` and ordinary
 * parenthetical prose out; the consecutive-letter check below does the rest.
 */
const MARKER = /(^|[\s:/·,—–-])\(?([a-j])\)(?=\s)/gi;

/** Bare `a/b/c` — a question that names the letters without labelling them. */
const BARE_RUN = /(^|[\s(])([a-j])(?:\s*\/\s*([a-j]))+(?=[\s?.,;:)]|$)/i;

/**
 * The option run in a question, or none.
 *
 * A run must start at `a` and its letters must be consecutive — that is the
 * whole defence against a stray parenthetical being read as a choice. A marker
 * whose letter is not the next one expected is skipped rather than ending the
 * run, because the god's questions do interleave prose between options (a real
 * one puts `(c)` after a "NOT:" paragraph two sentences past `(b)`).
 */
export function parseAskOptions(q: string | undefined | null): ParsedAsk {
  const text = String(q ?? '');
  const whole = text.trim();
  const hits: { key: string; start: number; end: number }[] = [];
  MARKER.lastIndex = 0;
  for (let m = MARKER.exec(text); m; m = MARKER.exec(text)) {
    const key = m[2].toLowerCase();
    if (key !== LETTERS[hits.length]) continue;
    hits.push({ key, start: m.index + m[1].length, end: m.index + m[0].length });
  }
  if (hits.length >= 2) {
    const options = hits.map((h, i) => ({
      key: h.key,
      label: cleanLabel(text.slice(h.end, i + 1 < hits.length ? hits[i + 1].start : text.length))
    }));
    return { stem: text.slice(0, hits[0].start).trim() || whole, options };
  }
  const bare = BARE_RUN.exec(text);
  if (bare) {
    const letters = bare[0].replace(/[^a-j]/gi, '').toLowerCase().split('');
    const ok = letters.length >= 2 && letters.every((c, i) => c === LETTERS[i]);
    // The letters ARE the labels here — there is nothing else to show, and the
    // human still gets one keypress instead of a typed character.
    if (ok) return { stem: whole, options: letters.map((key) => ({ key, label: key.toUpperCase() })) };
  }
  return { stem: whole, options: [] };
}

/** One option's text, tidied for a single-line row: newlines folded, and the
 *  separator that led into the NEXT option dropped off the end. */
function cleanLabel(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/[\s/·,;—–-]+$/, '').trim();
}

/** The shape this module needs off a humanQA entry — structural, so it fits
 *  main's HumanQA and the renderer's alike. */
export interface AskLike {
  q: string;
  a?: string;
  options?: AskOption[];
}

/**
 * The choices on an ask: the asker's own list if it passed one, else whatever
 * the prose yields. A structured list is used verbatim and is NOT re-parsed —
 * an asker that says "these are the options" is right by definition.
 */
export function askOptions(entry: AskLike | undefined | null): ParsedAsk {
  const explicit = Array.isArray(entry?.options)
    ? entry.options
      .filter((o): o is AskOption => !!o && typeof o.key === 'string' && !!o.key.trim())
      .map((o) => ({ key: o.key.trim().toLowerCase(), label: String(o.label ?? '').trim() }))
    : [];
  if (explicit.length >= 2) return { stem: String(entry?.q ?? '').trim(), options: explicit };
  return parseAskOptions(entry?.q);
}

/**
 * The answer text for a picked option and/or typed note.
 *
 * A letter alone is the historical answer and stays byte-identical. With a note
 * the letter still comes FIRST, so the god's "one letter is enough" reading of
 * the answer keeps working and the note is extra rather than in the way.
 */
export function composeAnswer(key: string | null | undefined, note: string | undefined): string {
  const k = String(key ?? '').trim().toLowerCase();
  const n = String(note ?? '').trim();
  if (k && n) return `${k} — ${n}`;
  return k || n;
}

/** The letter an existing answer picked, or null — the answer may be free text,
 *  and may have been typed in the chat as `a`, `A`, `(a)` or `a) …`. */
export function answeredKey(answer: string | undefined | null): string | null {
  const m = /^\s*\(?([a-j])\)?(?=$|[\s).,:;—–-])/i.exec(String(answer ?? ''));
  return m ? m[1].toLowerCase() : null;
}

/** The option an answered entry chose, for showing the label back instead of a
 *  lone letter nobody can read later. Null when the answer was free text. */
export function chosenOption(entry: AskLike | undefined | null): AskOption | null {
  const key = answeredKey(entry?.a);
  if (!key) return null;
  return askOptions(entry).options.find((o) => o.key === key) ?? null;
}
