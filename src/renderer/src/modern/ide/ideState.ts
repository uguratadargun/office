/**
 * The IDE's two decisions that are worth getting right in one place, away from
 * the components that render them (MD-121). Both were QA findings, and both are
 * the same kind of bug: a screen stating something it does not actually know.
 */

/* ── 1. Which workspace is on screen, and did we have to guess? ─────────── */

/** Only what the rule needs. Deliberately not `Agent`: the precedence order is
 *  about ids and cwds, and a narrower input is a narrower thing to get wrong. */
export interface TargetAgent {
  id: string;
  cwd?: string;
  isGod?: boolean;
}

export interface IdeTarget<A extends TargetAgent> {
  agent: A | null;
  root: string | null;
  /** True only when NOBODY chose this workspace — see below. */
  inferred: boolean;
}

/**
 * Preference order, most trustworthy first: the agent the opener NAMED, the
 * agent the user has SELECTED, then god / the first agent so the IDE still
 * opens on something.
 *
 * `inferred` marks the last of those three, and only the last. It was
 * previously "anything past `pinnedId`", which made it true on the ordinary
 * route into this view: `pinnedId` is set only by "Open IDE" on an agent, so
 * arriving from the nav rail read "(assumed)" even one click after choosing
 * that agent in Agents (MD-118 S3). A selection IS the user naming it — the
 * two differ in which control was used, not in who decided.
 *
 * That distinction is the whole value of the word. A warning that is always on
 * is not a warning; it is decoration, and the one time the directory really was
 * a guess it would read exactly the same.
 */
export function pickIdeTarget<A extends TargetAgent>(
  agents: readonly A[],
  selectedId: string | null,
  pinnedId: string | null
): IdeTarget<A> {
  const byId = (id: string | null) => (id ? agents.find((a) => a.id === id) ?? null : null);
  const named = byId(pinnedId) ?? byId(selectedId);
  if (named?.cwd) return { agent: named, root: named.cwd, inferred: false };
  const guess = agents.find((a) => a.isGod) ?? agents[0] ?? null;
  if (guess?.cwd) return { agent: guess, root: guess.cwd, inferred: true };
  return { agent: null, root: null, inferred: false };
}

/* ── 2. What the git rail should be showing ─────────────────────────────── */

/**
 * `checking` is its own state rather than folding into `loading`: it is the gap
 * before we know whether git applies here at all, and the wrong thing to show
 * in it is anything git-shaped.
 */
export type GitPaneState = 'checking' | 'not-a-repo' | 'error' | 'ready';

/**
 * The rail asked `gitStatus` straight away and printed whatever came back, so
 * a workspace that is not a repository answered with git's own stderr —
 * `fatal: not a git repository (or any of the parent directories): .git` — in
 * red, in the sidebar (MD-118 S2).
 *
 * That is the DEFAULT state of this view, not an edge case: god's cwd is the
 * harness home, and a harness home is not a repository. It is the first thing a
 * new user sees, and it reads like the app is broken.
 *
 * The pixel IDE never had it because it asks `gitIsRepo` first
 * (`ide/IdePanel.tsx`) and renders nothing when the answer is no. So the rule
 * here is the ordering, stated once: **a non-repo is answered before an error
 * can be, and never by surfacing one.** "Not a git repository" is an ordinary
 * fact about a folder, not a failure — an error line claims something went
 * wrong, and nothing did.
 */
export function gitPaneState(o: { isRepo: boolean | null; error?: string }): GitPaneState {
  if (o.isRepo === null) return 'checking';
  if (!o.isRepo) return 'not-a-repo';
  return o.error ? 'error' : 'ready';
}

/* ── 3. The picker's options ────────────────────────────────────────────── */

export interface PickerAgent extends TargetAgent {
  name: string;
  archived?: boolean;
  /** Absent means no live process — the roster's `asleep` word (MD-114). */
  ptyId?: string;
}

export interface PickerOption {
  id: string;
  name: string;
  /** The workspace, basename first. */
  label: string;
  /** The full path, for the title attribute. */
  cwd: string;
  isGod: boolean;
  /** 'asleep' for a processless agent; undefined while it is running. */
  presence?: string;
}

/**
 * MD-129. Until now the IDE only INFERRED its target, and the single explicit
 * route in was "Open IDE" on an agent's card — so from the nav rail you got
 * whatever the rest of the app happened to have selected, with no way to say
 * otherwise from inside the view that was showing it.
 *
 * Two rules the list has to follow:
 *
 *  - **An agent with no `cwd` is not an option.** Picking one would point the
 *    file tree at nothing and there is no honest way to render that.
 *  - **Basename first** (MD-125). The trigger truncates at the END, so a raw
 *    path loses the half that identifies it: `/Users/…/worktrees/pam-mt31…`
 *    is every worktree at once. `pam-mt310mbm — /Users/ugur/HarnessAgents/…`
 *    stays readable at any width.
 *
 * God sorts first — it is the default workspace and the one people look for —
 * and the rest keep roster order rather than being re-sorted here, so the list
 * matches the order they were just reading in Agents.
 */
export function idePickerOptions<A extends PickerAgent>(agents: readonly A[]): PickerOption[] {
  const usable = agents.filter((a) => !a.archived && !!a.cwd && !!a.id);
  const rank = (a: A) => (a.isGod ? 0 : 1);
  return [...usable]
    .sort((x, y) => rank(x) - rank(y))
    .map((a) => {
      const cwd = a.cwd as string;
      const base = cwd.split('/').filter(Boolean).pop() ?? cwd;
      return {
        id: a.id,
        name: a.name,
        label: base === cwd ? cwd : `${base} — ${cwd}`,
        cwd,
        isGod: !!a.isGod,
        // Only worth a word when it is NOT the ordinary state; a badge on every
        // row is a badge nobody reads.
        presence: a.ptyId ? undefined : 'asleep'
      };
    });
}
