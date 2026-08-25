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

## 2. State / IPC used (reused verbatim, no main-process changes)

- Store: `agents`, `restorableAgents`, `selectedId`, `select`, `reorderAgents`,
  `setAgentNote`, `setAddAgentOpen`, `setEditAgentId`, `setIdeOpen`, `setFullscreen`,
  `fullscreenAgentId`, `sidebarTab`/`setSidebarTab`, `openTaskDetail`,
  `archiveAgent`, `updateAgent`, `removeRestorableAgent`.
- Hooks/helpers: `useFleetUsage`, `useFleetTelemetry().breakers[id]`, `usePtyParser`,
  `useHasTerminalDraft`, `sortAgentsForList`, `taskLedger` (`parseTasks`,
  `selectAgentWork`, `openQuestion`, `TASK_POLL_MS`), `usageFormat`
  (`billedChipText`, `formatTokens`, `formatUsd`, `capProgress`), `relSince`,
  `inferAgentProvider`, `isClearCommand`.
- IPC (`window.cth.`): `getConfig`, `updateConfig`, `hiveTasks`, `hiveInbox`,
  `hiveSend`, `hiveUpdateAgentMeta`, `spawnPty`, `killPty`, `openTerminalAt`,
  `openExternal`, `historyAdd`, `chooseFolder`, `resolveSessionCwd`,
  `importHireFile`, `controlSnapshot|Pause|Resume|Halt|Steer`, `attachFiles`,
  `pathForFile`, `saveClipboardImage`.
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

## 4. shadcn primitives needed (from `modern/components/ui`)

`button`, `input`, `textarea`, `select`, `dialog`, `tabs`, `badge`, `progress`,
`tooltip`, `scroll-area`, `separator`, `avatar`, `card`, `switch`, `collapsible`,
`dropdown-menu`, `alert`. Anything missing → `npx shadcn add`, never hand-rolled.

## 5. Open questions for god

1. **God/Michael:** detail for `isGod` currently swaps in CommandCenterPanel. Out of
   my area — I will render a "Command Center" placeholder and defer to whoever owns it.
2. **Fullscreen terminal** (`FullscreenTerminal.tsx`) — is that mine, or the shell's
   (MD-84 overlay slot)? I assume the shell owns the overlay and I only mount/unmount.
3. **breaker level + effort controls** are not in the pixel `AgentControlStrip`
   (effort lives in AddAgentModal, breaker is read-only telemetry). I will surface
   effort as an edit-agent field and breaker as a read-only chip unless told to add
   a live setter (that would need a main-process change).
