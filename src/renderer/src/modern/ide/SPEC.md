# modern/ide — spec (MD-89)

Port of `src/renderer/src/ide/IdePanel.tsx` (1053 ln) + `GitPanes.tsx` + `ImagePreview.tsx`.
Nav row: `ide`. In the pixel UI the IDE is a **fullscreen overlay** toggled by `store.ideOpen`;
here it is a **nav view**, so `ideOpen` is not used and Escape does not close anything.

## Features it must cover

| Feature | Pixel source | IPC |
|---|---|---|
| Target agent + workspace root, "assumed" when inferred | `pickIdeTarget` | store `ideAgentId` / `selectedId` / `agents` |
| File tree, lazy per directory, hides .git/node_modules/out/dist | `components/FileTree.tsx` | `listDir` |
| Open file → tab; edit; Cmd/Ctrl+S save; dirty marker; close guard | IdePanel `editBuffers` | `readFile`, `writeFile` |
| Git changes rail (staged / unstaged / untracked), stage+commit | IdePanel `status` | `gitIsRepo`, `gitStatus`, `gitCommitFiles` |
| Diff a changed file against HEAD | IdePanel `diffData` | `gitDiff` |
| History (log graph) and Compare (two refs) | `GitPanes.tsx` | `gitLogGraph`, `gitBranches`, `gitBranch`, `gitCompareRefs`, `gitShowFile`, `gitMainRepo`, `gitCheckout` |
| Repo-wide search, regex + case, click a hit to open at its line | IdePanel search rail | `ideSearch` |
| Image / SVG preview | `ImagePreview.tsx` | `readFile` |
| Markdown preview (code / split / preview) | `MarkdownPreview` | — |

## Reuse vs rebuild

- **Reuse as-is**: `ide/MonacoEditor`, `ide/MonacoDiff`, `ide/monaco.ts`. Monaco is not migratable
  (plan §B5) and `monaco.ts` already re-registers its theme off `data-cth-theme`.
  **Gotcha**: it reads `--cth-*` with hardcoded light fallbacks, so under the modern document (no
  `--cth-*`) it would paint the pixel LIGHT palette in dark mode. `modern/ide/monaco-tokens.css`
  defines just the variables Monaco reads, pointed at modern values. Owned by this area, imported
  by it — the modern token file stays free of `--cth-*`.
- **Rebuild** (pixel chrome, inline `--cth-*` styles): the file tree, the rail, tabs, the git panes,
  search results, the image and markdown frames.

## Layout

```
┌ IdeView ───────────────────────────────────────────────────────────────┐
│ header  [agent ▾ badge "assumed"]  workspace/basename        [refresh] │  h-10, border-b
├────────────────┬───────────────────────────────────────────────────────┤
│ rail  w-72     │ tabs  file.ts •  file.md  ✕                           │  border-b
│ ┌ Tabs ──────┐ │ ┌───────────────────────────────────────────────────┐ │
│ │Chg Hst Cmp │ │ │                                                   │ │
│ │Search      │ │ │   Monaco editor  /  diff  /  image  /  markdown   │ │
│ └────────────┘ │ │                                                   │ │
│ (rail body,    │ └───────────────────────────────────────────────────┘ │
│  ScrollArea)   │ status bar: path · language · saved                   │
│ ── Separator ──│                                                       │
│ file tree      │                                                       │
│ (ScrollArea)   │                                                       │
└────────────────┴───────────────────────────────────────────────────────┘
```
Rail width is a `ResizablePanelGroup` (horizontal). Tabs are `Tabs`; the rail switcher is `Tabs`.
Everything else: `Button` ghost/icon-sm, `Input` for search, `Badge` for git status letters,
`ScrollArea` for the two scrolling columns, `Skeleton` while a buffer loads.

## Two rules the QA had to teach this view (MD-121)

Both live in `ideState.ts`, tested in `test/modern-ide-state.test.cjs`, because both are the
same failure: **the header stating something the app does not actually know.**

- **Ask `gitIsRepo` before asking git anything.** A workspace that is not a repository is the
  DEFAULT here — the orchestrator's cwd is the harness home — so going straight to `gitStatus`
  and rendering its error meant a first run opened on `fatal: not a git repository …` in red.
  It gates all three git panes, not just Changes: a non-repo `root` makes `gitMainRepo` answer
  `root` back, so History and Compare were printing the same line. "Not a git repository" is a
  fact about a folder, so it is muted, never `text-destructive`.
- **`inferred` marks only the fallback.** A pin (`Open IDE`) and a selection are both the user
  naming the workspace; only "god / the first agent, because we had to open on something" is a
  guess. Marking everything past the pin made "(assumed)" permanent on the ordinary route in,
  and a warning that never varies carries no information on the visit that needs it.

## The workspace picker (MD-129)

The header's `Select` is the explicit half of `pickIdeTarget`: it sets the SAME `pinnedId` that
"Open IDE" sets, so there is one notion of "the user named this workspace" rather than two.

- Options come from `idePickerOptions` — agents with a `cwd`, not archived, god first, workspace
  **basename first** (the trigger truncates at the end, so a raw path loses the identifying half).
- The pick is remembered in `localStorage` via `ideStore`, not in the roster: it is a per-machine
  preference about one view, and `roster.json` travels between machines.
- Switching targets is not a discard. Sessions are keyed by root, so the previous agent's unsaved
  buffers are still there when you switch back — the same invariant MD-94 introduced them for.
- No sentinel value is needed: Radix reserves `''` for "no selection" and every option's value is
  an agent id.
