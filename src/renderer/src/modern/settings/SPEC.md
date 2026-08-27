# MD-87 — modern/settings + modern/onboarding (read-only prep spec)

Source read at `85787b0c`: `components/SettingsModal.tsx` (2838 L), `OnboardingWizard.tsx` (855 L),
`OfficeThemePicker.tsx`, `@shared/settingsSearch.ts`, `store/config.ts`, `design/theme.ts`,
`CommandCenterPanel.tsx` FloorTab (DIRECTORIES), and `docs/DESIGN-MODERN.md` @ `95f89689`
(`origin/feat/modern-ui-shell`).
Ownership: everything below lives under `modern/settings/` and `modern/onboarding/`. Nothing outside.

## 1. Judgement calls (flag now, cheap to change later)

- **Coverage.** `HarnessConfig` has **67 top-level keys**; `SETTINGS_INDEX` has **42 entries**
  (MD-71's "41 of 187" counts nested leaves — `circuitBreaker.*`, `contextTrigger.*`,
  `webhookTriggers[].*`, per-provider `providerBaseUrls`/`providerDefaultModels`, per-server
  `mcpDefaults`). I will index **every user-facing leaf**, not every key: 11 keys are internal
  state, not settings (`onboardingComplete`, `audience`, `recentHives`, `opsStandupSeeded`,
  `heartbeatSeeded`, `triggersMigratedV1`, `autoDeliveryPausedAgents`, `agentTokenCaps`,
  `defaultCommand` (read by AddAgentModal, written by nobody) and the three deprecated
  `webhook{Enabled,Secret,Port}`). Indexing those would produce results that navigate to a field
  that does not exist. **Default I recommend: index the leaves, and add a test that fails when a
  new user-facing key lands unindexed** (derive from a source-of-truth key list, so the index
  cannot silently go stale the way the hand-written one did).
- **Search is a real component here, not a filter.** Pixel search filters the nav to matching
  sections and highlights label hits; it does NOT scroll to the field. In modern I will make a
  ⌘K-style command palette over the same index that switches section *and* scrolls/flashes the
  row — needs each row to carry a stable `id`, which is the one structural difference from pixel.
- **Appearance already exists — build on it, do not add a key.** `design/theme.ts` is an app-wide
  light/dark switch: `localStorage['cth.theme']` (seeded once from the legacy `cth.ptyTheme`),
  stamped as `data-cth-theme` on `<html>`, with `:root[data-cth-theme='dark']` overrides in
  `design/tokens.css`. Read it with `useAppTheme()`, write with `setAppTheme()`. DESIGN-MODERN
  pins the modern palette to the **same attribute**, so one toggle drives both UIs. The Settings
  appearance control is therefore a second view onto that store — the title-bar toggle and the
  shell topbar toggle stay live and must stay in sync, which `useSyncExternalStore` gives free.
  My earlier "there is no light/dark" was wrong: I grepped `data-theme`/`darkMode`, and the real
  names are `data-cth-theme` / `dataset.cthTheme`. Import `AppTheme` from `design/theme.ts` and
  render one radio per member — never re-spell the union here, or 'system' becomes a second edit.
- **'system' does not exist yet.** `AppTheme` is `'light' | 'dark'` — no `matchMedia` follow.
  Adding it means editing `design/theme.ts`, a module the PIXEL UI also consumes, which is
  outside `modern/settings/`. I will ship a two-way Light/Dark control that works, leave room in
  the layout for a third option, and take 'system' only when whoever owns `design/theme.ts`
  lands it (see §5).
- **`ui.mode` toggle**: MD-84/Orcun owns the `ui: { mode, theme }` key and `modern/nav.ts`; the
  switch reloads the window. I only build and polish the control on top of what they land.
- **MD-102 update — the slots are gone; every one of them is built.** MD-93 showed what a
  "slot" costs when nobody fills it: `providerKeySet/Has/Clear`, `providerBaseUrls` and
  `providerDefaultModels` had ZERO callers under `modern/`, so a modern-only install could pick
  any of ten orchestrator engines and authenticate none of them. `AiEnginesPanel.tsx`,
  `McpDefaultsPanel.tsx`, `OrchestratorRows.tsx` and a seventh section, `PrerequisitesSection.tsx`,
  now cover `AiEnginesSettings`, `McpDefaultsSettings`, `SetupPanel`, `UpdatesSection` and the
  orchestrator picker. The BYOK backend table moved to `@shared/providerKeys` so main validates
  against the same rows both UIs render. Still not mine: `RealtimeDevicePicker`/`CostHud` (the
  topbar voice control owns them) and the triggers panel.
- **MD-99 update — `IntegrationsRegistry` and the Realtime OpenAI key ARE mine after all.**
  MD-94 found the consequence of leaving them as slots: nothing else in `modern/` renders
  either, Integrations is status-only by ruling, so a modern-default user could not add a REST
  integration or enable voice at all. Both now live here — `RestRegistry.tsx` under Connections
  (validated with the main-process `validateIntegrationRecord`, not a second copy of its rules)
  and the write-only OpenAI key row under Voice. The remaining slots below stand.
- **Not my area** (present in pixel Settings but owned elsewhere): `SetupPanel` (Prerequisites /
  doctor), `AiEnginesSettings`, `McpDefaultsSettings`, `UpdatesSection`,
  `RealtimeDevicePicker`/`CostHud`, the triggers panel (`orgTrigger`, `webhookTriggers`, and the
  compact rule's message + the whole `/clear` half of `contextTrigger`), `embeddingModel` (lives in
  `MemoryPanel`). **MD-162 exception:** auto-compaction's three NUMBERS moved into Agents & Models —
  they are cost dials and belong beside the other cost dials; the rest of `contextTrigger` stays
  in Triggers. I will render **slots** for these
  and expect the owning agent to fill them; if MD-84's registry has no slot concept I will inline
  a placeholder and say so.
- **Scope add (god, MD-87 scope msg): the FloorTab DIRECTORIES section is mine.** It is a
  registered-repo list, not a worktree UI — there is no worktree surface in FloorTab. See the
  table below. Adding a repo today happens in Onboarding and in `AddAgentModal`; Settings only
  lists and removes. I will add a **Choose folder…** button so the two paths match, since a
  Settings list you can only shrink is the odd one out.

## 2. Feature inventory — every control, with its key and its write path

All writes go through `window.cth.updateConfig(patch)` unless a second call is named.
Text/number rows save on **blur**; toggles/selects save on **change**.

| Section | Control | Key / call |
|---|---|---|
| General | Home folder (picker) | `chooseFolder()` → `changeHome()`; `harnessHome` |
| General | Boss name | `bossName` (blank ⇒ `DEFAULT_BOSS_NAME` via `bossName()`) |
| General | Keep Mac awake while agents run | `strongKeepalive` |
| General | Explain things simply | `audience` ('non-technical' \| 'technical') |
| General | Desktop notifications | `notifications` via `setNotifications()` |
| General | Scheduled auto-compact | `missions[]` (kind `compact`) |
| General | Auto-update | `autoUpdate` (+ `UpdatesSection` slot) |
| General | Anonymous usage stats | `telemetryEnabled` |
| General | Office theme picker | `tvShowOffices`, `officeTheme` (switch kills PTYs: `killPty()`) |
| General | Hero card | `appInfo()`, `heroPayload()` (slot) |
| General | Appearance: Light / Dark | `design/theme.ts` — `useAppTheme()` / `setAppTheme()`; NOT a config key |
| General | Interface: Pixel / Modern | `ui.mode` (MD-84 owns the key; switching reloads the window) |
| General | Directories: registered repo list | `registeredRepos` — read via `getConfig()`, remove = filter + `updateConfig`, per-row `openTerminalAt(path)`; add = `chooseFolder()` + prepend-dedupe |
| General | Danger zone · Reset & start over | `resetAll()` + `clearLocalState()`, armed (`ARM_TIMEOUT_MS`) |
| Prerequisites | doctor | `doctorRun()`, `doctorResults()`, `toolsStatus()` (slot) |
| Agents & Models | Default agent model | `defaultModel` (`AGENT_MODELS`) |
| Agents & Models | Max turns per run | `maxTurns` (blank ⇒ undefined = unlimited) |
| Agents & Models | Sleep idle agents after | `idleHibernateMinutes` (0 = never; `DEFAULT_IDLE_HIBERNATE_MINUTES`) |
| Agents & Models | Compact at most every | `contextTrigger.compact.everyMs` (minutes in the UI; `DEFAULT_CONTEXT_TRIGGER`) |
| Agents & Models | Compact once context passes | `contextTrigger.compact.minContextPct` (0 = cadence only) |
| Agents & Models | …or, on a 1M window, passes | `contextTrigger.compact.minContextPctLargeWindow` |
| Agents & Models | AI engines / keys | `providerBaseUrls`, `providerDefaultModels`, `providerKeySet/Has/Clear` (slot) |
| Autonomy | Autonomous or ask-first | `autoMode` |
| Autonomy | Floor token budget | `costCapTokens` |
| Autonomy | Circuit breaker: enabled, hard stop, token velocity, repeated-tool, error-storm | one `circuitBreaker` object patch (spread the old one — it has keys the form does not show) |
| Connections | Public URL | `publicUrl` (+ `resolvePublicUrl`/`isStable`/`describePublicUrl`) |
| Connections | Issue tracker | `issueHost` |
| Connections | Auto-merge ready PRs | `prAutoMerge` |
| Connections | Slack: transport (events/socket), app token, signing secret, bot token, allowed user ids, channel id, port, proactive posting | `slack*` keys + `slackSetConfig()`, `slackStart/Stop/Status()` |
| Connections | Telegram: enabled, bot token, chat id | `telegram*` + `telegramSetConfig/Start/Stop/Status()` |
| Connections | Webhook triggers (secret, mode) | store `webhookTriggers`/`setWebhookTriggers`, `triggersApi()` (slot) |
| Connections | MCP defaults / integrations | `mcpDefaults` (slot) |
| Voice | Free Flow on, Groq API key, model | `freeflowEnabled`, `groqApiKey`, `freeflowModel` + `freeflowSetConfig()`; store `setFreeflowEnabled`/`setHasGroqKey` |
| Voice | OpenAI key (Realtime) | `providerKeySet()`; store `hasOpenAiKey`/`setHasOpenAiKey` |
| Voice | Idle auto-disconnect | `realtimeIdleDisconnectMs` (0 = never) |
| Memory | Cross-session recall | `semanticMemory` |
| Memory | Condenser: enabled, interval, byte %, section trigger, recent keep, min bytes, fallback engine, per-engine models | `reflect*` (8 keys; `CONDENSE_VERIFIED` gates the engine list) |
| Memory | Knowledge graph | `knowledgeGraph.enabled`; `kgStatus()`, `kgAddFiles()` |
| Memory | Agent meta | `hiveUpdateAgentMeta()` |
| — | copy buttons | `copyToClipboard()` |

**Onboarding** — 7 steps: `persona → welcome → home → orchestrator → repos → permissions → done`.
Calls: `chooseFolder()`, `ensureHarnessHome()`, `setLoginItem()` (reconcile to the OS return, do
not trust the local state), `setNotifications()`, `openExternal()`, and ONE final
`updateConfig({ onboardingComplete, audience, harnessHome, registeredRepos, autoMode, godProvider, godModel, telemetryEnabled })`.
`audience` picked on step 1 drives plain-vs-technical copy on every later step (`plain` flag).
Guards to keep: whitespace-only home is rejected and bounces to `home`; next is disabled on
`persona` until an audience is chosen; the wizard scrolls (step 2 is taller than a 1080p window).

## 2b. Directories (scope add) — the exact pixel behaviour to preserve

`CommandCenterPanel.tsx` L1135–1157, `<Section title="DIRECTORIES">`:
- Rows are `config.registeredRepos`, read with `getConfig()` on mount (NOT threaded from a prop).
- Empty state: "No registered repos."
- Per row: the full path (`word-break: break-all` — these are long), a terminal icon button
  (`openTerminalAt(path)`, "Open in Terminal.app"), and a **confirm-armed** delete
  (`IconDelete`, confirm label "remove project").
- Delete is `repos.filter(...)` + `updateConfig({ registeredRepos: next })`, optimistic, and the
  catch is a deliberate no-op. **It only drops the quick-pick — agents already working in that
  folder keep their cwd**, and the tooltip says so. Keep that sentence; it is the whole reason
  the control is safe to offer.
- Add (my addition, mirroring `AddAgentModal.registerProject` L313–329): `chooseFolder()`, then
  `[p, ...repos.filter(r => r !== p)]` — prepend and dedupe, most-recent-first. **Adopt the
  returned `updated.registeredRepos`, not your local `next`**: `src/main/config.ts` L662–666
  expands `~` when it persists, so a typed `~/dev/foo` stays literal in renderer state otherwise
  and rides along into a spawn.

## 3. Screens

```
SETTINGS  (modal, ~1040×720, hairline border, 8px radius)
┌──────────────────────────────────────────────────────────────┐
│  Settings                                          ⌘K   [×]  │
├───────────────────┬──────────────────────────────────────────┤
│ ⌕ Search settings │  General                                 │
│                   │  ─────────────────────────────────────   │
│ ▸ General         │  Home folder                             │
│   Prerequisites   │  ┌────────────────────────┐              │
│   Agents & Models │  │ ~/HarnessAgents        │ [Change…]    │
│   Autonomy…       │  └────────────────────────┘              │
│   Connections     │  Boss name        [ Michael          ]   │
│   Voice           │                                          │
│   Memory & Know.  │  Environment                             │
│                   │  Keep Mac awake while agents run   [ ●]  │
│ ───────────────   │  Explain things simply             [○ ]  │
│ Appearance        │                                          │
│  ○ Light          │  Danger zone                             │
│  ● Dark           │  ⚠ Reset & start over        [ Reset ]   │
│  ○ System         │     click again to confirm (8s)          │
│ Interface         │                                          │
│  ○ Pixel ● Modern │                                          │
└───────────────────┴──────────────────────────────────────────┘
Search active → the left nav collapses to matching sections and the pane
becomes a flat result list (label, section › group, hit highlighted);
Enter/click switches section and flashes the row.
```

Row grammar (one component, four variants): `label + optional help line` on the left, control
right-aligned; `Switch` / `Input` / `Select` / `Button`. Groups are a 13px medium heading + hairline.

```
ONBOARDING  (fullscreen, centred 560px column, no chrome)
┌──────────────────────────────────────────────────────────────┐
│                      ●━━●━━○━━○━━○                           │
│                    Step 1 of 4 · Harness home                │
│                                                              │
│   Where should Office keep its agents and their memory?      │
│                                                              │
│   ┌──────────────────────────────────┐                       │
│   │ ~/HarnessAgents                  │   [ Choose folder ]   │
│   └──────────────────────────────────┘                       │
│   ⚠ Pick a harness home folder first.                        │
│                                                              │
│                                   [ Back ]  [ Next     → ]   │
└──────────────────────────────────────────────────────────────┘
```

## 4. shadcn primitives + DESIGN-MODERN constraints

Primitives (from `modern/components/ui`; `npx shadcn@latest add <name>` if missing, never
hand-rolled): `dialog`, `input`, `textarea`, `label`, `switch`, `select`, `radio-group`
(appearance + interface), `checkbox`, `button`, `separator`, `card`, `tabs`, `command` (the
search palette), `scroll-area`, `badge`, `tooltip`, `dropdown-menu`, `skeleton`.
Icons: `lucide-react` at `size-4`, `size-3.5` in the dense directory/row lists.

Constraints I have to build to, from `docs/DESIGN-MODERN.md`:
- **Zero `--cth-*` and zero inline `style=`** — the pixel Settings is ~all inline styles, so this
  is a rewrite, not a port. Utilities only; a `dark:` utility is a smell (the value belongs in
  `modern/tokens.css`).
- Control height `h-8` (32px), page gutter 24px, card padding 16px, 8px between rows, 24px
  between sections, `--radius: 8px`, 1px `--border` hairlines and **no shadow on a card**.
- 13px UI default, 500 weight for labels and active nav; nothing bold, nothing uppercase — so the
  pixel section headings (`DIRECTORIES`, `DANGER ZONE`) lose their caps.
- `Switch` for instant-effect toggles, `Checkbox` only for staged ones. Every Settings toggle here
  writes immediately ⇒ all `Switch`. Onboarding's permission opt-ins are staged until Finish
  ⇒ `Checkbox`.
- One primary `Button` per view. Danger zone and repo-removal use `destructive`, which is also the
  only place `--destructive` may appear.
- `Skeleton` while `getConfig()`/`kgStatus()` resolve — never a spinner over existing content.

## 5. Open items

- **'system' appearance — SETTLED (god, MD-87 system msg): ship Light/Dark, leave the slot.**
  The `matchMedia` follow in `design/theme.ts` is Orcun's, optional in MD-84 addendum 3. Build
  the `RadioGroup` over `useAppTheme()`/`setAppTheme()` with two options and the third position
  reserved; **if MD-84 lands 'system', wiring it is one added option, not a redesign** — so keep
  the control driven by the theme module's own union type rather than a locally spelled
  `'light' | 'dark'`, and the extra state arrives for free. Do NOT edit `design/theme.ts`.
- **Slot mechanism.** If `modern/nav.ts` has no way to register a foreign section, the
  not-my-area list in §1 renders as inline placeholders and I will say so in the report.
- **`costCapUsd`** was a dead key (no renderer reader or writer). MD-115 removed it outright —
  config schema, preload/store mirrors, the breaker's $-arm and this exemption — so the budget the
  UI shows (`costCapTokens` + `agentTokenCaps`) is now the only one the breaker can trip on.
