/**
 * Command History's reading rules — everything the panel decides before it
 * draws anything.
 *
 * The prompt log has been recorded since it shipped and modern only ever WROTE
 * to it (`historyAdd` from AgentDetail's terminal). This is the read side's
 * arithmetic: which rows belong to the scope you asked for, how many to ask the
 * database for, what a row says when collapsed, and what the empty state means.
 *
 * Pure on purpose: the panel is an IPC-driven surface with a debounce and three
 * destructive actions, and none of that has to be stood up to check that a
 * scoped search cannot quietly show you another agent's prompts.
 */

export interface HistoryRow {
  id: number;
  agentId: string;
  ts: number;
  text: string;
  cwd?: string | null;
}

/** Rows fetched for an unscoped read. Matches the pixel panel's page size. */
export const HISTORY_LIMIT = 100;

/**
 * How many rows to ask for.
 *
 * `historySearch` has NO agent filter — it searches the whole floor and the
 * scope is applied here, afterwards. So a scoped search that asks for 100 gets
 * 100 floor-wide matches and may filter them down to nothing, while the prompt
 * the user is looking for sits at position 140. Over-fetch when scoped: the
 * cost is one wider SQLite read, and the alternative is a search box that says
 * "no prompt matches that" about a prompt that exists.
 */
export function readLimit(scoped: boolean, searching: boolean): number {
  return scoped && searching ? HISTORY_LIMIT * 5 : HISTORY_LIMIT;
}

/**
 * Apply the agent scope the fetch could not.
 *
 * `historyList` takes an agentId and needs no help; search does not. Filtering
 * unconditionally is what keeps the two paths honest — returning other agents'
 * prompts under a control that says "this agent only" is the one thing this
 * panel must never do.
 */
export function scopeRows(rows: HistoryRow[], agentId?: string): HistoryRow[] {
  if (!agentId) return rows ?? [];
  return (rows ?? []).filter((r) => r.agentId === agentId);
}

/** The prompt's first non-blank line — what the collapsed row shows. A prompt
 *  that is all whitespace still gets a label, or the row becomes unclickable. */
export function firstLine(text: string): string {
  const line = String(text ?? '').split('\n').find((l) => l.trim()) ?? '';
  return line.trim() || '(blank)';
}

/** "just now" / "12m ago" / "3h ago" / a date. `now` is a parameter so this is
 *  testable and so every row in one render agrees on what "now" was. */
export function when(ts: number, now: number): string {
  const mins = Math.round((now - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * Why the list is empty — which is three different situations that must not
 * share one sentence. "No prompts recorded yet" under an active search is a
 * lie about the database.
 */
export function emptyCopy(query: string, scoped: boolean, agentName?: string): string {
  if (String(query ?? '').trim()) return 'No prompt matches that.';
  if (scoped && agentName) return `No prompts recorded for ${agentName} yet.`;
  return 'No prompts recorded yet.';
}

/** What the clear button destroys, said plainly enough to stop for. */
export function clearCopy(scoped: boolean, agentName?: string): { label: string; confirm: string; consequence: string } {
  return scoped && agentName
    ? {
      label: `Clear ${agentName}'s prompts`,
      confirm: `Yes, clear ${agentName}'s prompts`,
      consequence: `Every prompt recorded for ${agentName} is deleted. There is no undo.`
    }
    : {
      label: 'Clear all prompts',
      confirm: 'Yes, clear every prompt',
      consequence: 'Every prompt you have ever sent any agent is deleted. There is no undo.'
    };
}

/** The export payload. Stable key order and a trailing newline so a pasted file
 *  diffs cleanly against the next export. */
export function exportJson(rows: HistoryRow[]): string {
  return JSON.stringify(rows ?? [], null, 2) + '\n';
}
