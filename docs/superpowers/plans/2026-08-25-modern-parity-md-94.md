# MD-94 — Modern UI parity QA: Issues & PRs · Integrations · IDE · Triggers · Voice

Read-only QA against main `c07419e9` (912 tests). Packaged build (`rm -rf out && npm run build`), launched with a
scratch profile (Slack/Telegram off, both webhook endpoints **disabled**, no public tunnel), `Settings → Interface →
Modern`, both themes driven through the real topbar toggle. Static audit = every pixel component read line by line
against its modern counterpart and the area `SPEC.md`; **live** = clicked in the running app over CDP. Screenshots
of every S1/S2 in `hive/agents/worker-md91-toby/artifacts/md-94/`. Known + excluded: Floor click → agent chat (MD-95).

Severity: **S1** blocks being the default UI (data loss, feature gone, action does nothing, misleading status) ·
**S2** present but wrong or noticeably worse · **S3** cosmetic / nit. Line refs: `P:` = pixel file, `M:` = modern file
named in the area header.

## Feature table

| feature | pixel location | modern status | severity | note |
|---|---|---|---|---|
| **ISSUES & PRs** — P: `components/CommandCenterPanel.tsx` · M: `modern/issues/IssuesView.tsx` (`D:` = `issuesData.ts`) | | | | |
| One nav entry, `Issues \| PRs` segments | CC tabs P:155,457 | parity | | god's ruling; `nav.ts:75`, Tabs M:243 |
| Shared repo picker over `registeredRepos`, remembered + re-validated | P:1284,1308,1537 | parity | | reuses `issuesTab.ts`; Select M:254 |
| `issueHost` passed to fetch | P:1309 | parity | | M:118,145 |
| Empty registry state | P:1533 | better | | M:296 adds "add one in Settings" |
| Fetch button, 400 ms search-as-you-type, `mine` pushed to gh/glab, sequence guard | P:1384-1427,1544 | parity | | M:134-173 |
| Segment switch must NOT re-fetch issues | SPEC §last | degraded | S2 | M:173 has `segment` in the effect deps → every PRs→Issues round-trip re-runs `githubIssues` (live: rows keep, but the shell-out repeats) |
| "Assigned to me" toggle | P:1558 | parity | | M:286 |
| Page cap 10 + visible cap note | P:69,1404,1581 | parity | | D:21,100; M:341 |
| Issue empty / error / loading states | P:1567-1576 | better | | dismissible Alert M:301, Skeleton M:302 |
| Issue row `#n title` | P:1591 | better | | M:311 links to `issue.url` |
| Issue labels | P:1598 | parity | | Badge M:323 |
| Linked PR chips beside an issue | P:1609, `PrChip` 1485 | degraded | S2 | M:472-500: the `running` review state (pixel lemon frame + "reviewing…") has no visual; "not ready" / "reviewed" words dropped |
| Review / Preview beside an issue's PR chip | `PrActions` P:1453, used P:1613 | missing | S2 | M:328-337 renders the chip only — must switch to PRs to review a PR linked to the issue you are reading |
| Chip drops `→owner` when PR not open | P:1522 | degraded | S3 | M:490 always prints `→name` |
| Chip tooltip (CI / host review / state / verdict reason) | P:1505 | degraded | S3 | M:493 raw verdict, no reason |
| **Assign → seeds the dispatch box + switches tab** | P:1431-1438 | **missing (no-op)** | **S1** | M:182-188 writes store `requestDispatchSeed` / `requestCommandCenterTab('floor')`; nothing in `modern/` consumes `dispatchSeedRequest` / `ccTabRequest` (grep — only pixel `CommandCenterPanel.tsx:227-245` does); modern Dispatch box (`agents/AgentsOverview.tsx:50`) is plain `useState`. Click leaves you on Issues with nothing seeded. Could not click live (registered repo has no open issues) — proven by grep |
| PRs seeded by `githubPRs`, follow `onGithubPRs`, open-only | P:1319,1631 | better | | M:125; D:75 newest-first + count badge |
| "No open pull requests." | P:1627 | parity | | live ✓ |
| Watcher / merge / review errors as three surfaces | P:1567/1624/1628/1663 | parity | | M:301,349-351; review error only inside PRs segment (S3, moot today) |
| CI dot separate from verdict rail; rail on row only | P:1441,1519,1636 | parity | | `CiDot` M:52, `railClass` M:75 |
| `→owner` with arrow + routing tooltip | P:1508 | better | | M:369, D:69 |
| Host review / draft / ready / state suffix | P:141,1486 | parity | | D:51 |
| Review button busy state | P:1457 | parity | | M:375 |
| Review button tooltip (last run · engine · "nothing is posted to the host") | P:1464 | missing | S3 | the "local only" reassurance appears nowhere in modern |
| Preview → "Report" | P:1469 | parity | | M:378 |
| Merge primary when ready, disabled draft/busy | P:1645 | parity | | M:383-401; tooltip detail shortened (S3) |
| Review overlay: Dialog, verdict + reason above report, re-run inside, footer | P:1193-1255 | parity | | M:439-461 |
| Overlay: verdict colour bar, duration, "nothing was posted", Markdown body | P:1209,1242,1247 | degraded | S3 | M:449 drops duration + line; M:454 `<pre>` verbatim (deliberate) |
| **INTEGRATIONS** — P: `components/SettingsModal.tsx` (SM), `IntegrationsRegistry.tsx` (IR) · M: `modern/integrations/IntegrationsView.tsx` (`D:` = `integrationsData.ts`) | | | | |
| Slack connected badge + transport | SM:2096-2160 | parity | | M:178, D:81-88 |
| Slack Request URL + copy (events only) | SM:2274-2290 | degraded | S3 | M:121 only while running; pixel keeps the last URL after Stop |
| Slack Start gating | SM:796 | degraded | S2 | D:93 blocks on "no bot token" — neither pixel nor main (`main/index.ts:1949-1990`) requires a bot token to start; modern says "cannot start" where the bridge starts |
| Slack Stop | SM:2260 | parity | | M:119 |
| Slack allowlist fail-closed blocker | SM:797 (silent) | better | | D:98 names it |
| Slack summary (signing secret / bot token / app token / port) | SM:2160-2240 | degraded | S3 | D:82-87 shows senders · channel · proactive only; SPEC lists the rest |
| Slack `enabled=false` → Start disabled without a hint | SM:2117 | degraded | S3 | M:186; live: Start greyed, no reason |
| Slack / Telegram edit fields → deep-link | SM:2136-2395 | by design → deep-link, **wrong landing** | S2 | `SettingsLink` M:298-314 calls `navigate('settings')` (`navigation.ts:20` takes only a nav id); `SettingsView.tsx:27` always opens **General**. Live ✓: every "Settings ↗" lands on General, never on Connections, never on the field. Tooltip M:311 names a "Settings → Integrations" section that does not exist |
| Telegram badge + `@username`, Start/Stop, fail-closed chat-id blocker, token/chat-id set? | SM:2350-2406 | parity / better | | D:111-119 names the blocker |
| Webhook server state, tunnel root, `''` → "waiting for tunnel" | SM:2463,2556 | parity | | D:136-138, M:320 |
| Endpoint list with **name** and **enabled** state | SM:2510-2545 | degraded | S2 | M:129-134 lists `webhooksStatus().endpoints` (`{id,url}`, ALL triggers incl. disabled) — live shows `w1 — waiting for tunnel`, the id not the name, and a disabled endpoint's URL is offered to copy like a live one. `listWebhooks()` (has name/enabled) is fetched M:61 but only counted |
| Copy endpoint URL | SM:2561 | parity (mechanism) | | M:328 `navigator.clipboard` vs IPC — not clickable live (no tunnel) |
| **Webhook add / secret / mode / schema / delete** | SM:2470-2700 | by design → deep-link, **no target** | **S1** | The modern editor lives under nav **Triggers** (`modern/triggers/WebhooksSection.tsx`); modern Settings has none (`settings/index.ts:70` "owned by the Triggers area"). M:192 still sends the row to `navigate('settings')` → Settings › General with no webhooks anywhere. Live ✓ (`integrations-deeplink-landing-light.png`) |
| Webhooks Start/Stop | none in pixel | parity | | no button renders (SPEC wireframe was wrong) |
| Doctor run / re-run, last run, per-check rows, `mismatch` only emphasised, unverifiable note | SM:1907-1962 | parity / better | | live ✓ 2 mismatches first + "2 to fix" badge, both themes |
| Providers per-engine installed/version | not in pixel Connections | missing vs SPEC only | S3 | not a pixel regression |
| Custom REST configured / usable counts, per-row | IR:364-421 | parity | | D:150-161; row kind + baseUrl dropped (S3) |
| **Custom REST add / edit / test / delete** | IR:217-415 | by design → deep-link, **no target** | **S1** | nothing in `modern/` renders the registry (`registryClient` imported only by `modern/integrations/`; `modern/settings/SPEC.md:44` slots it and no slot exists). Live ✓: Settings shows no "integration", "REST" or "webhook" text. A modern-default user cannot add or edit a REST integration |
| Status refresh on mount + focus | SM:764 | parity | | M:76-82 |
| **IDE** — P: `ide/IdePanel.tsx`, `ide/GitPanes.tsx`, `ide/ImagePreview.tsx`, `components/FileTree.tsx` · M: `modern/ide/IdeView.tsx`, `GitRail.tsx`, `FileTree.tsx`, `ImageView.tsx` | | | | |
| Target agent (named → selection → god → first), "assumed" badge, workspace root | P:97-104,552-588 | parity / better | | M:54-62,171-191; live ✓ |
| **"Open IDE" from agent detail** | `AgentDetailPanel.tsx:147` | **missing (no-op)** | **S1** | `modern/agents/AgentDetail.tsx:66` calls `setIdeOpen(true, id)`; nothing in modern reads `ideOpen`, never `navigate('ide')`. Side effect: `ideAgentId` is never cleared, so after one click the IDE is pinned to that agent (M:57) |
| Lazy tree, hidden dirs, dirs-first, open-file highlight | FileTree:35-52 | better | | M FileTree:23-50; no per-dir "loading…" (S3) |
| Tree: copy path per row | FileTree:145-155 | missing | S2 | no copy-path anywhere in modern IDE |
| Open file → tab; edit in Monaco; dirty dot | P:245,719 | parity | | live ✓ dot + "unsaved — ⌘S" footer |
| Close-tab guard | P:299-306 | parity | S3 | live ✓ `window.confirm("Discard unsaved changes to this file?")` — should be `AlertDialog` per design rules |
| Cmd/Ctrl+S window-level | P:352-361 | degraded | S2 | live ✓ ⌘S with focus in the nav/tree does nothing; only inside Monaco saves. No Save button either (S3) |
| Save: keystrokes typed during the in-flight write | P:322-328 snapshot | degraded | S1 | M:135 `original: e[key].content` marks text typed mid-write as saved but never writes it; no double-save guard. Narrow race, silent loss |
| **Save failure** | P:331-333 (buffer stays editable, "err" in bar) | **degraded** | **S1** | live ✓ (`ide-save-error-light.png`): `chmod 444` + ⌘S → editor **replaced** by red EACCES text, dirty dot gone, footer says **"saved"**, ✕ closes without a prompt — unsaved edits unreachable and discarded |
| **Dirty buffers on leaving the IDE** | P:359 Escape refuses while dirty | **degraded** | **S1** | live ✓: edit → click Agents → back: all tabs and edits gone, no prompt (`AppShell.tsx:186` keyed `ViewBoundary` unmounts the view). M:84 also wipes buffers on `root` change |
| Git rail staged / unstaged / untracked + branch | P:365-373 | parity / better | | live ✓ (`ide-changes-light.png`); status colours → neutral badges (S3, per design) |
| Git status auto-refresh (4 s) | P:346-350 | degraded | S2 | live ✓: an external edit does not appear until the refresh icon is clicked (M GitRail:100 mount-only) |
| Stage + commit | — (no IPC exists; SPEC overstated) | parity (both absent) | | |
| "not a git repo" state | P:338-341 | degraded | S3 | raw `fatal: not a git repository` in destructive red (`ide-dark.png` first run) |
| Diff vs HEAD | P:221-241 | parity | | live ✓ MonacoDiff; no header / refresh-diff (S3) |
| Diff tab teardown | — | degraded | S3 | live: **7× uncaught** `TextModel got disposed before DiffEditorWidget model got reset` when switching away from a diff tab (`MonacoDiff` chunk) — pixel does not throw |
| History: commit graph with lanes / refs / time, pagination | GitPanes:68-100 | degraded | S2 | flat list of 60 (`GitRail:157,178`), no graph, no refs, no "load older" |
| **History: click a commit's file → rev diff** | GitPanes:129 → P:251 (`gitShowFile`) | **missing** | **S1** | live ✓ (`ide-history-commit-light.png`): commit expands to `M src/math.ts` as a plain `<div>`; nothing opens; `gitShowFile` unused in modern |
| **History: "jump here" checkout** | GitPanes:86-116 | **missing** | **S1** | no `gitCheckout` in `modern/ide` |
| Compare: base/head + ahead/behind + file list | GitPanes:161-243 | degraded | S2 | live ✓ `0 ahead · 1 behind · 0 files`; needs a Compare click (pixel auto-runs), no swap ⇄ (S3), no two-dot/three-dot toggle (M omits `mode`) |
| **Compare: click file → rev diff; "switch to branch"** | GitPanes:175-242 | **missing** | **S1** | rows are `<div>`s (`GitRail:254`); branch checkout gone |
| Main-repo root for History/Compare | P:180-185 | parity | | GitRail:39-44 |
| Search: regex + case toggles, click hit → open at line | P:508-544 | parity | | live ✓ `src/math.ts:1` hit |
| Search: match `<mark>`, per-file grouping, hit/file count | P:151-161,1035 | degraded | S2 | flat `file:line` rows, no counts; limit 300 vs 500 |
| Search: results survive rail-tab switch | P:128-132 | degraded | S2 | live ✓: query + results cleared after Changes → Search (state inside `TabsContent`) |
| Search debounce-as-you-type | P:133-149 | degraded | S3 | Enter/button only (deliberate) |
| **Markdown code / split / preview** | P:13-23,782-800,887-903 | **missing** | **S1** | live ✓ (`ide-markdown-light.png`): `.md` opens as plain Monaco, no mode buttons, nothing rendered; no `MarkdownPreview` import in `modern/ide` — SPEC row 9 requires it |
| SVG opens as picture with "view source" round-trip | P:248,762 · ImagePreview:76 | degraded | S2 | live ✓ (`ide-svg-light.png`): `M:88 isImagePath && !isSvgPath` → SVG always lands in Monaco as text |
| Image fit / 1:1, loading Skeleton | ImagePreview:61-74 | parity / better | | ImageView:31; no dimensions / decode-failure (S3) |
| Image checkerboard for transparency | ImagePreview:88-100 | degraded | S2 | flat ground (ImageView:35) |
| Status bar path · saved | P:908-930 | parity | | neither shows language (SPEC overstated); modern can never show "err" (see save failure) |
| Tab strip DIFF/IMG/REV badges, empty-state shortcut hints, rail collapse | P:723-753,946-1000,435-448 | degraded | S3 | "(diff)" suffix only; one-sentence empty state; rail not collapsible |
| Dark-mode Monaco | `--cth-*` bridge | parity | | live ✓ (`ide-editor-dark.png`, `ide-diff-dark.png`) |
| **TRIGGERS** — P: `components/triggers/*` · M: `modern/triggers/*` | | | | |
| Four collapsibles, Schedules open by default, live summary badges, children stay mounted | TriggersTab:28-51, ui:159-190 | parity | | live ✓ `3 of 5 on · compact · 2 · offline · 1 waiting`, both themes |
| Row header: title/sub area toggles disclosure | ui:207-228 | degraded | S3 | only the chevron opens a row (controls:88-96) |
| Schedules: load/refresh/optimistic save/delete, interval chip + `♥ beat`, target · fired · next, enable Switch, mono first line | SchedulesSection:56-240 | parity | | live ✓ |
| Schedule editor (label, target Select, interval picker, prompt, save-dirty-saved, delete) + add form | SchedulesSection:110-272 | parity | | live ✓ `NEW SCHEDULE` form opens/cancels |
| Context: compact + clear, 1 m…24 h clamp, % + meter, big-window, message, armed caution | ContextSection:15-151 | parity / better | | Skeleton while loading; live ✓ |
| Webhooks: mirror + seed, 5 s status poll, `N · live/offline`, adopt canonical list | WebhooksSection:33-74 | parity | | live ✓ `deploy hook — strict · server offline` |
| Webhook editor: name, URL copy, masked secret, trust Select + blurb, lazy CodeMirror schema (refuses invalid JSON), delete `AlertDialog`, add mints secret disabled | WebhooksSection:76-274 | parity / better | | delete gets a real dialog |
| History: exchanges by `correlationId`, pending first, badges, clamp + show all, approve/reject, tail line, held-count, empty state | TriggerHistoryTab:79-510 | parity | | live ✓ "Waiting for you" card, `Show all 393 characters`, Approve / Reject |
| Clear history: arm → confirm → 6 s undo | TriggerHistoryTab:526, `ui/destructive.ts` | degraded | S3 | `AlertDialog` runs immediately, no undo window (live ✓ "Delete all 4 webhook messages?") |
| Calendar deep-link into Triggers from the Floor | `OfficeFloor.tsx:336` | missing | S3 | no equivalent in `modern/views/FloorView.tsx` (Floor area, not MD-91) |
| **VOICE** — P: `components/RealtimeMichaelToggle.tsx`, `realtime/*` · M: `modern/realtime/VoiceStatus.tsx`, `CostCard.tsx`, `DevicePicker.tsx` | | | | |
| Mic toggle across off / connecting / listening / responding / working | Toggle:41-117 | parity | | topbar control (god's call) |
| Click while `connecting` cancels | Toggle:14,115 | degraded | S2 | `VoiceStatus:85` disables the button while busy — no way out until the session errors |
| Disabled without a key, **reason visible** | Toggle:107,181-193 (`title` on a non-disabled wrapper) | degraded | S2 | live ✓ (`voice-disabled-hover-light.png`): hover and focus on the disabled mic show **no** tooltip (`button.tsx:8` `disabled:pointer-events-none` under a Radix trigger) — the reason is unreachable |
| **OpenAI key field the reason points at** | SM:2770-2798 | **missing** | **S1** | live ✓ (`settings-voice-light.png`): modern Settings › Voice has Groq + idle-disconnect only; grep `openai` in `modern/` is empty. A modern-only install can never turn voice on. Owner: MD-87 Settings |
| Key presence re-checked after save | `App.tsx:133` live store | degraded | S3 | one-shot on mount (`VoiceStatus:126`); moot until a key field exists |
| Device picker + spend cap reachable **before** connecting | SM:2801 (Settings › Voice) | degraded | S2 | popover renders only while live (`VoiceStatus:65-78`) although mic choice "applies the next time {boss} connects" |
| Device picker mic + speaker, `setSinkId` absent → hidden, hint, `devicechange` | DevicePicker:31-130 | parity | | |
| Cost: `$ / cap`, in·out tokens, cap input, ≥80 % warn, ≥100 % destructive, "Last session" | CostHud:60-148 | parity | | warn is muted text (per design) |
| Compact readout beside the toggle | CostHud:79-102 (tokens) | better | | running `$` in the pill; tokens in the popover |
| Model + token expiry | not in pixel | better | | `VoiceStatus:108` |
| Completion toasts app-wide, de-duped, dismissible | CompletionToast:41-162 | parity | | sonner from the never-unmounted topbar |

## DESIGN-MODERN.md by eye (both themes)

- **Palette / hard-coded colour**: green + amber are raw Tailwind (`IssuesView:60,62,78,483`, `IntegrationsView:273`, `VoiceStatus:39-40`) with `dark:` pairs — the doc says a `dark:` utility means the value belongs in `tokens.css`; no green/amber token exists. Everything else is token-only; both themes paint consistently (no light value on a dark ground found in any screenshot).
- **One primary Button per view** broken everywhere: Fetch + active "Assigned to me" + every ready Merge (Issues); every stopped Start (Integrations); Compare + Search + active toggles (IDE); Add + per-row Save + Approve (Triggers); the live mic.
- **Tooltip on icon-only buttons** missing: Issues dismiss ×, Integrations copy/dismiss, IDE refresh + tab ✕, Triggers chevron / show-secret / copy (aria-label only).
- **Spinner over content** (`animate-spin` > 150 ms): Issues Fetch, IDE refresh/search, Voice connecting.
- **Inline `style=`**: `modern/ide/FileTree.tsx:108,121` (indent).
- **Nested hairline boxes** three deep in Triggers (`controls.tsx:44→75→227`, History exchange → body box); **uppercase** `NEW SCHEDULE`, `TASK <id>`; `text-[10px]/[11px]` below the 12-px floor in IDE; `window.confirm` instead of `AlertDialog` for the IDE close guard; hand-rolled tab strip + two-state toggle in IDE.
- Clean: no `--cth-*` in any modern `.tsx`, no nested `Card` primitive, primitives all from `modern/components/ui`, radii/borders/type otherwise per spec, dark mode via the one toggle works on every screen shot.

## Verdict

**Ready to be the default? No.** Nine S1s across four of the five areas, all of them "the button exists and does
nothing" or "the feature is gone": Issues **Assign** is a no-op; Integrations' **Webhooks** and **Custom REST**
"Settings ↗" land on General where no editor exists (REST is unreachable in the modern shell); IDE loses unsaved
edits on **nav-away** and on **save failure** (footer even says "saved"), has no **Markdown preview**, and History /
Compare files and **branch checkout** are dead; **Open IDE** from an agent is a no-op; Voice can never be enabled
because modern Settings has **no OpenAI key field**. Triggers is at parity (S3s only) and Integrations' status half
(Slack/Telegram/Doctor) is fine. Unblock order: Settings key field + REST slot + section deep-link target (MD-87),
IDE buffer safety + rev-diff/checkout (MD-89), Assign consumer + Open-IDE navigate (MD-88/MD-86), then the S2 list.
