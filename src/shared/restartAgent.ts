/**
 * Restart one agent's process — the widest-blast-radius operation in this area,
 * so it lives in a `.ts` with its dependencies injected and a test beside it
 * (`test/load-ts.cjs` cannot transpile TSX, and this logic is far too easy to
 * get subtly wrong to leave untested).
 *
 * Three kinds, and the difference is what happens when there is no session to
 * resume:
 *  - `continue`      — "Restart & Continue". Reattaches the prior conversation.
 *                      Continuing is the whole point, so a refused resume must
 *                      FAIL loudly rather than hand back a blank session.
 *  - `model-change`  — the user picked a different model. Something still has to
 *                      spawn, so a missing session falls back to a fresh one.
 *  - `fresh`         — plain "Restart": deliberately START CLEAN on the same
 *                      engine. Same spawn as a model change; it exists as its
 *                      own name because "restart this agent with no history"
 *                      was otherwise only reachable by killing it and hiring it
 *                      back, and calling that path `model-change` at the call
 *                      site would read as a bug.
 *
 * This lives in `shared/` because BOTH UIs respawn agents through it (MD-115):
 * modern's `AgentsOverview.restart` and the pixel `FloorTab.restartWithModel`.
 * It stayed a duplicate while the pixel file belonged to another card, and the
 * copies had already begun to drift — which is exactly why the spawn shape,
 * the hive identity and the post-restart patch are computed HERE, once, with
 * the tests beside them.
 *
 * MD-114b folded a fourth invariant in: a PARKED agent (no `ptyId`) can be
 * restarted. The respawn is then just a spawn with no kill in front of it,
 * under the id it will come back on — and the patch that lands afterwards has
 * to CLEAR the flags that made it parked, in the same write that says it is
 * running again. Split those two and you get MD-113's "asleep card on top of a
 * live process" back.
 *
 * What is deliberately NOT here: resolving a resume session id, and deciding
 * whether a refused precondition is fatal. Those are call-site policy (the
 * pixel row offers an opportunistic "resume if you can", the modern row does
 * not), and folding them in would have changed one UI's behaviour to match the
 * other's. The `kind` a caller passes is that decision, already made.
 */
import { buildSpawnCommand, type SpawnCommandConfig } from './spawnCommand';
import { isValidEffort, providerPreset, type AgentProvider } from './agentProvider';

export type RestartKind = 'continue' | 'model-change' | 'fresh';

/**
 * The id the process comes back on. A live agent keeps the one it has; a parked
 * one gets the id it WOULD have had — the same rule `planRespawn` uses at boot,
 * and it has to be the same rule, because a resume and the hive registry entry
 * both key off it. A fresh id would reattach the conversation to nobody.
 */
export function respawnPtyId(agent: Pick<RestartAgent, 'id' | 'ptyId'>): string {
  return agent.ptyId ?? `pty-${agent.id}`;
}

/**
 * Whether there is anything to kill first. A parked agent's process is already
 * gone — that is what parked MEANS — so calling `killPty` would answer
 * `no pty: <id>`, which `killWasFatal` forgives anyway. The gate exists so the
 * respawn does not depend on that forgiveness, and so the intent reads.
 */
export function needsKill(agent: Pick<RestartAgent, 'ptyId'>): boolean {
  return !!agent.ptyId;
}

export interface RestartAgent {
  id: string;
  ptyId?: string;
  cwd: string;
  name: string;
  description?: string;
  provider?: AgentProvider;
  effort?: string;
  isGod?: boolean;
  isAssistant?: boolean;
  terminalGeneration?: number;
}

export interface RestartRequest {
  kind: RestartKind;
  agent: RestartAgent;
  provider: AgentProvider;
  model?: string;
  /** Omitted keeps the agent's current level; this is the only path that can
   *  apply an effort change, since the flag is a spawn argument. */
  effort?: string;
  config: SpawnCommandConfig;
  bossName: string;
  cols: number;
  rows: number;
}

/**
 * A pty that is ALREADY gone is the state the kill was trying to reach, so it is
 * not a failure — and it is the most common way to arrive at Restart & Continue
 * (the session crashed, main dropped it, kill answers `no pty: <id>`). Treating
 * that as fatal turned the one situation the button exists for into a dead end.
 */
export function killWasFatal(res: { ok: boolean; error?: string }): boolean {
  if (res.ok) return false;
  return !/^no pty:/.test(res.error ?? '');
}

/** An effort level belongs to the ENGINE: a provider switch DROPS a level the
 *  new engine does not accept rather than splicing an unknown flag onto it. */
export function effortForSpawn(req: Pick<RestartRequest, 'provider' | 'effort' | 'agent'>): string | undefined {
  const wanted = req.effort !== undefined ? req.effort : req.agent.effort;
  return isValidEffort(req.provider, wanted) ? wanted : undefined;
}

/** The hive identity the respawn re-registers under. God and the prep assistant
 *  keep their roles; everyone else carries their description. */
export function hiveIdentity(agent: RestartAgent, provider: AgentProvider, bossName: string) {
  const base = { id: agent.id, name: agent.name, cwd: agent.cwd, provider };
  if (agent.isGod) return { ...base, isGod: true, role: 'orchestrator (god)' };
  if (agent.isAssistant) return { ...base, isAssistant: true, role: `${bossName}'s prep assistant` };
  return { ...base, role: agent.description };
}

/** The spawn payload, minus the side effects — everything a test can check. */
export function buildRestartSpawn(req: RestartRequest) {
  const resume = req.kind === 'continue';
  const effort = effortForSpawn(req);
  const command = buildSpawnCommand(req.config, req.model, req.provider, effort);
  return {
    /** Spawn under this id whether or not the agent still holds one. */
    ptyId: respawnPtyId(req.agent),
    /** False for a parked agent: there is no process to stop first. */
    needsKill: needsKill(req.agent),
    resume,
    effort,
    command: command.trim(),
    hive: hiveIdentity(req.agent, req.provider, req.bossName),
    /** Resume is DEMANDED only when continuing. */
    requireResume: resume,
    cols: req.cols,
    rows: req.rows
  };
}

/**
 * What the agent record becomes after a successful respawn. The model is
 * recorded even on a resume: a same-provider model change resumes the session
 * (that is the point — keep the conversation, swap the model), so skipping the
 * patch left the live process on the new model while the selector and the
 * persisted agent kept the old one, and the next restore relaunched the old
 * command.
 */
export function restartPatch(req: RestartRequest, previousProvider: AgentProvider) {
  const { command, effort, resume, ptyId } = buildRestartSpawn(req);
  return {
    // A parked agent came back: it is holding a process again, and under WHICH
    // id is part of that fact — a parked card has no `ptyId` at all, so the
    // patch has to hand it one or the roster keeps rendering Wake over a live
    // process. A no-op for an agent that never lost its own.
    ptyId,
    command,
    provider: req.provider,
    model: req.model,
    effort,
    // MD-114b — a restart ENDS holding a process, so it clears the flags that
    // say otherwise in the same write that reports success. Restart is
    // kill-then-spawn under one id, and the roster's liveness poll watches that
    // id: if the two ever crossed, the card would come back parked on top of a
    // live process (the MD-113 state). Two strikes make that crossing
    // impossible; this makes it harmless as well.
    sleeping: false,
    archived: false,
    status: 'idle' as const,
    action: resume
      ? 'continuing…'
      : req.provider === previousProvider
        ? (req.kind === 'fresh' ? 'restarting clean…' : 'restarting…')
        : `switching to ${providerPreset(req.provider).label}…`
  };
}

/** A resume that main did not honour. Only `continue` treats this as an error;
 *  a model change has already fallen back to a fresh session by design. */
export function resumeWasRefused(kind: RestartKind, res: { resumed?: boolean }): boolean {
  return kind === 'continue' && res.resumed !== true;
}
