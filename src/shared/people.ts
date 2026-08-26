/**
 * The people on an issue or a PR: assignees, and whoever actually decided a
 * review.
 *
 * MD-128 asked for avatars. MD-130 asked for a name beside the word "approved".
 * They are the same data, which is why they are one module: the fix for
 * "approved by nobody" is having a login to print, and the moment you have a
 * login you can draw a face.
 *
 * ── Why the avatar URL is DERIVED, not fetched ────────────────────────────
 *
 * `gh pr list --json assignees,reviews,author` returns `{id, login, name}` and
 * `{author:{login}, state}` — no avatar anywhere. Verified against the real CLI
 * before choosing: only `gh api graphql` carries `avatarUrl`, and swapping the
 * shared list call over to GraphQL to decorate a row is a large change to the
 * one data path the watcher, the review flow and both UIs share.
 *
 * GitHub serves a canonical avatar per login at
 * `https://avatars.githubusercontent.com/<login>`, so the URL is a pure function
 * of something we already have. Zero extra requests — which is also what the
 * card asked for ("do not add a second gh call per row"). An unknown login
 * answers 200 with GitHub's default image, so this cannot produce a broken
 * tile; the initials fallback is for offline and for a CSP that blocks the host.
 *
 * GitLab is different and simpler: its API hands back `avatar_url` directly, so
 * that one is carried, not derived.
 */

export interface Person {
  login: string;
  /** Display name when the host gives one; the login is the fallback. */
  name?: string;
  /** Absent ⇒ render initials. Never render a broken image. */
  avatarUrl?: string;
}

export const GITHUB_AVATAR_HOST = 'https://avatars.githubusercontent.com';

/** A login → its canonical GitHub avatar. Empty for a blank login so a caller
 *  cannot accidentally build `…/` and request the host's index. */
export function githubAvatarUrl(login: string): string | undefined {
  const l = (login ?? '').trim();
  return l ? `${GITHUB_AVATAR_HOST}/${encodeURIComponent(l)}` : undefined;
}

/**
 * Up to two letters for the fallback tile.
 *
 * Prefers the display name's word initials ("David Peter" → DP) because that is
 * what a human recognises; falls back to the login's first two characters.
 * Non-letter leaders (`_ghost`, `1password`) are skipped rather than rendered —
 * a tile reading "_G" is noise where "GH" is a name.
 */
export function initialsFor(p: { login?: string; name?: string }): string {
  const words = (p.name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const a = firstLetter(words[0]);
    const b = firstLetter(words[words.length - 1]);
    if (a && b) return (a + b).toUpperCase();
  }
  const src = (words[0] ?? p.login ?? '').replace(/[^A-Za-z0-9]/g, '');
  return src.slice(0, 2).toUpperCase() || '?';
}

function firstLetter(w: string): string {
  const m = /[A-Za-z0-9]/.exec(w ?? '');
  return m ? m[0] : '';
}

/**
 * What an avatar stack draws: the first `max` faces and how many are hidden.
 *
 * The overflow count is `+N`, not a truncation — a row that silently showed 3
 * of 7 assignees would be a worse lie than no assignees at all, which is the
 * whole complaint MD-130 came from.
 */
export interface Stack {
  shown: Person[];
  /** 0 ⇒ draw no `+N` chip. */
  overflow: number;
}

export const STACK_MAX = 3;

export function avatarStack(people: readonly Person[] | undefined, max = STACK_MAX): Stack {
  const list = (Array.isArray(people) ? people : []).filter((p) => p && (p.login ?? '').trim());
  const cap = Math.max(0, max);
  return { shown: list.slice(0, cap), overflow: Math.max(0, list.length - cap) };
}

/** Every login, for the tooltip. The stack shows three faces; the tooltip is
 *  where "and who are the other four" gets answered. */
export function loginList(people: readonly Person[] | undefined): string {
  return (Array.isArray(people) ? people : []).map((p) => p?.login).filter(Boolean).join(', ');
}
