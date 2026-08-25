# shadcn/ui migration — inventory + parallel batch plan (MD-81)

Read-only survey of `src/renderer/src` at `origin/main` = `0ab247d6`. No code changed.
Foundation (Tailwind v4 + shadcn init + Settings pilot) is MD-80 / Orcun; **Settings is excluded here**.

## The judgement call, first

**Migrate the five shim files before the 60 screens.** `PixelButton` has **166 uses across 34 files**,
`Icon` 85/28, `PixelPanel` 17/14, `PixelBadge` 10/7, `DestructiveAction` 5/4. Rewriting those five
*internals* onto shadcn re-skins ~80% of the visible chrome while touching **five files** — zero merge
surface for the fan-out. Keep each shim's existing prop API (`variant/size/fullWidth/style/title`,
`variant='default'|'inset'|'active'|'terminal'|'dialog'`) as a thin wrapper over shadcn `Button`/`Card`/`Badge`;
deleting the shims is a later, optional cleanup, not this migration.

What the batches then actually chew through is the **unshimmed** bulk: **156 raw `<button>`, 64 `<input>`,
17 `<select>`, 12 `<textarea>`, 1774 inline `style=` props**. That, not the shims, is where the S/M/L sits.

Second call: `--cth-*` tokens stay the source of truth (DESIGN.md §3, `test/theme-contrast.test.cjs`
parses `tokens.css`). shadcn's CSS vars alias **to** them — never the reverse, or the contrast test goes blind.

## Batch 0 — foundation shims (SERIAL, blocks everything else)

| File | Renders | shadcn | Risk |
|---|---|---|---|
| `components/PixelButton.tsx` | 4 variants × 3 sizes, hover/press state | `Button` + `cva` | **M** — 166 call sites; API must not move |
| `components/PixelPanel.tsx` | 5 surface variants, optional title/accent | `Card` (+`CardHeader`) | S |
| `components/PixelBadge.tsx` | status chip | `Badge` | S |
| `components/ui/DestructiveAction.tsx` | arm→confirm→undo button | `Button` + `AlertDialog`? keep reducer (`ui/destructive.ts` untouched) | S |
| `components/Icon.tsx` | 16×16 hand-drawn pixel SVG set | **NOT migratable** — art, not a primitive. `image-rendering:pixelated` must survive | S |

## Batches 1–6 — file-disjoint, run in parallel

Every file below belongs to exactly **one** batch. Import edges cross batches (e.g. `ActivityTab` imports
`CommandCenterPanel`) but *file ownership* does not, so no two agents ever open the same file.

### B1 — Floor chrome & agent rail (M)
| File | Renders | shadcn | Risk |
|---|---|---|---|
| `App.tsx` | shell, sidebar, titlebar, lazy routes | `Resizable`, `Separator`, `Tooltip` | **L** — 23 inline styles + layout owner |
| `components/AgentStrip.tsx` | agent list + spawn/restore row | `ScrollArea`, `Button`, `Input`, `Dialog` | M |
| `components/AgentCard.tsx` | one agent tile | `Card`, `Badge`, `Tooltip` | M |
| `components/AgentControlStrip.tsx` | pause/deny controls | `Button`, `Tooltip`, `Input` | S |
| `components/AgentDetailPanel.tsx` | right pane, hosts 18 children | `Tabs`, `ScrollArea`, `Separator` | **L** |
| `components/SidebarTabs.tsx` · `SidebarSplitter.tsx` | tab bar / drag handle | `Tabs` · `Resizable` | S |
| `components/UsageReadout.tsx` · `ToolWaterfall.tsx` | token meter / tool timeline | `Progress` · `ScrollArea` | S |
| `components/MichaelBooting.tsx` · `SpritePortrait.tsx` | boot splash / sprite `<canvas>` | `Skeleton` · **NOT migratable** | S |

### B2 — Command Center & its tabs (L)
| File | Renders | shadcn | Risk |
|---|---|---|---|
| `components/CommandCenterPanel.tsx` | 2176 ln, 130 inline styles, tab host + embedded xterm | `Tabs`, `ScrollArea`, `Select`, `Input`, `Textarea`, `Dialog` | **L** — biggest single file; xterm mount stays raw |
| `components/ActivityTab.tsx` · `HistoryTab.tsx` | event feed / session list + filters | `ScrollArea`, `Select`, `Input`, `Checkbox` | M |
| `components/AskMeTab.tsx` · `WorkersTab.tsx` · `SkillsTab.tsx` · `KnowledgeTab.tsx` | Q&A, worker list, skill/knowledge browsers | `ScrollArea`, `Input`, `Select`, `Badge`, `Textarea` | M |
| `components/ThreadsPanel.tsx` · `MemoryPanel.tsx` | message threads / memory list | `ScrollArea`, `Card`, `Textarea` | S |
| `components/MemoryGraphPanel.tsx` | force-layout graph | **NOT migratable** (SVG/canvas); only chrome around it | M |
| `components/issuesTab.ts` | data helper | none | S |

### B3 — Tasks, messaging, terminal chrome (M)
| File | Renders | shadcn | Risk |
|---|---|---|---|
| `components/TasksKanban.tsx` | kanban board, drag, card editor | `Card`, `Badge`, `Dialog`, `Select`, `Textarea`, `ScrollArea` | **L** — 830 ln, 70 styles |
| `components/TaskDetailOverlay.tsx` | task detail overlay | `Dialog`/`Sheet` | S |
| `components/MessageQueueComposer.tsx` | queued-message composer | `Textarea`, `Button`, `Popover` | M |
| `components/FullscreenTerminal.tsx` | fullscreen shell around xterm | `Dialog`, `Badge`, `Tooltip` — **xterm core NOT migratable** | **L** — 1040 ln, 67 styles |
| `components/PtyTerminalView.tsx` | xterm mount | chrome only; **NOT migratable** | S |
| `components/terminal*.ts` (5) | pool/recovery/selection/font/automation | none — logic | S |

### B4 — Triggers (S/M, fully self-contained)
| File | Renders | shadcn | Risk |
|---|---|---|---|
| `components/triggers/ui.tsx` | **local mini design system**: `inputStyle`, `selectStyle`, `Chip`, `Callout`, `Toggle`, `MiniButton`, `Select`, `Field`, `Scroll`, `TriggerCard`, `SubHeader`, `IntervalPicker`, `SecretField` | delete in favour of `Input`,`Select`,`Badge`,`Alert`,`Switch`,`Button`,`Label`,`ScrollArea`,`Card`,`Collapsible` | **M** — highest value/line in the repo |
| `components/triggers/TriggersTab.tsx` · `SchedulesSection.tsx` · `ContextSection.tsx` · `WebhooksSection.tsx` · `TriggerHistoryTab.tsx` | trigger config + run history | fall out of `ui.tsx` once it lands | M |
| `components/triggers/JsonEditor.tsx` | CodeMirror JSON field | **NOT migratable** | S |

### B5 — IDE, git, editors (S — mostly not migratable)
| File | Renders | shadcn | Risk |
|---|---|---|---|
| `ide/IdePanel.tsx` | file tabs, tree, editor host | `Tabs`, `Resizable`, `ScrollArea`, `Command` (file open) | **L** — 1053 ln |
| `ide/GitPanes.tsx` · `ide/ImagePreview.tsx` · `ide/chrome.ts` | diff panes, image view, 3 shared style consts | `Select`, `ScrollArea`, `Button`; `chrome.ts` → `cva` | M |
| `ide/MonacoEditor.tsx` · `MonacoDiff.tsx` · `monaco.ts` | Monaco | **NOT migratable** | S |
| `components/CodeEditor.tsx` · `FullscreenFileEditor.tsx` · `FileTree.tsx` | CodeMirror + chrome, tree | chrome→`Button`/`ScrollArea`; editor **NOT migratable** | M |
| `components/GitTab.tsx` · `git/CommitGraph.tsx` | git status / SVG graph | `ScrollArea`,`Button`; graph **NOT migratable** | M |
| `markdown/MarkdownPreview.tsx` | rendered md | keep `.cth-md-preview` CSS; only container | S |

### B6 — Modals, onboarding, toasts, realtime (M)
| File | Renders | shadcn | Risk |
|---|---|---|---|
| `components/AddAgentModal.tsx` | 1190 ln spawn wizard, 87 styles | `Dialog`, `Tabs`, `Input`, `Textarea`, `Select`, `ScrollArea` | **L** |
| `components/OnboardingWizard.tsx` | 855 ln first-run flow | `Dialog`, `Progress`, `Input`, `Select` | **L** |
| `components/HivePicker.tsx` · `QuitWarningModal.tsx` · `OfficeThemePicker.tsx` | hive switch / quit guard / theme grid | `Dialog`, `Card`, `RadioGroup` | M |
| `components/UpdateToast.tsx` · `UpdateBadge.tsx` · `ReleaseDrop.tsx` | update notices | `Toast`/`Sonner`, `Badge`, `Dialog` | M |
| `components/RealtimeMichaelToggle.tsx` · `realtime/CompletionToast.tsx` · `CostHud.tsx` · `DevicePicker.tsx` | voice toggle, toast, cost HUD, device `<select>` | `Switch`, `Toast`, `Card`, `Select` | S |
| `components/ProviderLogo.tsx` | brand SVGs | **NOT migratable** | S |

**Owned by MD-80 (Orcun) — do not touch:** `SettingsModal.tsx` (2807 ln / 315 styles), `SettingsHeroCard`,
`SetupPanel`, `UpdatesSection`, `McpDefaultsSettings`, `IntegrationsRegistry`, `AiEnginesSettings`,
`OfficeThemePicker` *if* the pilot claims it (it is imported by SettingsModal — **confirm with Orcun**, it is
listed in B6 above on the assumption the pilot stops at the Settings shell).

**Never migrated (hard boundaries):** `scene/office/**` (Pixi, 1959-ln `OfficeFloor.tsx`), all xterm mounts,
all Monaco, all CodeMirror, `Icon.tsx` pixel art, `SpritePortrait` canvas, `CommitGraph`/`memoryGraph` SVG.
Their *surrounding* chrome is in scope; their render surface is not.

## Dead CSS as each batch lands

| Rule in `design/global.css` | Dies with |
|---|---|
| `.cth-tabbar`, `.cth-tabbar::-webkit-scrollbar` (48–49) | B1/B2 — shadcn `Tabs` + `ScrollArea` |
| `.cth-scroll-hidden` (54–55) | any batch that adopts `ScrollArea` |
| `.cth-settings-btn` + `:hover`/`:active` (97–107) | MD-80 (Settings pilot) |
| `.cth-commit-graph`, `> div:hover` (83–89) | B5 — **or never**, if the SVG graph keeps its own hover |
| `button, input, textarea, select` reset (26–32) | last batch only — a global reset dies only when *no* raw control is left |
| `ide/chrome.ts` `ideBarStyle`/`ideIconBtn`/`ideTextBtn` | B5 |
| `triggers/ui.tsx` `inputStyle`/`monoInputStyle`/`textareaStyle`/`selectStyle` | B4 |
| `.cth-md-preview *` (139–197), `canvas,img,svg{image-rendering:pixelated}` (58), `@keyframes cth-blink/pulse`, `prefers-reduced-motion` block, `.cth-titlebar-drag/-nodrag`, `.xterm-width-cache-*` | **keep** — Electron/xterm/markdown/pixel-art, no shadcn equivalent |

## Sequencing

`MD-80 (Tailwind+shadcn init) → Batch 0 (shims, one agent) → B1…B6 in parallel → final sweep`
(sweep = delete the global control reset, re-run `test/theme-contrast.test.cjs`, `npm run -s build`).
Batch 0 is the only serial gate; skipping it makes six agents each invent their own Button.
