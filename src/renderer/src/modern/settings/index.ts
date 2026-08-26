/**
 * The modern Settings index — every user-facing setting, in screen order.
 *
 * The pixel UI's index (`@shared/settingsSearch`) is hand-kept and covers 42 of
 * the ~68 config keys, which is exactly the failure MD-71 reported: a NEW
 * setting is simply not findable until someone remembers to add it, and nothing
 * fails when they don't. This index is kept the same way — by hand, because the
 * label and the group are copy, not data — but `test/modern-settings-index.test.cjs`
 * closes the loop: it reads `HarnessConfig` and fails when a key is neither
 * indexed here nor named in NOT_A_SETTING below. Adding a config key now forces
 * a decision instead of allowing an omission.
 *
 * Two things this index does that the pixel one does not:
 *   1. every entry carries a `key` — the `HarnessConfig` field it writes, which
 *      is what lets the test check coverage at all;
 *   2. every entry carries a DOM `id`, so a search hit can scroll to the row
 *      rather than just switching sections.
 */

/** Section tabs, in nav order. */
export const SECTIONS = [
  'General',
  'Agents & Models',
  'Autonomy & Budgets',
  'Connections',
  'Voice',
  'Memory & Knowledge',
  'Prerequisites'
] as const;

export type Section = (typeof SECTIONS)[number];

/** Narrow an arbitrary string to a Section. Cross-area deep links arrive as
 *  plain strings through `navigate()` — which knows nothing about Settings — so
 *  a stale link names a pane that no longer exists rather than crashing. */
export function isSection(value: string): value is Section {
  return (SECTIONS as readonly string[]).includes(value);
}

export interface SettingEntry {
  /** DOM id of the row, `set-<key-ish>`. The search result scrolls to it. */
  id: string;
  section: Section;
  /** Group heading above the row. Searching the group finds every row under it. */
  group: string;
  /** The label as it reads on screen. */
  label: string;
  /** Extra words that should find this row but are not on screen. */
  keywords?: string;
  /**
   * The `HarnessConfig` field(s) this row writes. `[]` means the row is real UI
   * but writes no config key of its own (a doctor panel, a copy button, an
   * action) — the coverage test skips those rather than pretending they are keys.
   */
  keys: string[];
}

/**
 * Keys that are deliberately NOT settings, each with the reason. The coverage
 * test reads this list, so "it isn't in Settings" always has a stated cause and
 * a reviewer can disagree with a specific sentence.
 */
export const NOT_A_SETTING: Record<string, string> = {
  onboardingComplete: 'first-run state, flipped by the wizard, never by a control',
  recentHives: 'MRU list behind the hive picker, written as a side effect of opening one',
  opsStandupSeeded: 'one-time seed marker for the default missions',
  heartbeatSeeded: 'one-time seed marker for the heartbeat mission',
  triggersMigratedV1: 'one-time main-process migration guard',
  autoDeliveryPausedAgents: 'per-agent runtime state, toggled on the agent, not in Settings',
  agentTokenCaps: 'per-agent budget, set on the agent row in Monitor',
  defaultCommand: 'legacy spawn command; AddAgentModal reads it, nothing writes it',
  webhookEnabled: 'deprecated in favour of webhookTriggers[]',
  webhookSecret: 'deprecated in favour of webhookTriggers[].secret',
  webhookPort: 'deprecated — the port belongs to the shared server, not to one trigger',
  contextTrigger: 'owned by the Triggers area, not Settings',
  orgTrigger: 'owned by the Triggers area, not Settings',
  webhookTriggers: 'owned by the Triggers area, not Settings',
  embeddingModel: 'chosen in the Memory panel, next to the index it rebuilds',
  reflectCondenseModels: 'per-engine model map, edited inside the condenser group as a unit',
  missions: 'scheduled missions are created and edited in Triggers > Schedules, not here'
};

export const SETTINGS: SettingEntry[] = [
  // ── General ───────────────────────────────────────────────────────────────
  { id: 'set-home', section: 'General', group: 'Workspace', label: 'Home folder', keywords: 'harness hive directory path', keys: ['harnessHome'] },
  { id: 'set-repos', section: 'General', group: 'Workspace', label: 'Directories', keywords: 'repos projects registered worktree folder', keys: ['registeredRepos'] },
  { id: 'set-boss', section: 'General', group: 'Workspace', label: 'Boss name', keywords: 'orchestrator michael god', keys: ['bossName'] },
  { id: 'set-appearance', section: 'General', group: 'Appearance', label: 'Theme', keywords: 'light dark system colour color appearance', keys: [] },
  { id: 'set-uimode', section: 'General', group: 'Appearance', label: 'Interface', keywords: 'pixel classic modern ui switch front-end', keys: ['ui'] },
  { id: 'set-office-theme', section: 'General', group: 'Appearance', label: 'Office theme', keywords: 'tv show friends brooklyn silicon valley got hogwarts map cast', keys: ['tvShowOffices', 'officeTheme'] },
  { id: 'set-keepawake', section: 'General', group: 'Environment', label: 'Keep this Mac awake while agents run', keywords: 'sleep power blocker display', keys: ['strongKeepalive'] },
  { id: 'set-audience', section: 'General', group: 'Environment', label: 'Explain things simply', keywords: 'plain english non-technical copy audience', keys: ['audience'] },
  { id: 'set-notifications', section: 'General', group: 'Environment', label: 'Desktop notifications', keywords: 'alerts banner', keys: ['notifications'] },
  { id: 'set-autoupdate', section: 'General', group: 'Maintenance', label: 'Auto-update', keywords: 'releases github upgrade', keys: ['autoUpdate'] },
  { id: 'set-telemetry', section: 'General', group: 'Maintenance', label: 'Anonymous usage stats', keywords: 'telemetry analytics privacy opt out', keys: ['telemetryEnabled'] },
  { id: 'set-updates', section: 'General', group: 'Maintenance', label: 'Version and updates', keywords: 'check for updates release notes upgrade download restart version', keys: [] },
  { id: 'set-reset', section: 'General', group: 'Danger zone', label: 'Reset and start over', keywords: 'wipe erase factory delete everything', keys: [] },

  // ── Agents & Models ───────────────────────────────────────────────────────
  { id: 'set-godprovider', section: 'Agents & Models', group: 'Orchestrator', label: 'Orchestrator engine', keywords: 'boss michael god provider claude codex gemini cli', keys: ['godProvider'] },
  { id: 'set-godmodel', section: 'Agents & Models', group: 'Orchestrator', label: 'Orchestrator model', keywords: 'boss michael god model opus', keys: ['godModel'] },
  { id: 'set-model', section: 'Agents & Models', group: 'Defaults', label: 'Default agent model', keywords: 'claude sonnet opus haiku engine', keys: ['defaultModel'] },
  { id: 'set-maxturns', section: 'Agents & Models', group: 'Limits', label: 'Max turns per run', keywords: 'turn limit unlimited', keys: ['maxTurns'] },
  { id: 'set-hibernate', section: 'Agents & Models', group: 'Limits', label: 'Sleep idle agents after', keywords: 'hibernate idle minutes park', keys: ['idleHibernateMinutes'] },
  { id: 'set-coding-workers', section: 'Agents & Models', group: 'Limits', label: 'Max concurrent coding workers', keywords: 'coding workers concurrent policy parallel cap', keys: ['maxCodingWorkers'] },
  { id: 'set-provider-keys', section: 'Agents & Models', group: 'AI engines (BYOK)', label: 'Provider API keys', keywords: 'byok anthropic openai google gemini openrouter groq secret token api key base url endpoint ollama localhost default model opencode crush pi qwen', keys: ['providerBaseUrls', 'providerDefaultModels'] },
  { id: 'set-mcp', section: 'Agents & Models', group: 'Tools for new agents', label: 'MCP defaults', keywords: 'servers consent tools context protocol permissions', keys: ['mcpDefaults'] },

  // ── Autonomy & Budgets ────────────────────────────────────────────────────
  { id: 'set-automode', section: 'Autonomy & Budgets', group: 'Autonomy', label: 'Autonomous or ask-first', keywords: 'permission bypass approve', keys: ['autoMode'] },
  { id: 'set-budget', section: 'Autonomy & Budgets', group: 'Autonomy', label: 'Floor token budget', keywords: 'cost cap tokens spend ceiling', keys: ['costCapTokens'] },
  { id: 'set-breaker-on', section: 'Autonomy & Budgets', group: 'Circuit breaker', label: 'Circuit breaker', keywords: 'runaway loop guard', keys: ['circuitBreaker'] },
  { id: 'set-breaker-velocity', section: 'Autonomy & Budgets', group: 'Circuit breaker', label: 'Token velocity', keywords: 'tokens per minute burn rate', keys: [] },
  { id: 'set-breaker-repeat', section: 'Autonomy & Budgets', group: 'Circuit breaker', label: 'Repeated-tool limit', keywords: 'loop same tool', keys: [] },
  { id: 'set-breaker-storm', section: 'Autonomy & Budgets', group: 'Circuit breaker', label: 'Error-storm limit', keywords: 'errors failures', keys: [] },
  { id: 'set-breaker-hardstop', section: 'Autonomy & Budgets', group: 'Circuit breaker', label: 'Hard stop', keywords: 'kill terminate', keys: [] },

  // ── Connections ───────────────────────────────────────────────────────────
  { id: 'set-publicurl', section: 'Connections', group: 'Public URL', label: 'Public URL', keywords: 'tunnel ngrok request slack webhook', keys: ['publicUrl'] },
  { id: 'set-issuehost', section: 'Connections', group: 'Repositories', label: 'Issue tracker', keywords: 'github gitlab auto', keys: ['issueHost'] },
  { id: 'set-automerge', section: 'Connections', group: 'Repositories', label: 'Auto-merge ready PRs', keywords: 'pull request merge', keys: ['prAutoMerge'] },
  { id: 'set-slack-on', section: 'Connections', group: 'Slack', label: 'Slack', keywords: 'chat integration', keys: ['slackEnabled'] },
  { id: 'set-slack-transport', section: 'Connections', group: 'Slack', label: 'Connection', keywords: 'events api socket mode websocket transport', keys: ['slackTransport'] },
  { id: 'set-slack-apptoken', section: 'Connections', group: 'Slack', label: 'App-level token', keywords: 'xapp socket connections write', keys: ['slackAppToken'] },
  { id: 'set-slack-secret', section: 'Connections', group: 'Slack', label: 'Signing secret', keywords: 'verify request', keys: ['slackSigningSecret'] },
  { id: 'set-slack-bottoken', section: 'Connections', group: 'Slack', label: 'Bot token', keywords: 'xoxb', keys: ['slackBotToken'] },
  { id: 'set-slack-users', section: 'Connections', group: 'Slack', label: 'Allowed user ids', keywords: 'allowlist sender permission who', keys: ['slackAllowedUserIds'] },
  { id: 'set-slack-channel', section: 'Connections', group: 'Slack', label: 'Channel id', keywords: 'where post', keys: ['slackChannelId'] },
  { id: 'set-slack-port', section: 'Connections', group: 'Slack', label: 'Port', keywords: 'listen http server', keys: ['slackPort'] },
  { id: 'set-slack-proactive', section: 'Connections', group: 'Slack', label: 'Proactive posting', keywords: 'unprompted voice initiated', keys: ['slackProactivePosting'] },
  { id: 'set-telegram-on', section: 'Connections', group: 'Telegram', label: 'Telegram remote control', keywords: 'phone mobile', keys: ['telegramEnabled'] },
  { id: 'set-telegram-token', section: 'Connections', group: 'Telegram', label: 'Bot token', keywords: 'botfather', keys: ['telegramBotToken'] },
  { id: 'set-telegram-chat', section: 'Connections', group: 'Telegram', label: 'Allowed chat id', keywords: 'allowlist who', keys: ['telegramChatId'] },
  { id: 'set-rest', section: 'Connections', group: 'Custom REST', label: 'Custom REST integrations', keywords: 'api registry http endpoint bearer header base url integration template', keys: [] },

  // ── Voice ─────────────────────────────────────────────────────────────────
  { id: 'set-freeflow-on', section: 'Voice', group: 'Free Flow', label: 'Free Flow (voice dictation)', keywords: 'speech to text microphone', keys: ['freeflowEnabled'] },
  { id: 'set-groqkey', section: 'Voice', group: 'Free Flow', label: 'Groq API key', keywords: 'gsk transcription', keys: ['groqApiKey'] },
  { id: 'set-freeflow-model', section: 'Voice', group: 'Free Flow', label: 'Transcription model', keywords: 'whisper', keys: ['freeflowModel'] },
  { id: 'set-openaikey', section: 'Voice', group: 'Realtime', label: 'OpenAI API key', keywords: 'sk byok talk realtime speech secret', keys: [] },
  { id: 'set-realtime-idle', section: 'Voice', group: 'Realtime', label: 'Idle auto-disconnect', keywords: 'voice chat hang up timeout never', keys: ['realtimeIdleDisconnectMs'] },

  // ── Memory & Knowledge ────────────────────────────────────────────────────
  { id: 'set-memory-open', section: 'Memory & Knowledge', group: 'Semantic memory', label: 'Agent memory', keywords: 'memory.md view graph palace notes read', keys: [] },
  { id: 'set-semantic', section: 'Memory & Knowledge', group: 'Semantic memory', label: 'Cross-session recall', keywords: 'mempalace embeddings search', keys: ['semanticMemory'] },
  { id: 'set-kg', section: 'Memory & Knowledge', group: 'Knowledge Graph', label: 'Enterprise knowledge base', keywords: 'documents multimodal rag', keys: ['knowledgeGraph'] },
  { id: 'set-reflect-on', section: 'Memory & Knowledge', group: 'Memory condenser', label: 'Condense agent memory', keywords: 'janitor reflect summarise shrink', keys: ['reflectEnabled'] },
  { id: 'set-reflect-interval', section: 'Memory & Knowledge', group: 'Memory condenser', label: 'Scan every', keywords: 'interval minutes how often', keys: ['reflectIntervalMs'] },
  { id: 'set-reflect-bytepct', section: 'Memory & Knowledge', group: 'Memory condenser', label: 'Condense above', keywords: 'byte percent budget trigger', keys: ['reflectByteTriggerPct'] },
  { id: 'set-reflect-sections', section: 'Memory & Knowledge', group: 'Memory condenser', label: 'Or above section count', keywords: 'headings trigger', keys: ['reflectSectionTrigger'] },
  { id: 'set-reflect-keep', section: 'Memory & Knowledge', group: 'Memory condenser', label: 'Keep newest sections verbatim', keywords: 'recent untouched', keys: ['reflectRecentKeep'] },
  { id: 'set-reflect-min', section: 'Memory & Knowledge', group: 'Memory condenser', label: 'Never condense below', keywords: 'minimum bytes floor', keys: ['reflectMinBytes'] },
  { id: 'set-reflect-engine', section: 'Memory & Knowledge', group: 'Memory condenser', label: 'Fallback condense engine', keywords: 'provider claude model one-shot', keys: ['reflectCondenseProvider'] },

  // ── Prerequisites ─────────────────────────────────────────────────────────
  { id: 'set-tools', section: 'Prerequisites', group: 'Local tooling', label: 'Installed tools', keywords: 'prerequisites uv mempalace git cli engine install missing doctor setup', keys: [] }
];

/** One match, with where in the label the query hit (-1 = matched elsewhere). */
export interface SettingMatch extends SettingEntry {
  start: number;
  end: number;
}

/**
 * Entries matching `query`, best first: a label hit beats a group/keyword hit,
 * and an earlier hit in the label beats a later one. A blank query matches
 * NOTHING — the caller shows the normal sections then, and returning all 50
 * entries would render a "results" list that is just an unsorted copy of the
 * whole panel.
 */
export function searchSettings(query: string, index: SettingEntry[] = SETTINGS): SettingMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { m: SettingMatch; rank: number; order: number }[] = [];
  index.forEach((entry, order) => {
    const start = entry.label.toLowerCase().indexOf(q);
    if (start >= 0) {
      scored.push({ m: { ...entry, start, end: start + q.length }, rank: start, order });
      return;
    }
    const hay = `${entry.group} ${entry.section} ${entry.keywords ?? ''}`.toLowerCase();
    // 1000 keeps every context hit below every label hit without a second sort
    // key — no label is 1000 characters long.
    if (hay.includes(q)) scored.push({ m: { ...entry, start: -1, end: -1 }, rank: 1000, order });
  });
  return scored.sort((a, b) => (a.rank - b.rank) || (a.order - b.order)).map((s) => s.m);
}

/** Sections with at least one match, in nav order — the nav filters to these. */
export function matchingSections(matches: SettingMatch[]): Section[] {
  return SECTIONS.filter((s) => matches.some((m) => m.section === s));
}
