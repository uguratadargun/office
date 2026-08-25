# MD-92 — Modern UI parity QA: Agents · Tasks · Ask Me · Floor

Read-only QA against main `c07419e9` (912 tests). Packaged build (`rm -rf out && npm run build`),
launched with `env -u ELECTRON_RENDERER_URL npx electron . --user-data-dir=<scratch>` on a scratch
profile — Slack, Telegram and webhooks all off, no webhook endpoint. `ui.mode` seeded to `modern`
(equivalent to Settings → Interface → Modern, minus the relaunch). The scratch hive was seeded with a
roster (working / idle / **sleeping** / archived / **restorable** agents) and a `tasks.json` covering
every column, an open ask with a `tgMessageId`, an answered ask, a dependency chain and an archived
card. Both themes were driven with the shell's own topbar toggle — never by stamping `data-cth-theme`.

Source of truth: the pixel components named per row, plus
`src/renderer/src/modern/{agents,tasks,askme}/SPEC.md` and `docs/DESIGN-MODERN.md`.

**Severity:** S1 = blocks making modern the default (a capability the human loses, or a destructive
action made easier). S2 = notable degradation, ship-blocking for a power user. S3 = polish.

Screenshots: `$AGENT_DIR/artifacts/md-92/` (light + dark for every area).

## Agents

| Feature | Pixel location | Modern | Sev | Note |
|---|---|---|---|---|
| Roster rail: name · status · action/repo line · context gauge · billed chip | `AgentCard.tsx` | parity | — | gauge escalation (amber ≥6/8, coral ≥7/8) preserved as tones; billed chip correctly absent with no signal |
| Typing indicator (`useHasTerminalDraft`) | `AgentCard.tsx` | parity | — | ✎ + tooltip |
| BOSS / god marking, selection | `AgentStrip.tsx` | parity | — | |
| **Hibernated agent → Wake** | `AgentCard.tsx` `onWake`, `AgentStrip.tsx:151` (click = wake) | **missing** | **S1** | A sleeping agent cannot be woken anywhere in modern. The empty state reads "Wake it to reattach" next to no control (`12-agents-detail-cal-asleep.png`); `wakeSleepingAgent` is not imported in `modern/`. |
| **Restorable agents (previous session): restore all · per-agent restore · dismiss** | `AgentStrip.tsx:255-337` | **missing** | **S1** | `store.restorableAgents` is never rendered in `modern/` (only `archivedAgents`, a different list). After an app restart the previous team is unreachable from the modern UI. |
| **Kill = two-press arm + countdown** | `AgentDetailPanel.tsx:66` (`useDestructive`) | **degraded** | **S1** | Modern's header ✕ calls `killPty` on the FIRST click (`AgentDetail.tsx`), then archives. Its own tooltip says "there is no undo"; it sits 16px from Edit. |
| Private note, inline edit | `AgentStrip.tsx:169-217`, `AgentCard.tsx:40` | missing | S2 | The field is still persisted and still editable in pixel — a note written there is invisible and uneditable in modern. |
| Add Agent: hire-manifest import (`importHireFile`) | `AddAgentModal.tsx:357` | missing | S2 | The documented hiring hand-off has no modern entry point. |
| Roster (overview): provider + model picker | pixel `FloorTab` in `CommandCenterPanel.tsx` | missing | S2 | Modern shows `provider · model · effort` as static text (`10-agents-overview.png`). |
| Roster: `EffortEditor` | same | missing | S2 | Effort is only reachable via Edit-agent. |
| Roster: **Restart** (fresh session on a model change) | same | missing | S2 | Only "Restart & Continue" is offered; there is no way to start an agent clean without killing + re-adding. |
| Nav badge counts (tasks / asks waiting) | `CommandCenterPanel.tsx:191` `badgeCounts` | missing | S2 | Nothing on the modern rail says an ask is waiting; you must open Ask Me to find out. Affects Tasks + Ask Me equally. |
| Detail: header (IDE · Terminal.app · edit), controls (pause/resume · halt · steer · pending count · halting… · floor delivery-paused), usage + agent/floor cap, breaker chip, "working on" strip | `AgentDetailPanel.tsx`, `AgentControlStrip.tsx` | parity | — | |
| Detail: embedded xterm, unmount-while-fullscreened, `historyAdd` on submit, empty states | `PtyTerminalView.tsx` | parity | — | |
| Detail: Messages (inbox/outbox thread, attachments) | `ThreadsPanel` | parity | — | |
| Detail tab: **git** | `AgentDetailPanel.tsx:250` `GitTab` | relocated | S3 | Lives in the modern IDE (`modern/ide/GitRail.tsx`) — per-agent diff is 2 clicks and a context switch away. |
| Detail tab: **traces** | `AgentDetailPanel.tsx:258` `ToolWaterfall` | relocated | S3 | Lives in Monitor (`modern/monitor/AgentSpans.tsx`). |
| Character portrait + accent colour | `AgentCard.tsx` | missing | S3 | Deliberate: DESIGN-MODERN.md has no portrait and one accent-free palette. Accent/character are still *edited* in Add Agent and shown only on the Floor — worth a decision, not a bug. |
| `doingCount` sticky note → open first task | `AgentCard.tsx:37` | degraded | S3 | The count is gone from the rail; the detail's "working on" strip covers the same jump. |
| Drag-to-reorder the roster | `AgentStrip.tsx:101-122` | missing | S3 | `reorderAgents` is unused in modern; order is `sortAgentsForList` only. |
| Add Agent: role templates | `AddAgentModal.tsx:50` | missing | S3 | Description/Goal start empty. |
| Add Agent: zero-step resume (`resolveSessionCwd` from a session id) | `AddAgentModal.tsx:292-297` | missing | S3 | The id is accepted; the cwd is not looked up for you. |
| Roster: default-model marker from `config.defaultModel` | pixel `FloorTab` | missing | S3 | |
| Roster: live telemetry (samples · spark · lastTool) | pixel `FloorTab` | degraded | S3 | Modern shows rate only. |
| Roster row for a sleeping agent reads `idle` | — | new inconsistency | S3 | The rail says `asleep`, the roster table says `idle` and disables Continue with no reason given (`10-`/`42-agents-overview.png`). |
| Add Agent: Identity · Workspace (folder picker, registered repos, worktree, resume) · Engine (provider · model · effort · command) · Briefing; edit vs create mode | `AddAgentModal.tsx` | parity | — | `14-add-agent-dialog.png` |
| Overview: dispatch box → always the god, agent as a *suggestion*, clear only on success | pixel `FloorTab` | **better** | — | A failed dispatch is now sticky-until-dismissed instead of fading on the same 4s timer as a success. |
| Overview: Archived — collapsible, count, restore, permanent remove, per-row errors | pixel `FloorTab` | parity | — | |

## Tasks

| Feature | Pixel location | Modern | Sev | Note |
|---|---|---|---|---|
| Four columns + counts | `TasksKanban.tsx` | parity | — | Status carries meaning by weight, not hue (allowed by DESIGN-MODERN.md §Palette) |
| Toolbar: `N tasks · M hidden`; chips unassigned / blocked / mine(n) counted board-wide; archived toggle + count; `N unassigned → {boss}` with its transient note; search over title **or** assignee | `TasksKanban.tsx:160-225` | parity | — | `20-tasks-board.png` |
| Card: title, priority dots, assignee badge, open-ask marker; click → detail; hover/focus nudge · archive · dismiss(arm→confirm); checkbox + shift-range | `TasksKanban.tsx:344-436` | parity | — | `22-tasks-card-hover.png` |
| Bulk bar (N selected · assign · clear); selection pruned every poll | `TasksKanban.tsx:295` | parity | — | |
| Detail: status accent, fact row, description, RESULT, Human Q&A with the one open entry answerable inline, superseded label, depends-on resolved to titles + status dot, status select, assign, close | `TaskDetailOverlay.tsx` | parity | — | `21-`/`45-tasks-detail.png` |
| Read-only board (no card creation) | `TasksKanban.tsx` | parity | — | |
| **"new work? dispatch it to {boss}" line** | `TasksKanban.tsx:216` | missing | S3 | SPEC §6 asks for it explicitly. The only equivalent is "{boss} writes this board" inside the detail sheet, which you only see after opening a card. |
| Detail reachable app-wide (`openTaskDetail`) with its own poll | `store` | parity | — | Works from Ask Me and from the agent "working on" strip |

## Ask Me

| Feature | Pixel location | Modern | Sev | Note |
|---|---|---|---|---|
| One card per open ask, `waitsOnHuman` as the only filter (no status filter), archived-with-an-ask included | `AskMeTab.tsx` | parity | — | `30-`/`46-askme.png` |
| Header: title → detail, assignee badge, Telegram-mirrored badge (`tgMessageId`), ✕ dismiss with the history-kept tooltip | `AskMeTab.tsx` | parity | — | |
| Question pre-wrap; Textarea 3 rows; ⌘/Ctrl+Enter sends; disabled while empty/sending; "Sending…" | `AskMeTab.tsx` | parity | — | |
| Draft survives leaving the view (store `answerDrafts`) | `store` | parity | — | Shared with the Tasks sheet, as specified |
| `VIEW n EARLIER ANSWERS` → detail | `AskMeTab.tsx` | parity | — | |
| Cascade: "Blocking n downstream tasks", first 6 indented + status dot + assignee, "… +n more" | `AskMeTab.tsx` | parity | — | |
| Empty state incl. the MD-83 "whatever column the card is sitting in" wording | `AskMeTab.tsx` | parity | — | |
| Optimistic dismiss restores on failure | `AskMeTab.tsx` | **better** | — | Pixel restores from a stale closure (`setTasks(tasks)`); modern captures `before` first |
| Failed answer says so | — | **better** | — | "Not saved — nothing was sent to {boss}" instead of a silently kept draft |
| Open-ask count in the header | — | better | — | |

## Floor

| Feature | Pixel location | Modern | Sev | Note |
|---|---|---|---|---|
| Pixi office scene | `scene/office/OfficeFloor` | parity | — | Mounted as-is inside a bordered frame; the scene keeps its own warm palette in both themes, per DESIGN.md §3.10 (`40-`/`41-floor.png`) |
| Agent count + mic + theme in the topbar | pixel titlebar | parity | — | |

(Floor click → agent chat is MD-95 and is deliberately not reported here.)

## DESIGN-MODERN.md by eye

No inline `style=` and no `--cth-*` *consumption* in any of the four areas — the one appearance,
`agents/terminal-tokens.css`, REDEFINES four `--cth-*` names as aliases of modern tokens so xterm's
token reader (`design/cssTokens`) resolves against this palette. That is the documented bridge, not a
leak. Radii, hairlines, 12/13/14/16/20 type scale,
`h-8` controls and 24px gutters all hold; only shadcn primitives; one primary per view; `--destructive`
appears only on real failure (blocked column, the cascade label, the kill button). Both themes are token
driven — no stray `dark:` utility in the four areas — and dark renders correctly on every screen shot.
Two notes, both cosmetic: the Agents overview leaves a large empty region below Archived on a tall
window, and a disabled primary ("Respond & unblock", "Send") is a filled grey that reads as enabled
until you try it.

## Verdict

Not ready to be the default yet — three S1s, all in Agents, and all cheap to fix.

1. **A sleeping agent cannot be woken** — the modern UI has no `wakeSleepingAgent` path at all.
2. **The previous session's team cannot be restored** — `restorableAgents` is rendered nowhere.
3. **Kill is one click** — the pixel arm+countdown was dropped from a genuinely irreversible action.

Tasks, Ask Me and Floor are at parity now (Ask Me is ahead of pixel on two failure paths); the Agents
S2s — roster model/effort/plain-Restart, the private note, hire import and the missing nav badge counts —
are what a power user will miss on day one.

---

# MD-92b — re-QA of the fixed items (2026-08-25)

Read-only re-check of the nine items MD-97/MD-99 landed against MD-92's findings, on main
`efe1a4a2`. Packaged build (`rm -rf out && npm run build`), launched as
`env -u ELECTRON_RENDERER_URL npx electron . --user-data-dir=<scratch> --remote-debugging-port=9377`
on a scratch profile — `autoMode:false`, Slack/Telegram/webhooks off, `webhookTriggers: []`, so no
tunnel and no outbound bridge. `ui.mode: 'modern'`. The scratch hive was seeded with a `roster.json`
(boss, working, idle, **sleeping**, archived and **restorable** agents, one carrying a private note)
and a `tasks.json` covering all four columns, an archived card, an unassigned card, a dependency, an
answered ask and an **open ask with a `tgMessageId`**. Both themes were driven with the topbar's own
toggle. Screenshots: `$AGENT_DIR/artifacts/md-92b/`.

| # | Item (MD-92 finding) | Was | Now | Evidence |
|---|---|---|---|---|
| 1 | Wake a hibernated agent | **missing S1** | **parity** | Detail shows an "Asleep" panel — "Waking respawns it under its own id, so its memory, inbox and CLI conversation all reattach" — with a **Wake** button; the roster row offers **Wake** in place of Continue/Restart. `11-agents-asleep-wake-{light,dark}.png` |
| 2 | Restorable team listed + restore | **missing S1** | **parity** | Overview grows a **Previous session** section: `Restore all (2)`, per-agent `Restore`, per-agent `Dismiss <name>`, and per-row failure text (forced here with a bad cwd: "2 failed — Jim: cwd does not exist: …"). The list also gets a footer, `Previous session · 2 to restore`, that routes back to it while an agent is open. Auto-restore (2.5 s) additionally brings the team back unaided on every launch. `07-previous-session-light.png`, `10-agents-overview-{light,dark}.png` |
| 3 | Kill = arm + countdown | **degraded S1** | **parity** | First press only arms: the control becomes `Confirm — end Cal's process`, the roster count is unchanged (7 → 7), and it disarms itself after ~6 s. `12-kill-armed-{light,dark}.png` |
| 4 | Private note | missing S2 | **parity** | Header control reads `Add a private note about this agent` when empty and `Private note — yours, never sent to the agent` when set; the editor opens pre-filled with the seeded note ("yours — Cal never sees it" + Done). `13-private-note-{light,dark}.png` |
| 5 | Hire-manifest import | missing S2 | **parity** | Add-agent dialog opens on "Hiring from a manifest someone sent you? → **Import hire file**". `05-add-agent-import-light.png` |
| 6 | Roster provider/model/effort + plain Restart | missing S2 | **parity** | Every roster row carries `Claude Code · Opus 5 · 1M · effort` as live selects plus **Continue** and **Restart**; an effort change annotates "applies on next restart" with a **Restart now** shortcut. `10-agents-overview-{light,dark}.png` |
| 7 | Nav badge counts | missing S2 | **parity** | Rail renders `Tasks 1` / `Ask Me 1` off the seeded ledger and tracks a live `tasks.json` write (both went to 2 mid-session). |
| 8 | Sleeping agent reads `idle` in the roster | new S3 | **parity** | Roster row now reads `asleep`. |
| 9 | Open IDE · Issues Assign | missing/dead S2 | **parity / not exercisable** | `Open the IDE — files and diffs for <repo>` is on the detail header and works. **Assign** could not be driven live — the registered repo has no open issues — but the dead path is demonstrably repaired in source (`IssuesView.tsx:199` now seeds the dispatch box, clears the selection and `navigate('agents')`), and the receiving half is live: the Agents overview shows the dispatch box with nothing selected. `06-issues-light.png`, `17-issues-dark.png` |

## Still open

| Feature | Modern | Sev | Note |
|---|---|---|---|
| Tasks toolbar hint "new work? dispatch it to {boss}" | missing | **S3 → MD-100** | `tasks/SPEC.md` §6 asks for it by name. The toolbar reads `6 tasks · Unassigned · Blocked · Asks me N · Archived N · N unassigned → Michael` and stops; the only equivalent, `{boss} writes this board`, is inside `TaskDetailSheet.tsx:165` and is invisible until a card is open. `14-tasks-{light,dark}.png` |
| Agent-detail header badge for a sleeping agent | new inconsistency | S3 | The fix at `AgentsOverview.tsx:235` covered the roster table only. The **detail header** still prints `idle` for Cal while the rail row two inches to its left prints `asleep`. `11-agents-asleep-wake-dark.png` |

## DESIGN-MODERN.md by eye

Both themes were driven through the real toggle and re-shot. Dark is clean: no white terminal pane, no
pixel-token leak, hairline borders and 8px radii intact, muted text still legible, and no uppercase
labels anywhere in the four areas. `--destructive` appears only where something is genuinely wrong or
irreversible — the blocked column rule, the `Asks you` badge, the armed kill, the restore-failure line.

## Verdict

1. All three MD-92 S1s are closed, and all six S2s with them — verified in a running packaged build, not by reading the diff.
2. Nothing regressed in Tasks, Ask Me or the Floor while those fixes landed.
3. Two S3s remain: the missing Tasks dispatch hint (routed to MD-100) and an `idle`/`asleep` disagreement between the agent-detail header and the rail.
4. Issues **Assign** is the one item this pass could not prove live; the repo it was pointed at has no open issues.
5. **Ready to be the default? Yes** for Agents · Tasks · Ask Me · Floor. No blockers remain in these four areas — the two S3s are cosmetic and neither costs the human a capability.
