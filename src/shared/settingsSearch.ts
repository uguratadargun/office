/**
 * Settings search — the pure half of "where is that setting?".
 *
 * SettingsModal is seven sections deep and every field is written inline, so
 * there is no DOM-independent list of what it contains. SETTINGS_INDEX is that
 * list, kept by hand: one entry per findable setting, tagged with the section it
 * lives in and the group header above it.
 *
 * The index being hand-written is the honest cost of not restructuring 2000
 * lines of JSX. It can therefore go stale — a NEW setting is simply not findable
 * until it is added here. It cannot lie the other way round: an entry names a
 * section, and clicking a result only switches sections, so a stale entry sends
 * you to a real section rather than to a field that isn't there.
 */

export interface SettingsEntry {
  /** The section tab this setting lives under — the result's destination. */
  section: string;
  /** The group heading above it, when it has one. Searching the group name
   *  finds every field under it ("slack" → signing secret, bot token, port). */
  group?: string;
  /** The visible label, as it reads on screen. */
  label: string;
}

/** Every setting the search can find, in the order the modal shows them. */
export const SETTINGS_INDEX: SettingsEntry[] = [
  // ── General ──
  { section: 'General', group: 'Home folder', label: 'Home folder' },
  { section: 'General', group: 'Environment', label: 'Keep Mac awake while agents run' },
  { section: 'General', group: 'Environment', label: 'Explain things simply' },
  { section: 'General', group: 'Notifications', label: 'Desktop notifications' },
  { section: 'General', group: 'Maintenance', label: 'Scheduled auto-compact' },
  { section: 'General', group: 'Maintenance', label: 'Auto-update' },
  { section: 'General', group: 'Maintenance', label: 'Anonymous usage stats' },
  { section: 'General', group: 'Danger zone', label: 'Reset & start over' },

  // ── Prerequisites ──
  { section: 'Prerequisites', label: 'Node, git and agent CLI setup' },

  // ── Agents & Models ──
  { section: 'Agents & Models', label: 'Default agent model' },
  { section: 'Agents & Models', group: 'Advanced', label: 'Max turns per run' },

  // ── Autonomy & Budgets ──
  { section: 'Autonomy & Budgets', group: 'Autonomy', label: 'Autonomous or ask-first' },
  { section: 'Autonomy & Budgets', group: 'Autonomy', label: 'Floor token budget' },
  { section: 'Autonomy & Budgets', group: 'Circuit breaker', label: 'Token velocity (tok/min)' },
  { section: 'Autonomy & Budgets', group: 'Circuit breaker', label: 'Repeated-tool limit' },
  { section: 'Autonomy & Budgets', group: 'Circuit breaker', label: 'Error-storm limit' },
  { section: 'Autonomy & Budgets', group: 'Circuit breaker', label: 'Hard stop' },

  // ── Connections ──
  { section: 'Connections', group: 'Public URL', label: 'Public URL for Slack and webhooks' },
  { section: 'Connections', group: 'Issue tracker', label: 'Issue tracker' },
  { section: 'Connections', group: 'MCP', label: 'Default MCP servers' },
  { section: 'Connections', group: 'Slack', label: 'Connection (Events URL or Socket Mode)' },
  { section: 'Connections', group: 'Slack', label: 'App-level token' },
  { section: 'Connections', group: 'Slack', label: 'Signing secret' },
  { section: 'Connections', group: 'Slack', label: 'Bot token' },
  { section: 'Connections', group: 'Slack', label: 'Channel id' },
  { section: 'Connections', group: 'Slack', label: 'Port' },
  { section: 'Connections', group: 'Slack', label: 'Proactive posting' },
  { section: 'Connections', group: 'Webhook triggers', label: 'Secret' },
  { section: 'Connections', group: 'Webhook triggers', label: 'Mode' },

  // ── Voice ──
  { section: 'Voice', group: 'Free Flow', label: 'Free Flow (voice dictation)' },
  { section: 'Voice', group: 'Free Flow', label: 'Groq API key' },
  { section: 'Voice', group: 'Free Flow', label: 'Model' },
  { section: 'Voice', group: 'Realtime Michael', label: 'Voice chat with Michael' },
  { section: 'Voice', group: 'Realtime Michael', label: 'Idle auto-disconnect' },

  // ── Memory & Knowledge ──
  { section: 'Memory & Knowledge', group: 'Semantic memory', label: 'Cross-session recall' },
  { section: 'Memory & Knowledge', group: 'Knowledge Graph', label: 'Enterprise knowledge base' }
];

/** One entry that matched, with WHERE in its label the query hit — the renderer
 *  needs the offsets to highlight, and computing them twice would risk the
 *  highlight drifting from the match. `start` is -1 when the entry matched on
 *  its section or group rather than on the label itself. */
export interface SettingsMatch extends SettingsEntry {
  start: number;
  end: number;
}

/**
 * Entries matching `query`, best first. Case-insensitive substring, matched
 * against the label, the group and the section — so "slack" finds every field
 * under the Slack group, not just a field with "slack" in its name.
 *
 * Ranking: a label hit beats a group/section hit (you searched for the thing,
 * not for its neighbourhood), and an earlier hit in the label beats a later one
 * ("Port" over "Public URL" for "por"). Ties keep index order, which is screen
 * order. A blank query matches NOTHING rather than everything — the caller shows
 * the normal nav in that case, and returning all 38 entries would render a
 * "results" list that is really just an unsorted copy of the whole modal.
 */
export function searchSettings(query: string, index: SettingsEntry[] = SETTINGS_INDEX): SettingsMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { m: SettingsMatch; rank: number; order: number }[] = [];
  index.forEach((entry, order) => {
    const start = entry.label.toLowerCase().indexOf(q);
    if (start >= 0) {
      scored.push({ m: { ...entry, start, end: start + q.length }, rank: start, order });
      return;
    }
    const inGroup = entry.group?.toLowerCase().includes(q) ?? false;
    const inSection = entry.section.toLowerCase().includes(q);
    // 1000 keeps every context hit below every label hit without needing a
    // second sort key — no label is 1000 characters long.
    if (inGroup || inSection) scored.push({ m: { ...entry, start: -1, end: -1 }, rank: 1000, order });
  });
  return scored
    .sort((a, b) => (a.rank - b.rank) || (a.order - b.order))
    .map((s) => s.m);
}

/** The sections that have at least one match — the nav filters down to these. */
export function matchingSections(matches: SettingsMatch[]): string[] {
  const seen: string[] = [];
  for (const m of matches) if (!seen.includes(m.section)) seen.push(m.section);
  return seen;
}
