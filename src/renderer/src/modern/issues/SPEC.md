# modern/issues — Issues & Pull Requests (MD-88, phase 1 spec)

Read-only inventory of the pixel implementation. Source of truth today:
`components/CommandCenterPanel.tsx` → `RepoTab({ view: 'issues' | 'prs' })` (lines
~1275–1690) plus `ReviewPreview` (~1186). Two CC tabs (`issues`, `prs`) share one
component and one repo picker.

**Decided (god, MD-88):** the modern UI gets **ONE nav entry, "Issues"**, with an
internal segmented control `Issues | PRs`. The pixel UI's two CC tabs collapse to
one registry entry; the repo picker is shared across both segments, which is what
the pixel UI already does behind the scenes.

## Features to cover

**Shared** — repo picker over `config.registeredRepos`; the choice is REMEMBERED
(`localStorage` via `issuesTab.ts`) and re-validated against the live list, so
leaving and returning does not silently jump to the first repo. Empty registry is
its own state ("No registered repos"), not a blank panel.

**Issues** — fetch (explicit button + debounced 400 ms search-as-you-type),
free-text search, an "assigned to me" toggle, per-issue labels, and the linked PR
chips for that issue. Page size is capped at **10** and the cap must be VISIBLE
("showing the first 10 — narrow it with search"); an invisible cap makes an issue
you cannot see indistinguishable from one that does not exist. Search and `mine`
are pushed down to `gh`/`glab`, never applied to the fetched page. Overlapping
fetches are sequence-guarded so a slow early query cannot repaint over a newer
one. `Assign` seeds the Monitor dispatch box (store one-shot) and switches tabs.

**PRs** — open PRs only, seeded by `githubPRs` then following the watcher's
pushes (`onGithubPRs`); the watcher owns polling, the view only renders. Per row:
CI dot, host review word, draft/ready/state suffix, `→owner` routing, Merge, and
the local review flow (Review → verdict → Preview → re-run from inside the
overlay). Errors from the watcher, from merge, and from review are three distinct
surfaces and each is dismissible/visible on its own.

**Two colours that must not merge.** The CI dot is what the host's machines ran;
the verdict frame is what the local review thought of the diff. Collapsing them
lets a green pipeline colour an unreviewed change. In the PR list the frame is on
the ROW only (chip frame off); beside an issue the chip carries it. The `→name`
is who *hears about* the PR, not who wrote or approved it — it needs the arrow or
a label, never a bare name.

## IPC / store / shared used (no main-process change expected)

- `window.cth.getConfig()` → `registeredRepos`, `issueHost`; `updateConfig`
- `githubIssues(repo, { host, search, mine })`, `githubPRs(repo)`,
  `onGithubPRs(cb)`, `githubMergePR(repo, n)`, `openTerminalAt(repo)`
- `prReviews()`, `prReviewRun(repo, n)`, `prReviewReport(path)`
- `@shared/prReview`: `ReviewRecord`, `repoRefFromUrl`, `reviewKey`, `chipState`
- `components/issuesTab.ts`: `readIssueRepo`, `writeIssueRepo`,
  `resolveIssueRepo`, `verdictFrame` — pure, reused as-is (both UIs import it)
- store: `bossName`, `agents`, `requestDispatchSeed`, `requestCommandCenterTab`

Local state: repo, issues, loading/error, query, mine, prs+prError, mergeBusy/Error,
reviews map, reviewing, reviewError, preview. Refs: fetch seq, search-armed, host.

## Layout (text wireframe)

```
┌ Issues ──────────────────────────────────────────────────┐
│ ( Issues | PRs )                       [repo ▾] [Fetch]  │   ← ONE sticky header:
│ [🔍 search title + description…      ] [ Assigned to me ]│     segmented control +
├──────────────────────────────────────────────────────────┤     shared repo picker
│ ⚠ <error>                                          [×]   │   ← Alert, only on error
│ #412  Tunnel drops after sleep              [Assign]     │
│       bug  needs-repro                                   │   ← Badge row
│       ● PR #77 · ready · →Jim   [Review] [Preview]       │   ← verdict-framed chip
│ ──────────────────────────────────────────────────────── │   ← hairline, not a card
│ #410  … (10 rows max)                                    │
│ Showing the first 10 — narrow it with search.            │   ← always when len===10
└──────────────────────────────────────────────────────────┘

── PRs segment (same header, same repo picker, no Fetch) ────
┌──────────────────────────────────────────────────────────┐
│ ▌● PR #77   Fix tunnel resume       [Review][Preview]    │   ← ▌ = 2px verdict rail
│ ▌            (framed row)                     [ Merge ]  │     ● = CI dot
│  ● PR #74   Bump deps               [Review]  [ Merge ]  │
│ (empty) “No open pull requests.”                         │
└──────────────────────────────────────────────────────────┘

Preview → shadcn Sheet (right, 560px) or Dialog: title "Review of PR #77",
metadata line (verdict · engine · timestamp), markdown body scrolls,
footer [Re-run review] [Close].
```

Rows are hairline-separated list items, not cards — dense but airy, per
DESIGN-MODERN.md. The verdict rail (2px left border) replaces the pixel UI's
inset box-shadow frame; `neutral` shows no rail rather than a grey one.

## Resolved by god (was: open questions)

1. **Primitives come from MD-84 — I do not run `npx shadcn add`.** Every agent
   adding its own would collide on `modern/components/ui/*`. Orcun ships the union
   (sheet, badge, alert, switch, separator, skeleton among them); anything still
   missing after go is a tiny add requested from Orcun on main, not done here.
2. **One nav entry, segmented `Issues | PRs`** (not two sibling entries).

The search box, `Assigned to me` and `Fetch` belong to the Issues segment only —
the PR list follows the watcher and has nothing to fetch. Switching segments must
NOT re-fetch issues or drop the repo choice.
