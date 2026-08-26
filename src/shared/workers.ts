/**
 * EPHEMERAL WORKERS, as a panel reads them.
 *
 * A worker is the Slack spawn loop's unit of work: a fresh isolated worktree
 * that does one job, replies in its thread and tears down. Main owns the live
 * map; what lives here is how a row is WORDED, because two UIs now draw the
 * same list and a worker that reads "working" in one and "running" in the other
 * is two different facts to whoever is deciding whether to stop it (MD-158).
 *
 * Structural types on purpose: the authoritative shapes are `WorkerSnapshot` /
 * `PreservedWorktreeSnapshot` in the preload, and `src/shared` must not import
 * across that boundary.
 */
import { relDuration } from './relTime';
import { formatTokens } from './usageFormat';

export interface WorkerLike {
  workerId: string;
  name: string;
  baseBranch: string;
  ageMs: number;
  /** null = the PTY is already gone. */
  idleMs: number | null;
  tokensUsed: number;
  /** null = uncapped, which is the default. */
  tokenCap: number | null;
  hasSlack: boolean;
  releasing: boolean;
}

export interface PreservedLike {
  workerId: string;
  wtPath: string;
  baseBranch: string;
  preservedAt: number;
}

/** 'stopping' the moment a teardown is in flight — the row must stop claiming
 *  the worker is doing your work the instant you press stop. */
export function workerStatusLabel(w: Pick<WorkerLike, 'releasing'>): 'working' | 'stopping' {
  return w.releasing ? 'stopping' : 'working';
}

/** "2 / 4" — a capacity, so the number that matters (how many more can start)
 *  is one subtraction away rather than absent. */
export function workerCapacityLabel(liveCount: number, maxWorkers: number): string {
  return `${liveCount} / ${maxWorkers}`;
}

/** "billed 36k / 2M" — or "billed 36k · uncapped", which is a different fact
 *  from a cap that happens to be large. */
export function workerBilledLabel(w: Pick<WorkerLike, 'tokensUsed' | 'tokenCap'>): string {
  const used = formatTokens(w.tokensUsed);
  return w.tokenCap !== null ? `billed ${used} / ${formatTokens(w.tokenCap)}` : `billed ${used} · uncapped`;
}

/** "idle 4m" — or "pty gone", which is why `idleMs` is nullable: a worker whose
 *  terminal has died is not an idle worker, and saying "idle 0s" would hide the
 *  one row a human most wants to stop. */
export function workerIdleLabel(w: Pick<WorkerLike, 'idleMs'>): string {
  return w.idleMs === null ? 'pty gone' : `idle ${relDuration(w.idleMs)}`;
}

/** The metadata line, one place, so both panels say the same things in the same
 *  order. `title` is the hover explanation; an empty one means the label speaks
 *  for itself. */
export function workerMetaRow(w: WorkerLike): { key: string; text: string; title: string }[] {
  return [
    { key: 'id', text: w.workerId, title: 'worker / PTY id' },
    { key: 'base', text: `base: ${w.baseBranch}`, title: 'base branch the worktree was cut from' },
    { key: 'age', text: `up ${relDuration(w.ageMs)}`, title: 'time since spawn' },
    { key: 'idle', text: workerIdleLabel(w), title: 'time since last terminal output' },
    { key: 'billed', text: workerBilledLabel(w), title: '' }
  ];
}

/** What stopping this worker costs, in the words the destructive prompt needs.
 *  It is NOT "the work is lost": teardown preserves a worktree that still holds
 *  un-integrated work, and saying otherwise would make people leave a runaway
 *  worker alone. */
export function stopWorkerConsequence(w: Pick<WorkerLike, 'name'>): string {
  return `${w.name} stops mid-job and its Slack thread gets no reply. Its worktree is kept if it holds un-integrated work.`;
}

/** "kept 3h ago" for a preserved worktree. */
export function preservedAgeLabel(p: Pick<PreservedLike, 'preservedAt'>, now: number): string {
  return `kept ${relDuration(Math.max(0, now - p.preservedAt))} ago`;
}
