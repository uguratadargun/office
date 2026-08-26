# MD-147 — Modern UI parity gap INVENTORY

**Base:** main `5b7c0f21` (MD-145, Messages tab removed). Branch `docs/parity-inventory-md-147`.
**Kind:** QA/doc only. Nothing was built and no code was touched — read-only audit of both trees.

**Why this card exists:** MD-92/93/94 audited *by area*. MD-138 then found a whole tab (Memory)
that no area owned, so nobody looked at it. This pass is the opposite shape: enumerate every
pixel surface and every `window.cth.*` consumer FIRST, then ask what modern does with each.

**Severity, for a user whose `ui.mode` is `modern` and who never opens pixel:**
S1 = a capability the human loses outright, or an autonomous-hive path that is silently dead.
S2 = notable degradation a power user will hit. S3 = polish / cosmetic.
Counted per *finding*, not per call site: the three dead hire listeners are one S1, not three.

---

## Verdict

**4 S1 · 6 S2 · 5 S3** (distinct findings — the hire path is three dead listeners but one gap).
Modern is not yet safe as the only UI: four whole pixel tabs
(Skills, Knowledge, Workers, Command History) have no modern home at all, and the **push half of
the hire flow is dead** — an agent that hires another agent produces nothing on screen in modern.

Top 5 gaps, in order:

1. **Hire push path is dead** (S1) — `onHireImport` / `drainPendingHires` / `onHireError`.
2. **Knowledge tab missing** (S1) — documents can be added in modern but never listed, searched or deleted.
3. **Workers tab missing** (S1) — live ephemeral Slack workers are invisible and cannot be stopped.
4. **Terminal queue has no attachments** (S1) — no file picker, no drag-drop, no paste-a-screenshot.
5. **Command History missing** (S2) — the prompt log is written by modern and readable only from pixel.

---

## Method, and what it is worth

Three passes, each catching what the others miss:

1. **IPC inventory.** Every `cth.<name>` token in each tree, `comm`-diffed. The raw diff is
   misleading and god's seed list inherits that: it lists 42 pixel-only consumers, but modern
   reaches many of them *through modules that live in pixel directories* —
   `@/components/triggers/api` (webhooks + trigger history + context triggers),
   `@/components/terminalPool` (clipboard paste), `@/components/PtyTerminalView` (terminal zoom),
   `@/hooks/*`, `@/store/*`. Diffing modern **plus its 1-hop pixel imports** against pixel gives
   **30** genuinely pixel-only consumers, not 42.
2. **Surface inventory.** Pixel tab lists (`CommandCenterPanel.tsx:152`, `SidebarTabs.tsx:8`),
   `SettingsModal` sections, every modal and overlay, versus `modern/nav.ts`.
3. **Probe.** For every pixel component name, grep modern for a counterpart — then **open it**.
   This is the step that matters: five names hit only a `SPEC.md`, i.e. the feature is *documented*
   in modern and *not built*.

**Two traps worth recording, because they cost the most time:**

- **A `SPEC.md` hit is not an implementation.** `attachFiles`, `pathForFile`, `saveClipboardImage`,
  `resolveSessionCwd`, `hiveRegistry` appear in `modern/agents/SPEC.md:88-90` as the IPC that area
  intends to consume. No code consumes them. Same for `OfficeThemePicker`, `UsageReadout`,
  `ToolWaterfall`, `UpdatesSection`, `SetupPanel`, `IntegrationsRegistry`, `RealtimeMichaelToggle`
  in the settings/monitor/triggers SPECs — but those five *are* built under different names, so the
  SPEC hit is a false positive in both directions. Only reading the file settles it.
- **Same word, different feature.** Pixel `HistoryTab` is the **prompt/command** log (SQLite,
  `historyList/Search/Delete/Clear/Export`). Modern `triggers/HistorySection` is the **trigger-run**
  ledger. Matching on the word "history" scores a gap as parity.

**No context menus exist in either UI** (`onContextMenu`: zero hits repo-wide), so that axis of the
card's objective is empty rather than unchecked.

---

## 1. Pixel tabs → modern

`CommandCenterPanel.tsx:152` declares 15 tabs; `modern/nav.ts` declares 11 areas.

| Pixel tab | Modern | Status | Sev |
|---|---|---|---|
| terminal | `agents/AgentDetail` + `TerminalQueue` | reduced — attachments, see §3 | S1 |
| floor (monitor) | `monitor/MonitorView` | parity | — |
| tasks | `tasks/TasksView` | parity (+ bulk delete, modern-only) | — |
| issues / PRs | `issues/IssuesView` | parity | — |
| ask me | `askme/AskMeView` | parity | — |
| triggers | `triggers/TriggersView` | parity | — |
| trigger-history | `triggers/HistorySection` | parity | — |
| memory | `memory/MemoryView` | parity (MD-138/140) | — |
| graph | `memory/MemoryGraph` | parity; drag dropped (MD-138 decision) | — |
| activity | `monitor/EventLogPanel` | parity — same `@shared/eventLog` | — |
| **prompts (history)** | **none** | **missing** | **S2** |
| **skills** | **none** | **missing** | **S2** |
| **knowledge** | **none** | **missing** | **S1** |
| **workers** | **none** | **missing** | **S1** |

Detail on the four missing ones:

- **Knowledge** — `components/KnowledgeTab.tsx` (303 lines, `cth.kgList` @ :40, plus `kgSearch`,
  `kgGet`, `kgRemove`). Modern `settings/MemorySection.tsx:86` calls `kgAddFiles()` + `kgStatus()`
  and nothing else, so in modern you can **add a document and then never see, search or remove it,
  including one added by mistake**. That is the exact defect KnowledgeTab's own header says it was
  written to fix — reintroduced by the port. **S1: data goes in and cannot come out.**
- **Workers** — `components/WorkersTab.tsx` (175 lines, `cth.listWorkers` @ :16, `stopWorker`).
  Live god-triggered ephemeral Slack workers and their preserved worktrees. In modern a human
  cannot see what is running or stop it by hand. **S1: no manual brake on autonomous spawning.**
- **Skills** — `components/SkillsTab.tsx` (354 lines, `cth.skillsCatalog` @ :59, `skillsLocal`,
  `skillsInstall`, `skillsUninstall`, `skillsReveal`). Answers "why did my agent just do that?".
  S2, not S1: nothing is lost or unrecoverable, but agent behaviour becomes unexplainable.
- **Command History** — `components/HistoryTab.tsx` (189 lines, `cth.historyList` @ :18).
  Modern *writes* this log (`historyAdd` fires from `modern/agents/`) and cannot read it back.
  **S2, asymmetric: modern feeds a forever-log it offers no way to search, export or clear.**

---

## 2. Autonomous-hive paths that are dead in modern

The card's real find. These are not tabs — they are listeners, and a missing listener is invisible.

| Path | Pixel | Modern | Sev |
|---|---|---|---|
| **Hire pushed in** (agent hires agent) | `App.tsx:158` `onHireImport` → opens the modal prefilled | **nothing** | **S1** |
| **Hires queued at boot** | `App.tsx:164` `drainPendingHires()` | **nothing** | **S1** |
| **Hire failed** | `App.tsx:172` `onHireError` | **nothing** | **S1** |
| Hire imported by hand | `AddAgentModal.tsx:361` | `AddAgentDialog.tsx:111` — parity | — |

Modern has the *manual* half (a file picker) and none of the *push* half. The documented hand-off
"here is a role, hire it" therefore completes in main, changes nothing on screen, and a failure is
swallowed. **This is the single most dangerous gap in the audit**: it is silent, and the feature it
kills is the one the hive exists for.

**Also dead:** the threaded hive inbox. `components/ThreadsPanel.tsx` (170 lines) is mounted at
`AgentDetailPanel.tsx:264`. Its modern counterpart `agents/MessagesTab.tsx` still exists but is
**mounted nowhere** since MD-145 removed the Messages tab — its own header (`:32`) says it is
"kept, not deleted, because it is the ONLY reader of `window.cth.hiveMailbox`". Reading an agent's
inbox and replying inline is thus unreachable in modern. MD-145 deliberately removed the *tab*; it
is not clear it meant to remove the *reader*, so this is **S2, flagged for god's ruling** — dropped
on purpose or collateral.

---

## 3. Reduced (present but does less)

| Surface | Pixel | Modern | Missing | Sev |
|---|---|---|---|---|
| Message composer | `MessageQueueComposer.tsx` (684 ln) | `TerminalQueue.tsx` (278 ln) | **file attach (`cth.attachFiles` @ :90), drag-drop (:95), paste-a-screenshot (`saveClipboardImage` @ :113), `pathForFile`** | **S1** |
| Auto-delivery | `CommandCenterPanel.tsx:267` fleet-wide pause toggle (`controlAutoDelivery`) | reads `paused`, cannot set it | the toggle itself | **S2** |
| Add agent | `AddAgentModal.tsx` (1194 ln) | `AddAgentDialog.tsx` (373 ln) | per-agent **token cap** (`tokenCap`, :241), 5 **role templates** (:53), **resume cwd auto-fill** (`resolveSessionCwd` @ :301), **register-a-project** picker (:720) | S2 |
| Per-agent git | `GitTab.tsx` (260 ln) at `AgentDetailPanel.tsx:260` — status/branches/log/ahead-behind **per agent** | `ide/GitRail` — same data, but scoped to the **IDE's** repo | per-agent git in the agent view | S3 |

The composer gap is **S1, not S2**: pasting a screenshot is how a human hands a screenshot to a
coding agent. Without it, the modern user must switch to pixel to do the single most common
multimodal action in the app.

---

## 4. Confirmed parity (checked, not assumed)

Recorded so the next audit does not re-walk them. **IDE is the strongest area**: pixel and modern
consume an identical 15-call git/file set (`gitStatus`, `gitDiff`, `gitCommitFiles`, `gitBranches`,
`gitCheckout`, `gitLogGraph`, `gitCompareRefs`, `gitShowFile`, `gitMainRepo`, `gitIsRepo`,
`ideSearch`, `listDir`, `readFile`, `writeFile`, `gitBranch`) — the only difference is a
`localStorage` key namespace (`cth.ide.*`), not a feature.

Settings: all 7 sections present (`SettingsModal.tsx:250` vs `modern/settings/`), and row-level
coverage is enforced by the `settings/index.ts` anti-rot test rather than by inspection.
Updates (all 5 update calls, `GeneralSection.tsx:456-476` + `monitor/notifications.tsx`),
office theme (`GeneralSection.tsx:64`), integrations (11 calls incl. doctor/slack/telegram),
triggers + webhooks + trigger history + context triggers (via `@/components/triggers/api`),
agent controls (`controlPause/Resume/Halt/Steer/Snapshot`, `killPty`, `openTerminalAt`),
terminal zoom (`PtyTerminalView` Cmd +/-/0, shared), clipboard paste (`terminalPool.ts:237`),
tool waterfall (`monitor/AgentSpans`), usage/cost (`monitor/FleetPanel`), activity log,
onboarding, hive picker, quit dialog, fullscreen overlay (`modern/overlay.tsx`).

---

## 5. The other direction — modern-only

So that pixel is not silently the poorer UI for anyone who switches back.

| Feature | Modern | In pixel? | Sev (for a pixel user) |
|---|---|---|---|
| **Bulk task delete** | `tasks/bulkDelete.ts` + `DeleteTasksDialog` + `cth.hiveDeleteTasks` | no — `TasksKanban` is deliberately read-only (`:150`) | S3 (a stated design choice, not a gap) |
| **Read-only / ownership banner** | `components/ReadOnlyBanner` (MD-139), app-wide | pixel calls `hiveOwnership` at `CommandCenterPanel.tsx:1865` but only to gate the **memory editor** (`editState(…owner…)` @ :1863) — no app-wide banner | **S2 — a pixel user in a non-owning instance learns it only if they open Memory and try to edit** |
| Fleet usage hook | `@/hooks/useFleetUsage` | pixel uses `UsageReadout` per agent | S3 (different shape, same data) |
| Selection bar / multi-select | `components/SelectionBar` | no | S3 |
| Toast notifications | `monitor/notifications.tsx` (sonner) | `UpdateToast` only | S3 |

---

## 6. Proposed cards — do NOT build from this doc alone; each needs its own brainstorm

Grouped so one agent owns one coherent surface.

**Sizes are TIERS, not effort estimates** (god's tiered definition of done, 2026-08-26): the letter
decides how much gate the card gets. S = typecheck + only the touched test file, no build, no
screenshot. M = typecheck + `test:focused` once, build only if main/preload/CSP/config moved.
L = the full gate — main-process, cross-UI, or risky (spawn, quit, IPC, roster, hive plumbing).

Re-tiered against that policy after the first draft; **three cards moved up**, and the reasons are
the point:

- **A was S, is L.** It reads like three `useEffect` listeners, but the path ends in `spawnPty` and
  it is hive plumbing. A hire that silently mis-spawns is the failure this card exists to prevent.
- **E was S, is M.** The toggle is one control, but `CommandCenterPanel.tsx:267` fans it out over
  **every** agent (`Promise.all(all.map(...))`). Cross-agent mutation is not an S-tier change.
- **H was M, is L.** It looks like four form fields, but two of them leave the form: `resumeSessionId`
  goes into the **spawn args** (`AddAgentDialog.tsx:172`), and `tokenCap` writes the
  `agentTokenCaps` config **the breaker enforces** (`AddAgentModal.tsx:481-486`) — it is not part of
  the spawn payload, it is a budget the runtime kills on. Spawn + config, so: full gate.

| # | Card | Scope | Tier | Port from | Owner |
|---|---|---|---|---|---|
| A | **Hire push path in modern** | `onHireImport` + `drainPendingHires` + `onHireError` listeners; open `AddAgentDialog` prefilled; surface the error | **L** | `App.tsx:158-176`, dialog already accepts a manifest at `AddAgentDialog.tsx:101` | agents-area owner |
| B | **Knowledge area** | new nav entry; `kgList`/`kgSearch`/`kgGet`/`kgRemove`; link from the existing Memory settings row | **M** | `KnowledgeTab.tsx` (303 ln) | memory-area owner (adjacent to MD-138) |
| C | **Workers panel** | `listWorkers` + `stopWorker` + preserved worktrees; a Monitor sub-panel, not a nav entry | **M** | `WorkersTab.tsx` (175 ln) | monitor-area owner |
| D | **Composer attachments** | `attachFiles`, drag-drop, paste-screenshot (`saveClipboardImage`), `pathForFile` | **M** | `MessageQueueComposer.tsx:88-140` | agents-area owner (MD-145's author) |
| E | **Auto-delivery toggle** | fleet-wide pause/resume; `TerminalQueue` already renders the paused state | **M** | `CommandCenterPanel.tsx:267` | with D |
| F | **Command History** | `historyList/Search/Delete/Clear/Export`; a Monitor sub-panel next to Activity | **M** | `HistoryTab.tsx` (189 ln) | monitor-area owner, after C |
| G | **Skills area** | installed + browse, `skillsCatalog/Local/Install/Uninstall/Reveal` | **L** | `SkillsTab.tsx` (354 ln) | unassigned |
| H | **Add-agent completeness** | token cap, role templates, resume cwd auto-fill, project registration | **L** | `AddAgentModal.tsx:53,241,301,720` | agents-area owner |
| I | **Threads decision + fix** | god rules first; then either mount `MessagesTab` somewhere or delete it and its `hiveMailbox` reader | **S** | `ThreadsPanel.tsx`, `AgentDetail` | needs a ruling, not an owner |
| J | **Pixel read-only banner** | the one modern→pixel regression | **S** | `modern/components/ReadOnlyBanner.tsx` | pixel owner |

**3 L · 5 M · 2 S.** Two tier caveats for whoever picks these up:

- **C is M but carries one L-shaped control.** `stopWorker` kills a live process. Port the panel at
  M; give that one button a live check anyway, or split it into its own card.
- **F is M but is mostly destructive.** `historyDelete` / `historyClear` / `historyExport` are three
  ways to lose or leak the prompt log. The reader is M; the three destructive actions want the
  `DestructiveAction` wrapper pixel already uses (`HistoryTab.tsx` imports it) rather than a bare button.

**Suggested order:** A (silent + dangerous) → B, C (lost capability) → D, E (daily friction) →
I (ruling) → F, G, H → J. Note this front-loads an L card: A is the one gap that is both invisible
and load-bearing, so it earns the full gate before anything cheaper.

**Two questions for god, neither blocking this doc:**

1. **Threads (card I).** Did MD-145 mean to drop the threaded inbox reader, or only the tab? The
   file was kept on purpose with a comment saying why, which reads like "not finished with this".
2. **Is modern meant to be a superset or a distinct product?** Skills, Knowledge and Workers are
   all "inspect the machine" surfaces. If modern is deliberately the operator UI and pixel the
   mechanic UI, B/C/G stop being gaps and become a documented split — this doc's S1 count drops
   from 4 to 2 (hire path + composer) and its S2 count from 6 to 4. That is a product call, and it
   changes half the backlog above.

---

## Appendix — the 30 genuinely pixel-only `window.cth.*` consumers

Classified, so the next reader does not repeat pass 1.

**Missing feature (18):** `kgGet` `kgList` `kgRemove` `kgSearch` (Knowledge) · `listWorkers`
`stopWorker` (Workers) · `skillsCatalog` `skillsInstall` `skillsLocal` `skillsReveal`
`skillsUninstall` (Skills) · `historyClear` `historyDelete` `historyExport` `historyList`
`historySearch` (Command History) · `drainPendingHires` `onHireImport` (hire push).

**Reduced (5):** `attachFiles` `saveClipboardImage` (composer) · `controlAutoDelivery` (toggle) ·
`resolveSessionCwd` (add-agent resume) · `onHireError`.

**Pixel-only by design, NOT gaps (7):** `gitAheadBehind` `gitLog` (per-agent GitTab; modern's
IDE uses `gitCompareRefs`/`gitLogGraph` for the same data) · `heroPayload` (`SettingsHeroCard`, a
pixel-art surface) · `ptyFontSize` (a `localStorage` key inside the *shared* `PtyTerminalView`) ·
`updateStarAsked` (`UpdateToast` star-ask, once-ever) · `fullscreen` `ide` (namespace prefixes on
`localStorage` keys, not IPC).

**Modern-only (5):** `hiveDeleteTasks` (bulk delete) · `fleetUsage` · `hiveMailbox` (in the
unmounted `MessagesTab`) · `ptyTheme` `theme` (theme plumbing).
