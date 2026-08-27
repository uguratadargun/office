import { app } from 'electron';
import type { UiConfig } from '../shared/uiMode';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import {
  autoModeFlagForProvider,
  defaultCommandForProvider,
  inferAgentProvider,
  providerPreset,
  type AgentProvider
} from '../shared/agentProvider';
import { defaultMcpDefaults } from '../shared/mcpCatalog';
import { DEFAULT_IDLE_HIBERNATE_MINUTES, DEFAULT_GOD_IDLE_HIBERNATE_MINUTES } from '../shared/hibernate';
import { DEFAULT_CLEAR_ON_DONE } from '../shared/clearThread';
import { DEFAULT_INBOX_NUDGE_DEBOUNCE_SECONDS } from '../shared/inboxNudge';
import { expandTilde, normalizeHiveHome } from './fs';
import type { IntegrationRecord } from '../shared/integrations';
import {
  DEFAULT_CONTEXT_TRIGGER,
  compactRuleNeedsMigration,
  migrateCompactRule,
  DEFAULT_ORG_TRIGGER,
  DEFAULT_TRIGGER_MODE,
  DEFAULT_WEBHOOK_SCHEMA,
  type ContextTriggerConfig,
  type OrgTriggerConfig,
  type WebhookTrigger
} from '../shared/triggers';

/** A recurring auto-dispatched mission fired on an interval by the scheduler. */
export interface ScheduledMission {
  id: string;
  label: string;
  intervalMs: number;
  to: string;
  body: string;
  enabled: boolean;
  /** When true, the scheduler asks the renderer to compact live terminals when
   *  this mission fires — but only agents whose context has filled past the bar
   *  in `contextTrigger.compact` (60% by default, 40% on ~1M-token windows), so
   *  small/idle sessions are left alone instead of compacting on every tick.
   *
   *  This gate used to be described here but was never actually implemented: every
   *  live agent was compacted on every tick. It is real now, and the bars live in
   *  `ContextTriggerConfig` where the operator can edit them, so do not restate
   *  the numbers anywhere else — they will drift. */
  autoCompact?: boolean;
  lastFiredAt?: number;
  /** Mission flavor. Absent ⇒ 'dispatch' (the classic interval-dispatch mission,
   *  e.g. the ops standup). 'heartbeat' (Lane A #1) is a context-aware beat: it
   *  observes live floor state, re-engages a quiet god, and ticks the circuit
   *  breaker — armed with an adaptive cadence, not a fixed setInterval. */
  kind?: 'dispatch' | 'heartbeat' | 'compact';
  /** Heartbeat only: a floor is "quiet" when no tracked signal (log.jsonl mtime,
   *  inbox/outbox mtimes, any PTY output) has moved in this many ms. Default
   *  ~5 min. NOT derived from registry.status (which never transitions in main). */
  quietThresholdMs?: number;
}

/** The built-in hourly ops standup: god reviews who's doing what + whether tasks
 *  are on track and agents are running, and every terminal's context is compacted.
 *  Shipped enabled by default; users can toggle it off in the Command Center. */
export const OPS_STANDUP_MISSION: ScheduledMission = {
  id: 'ops-standup',
  label: 'Hourly ops standup',
  intervalMs: 3_600_000,
  to: 'god',
  body:
    'Hourly ops standup. Review every agent: who is doing what, and confirm each ' +
    'is still running (not stalled or idle-stale). Check the task board — are ' +
    'in-flight tasks on track, and is anything blocked or unowned? Flag stale ' +
    'agents and at-risk tasks, and keep the board accurate. (As part of this ' +
    "standup each working agent is asked to summarise its current task and the " +
    'next step, then compact and resume from the same point — so terminal ' +
    'contexts stay bounded without losing work. The compaction is queued and ' +
    'runs when an agent is idle, so it never interrupts work mid-step.)',
  enabled: true
  // NO autoCompact. Compaction belongs to contextTrigger.compact and nothing else.
  // This flag used to live here as well, which meant a default install asked for
  // compaction on TWO cadences — hourly from this standup and 2-hourly from the
  // trigger — the exact "two controls that disagree" the maint-1 retirement below
  // was written to end. The standup's own prose still describes compaction, and
  // that stays true: the trigger does it, just not on this mission's clock.
};

/** The built-in heartbeat (Lane A #1). A context-aware beat that, each tick,
 *  observes live floor state and — only when the floor has gone quiet — drops a
 *  digest into god's inbox and (if god's PTY is genuinely idle) nudges it to
 *  re-engage anyone stalled. The same beat ticks the circuit breaker.
 *
 *  Shipped DISABLED by default (opt-in): unlike the standup, which only sends a
 *  hive message, the heartbeat types into god's PTY, so the user turns it on
 *  explicitly in the Command Center once they want active re-engagement.
 *  `intervalMs` is the normal-cadence base; the scheduler derives a tighter beat
 *  when an agent looks stuck and a slower one right after a re-engage. */
export const HEARTBEAT_MISSION: ScheduledMission = {
  id: 'heartbeat',
  label: 'Floor heartbeat',
  intervalMs: 120_000,
  to: 'god',
  body:
    'Floor heartbeat: the team has gone quiet. Review the digest in your inbox, ' +
    're-engage anyone stalled or blocked, and keep the board accurate — or rest ' +
    'if the work is genuinely done.',
  enabled: false,
  kind: 'heartbeat',
  quietThresholdMs: 300_000
};

/** The dedicated auto-compact MAINTENANCE schedule (maint-1). DECOUPLED from the
 *  ops standup so editing/replacing a standup can never silently disable
 *  compaction again (the bug this fixes). It fires ONLY the auto-compact signal —
 *  `kind:'compact'` makes syncMissions skip the hive.send dispatch (empty to/body).
 *  Shipped DISABLED (v0.3.4 founder decision): scheduled compaction is opt-in.
 *  Turn it on in Settings → General or the Schedules tab; the Schedules warning
 *  panel explains the risk of leaving it off for long-running agents. It is the
 *  SINGLE source of truth for compaction, and it's persistent: deleting it makes
 *  it reappear DISABLED.
 *  Existing installs keep whatever enabled state the user already has
 *  (compactMaintenanceSeeded guards re-seeding). */
export const COMPACT_MAINTENANCE_MISSION: ScheduledMission = {
  id: 'compact-maintenance',
  label: 'Auto-compact (maintenance)',
  // 30m, matching DEFAULT_CONTEXT_TRIGGER.compact.everyMs. The two cadences must
  // agree: this mission is the schedule half of the same behaviour the context
  // trigger now owns, and a stale seed here would keep compacting agents on the
  // old rhythm no matter what the trigger says. It matters more than it looks:
  // `bootstrapHiveServices` RETIRES this mission by copying its `intervalMs` into
  // `contextTrigger.compact.everyMs`, so a 2h seed surviving here would write the
  // old cadence straight back over the migrated one.
  intervalMs: 1_800_000,
  to: '',
  body: '',
  enabled: false,
  autoCompact: true,
  kind: 'compact'
};

/** The 1h cadence `compact-maintenance` was seeded with before Triggers doubled
 *  it. `migrateTriggersV1` bumps only missions still sitting on this EXACT value,
 *  so an interval the user tuned by hand is left exactly where they put it. */
const LEGACY_COMPACT_MAINTENANCE_INTERVAL_MS = 3_600_000;

/** The 2h cadence `compact-maintenance` carried between the Triggers release and
 *  MD-162. `migrateCompactCadenceV2` bumps only missions still sitting on this
 *  EXACT value, for the same reason as the constant above. */
const V1_COMPACT_MAINTENANCE_INTERVAL_MS = 7_200_000;

/** Circuit-breaker thresholds (Lane A #6.6b). The breaker runs inside the
 *  heartbeat beat, so it only ticks when the heartbeat is enabled. Trip
 *  conditions are behavioral by default; the only budget arm is `costCapTokens`
 *  (plus the per-agent `agentTokenCaps`), unset by default. Defaults
 *  are deliberately conservative and steer-first — `hardStop` is OFF unless the
 *  user opts in, so the breaker never auto-kills a healthy long-runner. */
export interface CircuitBreakerConfig {
  /** Master switch for breaker evaluation within the beat. Default true. */
  enabled?: boolean;
  /** Allow the top of the ladder (kill PTY + archive). Default false = the
   *  breaker may steer/constrain but never hard-stops until the user opts in. */
  hardStop?: boolean;
  /** Consecutive identical tool calls (same name+input) before tripping. */
  repeatedToolLimit?: number;
  /** Consecutive api_error / retry events before tripping. */
  errorStormLimit?: number;
  /** Output-token velocity (tokens/min, diffed across beats) before tripping. */
  tokenVelocityPerMin?: number;
}

/** Enterprise Knowledge Graph (multimodal context store + agent access tool).
 *  The user ingests their own documents/images/PDFs; agents query them on demand
 *  via the `kg` CLI. Opt-in like the heartbeat/Slack features — `enabled` gates
 *  everything (no env injected, no prompt line, no store touched when off). See
 *  docs/design/knowledge-graph.md. */
export interface KnowledgeGraphConfig {
  /** Master switch. Default false = zero behaviour change (the feature is dark). */
  enabled?: boolean;
  /** Override the store location. Unset = <userData>/knowledge. */
  rootPath?: string;
}

export interface HarnessConfig {
  /** Has the user completed the first-run onboarding? */
  onboardingComplete: boolean;
  /** Self-identified audience picked on the first onboarding screen. Drives the
   *  copy register everywhere onboarding explains itself: 'technical' shows CLI /
   *  flag lingo, 'non-technical' explains each concept in plain language. Unset =
   *  not yet chosen (treated as technical for any incidental copy). */
  audience?: 'technical' | 'non-technical';
  /** Folder where the harness keeps its own state (agent metadata, logs). */
  harnessHome: string | null;
  /** Recently-opened hive home folders (most-recent first), surfaced by the
   *  launch-time hive picker. Maintained by writeConfig whenever harnessHome is
   *  set (onboarding finish, changeHome). Capped to a handful. */
  recentHives?: string[];
  /** Folders the user registered during onboarding (used as quick-picks). */
  registeredRepos: string[];
  /** Which CLI backs the ISSUES panel: `gh`, `glab`, or per-repo detection from
   *  the origin remote. Default 'auto'. */
  issueHost?: 'auto' | 'github' | 'gitlab';
  /** Opt-in: when a PR becomes ready, arm the host's auto-merge (`gh pr merge
   *  --auto`). Branch protection decides; we hold no merge rule. Default off —
   *  the human merges from the Command Center. */
  prAutoMerge?: boolean;
  /** Public address for the Slack + webhook bridges. Blank = an ephemeral
   *  tunnel whose URL changes every restart (and silently breaks whatever the
   *  user pasted into Slack/GitHub). A full URL = their own endpoint, no tunnel
   *  started. A bare host = a reserved tunnelmole subdomain. */
  publicUrl?: string;
  /** Display name of the boss / orchestrator. Unset or blank falls back to
   *  DEFAULT_BOSS_NAME — resolve it with `bossName()` from @shared/bossName,
   *  never by inlining a default here. The agent ID stays 'god'. */
  bossName?: string;
  /** When true, new agents are spawned with --permission-mode bypassPermissions. */
  autoMode: boolean;
  /** The command we run when spawning a new agent. */
  defaultCommand: string;
  /** Default model for newly spawned agents (e.g. 'claude-sonnet-4-6[1m]'); unset = CLI default. */
  defaultModel?: string;
  /** Reasoning effort every newly spawned agent starts on, unless it picks its own
   *  in the hire dialog. Unset = no `--effort` flag at all, i.e. whatever the CLI
   *  itself does — which is the shipped default, so this key changes nothing until
   *  an operator sets it. Engines with no effort flag ignore it, and a level that
   *  is not valid for the chosen engine is dropped rather than spliced into a
   *  command line that never had that flag (`isValidEffort`). */
  defaultEffort?: string;

  /** Which provider powers the GOD orchestrator ("Michael"). The persona is
   *  constant; only its engine is selectable. Default 'claude'. Eligible providers
   *  are those that can receive inbox (claude/codex/antigravity/qwen). */
  godProvider?: AgentProvider;
  /** The model GOD runs on. Unset falls back to the provider preset's
   *  `recommendedOrchestratorModel`, then MODEL_GOD. Default 'claude-opus-4-8'. */
  godModel?: string;
  /** Per-server consent state for the default MCP bundle, keyed by catalog id.
   *  Seeded from MCP_CATALOG (safe-readonly ON, write/secret OFF); the user flips
   *  these in Settings. A server is wired into an agent only when enabled here. */
  mcpDefaults?: { [id: string]: { enabled: boolean } };
  /** Enable semantic memory (MemPalace CLI). No-op if mempalace isn't installed. */
  semanticMemory: boolean;
  /** Embedding model for the palace: lightweight 'minilm' or multilingual 'embeddinggemma'. */
  embeddingModel: 'minilm' | 'embeddinggemma';
  /** Recurring auto-dispatch missions handled by the scheduler. */
  missions?: ScheduledMission[];
  /** One-time guard: has the built-in hourly ops standup been seeded into an
   *  existing install's missions? Prevents re-adding it after a user deletes it. */
  opsStandupSeeded?: boolean;
  /** One-time guard for the built-in heartbeat mission (mirrors opsStandupSeeded
   *  so a user who deletes the heartbeat doesn't get it re-added every boot). */
  heartbeatSeeded?: boolean;
  /** maint-1 guard for the dedicated auto-compact maintenance mission. UNLIKE the
   *  two above, this does NOT suppress re-add forever: once seeded (flag set), a
   *  later delete makes the mission reappear DISABLED on next boot (compaction is
   *  required, so it's never silently lost — only user-disabled). */
  compactMaintenanceSeeded?: boolean;
  /** Hard TOKEN ceiling (total tokens across all active agents) before the
   *  breaker trips. The user-facing budget — set in Settings. Opt-in like the
   *  $-cap; total = input + output + cacheRead + cacheCreation, summed across the
   *  floor (the biggest token spender is blamed). */
  costCapTokens?: number;
  /** Per-agent total-token ceiling, keyed by agent id. When an agent's own total
   *  tokens exceed its cap the breaker trips that agent alone (independent of the
   *  floor budget). Set from each agent's card in the Command Center. */
  agentTokenCaps?: Record<string, number>;
  /** Agent ids whose automatic inbox/queue delivery is paused. Pending messages
   *  stay durable until the operator explicitly resumes delivery. */
  autoDeliveryPausedAgents?: string[];
  /** Passed to every spawned agent as `--max-turns <n>` when set; unset = no cap
   *  (Claude Code's default). A coarse runaway guard independent of the breaker. */
  maxTurns?: number;
  /** Max concurrent god-triggered ephemeral Slack workers; extra spawn-requests
   *  wait in the queue (natural backpressure, a resource backstop). Default 4. */
  maxConcurrentWorkers?: number;
  /**
   * Raise ONE alarm on the Ask Me board (and the human's Telegram) when spend
   * during the quiet hours crosses this many dollars. Default 5; 0 turns it off.
   *
   * A circuit breaker stops a runaway agent. It does not notice a floor that
   * quietly cost forty dollars between 23:00 and 06:00 with nobody awake — the
   * measured MD-164 case — because nothing was runaway, there was just nobody to
   * see it. This is the budget half: a number the human sets and gets told about.
   */
  nightSpendAlarmUsd?: number;
  /** The night this alarm last fired (local `YYYY-MM-DD` of the evening it
   *  started). Persisted so once-per-night survives a restart; written by main,
   *  never edited by hand. */
  nightSpendAlarmLastKey?: string;
  /**
   * How many agents the orchestrator may have WRITING CODE at once (MD-132).
   *
   * A POLICY, not an enforcement. `maxConcurrentWorkers` above is a resource
   * backstop main applies itself by holding spawn-requests in a queue; this one
   * is a number the human sets and god obeys, because "is this agent coding"
   * is a judgement about the work, not a property main can see from a PTY. So
   * it is not gated anywhere in main — it is published to god twice (the roster
   * injected into its turns, and fleet.json on disk) and god does the rationing.
   *
   * Stated plainly so nobody later mistakes it for a limiter and wires a
   * silent block onto it: exceeding this number is possible, and when it
   * happens it is god ignoring the policy, not the app failing to stop it.
   */
  maxCodingWorkers?: number;
  /** Minutes an ephemeral worker may produce NO output before the reaper kills it
   *  — idle-based, never wall-clock, so an actively-working worker is never reaped.
   *  Default 20. */
  workerIdleTimeoutMinutes?: number;
  /** Minutes a NON-god agent may sit with no terminal activity, no in-flight card
   *  and an empty inbox before its session is shut down and the agent is parked
   *  'sleeping' — it is respawned automatically the moment work arrives. Idle-based
   *  like workerIdleTimeoutMinutes, never wall-clock. 0 = off. Default 10. */
  idleHibernateMinutes?: number;
  /** Seconds an agent is nudged about new inbox mail AT MOST once, however many
   *  messages arrive — a burst of N costs one wake instead of N, and the single
   *  nudge names the count. Held mail is never dropped: it is nudged with the
   *  rest as soon as the window closes. 0 = off (nudge per message, pre-MD-163).
   *  Default 60. */
  inboxNudgeDebounceSeconds?: number;
  /** The ORCHESTRATOR's own idle window, in minutes. Separate from the worker one
   *  because parking the agent every other agent reports to is a bigger call than
   *  parking a worker: it may only sleep once every non-god session is asleep, its
   *  cards are clear and no mail is waiting that would wake it (see
   *  `shouldHibernateGod`). 0 = never sleep the orchestrator. Default 30. */
  godIdleHibernateMinutes?: number;
  /** Retire an agent's conversation when a card assigned to it reaches `done` and
   *  it has nothing else in flight — the next card starts from the harness prefix
   *  and memory.md instead of a day of compaction summaries. See
   *  `@shared/clearThread` for every reason a thread is KEPT. Default true;
   *  false leaves every thread to grow for the life of the hive (pre-MD-175). */
  clearOnDone?: boolean;
  /** Registered integrations (Phase 2) — labeled REST endpoints workers reach through
   *  the loopback secret broker. METADATA ONLY: each record carries a `secretRef`
   *  handle, never the secret value (secrets live encrypted in a separate file via
   *  Electron safeStorage — see src/main/integrations.ts). Default []. */
  integrations?: IntegrationRecord[];
  /** Default per-worker TOTAL-token cap (input+output+cache) applied to every
   *  god-triggered ephemeral worker; a worker's own spawn-request `tokenCap`
   *  overrides it. When the effective cap is exceeded the worker is reaped (its
   *  committed work preserved) and god is informed. This is PLUMBING for a later
   *  budget feature: per the human directive there is NO per-worker cap today, so
   *  the default is 0 = UNLIMITED — the mechanism is wired but never throttles
   *  unless someone explicitly sets a positive cap (per request or here). */
  defaultWorkerTokenCap?: number;
  /** Circuit-breaker thresholds (Lane A #6.6b). Unset = conservative defaults. */
  circuitBreaker?: CircuitBreakerConfig;
  /** Enterprise Knowledge Graph (multimodal context for agents). Default OFF. */
  knowledgeGraph?: KnowledgeGraphConfig;
  /** Fire native desktop notifications on agent lifecycle events (idle finish / waiting for input). */
  notifications?: boolean;
  /** Opt-in "strong keep-alive": while ≥1 agent PTY is live, escalate the power
   *  blocker from 'prevent-app-suspension' to 'prevent-display-sleep', which on
   *  macOS also blocks TRUE system sleep (lid-close/idle) so scheduled missions
   *  and terminals keep firing ON TIME while away — at a battery cost (best on
   *  AC). Default OFF: the honest default is "survive sleep + catch up once on
   *  resume" (see the powerMonitor 'resume' handler), not "stay awake". */
  strongKeepalive?: boolean;
  /** Auto-update from GitHub releases (v0.3.4). Default ON. Packaged builds
   *  check on boot + every ~6h, download in the background, and show a
   *  "restart to update" toast — installation is always user-initiated. OFF
   *  disables checking entirely. (Mirrored in preload + renderer config.) */
  autoUpdate?: boolean;
  /** Multi-window "floors": expose a New Floor action that opens additional
   *  windows, each an independent office with isolated renderer state (its own
   *  session partition) and per-window PTY routing. ON by default (v0.3.4: code
   *  and comment disagreed; the shipped behavior — enabled — wins) —
   *  the window/PTY-ownership plumbing is always active and single-window-safe,
   *  but the New Floor entry points (app menu item + IPC) only appear when on.
   *  The on-disk hive (god orchestration under harnessHome) stays process-global;
   *  floors share it. */
  multiWindow?: boolean;
  /** Shell preferences. `ui.mode` picks the front-end the renderer boots: the
   *  original pixel UI or the modern one under src/renderer/src/modern/.
   *  Default 'modern' (MD-124) — see @shared/uiMode, which owns the default;
   *  DEFAULTS below deliberately has no `ui` key, so there is one source of
   *  truth and an existing `ui.mode: 'pixel'` keeps the classic pixel office.
   *  Changing it reloads the window;
   *  nothing in the main process branches on it. Light/dark is NOT here —
   *  design/theme.ts owns that for both UIs. */
  ui?: UiConfig;
  /** Terminal theme — mirrored into each agent's per-session Claude settings
   *  ("theme" key) at spawn so the TUI's truecolor palette matches. Scoped to
   *  harness agents only; the user's global Claude theme is never touched. */
  terminalTheme?: 'light' | 'dark';
  /** Anonymous product analytics (PostHog) — the exact events/properties are
   *  documented in TELEMETRY.md. Default ON (opt-out, like autoUpdate); builds
   *  without an injected key and environments with DO_NOT_TRACK set never send
   *  regardless of this flag. (Mirrored in preload + renderer config.) */
  telemetryEnabled?: boolean;
  /** Master flag for the TV-show office themes feature (Settings theme picker +
   *  destructive switch flow). Default false = the picker is hidden and the
   *  office renders as today (zero behavior change). */
  tvShowOffices?: boolean;
  /** Which office map/cast theme the pixel office renders. Only honored when
   *  `tvShowOffices` is on; otherwise the office theme is used. Unbuilt show
   *  themes fall back to 'office' in the loader. */
  officeTheme?: 'office' | 'friends' | 'brooklyn99' | 'siliconvalley' | 'got' | 'hogwarts';
  /** Per-CLI-provider local/self-hosted base URL (Ollama/LM Studio/vLLM, …) for the
   *  OpenCode/Crush/pi/qwen engines; applied at spawn (config-injection or proxy
   *  upstream). API KEYS are NOT stored here — they live write-only in the secret
   *  broker (integrations.ts), read MAIN-ONLY at spawn. */
  providerBaseUrls?: Partial<Record<AgentProvider, string>>;
  /** Per-CLI-provider default model slug, used to pre-fill the model picker. */
  providerDefaultModels?: Partial<Record<AgentProvider, string>>;
  /** Master toggle for the Slack → Michael's-queue integration. */
  slackEnabled?: boolean;
  /** Slack app signing secret (Basic Information → Signing Secret). Never logged. */
  slackSigningSecret?: string;
  /** Bot token (xoxb-…) — only needed if the bot ever replies; optional for now. */
  slackBotToken?: string;
  /** Restrict ingestion to one channel id; empty/undefined = any channel. */
  slackChannelId?: string;
  /** REQUIRED sender allowlist — the Slack user ids (comma/space separated)
   *  whose messages are ingested. The signing secret proves a request came from
   *  Slack, not from the owner, so this is the only thing standing between any
   *  workspace member and agents that run with approvals off. Blank ⇒ nothing is
   *  ever accepted and ingestion refuses to start (fail closed, like
   *  `telegramChatId`). */
  slackAllowedUserIds?: string;
  /** Local HTTP port the webhook server binds to (default 3847). Events API only —
   *  Socket Mode binds nothing. */
  slackPort?: number;
  /** Which transport carries Slack events in: 'events' (Events API over HTTP —
   *  needs a public URL and a tunnel) or 'socket' (Socket Mode over an outbound
   *  WebSocket — needs neither). Absent = 'events', so every existing install
   *  keeps the transport it is already configured for. */
  slackTransport?: 'events' | 'socket';
  /** Slack APP-LEVEL token (xapp-…, scope connections:write) — Socket Mode only.
   *  A credential like slackBotToken: main-only, never logged. */
  slackAppToken?: string;
  /** Opt-in: allow APP/VOICE-INITIATED proactive posting into Slack (e.g. the
   *  renderer's "queued" acknowledgement). DEFAULT OFF per the human directive
   *  "stop posting into Slack by default". This does NOT gate the Slack-ORIGIN
   *  done-reply round-trip (a user @-mention → task → result posted back to that
   *  thread) or an agent's own direct in-thread reply — those always stay on. */
  slackProactivePosting?: boolean;

  // ─── Telegram (remote control the office from one chat) ───────────────────
  /** Master toggle for the Telegram → Michael's-queue integration. */
  telegramEnabled?: boolean;
  /** Bot token from @BotFather. A credential like `slackBotToken`: main-only,
   *  never logged, never crosses IPC on the read path. */
  telegramBotToken?: string;
  /** The ONLY chat id whose messages are accepted. Non-optional in practice:
   *  with it blank nothing is ever ingested (fail closed). */
  telegramChatId?: string;

  // ─── Free Flow (voice dictation → message queue) ───────────────────────────
  /** Master toggle for Free Flow push-to-talk dictation. Default OFF: with it off
   *  the composer shows no mic button, no getUserMedia runs, and no Groq call is
   *  ever made (zero behavior change). */
  freeflowEnabled?: boolean;
  /** User-pasted Groq API key (the user supplies their own free key). Used ONLY in
   *  the main process for the Groq STT call; NEVER logged, and never crosses IPC
   *  for the request. Treated like `slackBotToken`. */
  groqApiKey?: string;
  /** Groq Whisper model id. Default 'whisper-large-v3-turbo' (fast, multilingual). */
  freeflowModel?: string;

  // ─── Realtime Michael (premium speech-to-speech voice orchestrator) ─────────
  /** True ONLY while a Realtime Michael voice session is live: the renderer
   *  session flips this on at start() (before getUserMedia) and off at stop().
   *  The main-process mic permission gate reads it so the Electron media
   *  permission is open EXACTLY while the voice loop holds the mic — never just
   *  because an OpenAI key exists (that key is shared with the CLI engines).
   *  Default off; absence ⇒ mic denied, mirroring `freeflowEnabled`. */
  realtimeVoiceEnabled?: boolean;
  /** How long (ms) a realtime voice session may sit with no voice activity before
   *  it auto-disconnects (the rt-9 idle guard). Default 180000 (3 min). 0 = never
   *  auto-disconnect on idle — the spend cap remains the runaway guard. The user
   *  tunes this in Settings → Realtime Michael. */
  realtimeIdleDisconnectMs?: number;

  // ─── Generic inbound webhook + status API (LEGACY, single-endpoint) ─────────
  // Superseded by `webhookTriggers`, which allows many endpoints over one server
  // and one tunnel. These three are kept because they are the MIGRATION SOURCE
  // (`migrateTriggersV1` folds them into a `WebhookTrigger`) and because the main
  // process still reads them until the server is rewired onto the new list.
  // Nothing new should be written here.
  /** @deprecated Use `webhookTriggers[].enabled`. */
  webhookEnabled?: boolean;
  /** App-generated shared secret callers echo in `x-md-webhook-secret`. Never
   *  logged, and never forwarded into the routed message/card/response.
   *  @deprecated Use `webhookTriggers[].secret` (one secret per endpoint, so
   *  revoking one caller never disturbs the others). */
  webhookSecret?: string;
  /** Local HTTP port the generic webhook server binds to (default 3849).
   *  @deprecated The port is a property of the shared server, not of any one
   *  trigger; `webhookTriggers` are multiplexed over it by id. */
  webhookPort?: number;

  // ─── Triggers (src/shared/triggers.ts owns every type here) ────────────────
  /** Auto-compaction / auto-clearing of agent terminal context. Both halves ship
   *  in DEFAULT_CONTEXT_TRIGGER; `readConfig` deep-fills them, because the
   *  top-level merge below is one level deep and a half-written sub-object would
   *  otherwise reach consumers with `undefined` thresholds. */
  contextTrigger?: ContextTriggerConfig;
  /** Inbound HTTP endpoints, one entry per caller. Replaces the legacy single
   *  webhook above; several coexist on one port, told apart by `id` in the path. */
  webhookTriggers?: WebhookTrigger[];
  /** Peer messaging between teammates' clone nodes. Persistence + UI only today —
   *  no transport service reads `apiKey` yet. */
  orgTrigger?: OrgTriggerConfig;
  /** One-time guard for `migrateTriggersV1` (legacy webhook → webhookTriggers,
   *  1h → 2h compact cadence). Set once the migration has run to completion. */
  triggersMigratedV1?: boolean;
  /** One-time guard for `migrateCompactCadenceV2` (the 2h/60%/40% compact rule
   *  moved onto the earlier 30m/25%/12% defaults). Separate from
   *  `triggersMigratedV1` on purpose: an install that already ran V1 must still
   *  get V2, and folding them into one flag would strand exactly the configs this
   *  migration exists for. */
  compactCadenceMigratedV2?: boolean;

  // ─── Memory reflection (the janitor's condense half) ───────────────────────
  /** Master toggle for the in-process MemoryReflector. Default on. */
  reflectEnabled?: boolean;
  /** How often to scan agent memory.md files for condensing (default 30 min). */
  reflectIntervalMs?: number;
  /** Condense when bytes exceed this percent of the 128 KB budget (matches the
   *  janitor's TRIGGER_PCT). DECIDED: 50. */
  reflectByteTriggerPct?: number;
  /** ...OR when `## ` section count exceeds this (AND bytes > floor). DECIDED: 50. */
  reflectSectionTrigger?: number;
  /** Newest K verbatim `## ` sections kept untouched on each condense. */
  reflectRecentKeep?: number;
  /** Never condense a file smaller than this; also the section-trigger byte floor.
   *  DECIDED: 16 KB. */
  reflectMinBytes?: number;
  /** Engine that condenses memory for agents whose OWN engine has no verified
   *  one-shot form. Unset means `claude`. Each agent whose engine DOES have one
   *  uses its own — this is only the fallback. */
  reflectCondenseProvider?: string;
  /** Per-engine condense model, keyed by provider id. An entry set to '' passes
   *  no model flag, so the engine uses whatever the user configured for it. */
  reflectCondenseModels?: Record<string, string>;
}

export {
  DEFAULT_MAX_CODING_WORKERS, MIN_MAX_CODING_WORKERS, MAX_MAX_CODING_WORKERS, maxCodingWorkers
} from '../shared/codingWorkers';
import { DEFAULT_MAX_CODING_WORKERS } from '../shared/codingWorkers';

const DEFAULTS: HarnessConfig = {
  onboardingComplete: false,
  harnessHome: null,
  recentHives: [],
  registeredRepos: [],
  issueHost: 'auto',
  prAutoMerge: false,
  publicUrl: '',
  autoMode: true,
  defaultCommand: 'claude',
  godProvider: 'claude',
  godModel: 'claude-opus-4-8',
  // Global default model for every agent that hasn't picked one explicitly — wins
  // over the role-based tiers (modelForRole) in the spawn handler, so all agents
  // (incl. god) default to Fable 5. A per-agent model choice still overrides it.
  defaultModel: 'claude-fable-5',
  // Seeded from the MCP catalog so the consent defaults never drift from it
  // (safe-readonly ON, write/secret OFF).
  mcpDefaults: defaultMcpDefaults(),
  maxConcurrentWorkers: 4,
  maxCodingWorkers: DEFAULT_MAX_CODING_WORKERS,
  workerIdleTimeoutMinutes: 20,
  idleHibernateMinutes: DEFAULT_IDLE_HIBERNATE_MINUTES,
  inboxNudgeDebounceSeconds: DEFAULT_INBOX_NUDGE_DEBOUNCE_SECONDS,
  godIdleHibernateMinutes: DEFAULT_GOD_IDLE_HIBERNATE_MINUTES,
  clearOnDone: DEFAULT_CLEAR_ON_DONE,
  integrations: [],
  defaultWorkerTokenCap: 0, // 0 = unlimited (human directive: NO per-worker cap)
  semanticMemory: true,
  embeddingModel: 'minilm',
  missions: [OPS_STANDUP_MISSION],
  notifications: false,
  strongKeepalive: false,
  autoUpdate: true,
  telemetryEnabled: true,
  multiWindow: true,
  tvShowOffices: false,
  officeTheme: 'office',
  slackEnabled: false,
  slackSigningSecret: undefined,
  slackBotToken: undefined,
  slackChannelId: undefined,
  slackAllowedUserIds: undefined,
  slackPort: undefined,
  slackTransport: 'events',
  slackAppToken: undefined,
  slackProactivePosting: false,
  telegramEnabled: false,
  telegramBotToken: undefined,
  telegramChatId: undefined,
  freeflowEnabled: true,
  groqApiKey: undefined,
  freeflowModel: 'whisper-large-v3-turbo',
  realtimeVoiceEnabled: false,
  realtimeIdleDisconnectMs: 180_000,
  webhookEnabled: false,
  webhookSecret: undefined,
  webhookPort: undefined,
  // Triggers. These three are the ONLY object/array defaults that get handed
  // straight back out of `readConfig` for a config that never persisted them, so
  // `withTriggerDefaults` re-copies them on every read — see the note there.
  contextTrigger: DEFAULT_CONTEXT_TRIGGER,
  webhookTriggers: [],
  orgTrigger: DEFAULT_ORG_TRIGGER,
  triggersMigratedV1: false,
  compactCadenceMigratedV2: false,
  // Memory reflection — preventive; nobody is over threshold today, so it sits
  // dark until an agent's memory crosses one of these (the verify gate is the
  // safety for the LLM step). Thresholds DECIDED by god 2026-06-06.
  reflectEnabled: true,
  reflectIntervalMs: 1_800_000,
  reflectByteTriggerPct: 50,
  reflectSectionTrigger: 50,
  reflectRecentKeep: 12,
  reflectMinBytes: 16_384,
  // Enterprise Knowledge Graph — opt-in; dark until the user enables it.
  // v0.3.4 fix: default OFF, matching the field's own documentation ("Default
  // OFF / dark until enabled") — the true default contradicted it. Existing
  // installs keep their persisted value.
  knowledgeGraph: { enabled: false }
};

function configPath(): string {
  return join(app.getPath('userData'), 'config.json');
}

/**
 * Deep-fill the trigger sub-objects, and hand back copies of them.
 *
 * TWO problems, one fix. First, the merge in `readConfig` is one level deep, so a
 * `contextTrigger` persisted by an older build (or by a `writeConfig` that
 * patched only `compact`) arrives missing sub-keys that DEFAULTS would have
 * supplied — the consumer then reads `undefined` where it expects a number and
 * the rule never fires. Second, that same shallow merge hands the literal
 * DEFAULT_CONTEXT_TRIGGER / DEFAULT_ORG_TRIGGER instances to every config that
 * didn't persist them, so one caller mutating what it read would rewrite the
 * defaults for the whole process — and for every config read afterwards.
 *
 * Every branch below therefore constructs a fresh object, including the
 * "nothing persisted" branch.
 */
function withTriggerDefaults(cfg: HarnessConfig): HarnessConfig {
  return {
    ...cfg,
    contextTrigger: {
      compact: { ...DEFAULT_CONTEXT_TRIGGER.compact, ...cfg.contextTrigger?.compact },
      clear: { ...DEFAULT_CONTEXT_TRIGGER.clear, ...cfg.contextTrigger?.clear }
    },
    orgTrigger: { ...DEFAULT_ORG_TRIGGER, ...cfg.orgTrigger },
    webhookTriggers: Array.isArray(cfg.webhookTriggers)
      ? cfg.webhookTriggers.map((t) => ({ ...t }))
      : []
  };
}

/** Set once `migrateTriggersV1` has run in THIS process. `writeConfig` reads
 *  before it writes, so without an in-memory latch the migration's own persist
 *  would re-enter `readConfig` and run the migration a second time before
 *  `triggersMigratedV1: true` ever reached disk. */
let triggersMigrationRan = false;

/**
 * Fold the pre-Triggers config shape forward, exactly once per install.
 *
 * Runs from `readConfig`, so it is complete before any consumer can observe the
 * config — there is no boot ordering to get wrong and no window in which half
 * the app sees the old shape. Two things move:
 *
 *   1. The single legacy webhook (`webhookEnabled`/`webhookSecret`) becomes one
 *      `WebhookTrigger` with the stable id `legacy`, so the caller that already
 *      holds that secret keeps working across the upgrade. Skipped when
 *      `webhookTriggers` is already populated — the user has moved on, and
 *      re-adding a synthesised entry would resurrect a revoked endpoint.
 *   2. The seeded `compact-maintenance` mission moves from the old 1h cadence to
 *      2h, but ONLY if it still reads exactly 1h. A user-chosen interval is a
 *      decision, not a stale default, and is left alone.
 *
 * Wrapped end-to-end in a try/catch: a config that is corrupt in some unrelated
 * way must still boot the app, and a migration is never worth a failed launch.
 */
function migrateTriggersV1(cfg: HarnessConfig): HarnessConfig {
  if (cfg.triggersMigratedV1 || triggersMigrationRan) return cfg;
  triggersMigrationRan = true;
  try {
    const next: HarnessConfig = { ...cfg, triggersMigratedV1: true };

    const legacySecret = typeof cfg.webhookSecret === 'string' ? cfg.webhookSecret.trim() : '';
    if (legacySecret && (cfg.webhookTriggers?.length ?? 0) === 0) {
      next.webhookTriggers = [
        {
          id: 'legacy',
          name: 'Default webhook',
          secret: legacySecret,
          enabled: cfg.webhookEnabled ?? false,
          mode: DEFAULT_TRIGGER_MODE,
          schema: DEFAULT_WEBHOOK_SCHEMA,
          createdAt: Date.now()
        }
      ];
    }

    const missions = Array.isArray(cfg.missions) ? cfg.missions : [];
    const stale = (m: ScheduledMission): boolean =>
      m?.id === COMPACT_MAINTENANCE_MISSION.id
      && m.intervalMs === LEGACY_COMPACT_MAINTENANCE_INTERVAL_MS;
    if (missions.some(stale)) {
      next.missions = missions.map((m) =>
        stale(m) ? { ...m, intervalMs: COMPACT_MAINTENANCE_MISSION.intervalMs } : m
      );
    }

    persistConfig(next);
    return next;
  } catch {
    // Leave the config exactly as read. The latch above stays set, so a failing
    // migration retries on the next launch rather than on every single read.
    return cfg;
  }
}

/** Same in-memory latch trick as `triggersMigrationRan`: `persistConfig` is
 *  reached from inside a `readConfig`, and without the latch the migration's own
 *  write would re-enter and run it a second time before the flag hit disk. */
let compactCadenceMigrationRan = false;

/**
 * MD-162: move a stored 2h / 60% / 40% compact rule onto the 30m / 25% / 12%
 * defaults, once per install.
 *
 * Why a migration at all — the defaults alone are not enough. `withTriggerDefaults`
 * only fills sub-keys that are MISSING, and any install that has opened the
 * Triggers tab (or been through the `compact-maintenance` retirement, which writes
 * `everyMs` explicitly) has all three numbers persisted. Those are precisely the
 * long-running installs whose bill this card is about, and they would never see the
 * new defaults.
 *
 * Per-field, and only on an exact match with the old shipped number — see
 * `migrateCompactRule` for why that is the honest reading of "untouched". A
 * surviving `compact-maintenance` mission is bumped in the same pass, because the
 * retirement in `bootstrapHiveServices` copies its interval over the trigger's.
 *
 * Wrapped in try/catch for the same reason as `migrateTriggersV1`: a config that is
 * corrupt in some unrelated way must still boot the app.
 */
function migrateCompactCadenceV2(cfg: HarnessConfig): HarnessConfig {
  if (cfg.compactCadenceMigratedV2 || compactCadenceMigrationRan) return cfg;
  compactCadenceMigrationRan = true;
  try {
    const compact = cfg.contextTrigger?.compact ?? DEFAULT_CONTEXT_TRIGGER.compact;
    const missions = Array.isArray(cfg.missions) ? cfg.missions : [];
    const stale = (m: ScheduledMission): boolean =>
      m?.id === COMPACT_MAINTENANCE_MISSION.id
      && m.intervalMs === V1_COMPACT_MAINTENANCE_INTERVAL_MS;
    const staleMission = missions.some(stale);
    // Nothing to move: still stamp the flag, so the next launch does not re-walk
    // this and (more to the point) a later hand-edit back to 60% is never "migrated"
    // out from under the operator.
    if (!compactRuleNeedsMigration(compact) && !staleMission) {
      return persistConfig({ ...cfg, compactCadenceMigratedV2: true });
    }
    const next: HarnessConfig = {
      ...cfg,
      compactCadenceMigratedV2: true,
      contextTrigger: {
        clear: { ...DEFAULT_CONTEXT_TRIGGER.clear, ...cfg.contextTrigger?.clear },
        compact: migrateCompactRule(compact)
      }
    };
    if (staleMission) {
      next.missions = missions.map((m) =>
        stale(m) ? { ...m, intervalMs: COMPACT_MAINTENANCE_MISSION.intervalMs } : m
      );
    }
    console.log('[config] compact cadence migrated →',
      `${next.contextTrigger?.compact.everyMs}ms /`,
      `${next.contextTrigger?.compact.minContextPct}% /`,
      `${next.contextTrigger?.compact.minContextPctLargeWindow}% large`);
    return persistConfig(next);
  } catch {
    return cfg;
  }
}

export function readConfig(): HarnessConfig {
  const p = configPath();
  // No file yet = a first run with nothing to migrate; the defaults ARE the
  // post-migration shape. Deliberately does not persist — a bare read must not
  // conjure a config.json before onboarding has written one.
  if (!existsSync(p)) return withTriggerDefaults({ ...DEFAULTS });
  try {
    const raw = readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    return migrateCompactCadenceV2(migrateTriggersV1(withTriggerDefaults({ ...DEFAULTS, ...parsed })));
  } catch {
    return withTriggerDefaults({ ...DEFAULTS });
  }
}

function persistConfig(next: HarnessConfig): HarnessConfig {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function writeConfig(patch: Partial<HarnessConfig>): HarnessConfig {
  const current = readConfig();
  const next: HarnessConfig = { ...current, ...patch };
  // Project INGESTION — a registered repo is typed by hand ("~/dev/foo") as often
  // as it is picked from the folder dialog. Expand `~` here so the persisted list
  // (and therefore every agent's default cwd) is ABSOLUTE; Node's fs/spawn treat
  // `~` as a literal directory name and the spawn dies with `cwd does not exist`.
  if (Array.isArray(patch.registeredRepos)) {
    const seen = new Set<string>();
    next.registeredRepos = patch.registeredRepos
      .map((r) => expandTilde(r))
      .filter((r) => r && !seen.has(r) && (seen.add(r), true));
  }
  // The HIVE HOME needs the exact same treatment as registeredRepos above, and for
  // years it did not get it (#140). Onboarding SUGGESTS `~/HarnessAgents` and the
  // field is free text, so the common path — accept the default, press Finish —
  // persisted a literal `~`. The first thing the finish step does is create the
  // directory, and Node's mkdir has no idea what `~` means: it tried to make a
  // folder actually named "~", which fails as
  //   ENOENT: no such file or directory, mkdir '~/HarnessAgents'
  // and left the wizard wedged on its last step with no way forward. Expand BEFORE
  // the value is persisted or copied into recentHives, so every downstream reader
  // (mkdir, the hive root, the launch picker) sees one absolute path.
  if (typeof patch.harnessHome === 'string' && patch.harnessHome) {
    const { home, recentHives } = normalizeHiveHome(patch.harnessHome, current.recentHives ?? []);
    next.harnessHome = home;
    next.recentHives = recentHives;
  }
  return persistConfig(next);
}

/** Wipe the persisted config back to first-run defaults so the app boots into
 *  onboarding again. Used by the "reset & start over" flow. */
export function resetConfig(): HarnessConfig {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(DEFAULTS, null, 2), 'utf8');
  // Drop the migration latches too: the file on disk is back to `triggersMigratedV1:
  // false`, and a latch left set would keep the flag from ever being written again
  // in this process. The migration itself is a no-op on defaults either way.
  triggersMigrationRan = false;
  compactCadenceMigrationRan = false;
  return withTriggerDefaults({ ...DEFAULTS });
}

/** Model ids by tier (Lane A #6.4). Kept in sync with AGENT_MODELS in
 *  src/renderer/src/store/config.ts. */
const MODEL_GOD = 'claude-opus-4-8';                  // orchestration — highest capability
const MODEL_WORKER = 'claude-sonnet-4-6';             // general execution
const MODEL_HELPER = 'claude-haiku-4-5-20251001';     // narrow, cheap helpers

/** Minimal structural shape for tiering — a subset of AgentMeta so config.ts
 *  stays free of a hive.ts import. */
export interface RoleHint {
  isGod?: boolean;
  role?: string;
  capabilities?: string[];
}

/** Default model for an agent given its role (Lane A #6.4): Opus for the god,
 *  Haiku for narrow helpers (triage / routing / verification / formatting),
 *  Sonnet for general workers. Returns a model id (matching AGENT_MODELS) or
 *  undefined to fall back to the CLI default. This is only a DEFAULT — an
 *  explicit per-agent model selection always wins. */
export function modelForRole(
  meta: RoleHint,
  config?: Pick<HarnessConfig, 'godProvider' | 'godModel'>
): string | undefined {
  if (meta.isGod) {
    // GOD engine is selectable: an explicit godModel wins, else the chosen
    // provider's recommended orchestrator model, else the legacy Opus default.
    const preset = providerPreset(config?.godProvider ?? 'claude');
    return config?.godModel ?? preset.recommendedOrchestratorModel ?? MODEL_GOD;
  }
  const hay = `${meta.role ?? ''} ${(meta.capabilities ?? []).join(' ')}`.toLowerCase();
  if (/\b(triage|rout|verif|lint|format|summar|classif|label)/.test(hay)) return MODEL_HELPER;
  return MODEL_WORKER;
}

/** Auto-suggested command string given current autoMode preference. */
export function commandForAutoMode(
  config: HarnessConfig,
  provider?: AgentProvider
): string {
  const p = provider ?? inferAgentProvider(config.defaultCommand);
  const base = p === 'claude' || p === 'custom'
    ? config.defaultCommand
    : defaultCommandForProvider(p, config.defaultCommand);
  if (!config.autoMode) return base;
  const flag = autoModeFlagForProvider(p);
  return flag ? `${base} ${flag}` : base;
}

/** Ensure harnessHome exists on disk. */
export function ensureHarnessHome(path: string): { ok: boolean; error?: string } {
  try {
    // Expand HERE too, not only at the config write (#140). This runs FIRST —
    // onboarding calls it before updateConfig — so normalizing only at the write
    // boundary left the actual mkdir still receiving a literal `~`. Depending on
    // the process cwd that either fails outright or, worse, quietly succeeds by
    // creating a directory genuinely named "~" somewhere nobody will look, and
    // the hive then lives at a path the user cannot find. This is the
    // "defense-in-depth at the consumers" the expandTilde doc calls for: the
    // ingestion point normalizes, and the consumer refuses to trust that it did.
    mkdirSync(expandTilde(path), { recursive: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Idempotently pre-accept Claude Code's first-run prompts so agents spawned with
 *  `--permission-mode bypassPermissions` start cleanly. Without this, a fresh
 *  install shows an interactive "WARNING: Bypass Permissions mode … 1. No, exit /
 *  2. Yes, I accept" prompt that the PTY can't answer in time, so the agent exits
 *  code 1 on its own (reported by multiple users).
 *
 *  Two separate gates, written only when they aren't already satisfied (so we
 *  rarely touch files a running `claude` also writes):
 *   1. `~/.claude/settings.json` → `skipDangerousModePermissionPrompt` +
 *      `skipAutoPermissionPrompt` — these gate the bypass-mode warning (global).
 *   2. `~/.claude.json` → `projects[cwd].hasTrustDialogAccepted` — the per-folder
 *      "do you trust the files in this folder?" dialog. */
export function ensureClaudePermissionsAccepted(cwd?: string): void {
  const home = homedir();
  if (!home) return;
  // 1) Global bypass-mode warning gate.
  try {
    const dir = join(home, '.claude');
    const p = join(dir, 'settings.json');
    let s: Record<string, unknown> = {};
    if (existsSync(p)) {
      try { s = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>; } catch { s = {}; }
    }
    if (s.skipDangerousModePermissionPrompt !== true || s.skipAutoPermissionPrompt !== true) {
      s.skipDangerousModePermissionPrompt = true;
      s.skipAutoPermissionPrompt = true;
      mkdirSync(dir, { recursive: true });
      writeFileSync(p, JSON.stringify(s, null, 2), 'utf8');
    }
  } catch { /* best-effort; never block a spawn */ }
  // 2) Per-folder trust dialog gate (only when this cwd isn't already trusted).
  if (cwd) {
    try {
      const p = join(home, '.claude.json');
      let c: { projects?: Record<string, { hasTrustDialogAccepted?: boolean }> } = {};
      if (existsSync(p)) {
        try { c = JSON.parse(readFileSync(p, 'utf8')); } catch { c = {}; }
      }
      if (c.projects?.[cwd]?.hasTrustDialogAccepted !== true) {
        c.projects = c.projects ?? {};
        c.projects[cwd] = { ...(c.projects[cwd] ?? {}), hasTrustDialogAccepted: true };
        writeFileSync(p, JSON.stringify(c, null, 2), 'utf8');
      }
    } catch { /* best-effort */ }
  }
}
