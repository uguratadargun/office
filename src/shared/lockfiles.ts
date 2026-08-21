/**
 * Which install command reproduces a repo's lockfile.
 *
 * A `git worktree` checkout has no node_modules, so an isolated agent cannot run
 * the repo's tests until something installs. Picking the WRONG installer is
 * worse than picking none — `npm ci` in a pnpm repo rewrites the lockfile and
 * hands the agent a dependency tree its project never described.
 */
export interface InstallPlan { lock: string; cmd: string; args: string[] }

/** Most specific first: a repo can carry more than one lockfile (a leftover
 *  package-lock.json next to the pnpm-lock.yaml it migrated to), and the
 *  dedicated package manager must win over npm's default. */
export const LOCKFILE_INSTALL: InstallPlan[] = [
  { lock: 'pnpm-lock.yaml',    cmd: 'pnpm', args: ['install', '--frozen-lockfile'] },
  { lock: 'yarn.lock',         cmd: 'yarn', args: ['install', '--frozen-lockfile'] },
  { lock: 'bun.lockb',         cmd: 'bun',  args: ['install', '--frozen-lockfile'] },
  { lock: 'package-lock.json', cmd: 'npm',  args: ['ci'] }
];

/** The install plan for a checkout, given a predicate that says whether a file
 *  exists in it. Returns null when nothing matches — not a JS repo, or its deps
 *  are vendored, either way there is nothing safe to run. */
export function pickInstall(has: (file: string) => boolean): InstallPlan | null {
  return LOCKFILE_INSTALL.find((p) => has(p.lock)) ?? null;
}
