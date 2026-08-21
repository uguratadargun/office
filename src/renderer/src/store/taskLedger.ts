/**
 * Reading hive/tasks.json.
 *
 * Pure, and in its own module for two reasons: the kanban component is JSX (the
 * test loader cannot transpile it), and this is the part that was actually
 * broken — the reader parsed a schema the harness does not write. Checked
 * against the live ledger of 42 cards: `description` on 0, `dependsOn` on 0,
 * while `note` was on 38, `deps` on 38 and `result` on all 42.
 *
 * The ledger is shared with the harness and stays READ-ONLY; both spellings are
 * accepted so neither side can break the other.
 */
/** A card on the task kanban. Mirrors HiveTask in the main/preload process —
 *  re-declared locally so the renderer doesn't reach into the preload package
 *  (same convention as store/config.ts). */
export interface HumanQA {
  q: string;
  a?: string;
  askedAt?: string;
  answeredAt?: string;
  /** Set when the human dismisses the ask from the ASK ME board WITHOUT
   *  answering — the question stays on the card (history is preserved) but
   *  openQuestion() stops returning it, so the card leaves ASK ME. */
  dismissedAt?: string;
}

export interface HiveTask {
  id: string;
  title: string;
  description?: string;
  assignee?: string;
  status: 'todo' | 'doing' | 'blocked' | 'done';
  dependsOn: string[];
  priority: number;
  createdAt: string;
  /** First-class human feedback: the god appends {q} when a card needs the
   *  human; the ASK ME view fills in {a}. Full history stays on the card. */
  humanQA?: HumanQA[];
  /** Archived cards stay in the ledger but drop off the board unless the
   *  toolbar's "archived" filter is on. */
  archived?: boolean;
  /** What the assignee reported on completion. Written on EVERY card by the
   *  harness and, until now, read by nothing — so the outcome of every finished
   *  task was recorded and invisible. */
  result?: string;
  /** Where the card came from: a Slack thread, a human ask, an inferred spawn.
   *  Also written on every card. */
  origin?: string;
  /** When the card closed. */
  closedAt?: string;
}

/** The card's currently open question for the human, if any. An entry the human
 *  dismissed (dismissedAt) counts as resolved, same as an answered one. */
export function openQuestion(t: HiveTask): HumanQA | undefined {
  if (!Array.isArray(t.humanQA)) return undefined;
  for (let i = t.humanQA.length - 1; i >= 0; i--) {
    const e = t.humanQA[i];
    if (e && typeof e.q === 'string' && !e.a && !e.dismissedAt) return e;
  }
  return undefined;
}

/** Waiting on the human = blocked with an unanswered question on the card. */
export function waitsOnHuman(t: HiveTask): boolean {
  return t.status === 'blocked' && !!openQuestion(t);
}

/** How often the ledger is re-read. The kanban, the ASK ME board and the tab
 *  badges all poll the same file; keeping the interval here means they cannot
 *  drift into showing different counts for a few seconds at a time. */
export const TASK_POLL_MS = 5000;

/**
 * The two tab-badge counts. They are DIFFERENT NUMBERS on purpose: each badge
 * counts exactly what its own tab lists, because a badge that promises more than
 * the tab shows sends the human hunting for a card that is not there.
 *
 *   tasks   the live board — `!archived` — flagging every card with an open ask,
 *           blocked or not (a card can be moved to done with the ask still open;
 *           the board is where you would look for it).
 *   askMe   the ASK ME board — `waitsOnHuman`, i.e. blocked-only, archived
 *           included, which is the exact filter that view applies.
 *
 * So tasks ⊉ askMe in general: an archived blocked card counts for ASK ME and
 * not for TASKS, a done card with an open ask counts for TASKS and not ASK ME.
 */
export function badgeCounts(tasks: HiveTask[]): { tasks: number; askMe: number } {
  let onBoard = 0, waiting = 0;
  for (const t of tasks) {
    if (!t.archived && openQuestion(t)) onBoard++;
    if (waitsOnHuman(t)) waiting++;
  }
  return { tasks: onBoard, askMe: waiting };
}

export type Status = HiveTask['status'];

/** Deterministic fallback id derived from a task's content (djb2 → base36).
 *  Used for tasks lacking a valid string id so re-parsing tasks.json on every
 *  5s poll yields the SAME id — no React key churn / card remount. Unlike
 *  shortId() (random, for brand-new tasks), this never changes across polls. */
function stableId(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = (((h << 5) + h) ^ seed.charCodeAt(i)) | 0;
  return `t-${(h >>> 0).toString(36)}`;
}

/** A non-empty string field, or undefined. The ledger is hand-written, so a
 *  field can be present-but-null or present-but-blank. */
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/** 1..5, from either spelling. The harness writes a NUMBER; the god writes a
 *  WORD ('high'/'medium'/'low' — 38 of 42 live cards). Reading only the number
 *  meant every one of those fell back to 3, so the priority dots showed the same
 *  middling 3/5 on the whole board: not missing, actively wrong. Out-of-range and
 *  unknown words land on 3 as before, because a card with a typo'd priority is
 *  still a card. */
export function toPriority(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(1, Math.min(5, Math.round(v)));
  const word = typeof v === 'string' ? v.trim().toLowerCase() : '';
  // 'urgent'/'critical' are not in the god's vocabulary today, but they are the
  // words a human reaches for first, and guessing 3 for them would be worse.
  return { critical: 5, urgent: 5, high: 4, medium: 3, normal: 3, low: 2, none: 1 }[word] ?? 3;
}

/** The string members of a maybe-array. */
function pickStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((d): d is string => typeof d === 'string') : [];
}

/** The board's filter chips: the three questions the text box cannot ask. */
export type BoardChip = 'unassigned' | 'blocked' | 'mine';

/** Chips NARROW: every one that is on must hold. Two chips reading as "or" would
 *  make turning a second one on show MORE cards, which is not what a filter
 *  means. They compose with the text box the same way — everything must hold. */
export function matchesChips(t: HiveTask, chips: BoardChip[]): boolean {
  return chips.every((c) =>
    c === 'unassigned' ? !t.assignee
      : c === 'blocked' ? t.status === 'blocked'
        // "mine" is about what is waiting on the HUMAN, which is an open ask on
        // the card — not its status. A card can be moved to done with the
        // human's questions still open, and that is exactly when you want it.
        : !!openQuestion(t)
  );
}

/** Does this card match the board's filter box? Matches the TITLE and the
 *  resolved assignee NAME — the two things a card actually shows — so "jim" and
 *  "slack" both find what you would expect. Case- and whitespace-insensitive; an
 *  empty query matches everything, which is what makes the box safe to leave up.
 *
 *  `assigneeName` is passed in rather than read here because resolving an id to
 *  a name needs the live roster, which is the component's business, not the
 *  ledger's. */
export function matchesQuery(t: HiveTask, assigneeName: string | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return t.title.toLowerCase().includes(q)
    || (assigneeName ?? '').toLowerCase().includes(q)
    // The raw id too: the ledger says "jim-mt2yvlbg" and the board says "Jim",
    // so whichever one you have in hand should find the card.
    || (t.assignee ?? '').toLowerCase().includes(q);
}

/** Normalize whatever hive:tasks returns into a typed task array. The god
 *  writes this file by hand — every field except the shape itself is optional
 *  in practice, so EVERY consumer must go through this (exported for the
 *  detail overlay; a raw card without dependsOn once crashed it). */
export function parseTasks(raw: unknown): HiveTask[] {
  const list = (raw && typeof raw === 'object' && Array.isArray((raw as { tasks?: unknown }).tasks))
    ? (raw as { tasks: unknown[] }).tasks
    : [];
  return list
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t, i) => ({
      id: typeof t.id === 'string' && t.id
        ? t.id
        : stableId(`${typeof t.title === 'string' ? t.title : ''}|${typeof t.createdAt === 'string' ? t.createdAt : ''}|${i}`),
      title: typeof t.title === 'string' ? t.title : '(untitled)',
      // Same story: the harness puts the 4-part contract in `note`, while this
      // reader only knew `description` — which is present on ZERO real cards, so
      // every card's detail view read "(no description on this card)" while its
      // actual content sat unread in the ledger.
      description: str(t.description) ?? str(t.note),
      assignee: typeof t.assignee === 'string' ? t.assignee : undefined,
      status: (['todo', 'doing', 'blocked', 'done'] as const).includes(t.status as Status)
        ? (t.status as Status) : 'todo',
      // The ledger writes `deps`; this reader was only looking for `dependsOn`,
      // so the DEPENDS ON block never rendered a single row against real data.
      // Accept both, so neither spelling is lost.
      dependsOn: pickStrings(t.dependsOn ?? t.deps),
      priority: toPriority(t.priority),
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
      humanQA: Array.isArray(t.humanQA)
        ? (t.humanQA as unknown[])
          .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && typeof (e as { q?: unknown }).q === 'string')
          .map((e) => ({
            q: e.q as string,
            a: typeof e.a === 'string' ? e.a : undefined,
            askedAt: typeof e.askedAt === 'string' ? e.askedAt : undefined,
            answeredAt: typeof e.answeredAt === 'string' ? e.answeredAt : undefined,
            // Preserve a dismissal across the 5s re-parse, else the card would
            // resurface on the next poll (openQuestion would see it as open).
            dismissedAt: typeof e.dismissedAt === 'string' ? e.dismissedAt : undefined
          }))
        : undefined,
      archived: t.archived === true ? true : undefined,
      result: str(t.result),
      origin: str(t.origin),
      closedAt: str(t.closedAt) ?? str(t.doneAt)
    }));
}

