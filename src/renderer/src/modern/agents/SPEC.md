# MD-85 — Modern UI: Agents area (`modern/agents/`)

Read-only prep. Source of truth for features: `AgentStrip.tsx`, `AgentCard.tsx`,
`AgentDetailPanel.tsx`, `AgentControlStrip.tsx`, `AddAgentModal.tsx`,
`FullscreenTerminal.tsx`, `PtyTerminalView.tsx`. Pixel UI is not touched.

## 1. Feature inventory (must all survive)

**List (from AgentStrip + AgentCard):** name, role/description, character portrait,
accent, status badge, action-while-working / repo-while-idle line, private note
(inline edit), context gauge (0..8 → %, amber ≥6, coral ≥7, tooltip tokens/limit),
billed chip, `doingCount` sticky note → opens first task, typing indicator
(`useHasTerminalDraft(ptyId)`), god/BOSS marking, selection, drag-reorder,
hibernated (`sleeping`) + Wake, restorable-agents section (restore / dismiss),
"Add Agent" entry point.

**Detail:** header (portrait, name, status badge, IDE, open Terminal.app, edit,
kill-with-arm), control strip, usage readout (+ agent/floor caps), "working on"
strip, 4 tabs — terminal / git / messages / traces — plus the god special case
(`agent.isGod` → CommandCenterPanel; out of my area, I render nothing and defer).

**Terminal:** embedded xterm via `PtyTerminalView` only; unmount when this agent is
fullscreened (`fullscreenAgentId === agent.id`) so two xterms never fight over
cols/rows; `historyAdd` on submit; `isClearCommand` handling; empty states
(In fullscreen / Asleep / No PTY).

**Controls:** pause↔resume, halt, steer input (+ pending-steer count, halting…,
floor delivery-paused notice), breaker level, effort.

**Messages:** inbox/outbox thread (`hiveInbox`, `hiveSend`, attachments via
`attachFiles`/`pathForFile`/`saveClipboardImage`).

**Add Agent flow:** 4 sections — Identity (name · character · accent) ·
Workspace (folder picker, registered repos, isolate-in-worktree, resume session id)
· Engine (provider · model · effort · command · token cap) · Briefing
(description · goal), plus role templates, hire-manifest import, and edit-mode
(`hiveUpdateAgentMeta`) vs create-mode (`spawnPty`).

**SCOPE ADD (god, 2026-08-25) — from the pixel `FloorTab` inside CommandCenterPanel.**
Pam keeps only the fleet telemetry rows; these three are mine:

- **Dispatch box:** free text + an optional "suggest an agent" picker. ALWAYS sends
  to the god (`hiveSend({to:'god', act:'request', subject:'Task from the human'}, 'human')`),
  never into a worker's inbox; a picked agent is appended to the body as a
  suggestion. Seeded from a task-card "assign" (keyed on a `seq` so a repeat assign
  re-prefills, and the picker resets to "Michael decides"). Clear the box only on
  success; a failure stays until dismissed, a success fades after 4s.
- **Roster controls per agent:** provider + model picker, `EffortEditor`,
  `TokenLimitEditor` (per-agent cap written into the merged `agentTokenCaps` map via
  `updateConfig`), Restart (fresh session on a model change) and **Restart &
  Continue** (`resume:true` → `--resume <sessionId>` resolved in main from the hive
  registry; hard-fails rather than silently starting blank), per-row restart errors,
  breaker chip, live telemetry (samples/spark/rate/lastTool).
  The default-model marker comes from `config.defaultModel`, not the CLI's default.
- **Archived agents section:** collapsible, count in the title, restore (re-spawns
  and `addAgent`) with per-row errors, and permanent remove (`removeArchivedAgent`).

## 2. State / IPC used (reused verbatim, no main-process changes)

- Store: `agents`, `restorableAgents`, `selectedId`, `select`, `reorderAgents`,
  `setAgentNote`, `setAddAgentOpen`, `setEditAgentId`, `setIdeOpen`, `setFullscreen`,
  `fullscreenAgentId`, `sidebarTab`/`setSidebarTab`, `openTaskDetail`,
  `archiveAgent`, `updateAgent`, `removeRestorableAgent`, `bossName`, `toolCounts`,
  `archivedAgents`, `removeArchivedAgent`, `addAgent`.
- Hooks/helpers: `useFleetUsage`, `useFleetTelemetry().breakers[id]`, `usePtyParser`,
  `useHasTerminalDraft`, `sortAgentsForList`, `taskLedger` (`parseTasks`,
  `selectAgentWork`, `openQuestion`, `TASK_POLL_MS`), `usageFormat`
  (`billedChipText`, `formatTokens`, `formatUsd`, `capProgress`), `relSince`,
  `inferAgentProvider`, `isClearCommand`.
- IPC (`window.cth.`): `getConfig`, `updateConfig`, `hiveTasks`, `hiveInbox`,
  `hiveSend`, `hiveUpdateAgentMeta`, `spawnPty`, `killPty`, `openTerminalAt`,
  `openExternal`, `historyAdd`, `chooseFolder`, `resolveSessionCwd`,
  `importHireFile`, `controlSnapshot|Pause|Resume|Halt|Steer`, `attachFiles`,
  `pathForFile`, `saveClipboardImage`, `hiveRegistry`, `gitMainRepo`.
- Terminal: `PtyTerminalView` + `terminalPool` (`acquireTerminal`/`attach`/`detach`/
  `dispose`). **One xterm per ptyId — never a second instance.**

## 3. Layout (text wireframe)

```
┌ 300px sidebar ────────────┬ detail ─────────────────────────────────┐
│ Agents            [+ Add] │ ◍ Ada   role · repo    [IDE][⌘][✎][✕]   │
│ ─ hairline ─────────────  │ ─────────────────────────────────────── │
│ ◍ Ada        ● working    │ pause | halt | breaker▾ | effort▾       │
│   role · repo             │ [ steer this agent…            ] [→]    │
│   ▁▁▁▂ 41%  12k billed  ①│ ─────────────────────────────────────── │
│ ◍ Bob        ○ idle       │ billed 1.2M · $3.40 · cap ▁▁▂▁ 38%      │
│   note…                   │ working on: MD-85 modern agents  ▸      │
│ ◌ Cal        ⏻ asleep [⤴] │ ─────────────────────────────────────── │
│                           │ ┌ Terminal │ Git │ Messages │ Traces ┐  │
│ Restorable (2)        ▾   │ │                                    │  │
└───────────────────────────┴─│  xterm fills, mono 13px            │──┘
                              └────────────────────────────────────┘
```
Sidebar row = 3 lines (name+status / role-or-action / gauge+chips), 8px radius,
1px hairline, hover tint, selected = subtle filled surface (no coloured ring).
Add Agent = a `Dialog` with a left section rail (Identity/Workspace/Engine/Briefing),
not a wizard — same four sections as the pixel modal.

Dispatch, the roster-with-controls table and Archived live on an **Agents overview**
route (what you get with nothing selected): dispatch box pinned at the top, roster
rows below it (identity · model/effort · restart · cap · breaker · live rate),
Archived as a `Collapsible` at the bottom.

## 4. shadcn primitives needed (from `modern/components/ui`)

`button`, `input`, `textarea`, `select`, `dialog`, `tabs`, `badge`, `progress`,
`tooltip`, `scroll-area`, `separator`, `avatar`, `card`, `switch`, `collapsible`,
`dropdown-menu`, `alert`, `table`, `popover`. Anything missing → `npx shadcn add`, never hand-rolled.

## 5. Decisions — confirmed by god (2026-08-25)

1. **god / Michael detail** = the same Agents view plus a "Command Center"
   placeholder. Its old tabs are being rebuilt as separate nav areas by other
   agents, so I render the placeholder and do not port CommandCenterPanel.
2. **Fullscreen terminal**: the MD-84 shell owns the overlay slot. I only
   mount/unmount into it — and keep the unmount-while-fullscreened rule.
3. **Effort** = an edit-agent field (it is a spawn argument, applied on restart);
   **breaker** = a read-only chip. No main-process change in this card.

Area boundaries: fleet telemetry rows → Pam. Issues/PRs → Jim. Directories →
Andy/Settings. Everything else that lived in FloorTab (dispatch, roster
model/effort/restart, archived) is mine, under `modern/agents/`.
