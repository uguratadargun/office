/**
 * ONE-CLICK BRIEFINGS: a sharp, ready-to-run role instead of a blank field.
 *
 * Lifted out of the pixel Add-Agent modal when the modern dialog grew the same
 * list (MD-151). The strings are the product here — two UIs offering "Repo
 * janitor" with two different standing goals is two different agents wearing
 * one name — so they live in `@shared` and both forms import them.
 */
export interface RoleTemplate {
  /** Button label, and nothing else — the agent is named by the user. */
  label: string;
  /** One-line role → the Description field. */
  description: string;
  /** Standing directive injected on every prompt → the Goal field. */
  goal: string;
}

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    label: 'Repo janitor',
    description: 'keeps the codebase tidy and healthy',
    goal: 'Continuously hunt for dead code, lint errors, flaky tests, and small safe refactors. Fix the safe ones and leave a note for anything risky. Never change behavior without flagging it.'
  },
  {
    label: 'Docs writer',
    description: 'keeps docs in sync with the code',
    goal: 'Watch for code changes that outdate the README and docs, then update them. Write for newcomers and prefer concrete examples over prose.'
  },
  {
    label: 'Bug triager',
    description: 'investigates and root-causes bugs',
    goal: 'For each reported issue: reproduce it, find the root cause, then propose a minimal fix with evidence. No fixes without a confirmed root cause.'
  },
  {
    label: 'Research assistant',
    description: 'gathers and summarizes information',
    goal: 'Research the questions you are given across multiple sources, verify the key claims, and return a concise, cited summary.'
  },
  {
    label: 'Release manager',
    description: 'prepares and ships releases',
    goal: 'Track what has shipped since the last release, update the changelog and version, and draft clear release notes.'
  }
];
