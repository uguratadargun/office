# Munder Difflin — Feature Candidates (2026-08-21)

> Analysis for MD-4. Read-only survey of the repo at `f517478` (main, clean, 284/284 green).
> Each item below is written to be an **independently implementable card**. "Parallel-safe?"
> names the files an item owns, so several can be fanned out at once without collision.
>
> _Status: COMPLETE — sections (a), (b), (c)._
> _Author: munder-developer. Restored 2026-08-21T15:2x after the file was deleted from disk; see MD-4 notes._

## (a) Product snapshot

1. **What it is.** An Electron desktop "control room" for coding agents you already run in terminals: every agent is a real `node-pty` process rendered as an xterm.js terminal *and* as a Sims-style avatar on a Pixi.js office floor (`SPEC.md` §1).
2. **Who it's for.** A single developer running many agent CLIs at once who wants to see, steer, and budget them from one window — explicitly local-first, no auth, no remote dashboard (`SPEC.md` §1 "What it is NOT").
3. **Ten engines.** Claude Code, Antigravity/Gemini, Codex, Grok, Kimi, Qwen, OpenCode, Crush, pi.dev, Copilot CLI, or a custom command (`README.md:123`).
4. **The hive** is the differentiator: per-agent memory files, atomic-file mailboxes, a shared blackboard, an append-only event log, and a "god" orchestrator (Michael) that routes work and escalates to the human (`HIVE.md` §1).
5. **Semantic recall.** Markdown memory is mined into a shared MemPalace, searchable from the UI, with condensation (`README.md:131`).
6. **Control & safety** is unusually mature for a prototype: human gates on spend/scope/destructive ops, a steer → constrain → stop circuit breaker, per-agent token budgets, real cost from transcripts, OTel spans (`README.md:135-138`).
7. **Command Center.** Kanban with dependencies, scheduled missions + heartbeat, fleet monitoring, memory search, activity log, issue tracker, a Skills browser (227 catalog entries), and a built-in Monaco IDE with git rails (`README.md:140-143`).
8. **Getting work in and out.** Issue → PR → review loop over `gh`/`glab`, Slack + webhook bridges that can spawn ephemeral workers, shareable `munderdifflin://hire` links, BYOK keys + local LLMs, auto-update, and a Prerequisites page (`README.md:145-151`).
9. **Shipped through v0.4.4.** The last three code commits are the issue → PR → review loop (`8306110`, `6a7b595`, `f517478`); the ~25 commits before them are almost entirely blog / Founders' Wall / site work, i.e. recent velocity went to go-to-market, not product.
10. **Stated next up** (`README.md:301-304`): more chat integrations (Telegram), more engines + integration templates, fuller avatar coverage driven by real hook events, durable layout & command history.

**Strategic constraint worth stating once:** the bundled pixel art is LimeZu **FREE VERSION — non-commercial only**, and the recolored sprites inherit it (`README.md` License note). The MIT grant covers code only. Any commercialization path requires replacing or licensing the art. This is not a feature, but it gates several.

## (b) Gaps found while reading code

### Debt markers confirmed by direct grep

| Where | What it encodes |
| --- | --- |
| `src/main/github.ts:302` | `// TODO-verify on glab ≥ 1.50` — the GitLab auto-merge flag name is a guess; `--auto-merge` vs `--when-pipeline-succeeds` |
| `src/main/github.ts:76` | `ponytail:` — GitLab detection is a substring match on `"gitlab"` in the remote URL, so a self-hosted instance on a custom domain is misdetected as GitHub |
| `src/main/github.ts:389` | `ponytail:` — N+1 CLI calls per poll (1 list + 1–3 per open PR) |
| `src/main/prWatcher.ts:200` | `ponytail:` — 60s polling per repo; a webhook would be instant but needs a public URL |
| `src/main/slack.ts:188`, `src/main/webhook.ts:253` | `TODO:` — no persistent tunnel domain; the public URL changes every restart |
| `src/shared/agentProvider.ts:227,301,307,311,313` | 5 × `TODO-verify` on provider model ids and flags (Codex, Gemini `--yolo`, qwen `OPENAI_BASE_URL`, Qwen coder ids) |
| `src/shared/mcpCatalog.ts:66,75,103,126,139,148` | 6 × `TODO-verify` on MCP server transports/packages (uvx vs npm, Postgres assumed, Gmail assumed, Brave assumed) |
| `src/renderer/src/store/config.ts:215,226,246,263,276` | 5 × `TODO-verify` on live model slugs across providers — flagged `humanQA` because "they drift" |

**Pattern:** 16 of the ~19 unverified assumptions in the codebase are *third-party facts that rot* — model ids, CLI flags, package names. Nothing in the app re-checks them, and nothing tells the user when one is stale. That is itself the strongest feature signal in the repo.

### Gaps confirmed by my own reading (file:line evidence)

- **`MemoryReflector` is built but invisible.** `src/main/reflect.ts` is a complete, carefully-safed condenser (backup → verify → atomic swap, `reflect.ts:15-19`), yet it has **no renderer surface at all** — no setting, no threshold control, no "this memory was condensed" signal. Meanwhile `HIVE.md:190-192` still lists reflection as *"Still open"*. Docs and code disagree, and the user cannot see or tune a service that silently rewrites their agents' memory.
- **Memory condensation silently spends Claude quota, on every provider.** `reflect.ts:279` calls `runHiddenClaude`, which spawns a hidden interactive `claude` PTY (`hiddenClaude.ts:11-20`) *specifically so the calls draw from the user's normal interactive plan quota*. So (a) a floor of Codex/Gemini/Qwen agents still needs the Claude CLI installed to bound its memory, and (b) that spend never appears in the budgets/telemetry the app otherwise tracks meticulously.
- **Linux is a fallback, not a platform.** 28 `process.platform` branches: **19 `win32`, 2 `darwin`, 0 `linux`**. Linux builds ship (`README.md` releases line) but no code path is written for them — Linux is whatever "not Windows" happens to do.
- **`localtunnel` is a dead production dependency.** Zero references anywhere in `src/` or `tools/`; only `tunnelmole` is used (`slack.ts:24`, `webhook.ts:45`). It ships in every build.
- **Tunnels leak by design.** `slack.ts:167` — *"tunnelmole has no documented close handle; teardown is best-effort"*. Combined with `slack.ts:188` / `webhook.ts:253` (`TODO:` no persistent domain), every restart hands the user a new public URL they must re-paste into Slack/GitHub.
- **Two code editors are bundled.** Monaco (`src/renderer/src/ide/`) for the IDE panel and CodeMirror + 7 `@codemirror/lang-*` packages (`components/CodeEditor.tsx`, `components/triggers/JsonEditor.tsx`) for two small surfaces. Both are in `dependencies`.
- **Recent velocity went to go-to-market, not product.** Of the last 30 commits, ~25 are blog / Founders' Wall / site; only `8306110`, `6a7b595`, `f517478` are product code. Whatever ships next is the first real feature work in a while.
- **Command history is write-only.** The full stack exists: SQLite table + index (`db.ts:58,65`), `addHistory`/`listHistory`/`searchHistory` (`db.ts:134,143,157`), three IPC handlers (`index.ts:3396,3404,3409`), and preload bridges `historyAdd`/`historyList`/`historySearch` (`preload/index.ts:824-831`). The renderer calls **`historyAdd` from 3 places** (`CommandCenterPanel.tsx:298`, `AgentDetailPanel.tsx:180`, `FullscreenTerminal.tsx:558`) and calls **`historyList`/`historySearch` from none**. Every prompt the user has ever submitted is captured, indexed and searchable — with no way to see it, reuse it, export it, or delete it. The roadmap (`README.md:304`) still lists "per-session history" as *not started*; in truth it is ~80% built and 100% invisible. There is also no privacy surface for a table that records every prompt.

### Dead IPC — implemented in main, exposed in preload, called by nobody

The single loudest pattern in the codebase. Each line is a finished feature with no way to reach it.

| Handler | What is stranded |
| --- | --- |
| `index.ts:3404` `history:list` / `history:search` | command history is **write-only** (see above) |
| `index.ts:3313` `kg:list` / `kg:search` / `kg:get` / `kg:remove` | ingested Knowledge-Graph docs can never be browsed, searched or deleted in-app; only `kg:status` + `kg:addFiles` reach the UI. Core is even tested (`test/kg-core.test.cjs`) |
| `index.ts:3118` `git:worktrees` | `listWorktrees()` implemented; no worktree switcher, though isolated agents each live in one |
| `index.ts:3638` `control:gateTool`, `index.ts:3612` `control:setBreakerState` | per-agent per-tool gating fully implemented in `control.ts`, unreachable |
| `index.ts:3187` `hive:setArchived` | task archive/unarchive works in main; no button on the Kanban |
| `index.ts:3308` `memory:reflectNow`, `:3303` `hive:memoryWakeUp`, `:3305` `hive:mineNow` | the entire memory janitor has no manual trigger |
| `index.ts:3601` `telemetry:usage`, `:3536` `hive:agentUsage` | per-agent token/cost pull exists; nothing displays it, so budgets are **enforceable but not observable** |
| `index.ts:3982` legacy `webhook:*` (5 handlers + 5 preload methods) | pure duplicate surface, superseded by `webhooks:*` (`:3842`) |
| `index.ts:3448` `window:newFloor` | multi-window ships on with no discoverable control |

### Settings that exist only as types

- `config.ts:398-418` — **all six** `reflect*` fields (`reflectEnabled`, `reflectIntervalMs`, `reflectByteTriggerPct`, `reflectSectionTrigger`, `reflectRecentKeep`, `reflectMinBytes`) appear in **zero** renderer files. A 437-line always-on LLM subsystem with no off switch.
- `config.ts:243-264` — `maxConcurrentWorkers`, `workerIdleTimeoutMinutes`, `defaultWorkerTokenCap` have no UI; `WorkersTab.tsx` lists workers but configures none. `defaultWorkerTokenCap: 0` is self-described *"PLUMBING… never throttles"*.
- `config.ts:291,320,322` — `terminalTheme`, `providerBaseUrls`, `providerDefaultModels`, `officeTheme`, `agentTokenCaps`, `autoDeliveryPausedAgents`, `costCapUsd` absent from `SettingsModal.tsx`; the last two appear in no component at all.

### Features sold at the UI that cannot work

- **Org/teammate messaging.** `OrgSection.tsx:70` + `SettingsModal.tsx:1827` + `TriggerHistoryTab.tsx:507` ship a full config UI over a transport that does not exist — the code says so plainly: *"Teammate messaging is not built yet… no one's clone node can reach yours."* `config.ts:388` confirms *"no transport service reads `apiKey` yet"*. Three surfaces selling nothing.
- **Unbuilt office themes.** `OfficeThemePicker.tsx:81` offers themes flagged `built: false`; picking one **kills every non-god agent's PTY and archives them**, then says *"isn't built yet — showing the office for now"*. Destructive, irreversible, and the warning arrives after the damage.
- `realtimeActions.ts:632` — spawn/hire still returns a **hardcoded stub $ estimate**.

### Dead renderer components

`CommandBar.tsx:17` (never imported; its `mode` state is set by three buttons and never read; placeholder names a non-existent agent "Ada"), plus `FilesTab.tsx`, `TerminalView.tsx`, `RecentText.tsx`, `BlockedBanner.tsx` — zero importers. `AgentDetailPanel.tsx:120` says the IDE "replaces the old files tab"; the file was never deleted.

### Safety, consistency and accessibility gaps

- **Five different destructive-action policies.** Two-step arm/confirm (`WebhooksSection.tsx:263`) · instant-and-silent integration+secret delete (`IntegrationsRegistry.tsx:392`) · instant schedule delete with fire-and-forget persist that can silently fail (`SchedulesSection.tsx:267,68`) · archived-agent **permanent** removal with no confirm and **no restore path** (`CommandCenterPanel.tsx:1154`) · one-click **PR Merge** with no confirm, diff preview or undo (`CommandCenterPanel.tsx:1102`) — while a mere engine restart *does* confirm (`:939`).
- **Silent data loss on edits.** `IdePanel.tsx:251` drops a dirty buffer when a tab's `✕` is clicked (Escape is guarded by `anyDirtyRef:319`, the button is not). `AddAgentModal.tsx:240` — a global capture-phase Escape discards the entire hire form with no dirty check.
- **Optimistic saves that can silently fail.** `AiEnginesSettings.tsx:119` (`saveBaseUrl`/`saveModel`/`clearKey`), `triggers/api.ts:56`, `CommandCenterPanel.tsx:652` all swallow IPC failure after updating local state — the user sees a saved config that may never have persisted. Main-side equivalents: `index.ts:1031` and `:4109` silently drop breaker/completion toasts; `SettingsModal.tsx:350` swallows `kgStatus` failure and shows a permanent "0 documents"; `index.ts:2691` swallows and spawns anyway, so the agent boots into a permission wall.
- **Modal and keyboard gaps.** `SettingsModal.tsx:729` — 2072 lines, 7 sections, **no Escape handler, no focus trap, no `role="dialog"`/`aria-modal`, no autofocus, no settings search**. `MemoryGraphPanel.tsx:290` — graph nodes are click-only, no `tabIndex`/`role`/key handler, so the memory graph is entirely keyboard-unreachable. **24 of ~40 component files contain zero `aria-`/`role` attributes.** `App.tsx` registers no window `keydown` listener at all — no global shortcuts, no `?` overlay.
- **No repo-wide search in the IDE.** `IdePanel.tsx:824` states it outright: *"Repo-wide search is genuinely absent"*; the empty state advertises Monaco's per-file ⌘F only.
- **Search missing on most long lists.** Only `SkillsTab.tsx:96` and the Issues list (`CommandCenterPanel.tsx:1035`) have it. Activity log, archived agents, trigger history, memory graph and the task kanban have none. The Activity tab (`CommandCenterPanel.tsx:1340`) is a hardcoded last-60 with a 3s poll, no filter, no click-through, no load-more.
- **Onboarding is one-shot.** `OnboardingWizard.tsx` runs once (`App.tsx:232`, gated on `onboardingComplete`); afterwards there is no tour, coachmarks, in-app help, or docs link.

### Test coverage

`index.ts` is 4869 lines and referenced by **1 of 42** test files. `config.ts` (754), `git.ts` (489), `telemetry.ts` (473), `realtimeCompletionWatcher.ts` (468) and `reflect.ts` (437) have **no** test referencing them. `slack.ts` (508) is untested — `test/slack.test.cjs` covers only the `slack-trigger.cjs` sidecar. `config.ts` is the riskiest: it owns migrations (`migrateTriggersV1`), seeding guards and deep-merge defaults.

### Provider unevenness — the app is eleven engines wide and one engine deep

The ten-engine roster is the headline of `README.md:123`. These are the places where it is a roster in name only.

- **MCP reaches Claude only.** `hive.ts:779` — `if (!claudeProvider) return {args, env}` sits *before* `hookSettings()` (`:790`), the only writer of `mcpServers`. The whole catalog (`mcpCatalog.ts:52`, 10 servers, 6 on by default) is inert for the other ten providers, **and the consent UI still shows toggles that do nothing**.
- **Cost and safety are blind for 7 of 11 providers.** `hive.ts:768` gates OTLP telemetry on `claudeProvider`, and the fallback (`telemetry.ts:389`) parses *Claude* transcript JSONL. codex/agy/grok/kimi/pi/opencode/copilot agents report **$0 cost and zero tool spans**; only proxy-tier qwen/crush synthesize usage. So the cost cap and the circuit breaker — the app's two headline safety features — do not work for most of the roster.
- **Two providers can never be messaged.** `agentProvider.ts:275,493` — kimi and copilot are `canReceiveInbox:false`; routed mail silently bounces to god.
- **Empty affordances.** `agentProvider.ts:264` — `commandGroups: []` for 7 of 11 providers (empty slash-command panel); `installCommand`/`docsUrl` absent for grok/kimi/antigravity/qwen, so the missing-CLI banner installs nothing and links nowhere.
- **Inert verbs.** `providerAutomation.ts:90,120,134` — antigravity has no compact verb; crush and copilot have neither compact nor clear. Auto-compaction and the voice `clear_context` verb are permanently dead for those three **while the Triggers UI still advertises them**.
- **Voice-hire is broken for four engines.** `realtimeActions.ts:162` — `PROVIDER_COMMAND` maps `antigravity → 'antigravity'` when the real binary is `agy` (`agentProvider.ts:280`), carries a bogus `gemini` key, **omits grok and kimi entirely**, and bypasses `buildSpawnCommand` (`store/config.ts:369`) so voice-hired agents get no `--model` and no auto-mode flag.

### GitLab is not at parity with GitHub — and one gap is a safety bug

- **`changes_requested` is unreachable for GitLab.** `github.ts:381` derives review state from the approvals endpoint only. An MR with blocking review discussion reads `review:'none'` → `isReady()` returns true (`:310`) → **opt-in auto-merge arms on a rejected MR.** This is the one finding in this document that is a bug rather than a gap, and it can merge unreviewed code.
- `github.ts:280` — GitLab closing-issue links come only from the title/body regex; `/closes_issues` is never called, so issues linked through the GitLab UI are missed.
- `github.ts:382` — no failing-*job* URL for GitLab (pipeline `web_url` only) vs GitHub's exact `detailsUrl` (`:212`); the CI-failed inbox message is materially less useful.
- `github.ts:319` — GitLab notes are filtered by `!n.system` with no `position` data read, so review comments arrive with **no file/line context**.
- No GitLab equivalent of `statusCheckRollup` collapsing (`ciFromRollup`, `:206`) — an MR with a green head pipeline but red child pipelines reads green.
- `github.ts:369` — GitLab costs 3 extra spawns per open MR (`mr view` + `approvals` + `notes`) vs GitHub's 1.

### Integration robustness

- `github.ts:107` — `runJson` has **no timeout, no retry, no 403/rate-limit handling**; one transient failure aborts the whole poll (`:404,:406`).
- `prWatcher.ts:187` — a **failed** viewer lookup is cached as `null` for the entire process lifetime, so a momentarily-unauthenticated `gh` permanently disables self-comment filtering and the agent gets **its own comments mailed back to it**.
- Hardcoded limits: `github.ts:99` 30 issues, `:288` 20 PRs, `:316/:325` 50 comments — so **PR #21+ silently never fires a watcher event**.
- `slack.ts:367` + `config.ts:447` — Slack is **reply-only**: CLAUSE-1 refuses any post without an explicit `thread_ts`, proactive posting defaults off, and there is no channel-root post, file upload, reaction or Block Kit. An agent can never *start* a Slack conversation.
- `webhook.ts:118` — webhooks are **inbound-only with poll-for-status**, so every integration must long-poll `GET /<id>`.
- `github.ts` has **zero write commands beyond merge** — no `issue create`, `pr create`, `pr comment`, `pr review` — even though `prWatcher.ts:148` instructs the agent to *"reply on the PR if you disagree"*. The loop tells agents to do something the API layer cannot do.
- `mcpCatalog.ts:66,75,103` — `time`/`fetch`/`git` are `defaultEnabled:true` but launch via `uvx`, which the app never checks for or installs; `:126,:139,:148` guess `server-postgres`/`server-gsuite`/`server-brave-search` package names.

---

## (c) Ranked feature candidates

Ranked by **value ÷ size**. **Parallel-safe?** names collisions so several can be fanned out at once.
Sizes: **S** ≈ under a day · **M** ≈ a few days · **L** ≈ a week+.

### ★ TOP 5

| # | Feature | Size |
| --- | --- | --- |
| 1 | Command History panel — see, search, reuse every prompt | S |
| 2 | Provider-agnostic cost & telemetry | M |
| 3 | Knowledge Graph browser | S–M |
| 4 | Stable public URL for Slack + webhooks | M |
| 5 | Unlock MCP for non-Claude providers | M |

**1. ★ Command History panel — see, search and reuse every prompt you've sent** — **S**
- *Value.* "What was that prompt that worked last Tuesday?" answered in two seconds, and re-sendable to any agent.
- *Why now.* The whole stack already ships **and is already recording in every install**: `db.ts:58,65,134,143,157` → `index.ts:3396,3404,3409` → `preload/index.ts:824-831`. Three sites write (`CommandCenterPanel.tsx:298`, `AgentDetailPanel.tsx:180`, `FullscreenTerminal.tsx:558`); **nothing reads**. Highest value-per-line in the repo — the data is on disk today.
- *Files.* New `HistoryPanel.tsx` + one tab registration in `CommandCenterPanel.tsx`. **No main-process work.**
- *Risk.* None. **Parallel-safe?** Yes.
- *Ship with it:* clear / export / pause. A table recording every prompt forever with no delete is a privacy problem the moment the panel makes it visible.

**2. ★ Provider-agnostic cost & telemetry** — **M**
- *Value.* Token budgets, the cost cap and the circuit breaker actually work on the engine you chose.
- *Why now.* `hive.ts:768` gates OTLP on `claudeProvider` and `telemetry.ts:389` parses Claude transcripts, so **7 of 11 providers report $0 and zero spans**. The app's two headline safety features are decorative for most of its advertised roster. The proxy-bridge usage synthesis already built for qwen/crush is the template — extend it to the hooks tier.
- *Files.* `hive.ts`, `telemetry.ts`, `shared/agentProvider.ts`.
- *Risk.* Each CLI reports usage differently; land 2–3 engines properly and mark the rest "unmeasured" rather than guessing. **Parallel-safe?** Yes.

**3. ★ Knowledge Graph browser** — **S–M**
- *Value.* See, search and delete the documents you ingested.
- *Why now.* `kg:list` / `kg:search` / `kg:get` / `kg:remove` are implemented, **already unit-tested** (`test/kg-core.test.cjs`) and dead (`index.ts:3313`). Only `kg:status` + `kg:addFiles` reach the UI, so today a user can add documents they can never see or remove — including ones added by mistake. README sells this as "Enterprise Knowledge Graph".
- *Files.* New KG panel; `SettingsModal.tsx:350` (also fix the swallowed `kgStatus` error that shows a permanent "0 documents").
- *Risk.* None. **Parallel-safe?** Yes.

**4. ★ Stable public URL for Slack + webhooks** — **M**
- *Value.* Your Slack app and every webhook caller keep working after a restart.
- *Why now.* The same `TODO: optional persistent domain` sits in both `webhook.ts:253` and `slack.ts:188`; tunnelmole mints an ephemeral URL and has **no documented close handle**, so teardown leaks (`slack.ts:167`). Every restart silently breaks every endpoint the user pasted elsewhere. This blocks the roadmap's own #1 item — a Telegram bridge inherits the same broken URL.
- *Files.* `slack.ts`, `webhook.ts`, config + Settings.
- *Risk.* A persistent domain means an account/paid tier, or Slack **Socket Mode** (no public URL at all) — decide which before building. **Parallel-safe?** Yes.

**5. ★ Unlock MCP for non-Claude providers** — **M**
- *Value.* The MCP catalog does something on the engine you actually run.
- *Why now.* `hive.ts:779` returns before `hookSettings()` (`:790`) for every non-Claude provider, so `mcpCatalog.ts`'s 10 servers (6 default-on) are dead weight for 10 of 11 engines — **while the consent UI shows toggles that do nothing**. codex/opencode/crush/pi all support MCP natively through their own config files.
- *Files.* `hive.ts`, `shared/mcpCatalog.ts`, per-provider config writers.
- *Risk.* Each provider has a different config format; start with the two or three with documented MCP support. Fix the `uvx` assumption (`mcpCatalog.ts:66,75,103`) at the same time. **Parallel-safe?** Yes.

### 6–16

**6. Per-agent usage & cost readout** — **S**. `telemetry:usage` (`index.ts:3601`) and `hive:agentUsage` (`:3536`) are implemented and unconsumed; `agentTokenCaps` has no UI. Budgets are *enforceable but not observable*. Pairs naturally with #2. Files: new panel + `AgentDetailPanel.tsx`. Parallel-safe: yes.

**7. Memory-reflection controls and visibility** — **S–M**. A 437-line always-on LLM subsystem rewrites agent memory with **no off switch**: all six `reflect*` fields (`config.ts:398-418`) appear in zero renderer files, and `memory:reflectNow` (`index.ts:3308`) plus `hive:mineNow`/`hive:memoryWakeUp` (`:3305,:3303`) are dead. `HIVE.md:190-192` still calls reflection "Still open", so the docs don't know it shipped. Files: `SettingsModal.tsx`, `reflect.ts` (events only), `HIVE.md`. Parallel-safe: partially (`SettingsModal.tsx`).

**8. Provider-agnostic memory condensation** — **M**. `reflect.ts:33` hardcodes `claude-haiku-4-5` and `reflect.ts:279` → `hiddenClaude.ts` spawns a hidden **interactive** `claude` PTY, deliberately chosen to draw on the user's plan quota (`hiddenClaude.ts:11-20`). On a codex/qwen-only floor every `memory.md` grows unbounded and only logs `summarize-failed` — and on any floor that spend is invisible to the budget ledger. Files: `reflect.ts`, `hiddenClaude.ts`, `agentProvider.ts`. Parallel-safe: coordinate with #7 (both open `reflect.ts`).

**9. One destructive-action policy, with undo** — **S–M**. Today there are five: two-step confirm (`WebhooksSection.tsx:263`), instant silent integration+secret delete (`IntegrationsRegistry.tsx:392`), instant schedule delete whose persist can silently fail (`SchedulesSection.tsx:267,68`), archived-agent permanent removal with no confirm **and no restore path** (`CommandCenterPanel.tsx:1154`), and one-click **PR Merge** with no confirm or diff preview (`CommandCenterPanel.tsx:1102`) — while an engine *restart* does confirm (`:939`). Add the two silent-data-loss cases: `IdePanel.tsx:251` (tab `✕` drops a dirty buffer) and `AddAgentModal.tsx:240` (capture-phase Escape discards the whole hire form). Files: shared confirm hook + ~6 call sites. Parallel-safe: no — touches many components; run alone.

**10. Repo-wide search in the IDE** — **M**. `IdePanel.tsx:824` says it outright: *"Repo-wide search is genuinely absent"*. The IDE is a headline feature and cannot answer "where is this symbol". Files: `IdePanel.tsx`, a main-side ripgrep/`git grep` broker. Parallel-safe: yes.

**11. Settings search + modal accessibility** — **S–M**. `SettingsModal.tsx:729` is 2072 lines across 7 sections with **no Escape, no focus trap, no `role="dialog"`/`aria-modal`, no autofocus, no search**. Broader: 24 of ~40 components have zero `aria-`/`role`; `MemoryGraphPanel.tsx:290` is keyboard-unreachable; `App.tsx` registers no window `keydown` at all (no global shortcuts, no `?` overlay). Parallel-safe: partially (`SettingsModal.tsx`).

**12. GitLab parity** — **M**. Fix the safety bug first (`github.ts:381` → auto-merge can arm on a rejected MR), then `/closes_issues` (`:280`), failing-job URLs (`:382`), note `position` for file/line context (`:319`), and child-pipeline rollup. Files: `github.ts`, `prWatcher.ts`, `test/pr-loop.test.cjs`. Parallel-safe: yes (owns `github.ts`) — **conflicts with #13**.

**13. The write half of the GitHub/GitLab loop** — **M**. No `pr comment`, `pr review`, `issue create` or `pr create` exists, yet `prWatcher.ts:148` already tells agents to *"reply on the PR if you disagree"*. The loop instructs agents to do what the API layer cannot. Files: `github.ts`, `prWatcher.ts`. Parallel-safe: **no — same files as #12**; sequence them.

**14. Outbound webhook completion callbacks** — **M**. `webhook.ts:118` is inbound-only with poll-for-status, so every integration long-polls `GET /<id>`. A caller-supplied completion URL closes the loop, and the same tunnel then unlocks a webhook path for the PR watcher (`prWatcher.ts:200`), killing the 60s N+1 poll (`github.ts:389` — ~60 spawns/min at 15 open MRs). Depends on #4. Parallel-safe: yes.

**15. Activity log → a real event log** — **S–M**. `CommandCenterPanel.tsx:1340` is a hardcoded last-60 on a 3s poll with no search, no filter by kind/agent, no click-through, no load-more. The event data already exists (append-only hive log). More broadly, only 2 of ~7 long lists in the app have search. Parallel-safe: partially (`CommandCenterPanel.tsx`, shared with #9).

**16. Fix voice-hire's provider map** — **S**. `realtimeActions.ts:162` maps `antigravity → 'antigravity'` (real binary `agy`), has a bogus `gemini` key, **omits grok and kimi**, and bypasses `buildSpawnCommand` so voice-hired agents get no `--model` and no auto-mode flag. Also `realtimeActions.ts:632` still returns a hardcoded stub $ estimate. These are bugs wearing a feature's clothes — smallest item here with a guaranteed user-visible payoff. Parallel-safe: yes.

### Also worth carding (17–20)

**17. Inbox for kimi and copilot** — M. `agentProvider.ts:275,493` `canReceiveInbox:false`; mail silently bounces to god. Kimi has upstream hooks and just needs a bridge.
**18. Provider Doctor** — M. 16 `TODO-verify` third-party facts (`agentProvider.ts:227,301,307,311,313`; `mcpCatalog.ts:66,75,103,126,139,148`; `store/config.ts:215,226,246,263,276`) with no probe anywhere. A stale slug means the picker says one model while the CLI runs another — the OpenCode comment at `store/config.ts:227` documents this having already happened live. Extend the Prerequisites page from *tools* to *facts*.
**19. Delete the dead surface** — S. `CommandBar.tsx`, `FilesTab.tsx`, `TerminalView.tsx`, `RecentText.tsx`, `BlockedBanner.tsx` (zero importers); the legacy `webhook:*` cluster (`index.ts:3982`, 5 handlers + 5 preload methods superseded by `webhooks:*`); `localtunnel` (a production dep with **zero** references). Pure deletion, no user-facing risk.
**20. Org messaging: ship it or hide it** — S to hide, L to build. `OrgSection.tsx:70` + `SettingsModal.tsx:1827` + `TriggerHistoryTab.tsx:507` sell teammate messaging at three surfaces over a transport that does not exist (`config.ts:388`: *"no transport service reads `apiKey` yet"*). Hiding it is an afternoon; building it is a distributed-systems project.

---

## Bugs found that outrank most of this list

Not features, but they surfaced during the survey and should be carded on their own:

1. **`github.ts:381` — auto-merge can arm on a rejected GitLab MR.** `changes_requested` is unreachable for GitLab, so `isReady()` returns true and opt-in auto-merge fires. Can merge unreviewed code. Fix before anyone enables auto-merge on a GitLab repo.
2. **`prWatcher.ts:187` — a failed viewer lookup is cached as `null` for the process lifetime**, permanently disabling self-comment filtering; the agent then gets its own comments mailed back to it.
3. **`OfficeThemePicker.tsx:81` — picking an unbuilt theme kills every non-god agent's PTY and archives them**, then explains it "isn't built yet". Destructive, irreversible, warning arrives after the damage.
4. **Hardcoded caps silently drop events** — `github.ts:288` caps at 20 PRs, so **PR #21+ never fires a watcher event**.

## Not recommended (for now)

- **Telegram / more chat bridges** (roadmap #1) — a new bridge inherits the ephemeral-URL breakage. Do #4 first, then this is cheap.
- **More engines** (roadmap #2) — the roster is eleven wide and one deep: MCP, cost, telemetry, inbox, compact/clear and slash-commands are all Claude-first. Widening multiplies the gap; deepen first.
- **Fuller avatar coverage from hook events** (roadmap #3) — genuinely nice, purely cosmetic, and it competes with safety features that don't work for 7 of 11 providers.
- **Consolidating the two bundled editors** (Monaco + CodeMirror + 7 `@codemirror/lang-*`) — real bloat, near-zero user-visible value. Do it opportunistically, never as a card.
- **A webhook-driven PR watcher** — correct end state, but strictly after #4 and #14; on its own it just re-litigates the tunnel problem.
- **Anything that assumes commercialization** — the bundled LimeZu art is FREE-VERSION **non-commercial only** and the recolored sprites inherit it. Replacing or licensing the art is a prerequisite, not a feature.
- **A big test-coverage push as a "feature"** — worth doing (`index.ts` 4869 lines / 1 of 42 test files; `config.ts`, `git.ts`, `telemetry.ts`, `reflect.ts`, `slack.ts` untested) but it belongs inside each card above, not as a standalone item nobody can demo.

---

## Addenda — second-opinion pass (Yakup)

A parallel review covered the same ground and converged on the same top 5 and the same four bugs. Only the items below were **not** already in this document; everything else in that pass duplicated the list above.

**Extra cards worth splitting out**

- **A1. Archive / unarchive on the Kanban** — **S**. `hive:setArchived` (`index.ts:3187`) works in main and is called by nothing, so finished cards pile up forever and the board becomes unreadable. Listed in the dead-IPC table above but never turned into its own card. Files: `TasksKanban.tsx`, `preload/index.ts`. Parallel-safe: yes.
- **A2. Manual memory-maintenance buttons ("condense now" / "mine now" / "wake up")** — **S**. `memory:reflectNow` (`index.ts:3308`), `hive:mineNow` (`:3305`) and `hive:memoryWakeUp` (`:3303`) are implemented in main with **no preload bridge and no caller** — three buttons against three finished handlers. Smaller and shippable independently of #7, which is about *settings and visibility*. Files: `preload/index.ts`, `MemoryPanel.tsx`. Parallel-safe: yes if #7 owns Settings and this owns MemoryPanel.
- **A3. Guard the two silent-data-loss paths on their own** — **S**. Carved out of #9: `IdePanel.tsx:251` (tab `✕` drops a dirty buffer while Escape on the same panel *is* guarded at `:319` — the guard exists, one path just doesn't use it) and `AddAgentModal.tsx:240` (capture-phase Escape discards the whole hire form). Both are one-condition fixes against a guard already written, so they need not wait for #9's shared-confirm refactor. Files: `ide/IdePanel.tsx`, `components/AddAgentModal.tsx`. Parallel-safe: yes.

**Implementation detail worth knowing before carding #6 and A2:** several of the dead handlers lack a **preload bridge** as well as a caller (`telemetry:usage`, `hive:agentUsage`, `memory:reflectNow`, `hive:mineNow`, `hive:memoryWakeUp`, `hive:setArchived`). Those cards are "add bridge + add UI", not "add UI".

**Additional "not recommended"**

- **Splitting `index.ts` (4869 lines).** It will be needed eventually, but a big-bang split of the file covered by 1 of 42 test files is how a regression ships. Tests first, split later.
- **A full 40-component accessibility sweep.** Real debt, wrong shape for a card. #11 does the two surfaces that actually block use (`SettingsModal`, `MemoryGraphPanel`).
- **Generalising the Provider Doctor into a "verify any third-party fact" framework.** #18 covers the 16 facts that matter and rot fastest; don't build a plugin system for one use case.
- **Finishing the unbuilt office themes.** Gated on the same LimeZu non-commercial art licence noted in (a) — high art cost, zero functional gain. Fix the destructive switch (bug 3) instead.
