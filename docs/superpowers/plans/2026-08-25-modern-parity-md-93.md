# MD-93 — Modern UI parity QA: Settings · Onboarding · Monitor · Activity

Read-only QA against main `1e4b52d5`. Packaged build (`rm -rf out && npm run build`, green including
`check:modern-css`), launched with `env -u ELECTRON_RENDERER_URL npx electron . --user-data-dir=<scratch>`
on a scratch profile — Slack, Telegram, webhooks, Realtime and the public URL all off, no webhook
endpoint, telemetry off. `ui.mode` seeded to `modern`. The scratch hive carried a four-agent roster
(one god + working / idle / asleep, plus an archived and a restorable entry), a 96-row event log
across five kinds and five actors, a task ledger covering every column, and a floor token budget —
then the budget was cleared live to check the no-cap path. Both themes were driven with the shell's
own topbar toggle and the Settings Theme select; `data-cth-theme` was never stamped by hand.
Onboarding was QA'd on a **second, first-run profile** (`onboardingComplete: false`), walked twice —
once technical, once "explain things simply".

Source of truth: the pixel components named per row, plus
`src/renderer/src/modern/{settings,onboarding,monitor}/SPEC.md` and `docs/DESIGN-MODERN.md`.

**Severity:** S1 = blocks making modern the default (a capability the human loses outright, or a
destructive action made easier). S2 = notable degradation, ship-blocking for a power user.
S3 = polish or a deliberate divergence that wants a sign-off.

Screenshots: `$AGENT_DIR/artifacts/md-93/` (light + dark for every area).
Known and already assigned, not re-reported here: Floor click does not open the agent chat (MD-95).

## Settings

| Feature | Pixel location | Modern | Sev | Note |
|---|---|---|---|---|
| **AI engines: API key per provider, custom base URL, per-provider default model** | `AiEnginesSettings.tsx` (`providerKeySet/Has/Clear`, `providerBaseUrls`, `providerDefaultModels`), rendered at `SettingsModal.tsx:1609` | **missing** | **S1** | `providerKeySet`/`Has`/`Clear` have **zero callers anywhere under `modern/`**. A modern-only user cannot enter a key for Codex, Grok, Kimi, Antigravity, OpenCode, Crush or Pi, and cannot point an engine at a custom base URL. Onboarding lets you *pick* one of ten engines as the orchestrator; nothing in modern lets you authenticate it. `Agents & Models` holds exactly three rows (`24-settings-agents-dark.png`). |
| **Voice: OpenAI key for Realtime** | `SettingsModal.tsx:691,701` — the Voice-tab doorway to the same `apikey:openai` broker slot | **missing** | **S1** | Modern's Voice section has the Groq key (Free Flow) and the idle-disconnect, and nothing else (`24-settings-voice-dark.png`). With both doorways gone, Realtime voice cannot be turned on from modern at all unless a key was set earlier in pixel. `modern/settings/index.ts` still lists these keys as "owned by the AI engines panel" — a panel that was never built. |
| **Prerequisites section (doctor + tool install status)** | `SettingsModal.tsx:246` `NAV_SECTIONS` (7 sections), `:1573` `<SetupPanel/>` — Prerequisites / Memory layer / Agent engines, driven by `toolsStatus()` | **missing** | **S2** | Modern's nav has **6** sections; Prerequisites is absent and `toolsStatus` has no modern caller. Integrations carries a narrower *Provider Doctor* (`doctorRun`), which answers "is this provider reachable", not "is the CLI installed and which ones do I still need". |
| **MCP defaults (per-server consent)** | `McpDefaultsSettings.tsx` @ `SettingsModal.tsx:2048` | **missing** | **S2** | `mcpDefaults` has no modern reader or writer; the key is documented in `modern/settings/index.ts` as belonging to a panel that does not exist. |
| **Update check / release notes** | `UpdatesSection.tsx` @ `SettingsModal.tsx:1352` | **missing** | **S2** | Modern has the *toast* (`monitor/notifications.tsx` subscribes to `onUpdateStatus`) but no manual "check for updates", no release notes, no version string. The Auto-update switch is present with nothing behind it. |
| **Hero card / app version** | `SettingsHeroCard.tsx` @ `SettingsModal.tsx:1344` (`appInfo()`, `heroPayload()`) | missing | S3 | `appInfo` has no modern caller — there is nowhere in the modern UI that says which version is running. |
| **Realtime input/output device picker** | `RealtimeDevicePicker` @ `SettingsModal.tsx:2801` | missing | S3 | Mic and output device are not selectable in modern. |
| Directories: **remove is confirm-armed** | `CommandCenterPanel.tsx` L1135–1157 (`IconDelete`, confirm label "remove project"); `modern/settings/SPEC.md` §2b calls it "a **confirm-armed** delete" | **degraded** | **S3** | `GeneralSection.tsx:263` fires `remove(r)` on the FIRST click, no arming. The code comment argues it is safe because agents keep their cwd — which is true and the help line says so — but it is a deliberate divergence from the area's own spec and wants a sign-off rather than a silent drop. |
| Scheduled auto-compact | `missions[]` kind `compact`; `modern/settings/index.ts:78` claims "General exposes only the auto-compact one" | relocated | S3 | It is **not** in General; it lives in Triggers (`modern/triggers/SchedulesSection.tsx`). The comment in `index.ts` is stale — one-line doc fix. |
| Section nav, per-section blurb, group headings, row grammar | `SettingsModal.tsx` | parity | — | 6 sections, hairline groups, label + help left / control right (`20-`, `24-settings-*`). |
| **Search** | pixel filters the nav and highlights label hits; does NOT scroll to the field | **better** | — | Modern's search is a real result list — label + `Section › Group` breadcrumb — and clicking a hit switches section, scrolls to the row and clears the query (`22-`, `23-settings-search-light.png`). |
| **Appearance: Light / Dark / Match system** | pixel has Light/Dark only; `SPEC.md` §5 reserved the third slot | **better** | — | All three ship, and the select stays in sync with the topbar toggle through `useThemePreference()` (MD-84e) — flipping either updates the other with no local mirror. |
| General: home folder + Change, boss name (blank ⇒ Michael), keep-awake, explain simply, notifications, auto-update, telemetry, office theme, interface | `SettingsModal.tsx`, `OfficeThemePicker.tsx` | parity | — | |
| General: Directories — list, per-row Open in Terminal, remove, **Add project** | `CommandCenterPanel.tsx` FloorTab (list + remove only) | better | — | Pixel could only shrink the list; modern adds `Choose folder…` and adopts the saved (tilde-expanded) list back. |
| General: Danger zone — two-press arm | `ARM_TIMEOUT_MS`, `SettingsModal.tsx` | parity | — | `GeneralSection.tsx:373-400` arms, relabels to "Yes, erase everything", and disarms on the timeout. |
| Agents & Models: default model, max turns (blank ⇒ unlimited), sleep idle after (0 never / blank default) | `SettingsModal.tsx` | parity | — | |
| Autonomy: autonomous vs ask-first, floor token budget, circuit breaker (enabled · velocity · repeated-tool · error-storm · hard stop) | `SettingsModal.tsx` | parity | — | Breaker patched as one object. |
| Connections: public URL + its warning, issue tracker, auto-merge, Slack (transport · app token · signing secret · bot token · allowed ids · channel · port · proactive), Telegram (enabled · token · chat id) | `SettingsModal.tsx` | parity | — | `24-settings-connections-dark.png`. Nit: the App-level token field stays enabled under the Events API transport, where it is inert. |
| Voice: Free Flow on, Groq key, transcription model, idle auto-disconnect | `SettingsModal.tsx` | parity | — | Minus the OpenAI key — see the S1 row. |
| Memory: cross-session recall, knowledge graph, condenser (interval · byte % · section trigger · recent keep · min bytes · fallback engine) | `MemoryPanel` / `SettingsModal.tsx` | parity | — | `embeddingModel` stays in the Memory panel, as in pixel. |
| Text/number rows save on blur | `SettingsModal.tsx` | parity | — | Verified live (boss name). Neither UI gives a saved-hint — the MD-71 finding stands for both. |
| Switches carry no `aria-label` | — | new nit | S3 | Every `[role=switch]` in Settings is unlabelled for a screen reader; the visible label is a sibling. |

## Onboarding

Walked end-to-end twice on a first-run profile, technical and plain.

| Feature | Pixel location | Modern | Sev | Note |
|---|---|---|---|---|
| 6 steps `persona → welcome → home → orchestrator → repos → permissions` (`done` is a sentinel in both) | `OnboardingWizard.tsx:16` | parity | — | `40-`, `43-`…`46-`, `50-`…`56-`. |
| Guard: Next disabled on `persona` until an audience is chosen | `OnboardingWizard.tsx` | parity | — | Verified: `disabled=true` before the pick, `false` after. |
| Guard: whitespace-only home rejected, stays on the step | `OnboardingWizard.tsx` | parity | — | `OnboardingView.tsx:402` → "Pick a home folder first." (`53-onboarding-home-guard-dark.png`). |
| Guard: the container scrolls (the engine step is taller than the window) | `OnboardingWizard.tsx` | parity | — | `overflow-y-auto`, 1088/900 measured (`54-onboarding-orchestrator-dark.png`). |
| `audience` drives plain-vs-technical copy on every later step | `plain` flag | parity | — | Every step re-writes: "Harness home" ⇄ "A home for the app", "Your clone's engine" ⇄ "Your clone" (`51-`, `52-onboarding-*-plain-dark.png`). |
| Step 4 permissions: autonomous vs ask-first, notifications, open at login, keep awake + energy settings link, usage stats | `setLoginItem()`, `setNotifications()`, `openExternal()` | parity | — | `46-`/`56-onboarding-permissions`. Defaults match pixel (`shareStats` starts `true` in both). |
| ONE final `updateConfig({onboardingComplete, audience, harnessHome, registeredRepos, autoMode, godProvider, godModel, telemetryEnabled})` | `OnboardingWizard.tsx:182` | parity | — | Verified on the written config; lands straight in the shell, correctly skipping the hive picker. |
| Progress bar + "Step N of 4" over the four numbered steps | `OnboardingWizard.tsx` | parity | — | |
| Engine sub-labels repeat the title | — | new nit | S3 | 5 of 10 engines read "Kimi Code / Kimi Code", "Pi / Pi", "Grok · xAI / Grok · xAI", "OpenCode / OpenCode", "Crush · Charm / Crush · Charm". |

## Monitor

| Feature | Pixel location | Modern | Sev | Note |
|---|---|---|---|---|
| Fleet totals band: billed · cost · inputs + cache % · rate · N of M reporting | `CommandCenterPanel.tsx` FloorTab summary (L720–990) | parity | — | `35-monitor-fleet-light.png`, `30-monitor-fleet-dark.png`. |
| Table: agent · status · billed · cost · rate · context · budget · last tool | same | parity | — | Mono numerals, right-aligned, hairline rows. |
| **Rule 1** — no cap set ⇒ no meter, an honest line | `UsageReadout.tsx` L60–88 | parity | — | Clearing `costCapTokens` live turns the band into "no floor budget" and every row into "no budget"; no invented denominator (`37-monitor-nocap-light.png`). |
| **Rule 2** — never `$0` for an unpriced model; always show the source | `usageFormat` / `usageSourceNote` | parity | — | Non-reporting rows read `unknown`, not `$0`; the sheet says "No usage signal on this machine for this engine — unknown, not zero." |
| **Rule 3** — budget spend and context headroom are distinct, labelled meters | `UsageReadout.tsx` | **better** | — | Two separate columns, and the sheet spells the trap out: "BILLED … context is the gauge. The context window itself is 910k right now — this is not that number." |
| Context gauge escalation | FloorTab ctx row (L805–840) | parity | — | Red at 91% (`35-monitor-fleet-light.png`). |
| Row → per-thread sheet: ctx gauge, in/out/cached split, source badge, **cap editor + Clear**, tool-span waterfall | `AgentDetailPanel` ctx row + `ToolWaterfall.tsx` | parity | — | `34-monitor-sheet-dark.png`. `agentTokenCaps` is editable exactly where `settings/index.ts` says it is. |
| Breaker state on the row | FloorTab `breakers[a.id]` | parity | — | Wired to `useFleetTelemetry().breakers`; not reproducible on a synthetic roster, code path verified. |
| Sparkline only while burning | FloorTab spark | parity | — | Absent on idle rows, as specified. |
| **Orchestrator engine/model picker** | pixel FloorTab | **missing** | **S2** | `settings/index.ts:72-73` excludes `godProvider`/`godModel` from Settings on the grounds that they are "chosen in the orchestrator engine picker (**onboarding + Monitor**)". Onboarding has one; **Monitor does not** — neither identifier appears anywhere under `modern/monitor/`. After first run the orchestrator's engine is unreachable from the modern UI. (Adjacent to MD-92's "roster provider + model picker missing"; called out here because Monitor is named as the owner and is not.) |
| Update + completion toasts through the shell's single `<Toaster/>` | `UpdateToast.tsx`, `realtime/CompletionToast.tsx` | parity | — | `monitor/notifications.tsx` mounts app-wide in `modern/App.tsx`, so a toast reaches the user in any area; module-level de-dup keys prevent doubling. Not triggerable on a scratch profile — code path verified. |
| Michael's Context cell reads "no status tick yet" while peers show a gauge | — | new nit | S3 | Honest, but the one row with real telemetry is the one with no context gauge. |

## Activity

Activity is a **tab inside Monitor**, not a top-level nav entry — `modern/monitor/SPEC.md` expected the
nav registry to contribute two entries. Consolidating it the way Issues & PRs was consolidated is
defensible; recording it so the difference is a decision, not a drift. (S3.)

| Feature | Pixel location | Modern | Sev | Note |
|---|---|---|---|---|
| **Click-through: `tasks` event → task board; agent event → that agent** | `ActivityTab.jump` (L107–116) — `requestCommandCenterTab('tasks')`, `select(id)` | **degraded** | **S2** | The arrows render with the right tooltips and **neither navigates**. Nothing under `modern/` subscribes to `requestCommandCenterTab` (it is a pixel command-center bus; modern routes through `modern/navigation.ts`), so "Open the task board" is inert; "Go to Pam" sets the store selection while you stay on Monitor, so it looks like a dead button. Verified live: clicking both leaves the view on Monitor/Activity. |
| Event list, newest first, relative time, `describeEvent` rendering | `ActivityTab.tsx` | parity | — | 96 rows across 5 kinds (`31-`, `36-monitor-activity-*`). |
| Search over the log | `ActivityTab.tsx` | parity | — | "26 of 26 matching · 96 scanned" (`32-activity-filtered-dark.png`). |
| Kind filter + agent filter, both derived from the data | `ActivityTab.tsx` | parity | — | Kinds `message/session/spawn/tasks`; agents resolved to display names (Dwight, Michael, Jim, Pam, scheduler). |
| Row expand → raw JSON in a mono block | `ActivityTab.tsx` | parity | — | `33-activity-expand-dark.png`. |
| Paging: `load more`, `N of M events` | `ActivityTab.tsx` | parity | — | 60 of 96, then more. |
| Polling pauses while filtering or paged back | rule 5 | parity | — | The live/paused indicator is present and flips. |
| Board — collapsible mono block | `hiveBoard()` | parity | — | |
| Truncated scans say so | rule 6 | parity | — | `truncated` threaded through from `logQuery`. |

## DESIGN-MODERN compliance (by eye + by scan)

- **Zero `--cth-*` in the modern stylesheet** — scanned every rule recursively (including inside
  `@layer`, the trap from MD-84c): no `--cth-` declaration and no `var(--cth-…)` reference.
- **No authored inline `style=`** in these areas — the only `[style]` nodes under `main` are Radix's
  own `outline`/`pointer-events` injections.
- Control height, 8px radius, hairline borders, shadowless cards, 13px/500 labels, nothing bold or
  uppercase, one primary button per view, `destructive` confined to the danger zone and repo removal:
  all hold in both themes across every screenshot.
- Light and dark both checked for every screen listed above; no unreadable pair found.

## Verdict

1. **Not yet — two S1s, both the same shape: a credential you cannot enter.** A modern-only user
   cannot set an API key or base URL for any non-Claude engine, and cannot set the OpenAI key that
   Realtime voice needs. Onboarding offers ten engines it gives you no way to authenticate.
2. The S2s are real but narrower: no Prerequisites/doctor section, no MCP defaults, no manual update
   check, no orchestrator engine picker after first run, and a dead click-through arrow in Activity.
3. Everything else in these four areas is at parity or ahead of it. Settings search, the three-way
   theme control, the Directories add-path and the Monitor sheet's honesty copy are genuine upgrades.
4. Onboarding is the strongest area — all four guards intact, both copy registers complete, and the
   final single `updateConfig` verified on disk.
5. Blockers to clear before modern becomes the default: the AI-engines key panel (S1), the Voice
   OpenAI key row (S1). Recommended alongside: Prerequisites (S2) and the Activity arrows (S2).
