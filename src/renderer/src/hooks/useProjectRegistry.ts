import { useCallback, useState } from 'react';

import type { HarnessConfig } from '@/store/config';

/**
 * THE REGISTERED-PROJECTS LIST, as an Add-Agent form uses it.
 *
 * `config.registeredRepos` is the quick-pick row of folders you hire into, and
 * it is also what the Directories and Issues screens read. Keeping it correct
 * has three rules that are easy to get half-right, which is why they are here
 * once rather than in each form (MD-151):
 *
 *   1. A newly picked folder goes to the FRONT, deduped — the next hire should
 *      default to the project you just chose.
 *   2. Main expands `~` when it persists the list, so the STORED list is what
 *      the form adopts afterwards; keeping the typed "~/dev/foo" would ride
 *      along into the spawn.
 *   3. After a spawn, the folder promoted is the PROJECT, never the private
 *      worktree an isolated agent got — otherwise the quick-picks (and the
 *      screens that read them) fill up with `…/worktrees/<agent>` paths.
 *
 * The hook owns the list and the persist; picking a folder and what to do with
 * the selection stay with the caller, because that is the part the two forms
 * genuinely do differently.
 */
export interface ProjectRegistry {
  repos: string[];
  /** Register `path` now: dedupe-prepend, persist, adopt what main stored.
   *  Returns the registered (expanded) path, or null if nothing was written. */
  registerProject: (path: string) => Promise<string | null>;
  /** Post-spawn: promote the project folder to the front, quietly. `worktree`
   *  is the isolated path main provisioned, if any — never the one promoted. */
  promoteProject: (picked: string, spawnedCwd: string, worktree?: string) => void;
}

export function useProjectRegistry(
  config: HarnessConfig,
  onConfigChange?: (config: HarnessConfig) => void
): ProjectRegistry {
  const [repos, setRepos] = useState<string[]>(config.registeredRepos ?? []);

  const registerProject = useCallback(async (path: string): Promise<string | null> => {
    const p = path.trim();
    if (!p) return null;
    const next = [p, ...repos.filter((r) => r !== p)];
    setRepos(next);
    try {
      const updated = await window.cth.updateConfig({ registeredRepos: next });
      const stored = updated.registeredRepos ?? next;
      setRepos(stored);
      onConfigChange?.(updated);
      return stored[0] ?? p;
    } catch {
      return p; // best-effort persist: the list is still right in this form
    }
  }, [repos, onConfigChange]);

  const promoteProject = useCallback((picked: string, spawnedCwd: string, worktree?: string) => {
    const projectRoot = worktree ? picked.trim() : spawnedCwd;
    if (!projectRoot || repos[0] === projectRoot) return;
    const nextRepos = [projectRoot, ...repos.filter((r) => r !== projectRoot && r !== picked)];
    void window.cth.updateConfig({ registeredRepos: nextRepos })
      .then((updated) => onConfigChange?.(updated))
      .catch(() => { /* best-effort */ });
  }, [repos, onConfigChange]);

  return { repos, registerProject, promoteProject };
}
