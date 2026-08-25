/**
 * Pure view-model for the modern Agents area.
 *
 * Everything here is JSX-free on purpose: `test/load-ts.cjs` transpiles TS but
 * not TSX, so logic that lives in a `.tsx` cannot be tested at all. The rules
 * below are the ones the pixel UI learned the hard way (see the referenced
 * comments in AgentCard.tsx / CommandCenterPanel.tsx) — they are behaviour, not
 * styling, so they must survive the second UI.
 */
import { billedChipText, capProgress } from '@shared/usageFormat';

/** Status → the one badge variant + word the roster shows. `--destructive` is
 *  reserved for real failure (DESIGN-MODERN.md), so only `blocked` earns it. */
export type BadgeTone = 'default' | 'secondary' | 'destructive' | 'outline';

export function statusTone(status: string): BadgeTone {
  if (status === 'blocked') return 'destructive';
  if (status === 'working') return 'default';
  return 'secondary';
}

/**
 * Context gauge. Same escalation as the pixel card (amber from 6/8, coral from
 * 7/8) expressed as a tone rather than a colour, so the token file owns the hex.
 * `progress` is the store's 0..8 scale.
 */
export interface Gauge {
  pct: number;
  tone: 'normal' | 'warn' | 'danger';
  title: string;
}

export function contextGauge(
  progress: number,
  contextTokens?: number,
  contextLimit?: number
): Gauge {
  const clamped = Math.min(8, Math.max(0, Number.isFinite(progress) ? progress : 0));
  return {
    pct: Math.round((clamped / 8) * 100),
    tone: clamped >= 7 ? 'danger' : clamped >= 6 ? 'warn' : 'normal',
    title: contextTokens !== undefined && contextLimit
      ? `Context: ${fmtK(contextTokens)} / ${fmtK(contextLimit)} tokens (${Math.round((contextTokens / contextLimit) * 100)}%)`
      : 'Context gauge — fills once the agent reports activity'
  };
}

const fmtK = (n: number): string => `${Math.round(n / 1000)}k`;

/**
 * The roster row's second line: what it is DOING while it works, what repo it
 * sits in while it does not. One line, never both — the card is three lines and
 * a fourth would push the gauge off the bottom edge.
 */
export function rowSubtitle(a: { status: string; action?: string; project?: string }): string {
  const action = a.action?.trim();
  return a.status === 'working' && action ? action : (a.project ?? '');
}

/**
 * The billed chip, or nothing at all. NEVER a zero: absent or unreadable usage
 * means "no signal", and a 0 there reads as "spent nothing", which is a
 * different and false claim (usageFormat.ts's whole reason to exist).
 */
export function billedChip(usage?: { totalTokens?: number; source?: string }): string | null {
  if (!usage || usage.source === 'none') return null;
  const total = usage.totalTokens;
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return null;
  return billedChipText(total);
}

/** Cap meter for a row — null when nothing is budgeted, so no bar is drawn
 *  rather than a bar against a number nobody chose. */
export function rowCap(used: number, agentCap?: number, floorCap?: number) {
  return capProgress(used, agentCap, floorCap);
}

/**
 * DISPATCH — the invariant. All human dispatch goes to the god; an agent picked
 * in the dropdown is forwarded as a SUGGESTION the orchestrator may ignore.
 * Sending straight into a worker's inbox bypasses the 4-part contract, the
 * tasks.json card and the board, and the old "broadcast" default sent one task
 * to every worker at once.
 */
export interface DispatchTarget { id: string; name: string }

export function dispatchBody(text: string, suggested?: DispatchTarget): string {
  const body = text.trim();
  if (!suggested) return body;
  return `${body}\n\n(The human suggests ${suggested.name} (${suggested.id}) for this — your call as orchestrator.)`;
}

export interface DispatchOutcome { ok: boolean; text: string; sticky: boolean }

/**
 * The outcome rides with the text. A failure STAYS until dismissed and the
 * input keeps what was typed; only a success clears the box and fades. Both
 * used to be one muted string on one 4s timer, so a dispatch that never reached
 * the god looked exactly like one that did.
 */
export function dispatchOutcome(
  res: { ok: boolean; error?: string },
  bossName: string,
  suggested?: DispatchTarget
): DispatchOutcome {
  if (res.ok) {
    return {
      ok: true,
      sticky: false,
      text: `sent to ${bossName}${suggested ? ` (suggesting ${suggested.name})` : ''}`
    };
  }
  return { ok: false, sticky: true, text: `not sent — ${res.error ?? 'unknown error'}` };
}

/**
 * Restart & Continue vs a model change. Continuing is the entire point of the
 * first, so a missing session id must FAIL rather than quietly start a blank
 * conversation; a model change still has to spawn something, so it falls back.
 */
export function resumeIsOptional(kind: 'continue' | 'model-change'): boolean {
  return kind === 'model-change';
}

/* ── List order ────────────────────────────────────────────────────────── */

/**
 * MD-106 — WORKING agents first, then idle, then asleep.
 *
 * This deliberately overrides `@shared/agentOrder`, which groups only
 * awake/sleeping and documents WHY: `status` is written by the pty parser and
 * flips thinking↔working↔idle every few seconds, so ranking on it makes rows
 * hop while you are trying to click one. That is a real cost and it is not
 * hypothetical — it is the reason the shared helper stops at `sleeping`.
 *
 * The human asked for it anyway, for a real reason: on a floor of a dozen
 * agents the two that are actually running are what you came to look at. So the
 * tier lives HERE, in the modern area, rather than in the shared helper the
 * pixel UI also uses — one front-end takes the churn, the other keeps the
 * steady list, and neither has to win the argument.
 *
 * Two things keep the churn survivable:
 *  - the LIVE tier is coarse. `working`, `thinking`, `compacting` and the rest
 *    all rank the same, so the parser flipping between them moves nothing. Only
 *    crossing the live/idle boundary re-ranks a row.
 *  - within a tier the comparator returns 0, so the sort (stable by spec) keeps
 *    the order the rows already had — the user's drag-reorder, not an alphabet.
 */
export interface RankedAgent {
  status: string;
  sleeping?: boolean;
  isGod?: boolean;
}

/** Statuses that mean "this agent has a run in flight". `blocked` and `waiting`
 *  are in here on purpose: an agent stopped ON something is live work — it is
 *  waiting for YOU, which is the opposite of idle. */
const LIVE_STATUS = new Set([
  'working', 'thinking', 'compacting', 'looping', 'waiting', 'blocked', 'typing'
]);

export const RANK_GOD = 0;
export const RANK_LIVE = 1;
export const RANK_IDLE = 2;
export const RANK_ASLEEP = 3;

/**
 * Lower sorts earlier.
 *
 * The god is pinned where it already sits — first — and never demoted for being
 * idle. It is the one row whose position is an address rather than a status: it
 * is where you go to dispatch, and a boss that slid under three workers because
 * it finished thinking would be a worse list, not a fresher one.
 *
 * `sleeping` outranks status because it is not one: the flag survives a boot
 * and the stale `status` underneath it does not.
 */
export function agentListRank(a: RankedAgent): number {
  if (a.isGod) return RANK_GOD;
  if (a.sleeping) return RANK_ASLEEP;
  return LIVE_STATUS.has(a.status) ? RANK_LIVE : RANK_IDLE;
}

/**
 * A NEW array, working first. Copies before sorting: the store's `agents` array
 * is shared state and `Array#sort` mutates in place, so sorting it directly
 * would reorder the store from inside a render.
 */
export function sortAgentsForModernList<T extends RankedAgent>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => agentListRank(a) - agentListRank(b));
}
