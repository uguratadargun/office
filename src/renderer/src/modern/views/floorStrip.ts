/**
 * The Floor's agents strip, minus the JSX (MD-126).
 *
 * Same split, and the same reason, as `agents/agentsModel.ts`: `test/load-ts.cjs`
 * transpiles TS but not TSX, so anything that lives in a `.tsx` cannot be tested
 * at all. What is here is what a test would want to hold — which rows appear, in
 * what order, what each one says, and whether the strip is open — and none of it
 * is about how a card looks.
 *
 * Nothing here invents vocabulary. The order comes from
 * `sortAgentsForModernList`, the badge from `statusBadge`, the second line from
 * `rowSubtitle` — the three functions the roster rail already uses. The human
 * asked to "see the agents from the Floor", not to meet a second dialect of
 * agent, and two places that describe the same agent differently is the bug
 * MD-100 and MD-114 were both filed about.
 */
import { repoLabel } from '../issues/issuesData';
import {
  rowSubtitle, sortAgentsForModernList, statusBadge,
  type BadgeTone, type RankedAgent
} from '../agents/agentsModel';

/** What a card needs, and no more. Deliberately structural rather than the
 *  store's `Agent`: the test can then build one by hand. */
export interface StripAgent extends RankedAgent {
  id: string;
  name: string;
  action?: string;
  project?: string;
}

export interface StripRow {
  id: string;
  name: string;
  /** One character for the avatar. */
  initial: string;
  /** The word and tone the rail would use for this agent. */
  badge: { label: string; tone: BadgeTone };
  /** The truncated second line. */
  subtitle: string;
  /** The untruncated version, for `title`. Empty when there is nothing to add. */
  full: string;
}

/**
 * The avatar letter.
 *
 * `[...name]` rather than `name[0]`: an emoji or an accented letter outside the
 * BMP is two code units, and slicing one of them off renders a replacement
 * glyph. An agent with a blank name still gets a circle with something in it,
 * because an empty avatar reads as a rendering failure rather than as a nameless
 * agent.
 */
export function avatarInitial(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  return [...trimmed][0]!.toUpperCase();
}

/**
 * The second line, path-aware.
 *
 * `rowSubtitle` answers what the agent is DOING, or where it lives when it is
 * not doing anything — and "where it lives" is frequently a path. The card is
 * narrow and truncates at the end, so a raw absolute path loses exactly the half
 * that identifies it (MD-111 S3: every scratch clone read as
 * `/private/tmp/claude-501/-Users…`). `repoLabel` already solved that for the
 * Issues picker, handling BOTH separators because a Windows path split on '/'
 * alone has no basename at all, so this defers to it rather than growing a
 * second answer. A line with no separator in it is left exactly as the rail
 * would say it.
 */
export function stripSubtitle(agent: StripAgent): { subtitle: string; full: string } {
  const raw = rowSubtitle(agent);
  if (!raw) return { subtitle: '', full: '' };
  return { subtitle: /[/\\]/.test(raw) ? repoLabel(raw) : raw, full: raw };
}

/**
 * Every agent on the floor, in the rail's order.
 *
 * The store's `agents` is already the non-archived roster — `archivedAgents` is
 * a separate list — so there is no filtering to do here, and doing it anyway
 * with a guess at the field name is how the two lists drift apart.
 */
export function stripRows(agents: readonly StripAgent[]): StripRow[] {
  return sortAgentsForModernList(agents).map((a) => {
    const { subtitle, full } = stripSubtitle(a);
    return {
      id: a.id,
      name: a.name,
      initial: avatarInitial(a.name),
      badge: statusBadge(a),
      subtitle,
      full
    };
  });
}

/* ── Open / collapsed, remembered ──────────────────────────────────────── */

export const STRIP_OPEN_KEY = 'cth.modern.floorStrip';

/**
 * Open unless the user said otherwise.
 *
 * The default matters: the human asked for this strip, so a first run that hides
 * it would answer the request with an empty bar. Only the exact string `'0'`
 * closes it — anything else, including a key some other version wrote, is read
 * as "no preference" rather than as an instruction.
 *
 * Both accessors are total. `localStorage` throws outright in a few real
 * contexts (a browser set to block site data, some embedded webviews), and a
 * floor that fails to render because it could not remember a toggle would be a
 * far worse bug than a toggle that forgets.
 */
export function readStripOpen(store?: Pick<Storage, 'getItem'>): boolean {
  try {
    return store?.getItem(STRIP_OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeStripOpen(open: boolean, store?: Pick<Storage, 'setItem'>): void {
  try {
    store?.setItem(STRIP_OPEN_KEY, open ? '1' : '0');
  } catch { /* the preference is a convenience, never a precondition */ }
}
