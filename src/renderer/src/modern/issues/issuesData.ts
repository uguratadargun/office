/**
 * What the Issues/PRs view shows, decided in one pure place.
 *
 * The two colours on a PR row are the reason this file exists. The CI dot is
 * what the HOST's machines ran; the verdict rail is what the LOCAL review
 * thought of the diff. They are different facts about different things, and a
 * rewrite that folds them into one "status" lets a green pipeline colour an
 * unreviewed change. Keeping both derivations here, tested, is how that stays
 * true through the next refactor.
 *
 * No imports on purpose: loadable by the `.cjs` test harness, which resolves
 * relative and `@shared/` paths only.
 */

/** The one nav entry has two segments (MD-88 ruling: not two nav entries). */
export type Segment = 'issues' | 'prs';

/** The fetch cap. It is SHOWN whenever a full page comes back — an invisible cap
 *  makes an issue you cannot see indistinguishable from one that does not exist,
 *  and the search box is the only way past it. */
export const ISSUE_PAGE_SIZE = 10;

/** CI as the host reported it. `null`/absent = no pipeline at all, which is not
 *  a failure and must not be coloured as one. */
export type CiState = 'success' | 'failure' | 'pending' | null | undefined;

/** The dot's role, mapped to a token by the view. Deliberately NOT merged with
 *  the review verdict — see the file header. */
export type CiTone = 'ok' | 'bad' | 'wait' | 'none';

export function ciTone(ci: CiState): CiTone {
  return ci === 'success' ? 'ok' : ci === 'failure' ? 'bad' : ci === 'pending' ? 'wait' : 'none';
}

/** The local review's verdict as a rail on the ROW. `neutral` draws NO rail
 *  rather than a grey one: an un-reviewed PR should look un-reviewed, and a
 *  grey rail reads as a third verdict. */
export type RailTone = 'ready' | 'notReady' | 'running' | 'none';

export function railTone(
  record: { verdict?: 'ready' | 'not_ready' | 'unknown' } | undefined,
  running: boolean
): RailTone {
  if (running) return 'running';
  if (!record) return 'none';
  return record.verdict === 'ready' ? 'ready' : record.verdict === 'not_ready' ? 'notReady' : 'none';
}

/** The words after "PR #12 · ". State beats draft beats ready beats the host's
 *  review word, because a merged PR's review status is history. */
export function prSuffix(pr: {
  state: string; draft?: boolean; ready?: boolean; review?: string
}): string {
  if (pr.state !== 'open') return pr.state;
  if (pr.draft) return 'draft';
  if (pr.ready) return 'ready';
  return { approved: 'approved', pending: 'review pending', changes_requested: 'changes requested', none: '' }[pr.review ?? 'none'] ?? '';
}

/**
 * The tooltip for a PR's routing arrow.
 *
 * `owner` is NOT the author and NOT who approved it — it is the live agent whose
 * checkout currently sits on the PR's head branch, falling back to the boss when
 * none does. A chip reading "approved · Michael" was read as "approved BY
 * Michael" by the first person who saw it, which is why the arrow and this
 * sentence both exist.
 */
export function routingHint(ownerName: string, branch: string | undefined, bossName: string): string {
  return `routes to ${ownerName} — the agent on branch ${branch || '?'}, else ${bossName}`;
}

/** Open PRs only, newest number first. The tab lists what you can still act on;
 *  a closed PR belongs to history, and the pixel UI filtered the same way. */
export function openPrs<T extends { state: string; number: number }>(prs: T[]): T[] {
  return (Array.isArray(prs) ? prs : [])
    .filter((p) => p?.state === 'open')
    .sort((a, b) => b.number - a.number);
}

/** The PRs that close a given issue, so an issue row can carry its chips. */
export function prsForIssue<T extends { issues: number[] }>(prs: T[], issueNumber: number): T[] {
  return (Array.isArray(prs) ? prs : []).filter((p) => Array.isArray(p?.issues) && p.issues.includes(issueNumber));
}

/**
 * The empty-state sentence for the issue list. Three different situations that
 * a single "No issues" would flatten into one — and the one that matters is the
 * third, because "nothing matched your filter" and "you have not fetched yet"
 * send you to different buttons.
 */
export function issuesEmptyMessage(opts: { fetched: boolean; filtered: boolean }): string {
  if (!opts.fetched) return 'No issues fetched yet — press Fetch to load them.';
  return opts.filtered
    ? 'No issues match that filter.'
    : 'No open issues in this repo.';
}

/** Shown whenever a full page came back. See ISSUE_PAGE_SIZE. */
export function pageCapNote(count: number): string | null {
  return count >= ISSUE_PAGE_SIZE
    ? `Showing the first ${ISSUE_PAGE_SIZE} — narrow it with the search box.`
    : null;
}

/**
 * Whether a repo choice still points at something real.
 *
 * The choice is remembered across mounts, so it can name a repo that has since
 * been unregistered; falling back to the first registered repo beats rendering
 * an empty list for a repo that is gone.
 */
export function resolveRepo(repos: string[], saved: string | null | undefined): string {
  const list = Array.isArray(repos) ? repos : [];
  return saved && list.includes(saved) ? saved : (list[0] ?? '');
}
