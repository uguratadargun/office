/**
 * Bringing back an agent that has no process.
 *
 * Two lists in the store hold processless agents, and BOTH come back the same
 * way: `restorableAgents` (had a terminal when the app last quit) and
 * `archivedAgents` (the human closed the tab). Restoring one is a spawn plus
 * `addAgent` — that is the whole operation. There is deliberately no
 * "unarchive" call on either side of the wire:
 *
 *   - the store's `addAgent` already drops the id from `archivedAgents`, because
 *     an id is active xor archived;
 *   - the main process's `hive.ensureAgent` already writes `archived: false` on
 *     every spawn ("a (re)spawn always means a live terminal").
 *
 * So archive's inverse is not a flag flip, it is a spawn — and a second call
 * that also claimed to decide whether an agent is live would be a second source
 * of truth for the same fact.
 *
 * The two halves below are the parts that touch no process, split out so they
 * can be tested without a renderer: what to spawn, and what the restored card
 * looks like afterwards.
 */
import {
  buildSpawnCommand,
  inferAgentProvider,
  tokenizeCommand,
  type AgentProvider,
  type HarnessConfig
} from './config';
import type { Agent } from './store';

export interface RespawnPlan {
  provider: AgentProvider;
  /** argv, already tokenized — `exe` is argv[0]. */
  exe: string;
  args: string[];
  ptyId: string;
  /** Where to spawn when this agent has no worktree, or its worktree is gone. */
  baseCwd: string;
  /** The isolated checkout to prefer, when the agent had one. The caller probes
   *  it: the user may have pruned it since the agent was put away. */
  worktreePath?: string;
}

/**
 * The spawn recipe for a processless agent, or the reason there isn't one.
 *
 * The agent's own recorded `command` wins over rebuilding one: it is what this
 * agent actually ran, flags and all. Rebuilding is the fallback for a record
 * persisted before `command` existed — and it goes through buildSpawnCommand so
 * the agent keeps its model AND its per-agent effort level (MD-42) rather than
 * quietly coming back on the harness default.
 */
export function planRespawn(a: Agent, config?: HarnessConfig | null): RespawnPlan | { error: string } {
  const provider = inferAgentProvider(a.command, a.provider);
  const command = (a.command ?? '').trim()
    || (config ? buildSpawnCommand(config, a.model, provider, a.effort) : '');
  // Both of these leave the record where it is and SAY why. Silent removal read
  // as "nothing happened", which is the failure this whole path is here to fix.
  if (!command.trim()) return { error: 'no saved command' };
  if (!a.cwd) return { error: 'no working directory' };
  const [exe, ...args] = tokenizeCommand(command);
  if (!exe) return { error: 'no saved command' };
  return {
    provider,
    exe,
    args,
    // Reuse the agent's own pty id so a resume, its transcript and its hive
    // registry entry all reattach to the same agent rather than a new one.
    ptyId: a.ptyId ?? `pty-${a.id}`,
    baseCwd: a.cwd,
    worktreePath: a.worktreePath
  };
}

/**
 * The floor card for an agent that just came back.
 *
 * Everything the record already carried — id, name, character, accent, model,
 * effort, note, description — rides through untouched, which is what makes this
 * the SAME agent and not a lookalike: tasks.json assignees, memory.md and the
 * hive inbox all key off that id and reattach by themselves.
 *
 * `now` is a parameter rather than a `Date.now()` call so the record is
 * reproducible under test.
 */
export function respawnedRecord(
  a: Agent,
  plan: RespawnPlan,
  o: { worktreeGone?: boolean; seedPrompt?: string; now: number }
): Agent {
  return {
    ...a,
    provider: plan.provider,
    ptyId: plan.ptyId,
    archived: false,
    // A woken agent is awake — the same flag flip archiving gets, for the same
    // reason: the record is only ever in one of these states.
    sleeping: false,
    status: 'idle',
    // Say it on the card, not just in the console: the agent IS back, but not in
    // the checkout it left, and its uncommitted work there is gone with it.
    action: o.worktreeGone ? 'worktree gone — using base repo' : 'starting up',
    // The worktree is no longer on disk, so stop carrying the path — otherwise
    // every future restore re-probes a directory that will never come back.
    worktreePath: o.worktreeGone ? undefined : a.worktreePath,
    seedPrompt: o.seedPrompt,
    carrying: undefined,
    currentStation: 'desk',
    recentTextTs: o.now
  };
}
