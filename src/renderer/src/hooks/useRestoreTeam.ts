import { useEffect, useSyncExternalStore } from 'react';
import { useStore, type Agent } from '@/store/store';
import { type HarnessConfig } from '@/store/config';
import { planRespawn, respawnedRecord } from '@/store/respawn';
import { isProcessless } from '@shared/agentPresence';

/** "Restore team" — respawn every worker from the previous session.
 *
 *  Lives here rather than inside AgentStrip because the floor strip is hidden in
 *  fullscreen, which used to mean the restore button (and the list of restorable
 *  agents) simply vanished when you went fullscreen. Both mount points share the
 *  progress state below, so a restore kicked off from one view shows as running
 *  in the other and can't be double-started. */

let restoring = false;
let note: string | null = null;
/** agent id → the reason its last restore failed. Module-level with the rest of
 *  the run state, and a STABLE identity between runs, because
 *  `useSyncExternalStore` re-renders forever on a snapshot that is a fresh
 *  object each read. It is replaced (not mutated) once per run. */
let failures: Record<string, string> = {};
/** True only while the AUTOMATIC boot restore is in flight, so the UI can say
 *  "this is happening on its own" rather than looking like a click you don't
 *  remember making. */
let autoRestoring = false;
/** Latched the moment the automatic restore starts. Module-level, not per
 *  component: `useRestoreTeam` is mounted from both the floor strip and the
 *  fullscreen rail, and without this each of them would kick off its own. */
let autoStarted = false;
const listeners = new Set<() => void>();

/** How long to wait after boot before restoring on our own.
 *
 *  App.tsx reconciles the persisted roster against the PTYs actually alive in
 *  the main process, and that is an async round trip. Firing before it lands
 *  would read a restorable list that still contains agents whose terminals are
 *  already running, and try to spawn duplicates of them. The delay is also the
 *  window in which you can hit a dismiss ✕ if you don't want an agent back. */
export const AUTO_RESTORE_DELAY_MS = 2500;

function emit(): void {
  for (const l of [...listeners]) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// useSyncExternalStore requires a stable snapshot identity — returning a fresh
// object each call would loop forever, so the two fields are read separately.
const getRestoring = (): boolean => restoring;
const getNote = (): string | null => note;
const getFailures = (): Record<string, string> => failures;
const getAutoRestoring = (): boolean => autoRestoring;

export interface RestoreTeamState {
  restoring: boolean;
  /** True when the run in flight was started automatically at boot, not by a
   *  click. Drives the "restoring your team…" banner. */
  autoRestoring: boolean;
  /** Outcome of the last run ("restored 3 · 1 failed — Stanley"), or null.
   *  Names the agents; the REASON belongs to `restoreFailures`, one per row. */
  restoreNote: string | null;
  /** agent id → why its restore failed, for the row's own error slot.
   *  MD-119 F5: the summary used to carry every reason inline, so three agents
   *  with a missing cwd printed the same sentence three times with three
   *  absolute paths, five wrapped lines above rows that each already have an
   *  error slot directly underneath them. A path is worth reading once, next to
   *  the name it belongs to. Cleared at the start of every run so a fixed row
   *  does not keep its old complaint. */
  restoreFailures: Record<string, string>;
  restoreTeam: () => Promise<void>;
}

export interface RespawnOutcome {
  /** The floor card for the agent that came back. Absent on every failure. */
  agent?: Agent;
  /** A PTY with this id is already running — the agent is not missing at all. */
  alreadyLive?: boolean;
  error?: string;
}

/** Ids with a wake already in flight. A broadcast delivers one file per agent and
 *  main announces each one, so without this a single fan-out would fire several
 *  spawns for the same sleeping agent. */
const waking = new Set<string>();

/**
 * Wake a hibernated agent because work arrived for it.
 *
 * Deliberately thin: it decides WHETHER to wake and then defers to respawnAgent,
 * the same single-agent restore the ARCHIVED rows use — so a woken agent re-enters
 * its own worktree and resumes its own CLI session, and there is exactly one spawn
 * path to keep correct. `updateAgent`, not `addAgent`: a sleeping card never left
 * the roster, and addAgent is a no-op for an id already on it.
 */
export interface WakeOutcome { ok: boolean; error?: string }

export async function wakeSleepingAgent(id: string, config?: HarnessConfig | null): Promise<WakeOutcome> {
  const agent = useStore.getState().agents.find((a) => a.id === id);
  // MD-114 — the gate is "has no process", NOT "carries the sleeping flag".
  // `sleeping` is written by exactly one path (the idle-hibernate rule), so an
  // agent that lost its PTY any other way — a released ephemeral worker, a
  // crash, a kill from outside the app — hit this early return and Wake did
  // nothing at all, silently. `planRespawn` has always coped with a missing
  // `ptyId` (it falls back to `pty-<id>`), so the respawn below needed no
  // change; the button was simply never allowed to reach it.
  if (!agent || !isProcessless(agent)) return { ok: false, error: 'this agent already has a live session' };
  if (waking.has(id)) return { ok: true };
  waking.add(id);
  try {
    const out = await respawnAgent(agent, config);
    if (out.agent) { useStore.getState().updateAgent(id, out.agent); return { ok: true }; }
    // A PTY with this id is already live (raced with another wake) — the card is
    // simply out of date, so correct the flag rather than spawning again.
    if (out.alreadyLive) { useStore.getState().updateAgent(id, { sleeping: false }); return { ok: true }; }
    // MD-114 — REPORT it. This was console-only, so a Wake that could not spawn
    // (no saved command, a worktree that will not open, a refused spawn) looked
    // exactly like the dead button this whole card is about. The caller decides
    // where to say it; the console is not a place a user looks.
    console.error('[hibernate] wake failed for', id, out.error);
    return { ok: false, error: out.error ?? 'spawn failed' };
  } finally {
    waking.delete(id);
  }
}

/**
 * Bring ONE processless agent back: probe its worktree, spawn, build the card.
 *
 * Shared by "restore team" (restorableAgents, in bulk) and the ARCHIVED list's
 * per-row restore, so the two can never drift on the things that are easy to get
 * subtly different — resume, isolate, and which checkout an isolated agent comes
 * back in. The caller does the `addAgent`; this only produces the record.
 *
 * NEVER throws: one agent's failure must not abort a bulk restore, and an
 * unhandled rejection here used to make the whole run a silent no-op after the
 * first bad agent.
 */
export async function respawnAgent(a: Agent, config?: HarnessConfig | null): Promise<RespawnOutcome> {
  try {
    const plan = planRespawn(a, config);
    if ('error' in plan) return { error: plan.error };
    // An isolated agent's worktree SURVIVES an app restart on disk (it's only torn
    // down on per-tab close / mid-session exit, not on quit). So re-enter that exact
    // worktree rather than re-isolating — `git worktree add` would conflict with the
    // existing path/branch, and re-isolating would also lose its uncommitted work.
    // But the user may have pruned it since: gitIsRepo (git rev-parse) is false for a
    // missing/invalid dir, so fall back to the base repo rather than a dead path.
    let cwd = plan.baseCwd;
    let worktreeGone = false;
    if (plan.worktreePath) {
      if (await window.cth.gitIsRepo(plan.worktreePath)) cwd = plan.worktreePath;
      else {
        worktreeGone = true;
        console.warn(`[restore] worktree gone for ${a.id} (${plan.worktreePath}); falling back to base repo ${plan.baseCwd}`);
      }
    }
    const res = await window.cth.spawnPty({
      id: plan.ptyId,
      cwd,
      command: plan.exe,
      provider: plan.provider,
      args: plan.args,
      cols: 100,
      rows: 30,
      // The worktree (if any) already exists on disk — cd into it, don't create a new one.
      isolate: false,
      // Continue the worker's prior CLI session if one was recorded — the main
      // process picks the provider's resume flag (Claude --resume, agy
      // --conversation) and for Claude reattaches the transcript. The agent id is
      // preserved, so its registry entry, memory.md and inbox reattach by id.
      // No-op without a recorded session.
      resume: true,
      hive: { id: a.id, name: a.name, provider: plan.provider, cwd, role: a.description }
    });
    if (res.ok) {
      return { agent: respawnedRecord(a, plan, { worktreeGone, seedPrompt: res.seedPrompt, now: Date.now() }) };
    }
    if ((res.error ?? '').includes('already exists')) return { alreadyLive: true };
    return { error: res.error ?? 'spawn failed' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * @param config used only to rebuild a spawn command for a restorable agent
 *        persisted before the `command` field existed.
 */
export function useRestoreTeam(config?: HarnessConfig | null): RestoreTeamState {
  const isRestoring = useSyncExternalStore(subscribe, getRestoring, getRestoring);
  const restoreNote = useSyncExternalStore(subscribe, getNote, getNote);
  const isAutoRestoring = useSyncExternalStore(subscribe, getAutoRestoring, getAutoRestoring);
  const restoreFailures = useSyncExternalStore(subscribe, getFailures, getFailures);

  /** Respawn every worker from the previous session with its ORIGINAL agent id,
   *  cwd, model and command — the hive workspace (memory.md, inbox, registry
   *  entry) reattaches by itself, no memory transplant needed. */
  const restoreTeam = async (): Promise<void> => {
    if (restoring) return;
    restoring = true;
    note = null;
    // Cleared with the note, BEFORE the emit: a row must not keep last run's
    // complaint on screen while this run is still deciding.
    failures = {};
    emit();
    const prevSel = useStore.getState().selectedId;
    const restorableAgents = useStore.getState().restorableAgents;
    // Tally every agent's outcome so the run ALWAYS leaves a visible trace — the
    // original bug was that every failure path was console-only, so a click that
    // couldn't spawn anything looked like a dead button.
    let restored = 0;
    let alreadyLive = 0;
    const failedNames: string[] = [];
    try {
      // Restore every agent CONCURRENTLY. Each spawn is keyed by its own ptyId and
      // touches no cross-agent state in the renderer, and in the main process the
      // whole `pty:spawn` handler (hive registry read-modify-write included) runs
      // synchronously between awaits, so concurrent handlers can't interleave
      // mid-update. Serially this cost the sum of every agent's git probe + spawn;
      // a 6-agent team took ~6× one agent for no reason.
      // Spawns run concurrently but agents are ADDED in roster order afterwards.
      // Calling addAgent from inside each spawn made completion timing decide
      // the roster order — and that order is persisted, so a slow provider or a
      // slow git probe silently overwrote the sequence the user had dragged the
      // cards into.
      const restoredInOrder = await Promise.all([...restorableAgents].map(async (a): Promise<Agent | null> => {
        const out = await respawnAgent(a, config);
        if (out.agent) { restored++; return out.agent; }
        if (out.alreadyLive) {
          // A live PTY with this id is already running (e.g. respawned at boot or
          // by another path) — the agent isn't actually missing, so retire it from
          // the restorable list rather than reporting a phantom failure.
          alreadyLive++;
          useStore.getState().removeRestorableAgent(a.id);
        } else {
          // Leave it restorable so the user can retry — but record WHY so the
          // outcome is shown on the floor, not buried in the devtools console.
          failedNames.push(a.name);
          failures[a.id] = out.error ?? 'spawn failed';
          console.error('[restore] spawn failed for', a.id, out.error);
        }
        return null;
      }));
      // Add in the ORIGINAL roster order, not completion order.
      for (const restoredAgent of restoredInOrder) {
        if (restoredAgent) useStore.getState().addAgent(restoredAgent);
      }
    } finally {
      // addAgent auto-selects each spawn; put the user back where they were.
      const sel = useStore.getState();
      if (prevSel && sel.agents.some((x) => x.id === prevSel)) sel.select(prevSel);
      restoring = false;
      // ALWAYS surface a result so the button can never look inert.
      const parts: string[] = [];
      if (restored) parts.push(`restored ${restored}`);
      if (alreadyLive) parts.push(`${alreadyLive} already live`);
      // Names, not reasons — each failed row prints its own underneath.
      if (failedNames.length) parts.push(`${failedNames.length} failed — ${failedNames.join(', ')}`);
      note = parts.length ? parts.join(' · ') : 'nothing to restore';
      emit();
    }
  };

  // Restore the previous session's team on open, without waiting for a click.
  //
  // Deliberately driven by a store SUBSCRIPTION rather than a plain timer: the
  // restorable list is empty on the first render and only fills once App.tsx's
  // PTY reconcile resolves, so a timer started at mount would look at an empty
  // list, decide there was nothing to do, and never look again.
  //
  // Only ever fires for agents already on the restorable list — i.e. ones that
  // had a terminal open when the app last quit. Archived agents (closed tabs)
  // are never touched.
  useEffect(() => {
    if (autoStarted || !config?.onboardingComplete) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const check = (): void => {
      if (autoStarted || restoring || timer) return;
      if (!useStore.getState().restorableAgents.length) return;
      timer = setTimeout(() => {
        timer = null;
        if (autoStarted || restoring) return;
        if (!useStore.getState().restorableAgents.length) return;
        // Latch BEFORE the await so the other mount point's timer, which may
        // fire in this same tick, sees it.
        autoStarted = true;
        autoRestoring = true;
        emit();
        void restoreTeam().finally(() => { autoRestoring = false; emit(); });
      }, AUTO_RESTORE_DELAY_MS);
    };

    check();
    const unsub = useStore.subscribe(check);
    return () => { unsub(); if (timer) clearTimeout(timer); };
    // restoreTeam is rebuilt every render but only ever called from inside the
    // timer, so it is read fresh at call time and does not belong in the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.onboardingComplete]);

  return { restoring: isRestoring, autoRestoring: isAutoRestoring, restoreNote, restoreFailures, restoreTeam };
}
