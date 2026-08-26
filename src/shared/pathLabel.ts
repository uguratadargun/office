/**
 * Naming a filesystem path in a UI row.
 *
 * MD-125. The human ran the app on Windows and the modern Agents list came
 * apart: rows carried `C:\Users\ugur\HarnessAgents\worktrees\worker-md91-toby`
 * in full, the status and Working chips were pushed out of the viewport, and
 * the page stopped fitting. Nobody had seen it on macOS, where the same paths
 * are shorter and made of `/`.
 *
 * Two separate things go wrong with a Windows path, and only one of them is CSS:
 *
 *  1. `\` OFFERS NO SOFT BREAK. A browser will wrap a long `/`-path between its
 *     segments; `\` is not a break opportunity in any line-breaking class, so
 *     the whole path is one unbreakable word whose intrinsic width every flex
 *     and grid ancestor then honours. `truncate` fixes that ONLY if every
 *     ancestor can shrink — one missing `min-w-0` and the row expands instead.
 *  2. `split('/')` IS NOT A BASENAME. It is the derivation this app used for an
 *     agent's `project`, and on a backslash path it matches nothing and returns
 *     the path entire — so the "short label" written into the roster was the
 *     long string. No amount of truncation makes that honest, because the value
 *     itself was wrong before it reached the DOM.
 *
 * So: one place that knows both separators, used wherever a path becomes a
 * label. Pure and dependency-free — main, both renderers and the node tests.
 */

/** The last segment of a path, whichever separator it is written with.
 *
 *  A trailing separator is a real thing a config file can hold, and stripping
 *  it first is why `C:\repos\fd\` names `fd` rather than nothing. Returns the
 *  input unchanged when there is no separator to cut on, so a bare name, an
 *  empty string and a drive-relative fragment all survive. */
export function baseName(path: string): string {
  const raw = typeof path === 'string' ? path : '';
  const trimmed = raw.replace(/[/\\]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (cut < 0) return trimmed || raw;
  return trimmed.slice(cut + 1) || trimmed || raw;
}

/**
 * `<basename> — <parent>`: the distinguishing half FIRST.
 *
 * The order is the whole point. Truncation cuts from the end, so a label that
 * leads with the parent (`C:\Users\ugur\HarnessAgents\worktrees\…`) truncates
 * away the only part that says WHICH one — every row ends up reading the same.
 * Leading with the basename means an aggressive cut still leaves the answer,
 * and the full path stays available in the element's `title`.
 *
 * Lifted out of `modern/issues/issuesData.ts` (MD-111), where it was written
 * for repo paths, because a worktree path in the Agents list has exactly the
 * same problem.
 */
export function pathLabel(path: string): string {
  const raw = typeof path === 'string' ? path : '';
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
 * A one-line label for arbitrary text that shares a row with other things.
 *
 * `truncate` is the right tool for a value with a box of its own; this is for
 * the ones that do not have one — a 200-character `command` in a tooltip, an
 * agent's `action` in a floor speech bubble drawn on a canvas where CSS does
 * not reach at all. Cuts on a word boundary when there is one nearby, so the
 * result reads like a phrase rather than a severed string.
 */
export function clampLabel(text: string, max = 64): string {
  const s = (typeof text === 'string' ? text : '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space >= max * 0.5 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
