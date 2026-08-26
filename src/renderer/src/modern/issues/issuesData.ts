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

/* Paging (page size, appending, the end state) lives in `./paging.ts` — a
   different concern with a different reason to change than what a row MEANS. */

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

/**
 * The words after "PR #12 · ".
 *
 * MD-130 — this slot used to hold three different KINDS of fact behind one
 * unlabelled badge, with the app's own computed value winning first:
 *
 *     if (pr.ready) return 'ready';                    // isReady(): open, not
 *                                                      // draft, CI green, and
 *                                                      // nobody blocking
 *     return { approved: 'approved', … }[pr.review]    // the HOST's decision
 *
 * So an approved PR with green CI read `ready`, a PR nobody had looked at read
 * `ready` too, and `approved` appeared only in the narrow case where CI was not
 * green — a bare word with nothing saying who decided it. The human read it as
 * "approved by me" and asked whether the app had approved on their behalf. It
 * had not; the word was simply unattributed (and on GitLab, unearned — see
 * `gitlabReview`).
 *
 * The slot now carries ONE kind of fact: the host's review decision, always
 * qualified with who made it. `ready` is gone from here — `isReady()` is still
 * the data behind the CI dot and the merge affordance, which is where an
 * app-computed judgement belongs. And a decision with nobody attached renders
 * nothing at all, because there is no honest way to print it.
 */
export function prSuffix(pr: {
  state: string; draft?: boolean; review?: string; decidedBy?: Array<{ login: string }>
}): string {
  if (pr.state !== 'open') return pr.state;
  if (pr.draft) return 'draft';
  if (pr.review === 'pending') return 'review pending';
  const word = pr.review === 'approved' ? 'approved'
    : pr.review === 'changes_requested' ? 'changes requested'
      : '';
  if (!word) return '';
  const who = byLine(pr.decidedBy);
  // No one to name ⇒ say nothing. This is the MD-130 invariant: the strings
  // 'approved' and 'changes requested' NEVER appear on their own.
  return who ? `${word} by ${who}` : '';
}

/** "sharkdp", "sharkdp and tavianator", "sharkdp +2". Two names fit a row; past
 *  that the count carries it and the avatar stack's tooltip has the full list. */
export function byLine(people: Array<{ login: string }> | undefined): string {
  const logins = (Array.isArray(people) ? people : []).map((p) => p?.login).filter(Boolean);
  if (logins.length === 0) return '';
  if (logins.length === 1) return logins[0];
  if (logins.length === 2) return `${logins[0]} and ${logins[1]}`;
  return `${logins[0]} +${logins.length - 1}`;
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

/**
 * How a registered repo reads in the picker: the folder's own name FIRST, then
 * where it lives.
 *
 * The trigger is a fixed-width control that truncates at the END, so a raw
 * absolute path lost exactly the half that identifies it — every scratch clone
 * rendered as "/private/tmp/claude-501/-Users…" and two different repos under
 * one parent were indistinguishable. Leading with the basename means the
 * ellipsis eats the parent directory, which is the part you can afford to lose.
 *
 * Both separators are handled: `registeredRepos` holds whatever the OS gave us,
 * and a Windows path split on '/' alone would have no basename at all.
 */
export function repoLabel(path: string): string {
  const raw = typeof path === 'string' ? path : '';
  // A trailing separator is a real thing config can hold; without stripping it
  // the basename comes back empty and the label falls back to the whole path.
  const trimmed = raw.replace(/[/\\]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (cut < 0) return trimmed || raw;
  const base = trimmed.slice(cut + 1);
  const parent = trimmed.slice(0, cut);
  // '/fd' has a separator but no parent to name, and a dangling em dash reads
  // as a missing value.
  if (!base) return trimmed || raw;
  return parent ? `${base} — ${parent}` : base;
}

/**
 * Whether the local review can still be run against a PR.
 *
 * Beside an issue the chips are NOT filtered to open PRs — an issue keeps the
 * closed and merged PRs that referenced it — so the action has to answer this
 * per chip. The pixel UI gated `Review` on `state === 'open'` for the same
 * reason: re-reviewing a merged diff spends an engine run on a decision that
 * cannot change anything. The report of a past review stays readable either
 * way, which is why only this half is gated.
 */
export function canReview(pr: { state: string } | null | undefined): boolean {
  return pr?.state === 'open';
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
