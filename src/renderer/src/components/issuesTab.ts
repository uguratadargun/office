/**
 * The two bits of Issues-tab chrome that are worth testing on their own: which
 * repo the tab opens on, and what colour a verdict paints.
 *
 * They live in a `.ts` file rather than inside CommandCenterPanel.tsx because
 * the test loader transpiles TS but not JSX — logic buried in a .tsx component
 * is logic nothing can check.
 */
import type { ChipState } from '@shared/prReview';

/** `cth.`-prefixed localStorage is this app's namespace for UI preferences
 *  (theme, terminal font size, collapsed rails). The repo you were last reading
 *  issues for is exactly that kind of preference. */
export const LS_ISSUE_REPO = 'cth.issuesRepo';

/**
 * Which repo the tab should show.
 *
 * A remembered repo only wins if it is still registered — a repo removed from
 * settings must not leave the tab pointing at a path that no longer resolves,
 * fetching nothing and blaming the host for it.
 */
export function resolveIssueRepo(repos: string[], saved: string | null | undefined): string {
  return saved && repos.includes(saved) ? saved : (repos[0] ?? '');
}

export function readIssueRepo(): string {
  try { return window.localStorage.getItem(LS_ISSUE_REPO) ?? ''; } catch { return ''; }
}

export function writeIssueRepo(repo: string): void {
  try { window.localStorage.setItem(LS_ISSUE_REPO, repo); } catch { /* private mode — the tab still works, it just forgets */ }
}

/**
 * The frame colour for a local review verdict.
 *
 * This is the chip's OUTERMOST border, not a label tint: a NOT READY verdict has
 * to be visible without reading the chip. `neutral` stays a hairline in the
 * ordinary ink so "nobody has reviewed this" never looks like a result.
 */
export function verdictFrame(state: ChipState): { color: string; width: number } {
  if (state === 'green') return { color: 'var(--cth-mint)', width: 2 };
  if (state === 'red') return { color: 'var(--cth-coral)', width: 2 };
  if (state === 'running') return { color: 'var(--cth-lemon)', width: 2 };
  return { color: 'var(--cth-ink-300)', width: 1 };
}
