import type { LocalSkill, CatalogSkill } from '../../../../preload';

/**
 * Skills — what the agents on this machine can already do, and what else is out
 * there. Everything this area decides before it draws a row.
 *
 * The question the installed list answers is "why did my agent just do that?",
 * and the question the catalog answers is "what else could it do?". They are
 * different questions with the same search box, which is the only reason they
 * share a screen.
 *
 * Pure on purpose: the area is two IPC lists, three facets and a cap, and none
 * of that needs a renderer to be checked. The pixel tab derives its filtered
 * list and its total COUNT through two separate copies of the same filter
 * chain — that is two places for one predicate, and this module is the fix as
 * much as it is the port.
 */

export type { LocalSkill, CatalogSkill };

/** How many catalog rows to put in the DOM. The catalog is ~1,200 entries;
 *  nobody scrolls past a few hundred and the browser stutters long before that.
 *  The count beside the list always states the REAL total, so the cap is a
 *  rendering decision the user can see rather than a silent truncation. */
export const CATALOG_RENDER_CAP = 300;

function hit(haystack: string | undefined, needle: string): boolean {
  return (haystack ?? '').toLowerCase().includes(needle);
}

/** A skill matches a search when its NAME or its DESCRIPTION does. Not its path
 *  or its url: a search for "pdf" would then match every skill installed under
 *  a directory with pdf in it, which is a different question. */
export function matchesSkill(s: { name: string; description?: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return hit(s.name, q) || hit(s.description, q);
}

export function filterLocal(list: LocalSkill[], query: string): LocalSkill[] {
  return (list ?? []).filter((s) => matchesSkill(s, query));
}

export interface CatalogFilters {
  query?: string;
  /** Publisher, or 'all'. */
  owner?: string;
  /** Catalog category, or 'all'. */
  category?: string;
}

/**
 * The catalog, filtered — ONCE.
 *
 * Returns the full match list and the capped slice together, because the count
 * and the rows have to come from the same predicate. Deriving "1,204 matching"
 * from one filter chain and the rows from a second copy is how a list ends up
 * claiming a total it is not showing rows for.
 */
export function filterCatalog(
  list: CatalogSkill[], f: CatalogFilters
): { matching: CatalogSkill[]; shown: CatalogSkill[]; capped: boolean } {
  const owner = f.owner && f.owner !== 'all' ? f.owner : null;
  const category = f.category && f.category !== 'all' ? f.category : null;
  const matching = (list ?? []).filter((s) =>
    (!owner || s.owner === owner)
    && (!category || s.category === category)
    && matchesSkill(s, f.query ?? ''));
  return {
    matching,
    shown: matching.slice(0, CATALOG_RENDER_CAP),
    capped: matching.length > CATALOG_RENDER_CAP
  };
}

/**
 * The values of one facet with their counts, commonest first.
 *
 * Ties break alphabetically rather than by insertion order: the catalog's order
 * is whatever the upstream file happens to be in, and a dropdown that reshuffles
 * between two refreshes for no visible reason is one the user stops trusting.
 */
export function facetCounts(list: CatalogSkill[], key: 'owner' | 'category'): [string, number][] {
  const counts = new Map<string, number>();
  for (const s of list ?? []) {
    const v = s[key];
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * Can this skill be removed?
 *
 * Bundled skills ship inside the app and are re-copied into every agent on
 * spawn, so "removing" one deletes a folder that comes straight back. Offering
 * the button anyway is worse than not offering it: the user presses it, the row
 * disappears, and the behaviour they were trying to stop keeps happening.
 */
export function isRemovable(s: LocalSkill): boolean {
  return s.scope !== 'bundled';
}

/** Why the installed list is empty — "nothing installed" and "nothing matches"
 *  are different facts and must not share a sentence. */
export function installedEmptyCopy(total: number, query: string): string {
  if (query.trim()) return 'No installed skill matches that.';
  return total === 0
    ? 'No skills installed yet. Browse the catalog to see what is available.'
    : 'Nothing to show.';
}

/** What to say about where the catalog came from. A cached copy shown as if it
 *  were live is how a user retries an install that cannot work yet. */
export function catalogSourceNote(meta: { stale?: boolean; error?: string } | null): string | null {
  if (!meta) return null;
  if (meta.error) return `Showing a cached copy — ${meta.error}.`;
  if (meta.stale) return 'Showing a cached copy — the catalog could not be refreshed.';
  return null;
}

/**
 * Is this catalog entry already on disk?
 *
 * Answered from the LOCAL LIST, never from a sticky "I installed this" flag on
 * the row. The flag version is what the classic tab does, and a live run caught
 * what it costs: install a skill, uninstall it from the Installed pane, and the
 * catalog row still reads "Installed" and stays disabled — because the install
 * marked the row by URL and the uninstall cleared it by PATH. The two never meet
 * and the entry cannot be reinstalled without a full catalog refetch.
 *
 * The local list is refreshed after BOTH operations, so deriving from it is
 * self-correcting: the same "prefer the fact over the flag" rule MD-139 cost an
 * afternoon to learn.
 *
 * Matched on name, case-insensitively, because that is the only field the two
 * shapes share — `installSkill` derives the folder from the source path, so a
 * near-miss is possible; a near-miss shows an Install button for something
 * already present, and main refuses that with "Already installed at …", which is
 * a recoverable wrong answer. The flag version's wrong answer is a dead button.
 */
export function isInstalled(s: { name: string }, local: LocalSkill[] | null): boolean {
  const n = s.name.trim().toLowerCase();
  return (local ?? []).some((l) => l.name.trim().toLowerCase() === n);
}

/**
 * Per-row action state, keyed by the row's stable id (catalog url, local path).
 *
 * Keyed rather than global so one row's failure reads as one row's failure. A
 * single `error` on the panel makes a refused install look like the catalog
 * being down, and the user refreshes instead of reading the reason.
 *
 * `busy` and `error` only — "installed" is NOT kept here; see `isInstalled`.
 */
export interface RowState {
  busy?: boolean;
  error?: string;
}

export function setRow(
  state: Record<string, RowState>, id: string, next: RowState | null
): Record<string, RowState> {
  const out = { ...state };
  if (next === null) delete out[id];
  else out[id] = next;
  return out;
}

/**
 * What an install attempt should say.
 *
 * `unsupported` is the case worth separating: it means the catalog entry has no
 * downloadable source, so retrying can never work and the honest move is to
 * send the user to the page. Rendering it as an ordinary failure invites a
 * retry loop against something that was never installable.
 */
export function installOutcome(
  res: { ok: true; path: string } | { ok: false; error: string; unsupported?: boolean }
): RowState | null {
  // Success clears the row: what it now looks like is the local list's answer,
  // not a flag this row remembers.
  if (res.ok) return null;
  return res.unsupported
    ? { error: `${res.error} — open the page to install it by hand.` }
    : { error: res.error };
}
