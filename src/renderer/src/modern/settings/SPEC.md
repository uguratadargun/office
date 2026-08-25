# MD-87 — modern/settings + modern/onboarding (read-only prep spec)

Source read at `85787b0c`: `components/SettingsModal.tsx` (2838 L), `OnboardingWizard.tsx` (855 L),
`OfficeThemePicker.tsx`, `@shared/settingsSearch.ts`, `store/config.ts`.
Ownership: everything below lives under `modern/settings/` and `modern/onboarding/`. Nothing outside.

## 1. Judgement calls (flag now, cheap to change later)

- **Coverage.** `HarnessConfig` has **67 top-level keys**; `SETTINGS_INDEX` has **42 entries**
  (MD-71's "41 of 187" counts nested leaves — `circuitBreaker.*`, `contextTrigger.*`,
  `webhookTriggers[].*`, per-provider `providerBaseUrls`/`providerDefaultModels`, per-server
  `mcpDefaults`). I will index **every user-facing leaf**, not every key: 11 keys are internal
  state, not settings (`onboardingComplete`, `audience`, `recentHives`, `opsStandupSeeded`,
  `heartbeatSeeded`, `triggersMigratedV1`, `autoDeliveryPausedAgents`, `agentTokenCaps`,
  `defaultCommand` (read by AddAgentModal, written by nobody), `costCapUsd` (no renderer reader OR writer) and the three deprecated
  `webhook{Enabled,Secret,Port}`). Indexing those would produce results that navigate to a field
  that does not exist. **Default I recommend: index the leaves, and add a test that fails when a
  new user-facing key lands unindexed** (derive from a source-of-truth key list, so the index
  cannot silently go stale the way the hand-written one did).
- **Search is a real component here, not a filter.** Pixel search filters the nav to matching
  sections and highlights label hits; it does NOT scroll to the field. In modern I will make a
  ⌘K-style command palette over the same index that switches section *and* scrolls/flashes the
  row — needs each row to carry a stable `id`, which is the one structural difference from pixel.
- **Appearance is NEW.** There is no light/dark anywhere in the pixel app today (`grep`:
  zero `prefers-color-scheme`, `data-theme`, `darkMode`). `--cth-*` in `design/tokens.css` is a
  single fixed palette. Light/dark/system is therefore a modern-only setting; it needs a new
  persisted key. **I will not add a main-process key unilaterally** — see §5.
- **`ui.mode` toggle**: no `uiMode` key exists yet either. MD-84 owns it; I only polish the
  control and consume whatever key/registry MD-84 lands. Blocked on that, not on me.
- **Not my area** (present in pixel Settings but owned elsewhere): `SetupPanel` (Prerequisites /
  doctor), `AiEnginesSettings`, `McpDefaultsSettings`, `IntegrationsRegistry`, `UpdatesSection`,
  `RealtimeDevicePicker`/`CostHud`, the triggers panel (`contextTrigger`, `orgTrigger`,
  `webhookTriggers`), `embeddingModel` (lives in `MemoryPanel`). I will render **slots** for these
  and expect the owning agent to fill them; if MD-84's registry has no slot concept I will inline
  a placeholder and say so.

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
| General | Danger zone · Reset & start over | `resetAll()` + `clearLocalState()`, armed (`ARM_TIMEOUT_MS`) |
| Prerequisites | doctor | `doctorRun()`, `doctorResults()`, `toolsStatus()` (slot) |
| Agents & Models | Default agent model | `defaultModel` (`AGENT_MODELS`) |
| Agents & Models | Max turns per run | `maxTurns` (blank ⇒ undefined = unlimited) |
| Agents & Models | Sleep idle agents after | `idleHibernateMinutes` (0 = never; `DEFAULT_IDLE_HIBERNATE_MINUTES`) |
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

## 4. shadcn primitives needed (from `modern/components/ui`, `npx shadcn add` if missing)
`dialog`, `tabs` (or a plain nav list), `input`, `label`, `switch`, `select`, `button`,
`separator`, `command` (search palette), `scroll-area`, `alert`, `badge`, `tooltip`,
`radio-group` (appearance), `progress` (onboarding steps), `card`.

## 5. Open question for god (does not block phase 1)
Appearance (light/dark/system) needs a persisted key and there is none. Options: (a) MD-84 adds
`ui: { mode, theme }` alongside `ui.mode` — cleanest, one main-process touch, one owner;
(b) I add `appearance?: 'light'|'dark'|'system'` to `HarnessConfig` + `src/main/config.ts`, which
is the main-process change the card told me to flag; (c) renderer-only `localStorage`, no main
change, but it does not survive a reinstall and is invisible to the rest of the app.
**Recommended: (a)** — appearance and `ui.mode` are the same setting family and should not be
owned by two agents. If MD-84 ships without it, I fall back to (b) and say so in the report.
