/**
 * The IDE's editor state, held OUTSIDE React — one module store per workspace
 * root (MD-98).
 *
 * Why this exists: `AppShell` keys its `ViewBoundary` on the nav id, so every
 * navigation UNMOUNTS the view it was showing. While the IDE kept its tabs and
 * edit buffers in `useState`, clicking Agents and coming back threw away every
 * open tab and every unsaved edit, silently and with no prompt — the S1 in
 * MD-94. The pixel IDE never hit this because it is a fullscreen overlay that is
 * opened and closed, not a route.
 *
 * A prompt-before-you-lose-it would have been the smaller change and the wrong
 * one: the edits do not need to be lost at all. Keeping them here means
 * navigating away and back is a no-op, exactly as it is in any real editor.
 *
 * Sessions are keyed by root and kept: an agent switch is a workspace switch,
 * and switching back must not have discarded the other workspace's buffers
 * either. `MAX_SESSIONS` bounds that — the least-recently-touched clean session
 * is evicted, and a session with unsaved work is NEVER evicted.
 *
 * One subscriber set, notified on every commit: a consumer reading a different
 * root drops the re-render itself, because `useSyncExternalStore` compares
 * snapshots with `Object.is` and the other root's object is unchanged.
 */

export type TabMode = 'edit' | 'diff' | 'revdiff' | 'image';
export type MdView = 'code' | 'split' | 'preview';

export interface Tab {
  key: string;
  rel: string;
  mode: TabMode;
  /** revdiff only: the two revisions being compared, and a short label. */
  revA?: string;
  revB?: string;
  revLabel?: string;
}

export interface EditBuffer {
  content: string;
  original: string;
  status: 'loading' | 'ready' | 'error';
  /** Set when the file could not be READ — the buffer has no content at all. */
  error?: string;
  saving?: boolean;
  /** Set when the file could not be WRITTEN. The buffer keeps its content and
   *  stays dirty; this is shown inline, never in place of the editor. */
  saveError?: string;
}

export interface DiffBuffer {
  status: 'loading' | 'ready' | 'binary' | 'error';
  head: string;
  working: string;
  error?: string;
}

export interface SearchState {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  busy: boolean;
  results: Awaited<ReturnType<typeof window.cth.ideSearch>> | null;
}

export interface IdeSession {
  tabs: Tab[];
  activeKey: string | null;
  edits: Record<string, EditBuffer>;
  diffs: Record<string, DiffBuffer>;
  mdViews: Record<string, MdView>;
  /** Which rail tab is showing. Lived inside `Tabs` before, so a Changes →
   *  Search → Changes round trip threw the query and its hits away. */
  rail: string;
  search: SearchState;
  /** Bumped after a save so the changes rail re-reads `git status`. */
  gitToken: number;
  /** Monotonic touch counter, for eviction only. */
  touched: number;
}

export const tabKey = (mode: TabMode, rel: string, revA?: string, revB?: string): string =>
  mode === 'revdiff' ? `revdiff::${revA}::${revB}::${rel}` : `${mode}::${rel}`;

/** A buffer only counts as dirty once it has actually loaded — the tab marker,
 *  the footer and the close guard all read this one function, or the ✕ discards
 *  what the guard refuses to. A failed WRITE leaves the buffer `ready` and
 *  dirty on purpose, so the edits stay reachable. */
export const isDirty = (b?: EditBuffer): boolean =>
  !!b && b.status === 'ready' && b.content !== b.original;

export const sessionIsDirty = (s: IdeSession): boolean =>
  Object.values(s.edits).some(isDirty);

const EMPTY_SEARCH: SearchState = {
  query: '', regex: false, caseSensitive: false, busy: false, results: null
};

export const EMPTY_SESSION: IdeSession = Object.freeze({
  tabs: [], activeKey: null, edits: {}, diffs: {}, mdViews: {},
  rail: 'changes', search: EMPTY_SEARCH, gitToken: 0, touched: 0
});

/** Enough to cover switching between the handful of agents on a floor without
 *  growing without bound over a long session. */
const MAX_SESSIONS = 8;

const sessions = new Map<string, IdeSession>();
const subscribers = new Set<() => void>();
let clock = 0;

export function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

/** The snapshot for one root. Stable by identity between commits, which is what
 *  lets `useSyncExternalStore` skip the render for every OTHER root. */
export function getSession(root: string | null): IdeSession {
  if (!root) return EMPTY_SESSION;
  return sessions.get(root) ?? EMPTY_SESSION;
}

/**
 * Apply one immutable update to a root's session and notify.
 *
 * Never gate the notify on "did the field I care about change" — that is the
 * bug MD-84e fixed in `design/theme.ts`. Consumers drop their own no-op
 * renders; a store that decides for them drops real ones too.
 */
export function update(root: string, fn: (s: IdeSession) => IdeSession): void {
  const prev = sessions.get(root) ?? EMPTY_SESSION;
  clock += 1;
  const next = { ...fn(prev), touched: clock };
  sessions.set(root, next);
  evict();
  subscribers.forEach((f) => { f(); });
}

/** Drop the least-recently-touched session that has nothing unsaved in it.
 *  A session holding dirty buffers is never a candidate — evicting it would be
 *  the same silent data loss this whole module exists to stop. */
function evict(): void {
  if (sessions.size <= MAX_SESSIONS) return;
  let victimKey: string | null = null;
  let victimTouched = Infinity;
  for (const [k, s] of sessions) {
    if (sessionIsDirty(s)) continue;
    if (s.touched < victimTouched) { victimTouched = s.touched; victimKey = k; }
  }
  if (victimKey) sessions.delete(victimKey);
}

/**
 * Settle one save against the buffer as it stands NOW.
 *
 * `sent` is the exact string handed to `writeFile`, not the buffer's current
 * content: anything typed while the write was in flight has not been written,
 * so marking it saved would silently lose it. Comparing against the snapshot
 * keeps the buffer dirty for precisely those keystrokes.
 *
 * On failure the buffer keeps its content and its `ready` status — an
 * unwritable file must not swallow the edits — and carries the message for the
 * inline bar.
 */
export function settleSave(
  buf: EditBuffer,
  sent: string,
  res: { ok: true } | { ok: false; error: string }
): EditBuffer {
  if (!res.ok) return { ...buf, saving: false, saveError: res.error };
  return { ...buf, saving: false, saveError: undefined, original: sent };
}

/** Test seam only — drops every session. */
export function __resetIdeStore(): void {
  sessions.clear();
  clock = 0;
}
