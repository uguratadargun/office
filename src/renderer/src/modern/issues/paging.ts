/**
 * Paging for the Issues and PRs lists (MD-127).
 *
 * Held apart from `issuesData.ts` on purpose: that file is where the row's
 * MEANING lives (verdicts, CI tone, which PRs close an issue) and several
 * people edit it. This is a different concern with a different reason to
 * change, and keeping it in its own file is what lets two cards touch the
 * Issues area in the same week without fighting over the same hunks.
 *
 * The whole subtlety is in one sentence: **neither `gh issue list` nor `glab
 * issue list` has an offset or a cursor.** You can only ask for the first N, so
 * a later page is a BIGGER N and the answer re-includes everything already on
 * screen. The merge, not the fetch, is what makes paging correct — which is why
 * `appendPage` is the centre of this file and the fetch is not here at all.
 *
 * Reaching past those CLIs to the GraphQL API for a real cursor is a different
 * auth story for a list that is rarely more than a couple of hundred rows.
 */

/** How many rows a page is (the human asked for twenty). */
export const ISSUE_PAGE_SIZE = 20;

/**
 * Merge a freshly fetched batch onto what is already on screen.
 *
 * Two rules, and they are the whole function:
 *
 *  - **Dedupe by number.** Without it page 2 renders every row twice and React
 *    warns about duplicate keys — the visible symptom of a list that has quietly
 *    stopped being a list of distinct things.
 *  - **First occurrence wins its POSITION, last occurrence wins its DATA.** A
 *    row already on screen must not jump when a later page re-reports it (that
 *    moves a row out from under a click), but its title, labels and state should
 *    be the fresher copy — the host may have been edited since page 1.
 */
export function appendPage<T extends { number: number }>(shown: readonly T[], incoming: readonly T[]): T[] {
  const order: number[] = [];
  const byNumber = new Map<number, T>();
  for (const row of [...shown, ...incoming]) {
    if (!byNumber.has(row.number)) order.push(row.number);
    byNumber.set(row.number, row);
  }
  return order.map((n) => byNumber.get(n) as T);
}

/** What to ask the host for once `pages` pages have been requested. Page 1 is
 *  one page's worth; every "load more" widens it by another. */
export function pageLimit(pages: number): number {
  return Math.max(1, Math.floor(pages)) * ISSUE_PAGE_SIZE;
}

/**
 * Is there another page, or is that everything?
 *
 * The only evidence available is whether the host filled the limit it was
 * given. A short answer means it ran out; a full one means there is probably
 * more — "probably", because a repo with exactly 40 issues answers a limit of
 * 40 with 40 and looks like it has more. That is why the end state waits for a
 * SHORT answer, and why the sentinel says "load more" rather than promising a
 * count.
 */
export function hasMorePages(shownCount: number, askedFor: number): boolean {
  return shownCount >= askedFor;
}

/** The line under a full list. Not "narrow it with the search box" any more —
 *  there is a way forward now, so the copy stops apologising. */
export function pageCapNote(count: number, more: boolean): string | null {
  if (count === 0) return null;
  return more ? null : `All ${count} loaded.`;
}
