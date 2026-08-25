/**
 * Ending an agent's session and taking it off the roster — the X in the agent
 * detail header, in both front-ends' floor inspector and agents list.
 *
 * MD-109. Every copy of this used to read:
 *
 *     if (!agent.ptyId) return;
 *     void window.cth.killPty(agent.ptyId).then(() => { dispose(); archive(); });
 *
 * which makes archiving a CONSEQUENCE of killing a process. An agent parked on
 * standby has no process: `sleepAgent` clears `ptyId` precisely so the terminal
 * renders as parked. So the guard fired first and a confirmed, armed, "there is
 * no undo" press did nothing — no archive, no error, no clue. That is the bug
 * the human hit trying to archive an idle agent.
 *
 * The two halves are independent, and only one of them is conditional:
 *   - END THE SESSION only if there is a live pty id to end.
 *   - ARCHIVE ALWAYS — it is a roster edit, and the roster is editable whether
 *     or not a child process happens to be running.
 *
 * A kill that fails must not strand the card either. `pty:kill` answers
 * `{ ok: false }` for an id the manager has never heard of (a stale id left by
 * a restore, a pty that already exited), and the IPC itself can reject if the
 * bridge is gone. Neither is a reason to keep an agent the user has asked to
 * archive, so both fall through to the archive.
 *
 * Dependencies are injected rather than imported so this stays a pure module
 * under `src/shared` — testable without a renderer, and shared by both UIs.
 */

/** Just the two fields this action reads. */
export interface ArchivableAgent {
  id: string;
  /** Absent for an agent asleep, parked, or restored without a live process. */
  ptyId?: string;
}

export interface AgentArchiveDeps {
  /** `window.cth.killPty` — resolves `{ ok: false }` for an unknown id. */
  killPty: (ptyId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Drop the xterm instance bound to that pty id. */
  disposeTerminal: (ptyId: string) => void;
  /** `useStore().archiveAgent` — moves the card to `archivedAgents`. */
  archive: (agentId: string) => void;
}

/**
 * End the agent's session if it has one, then archive it. Never rejects: a
 * failed or impossible kill still archives, because the user asked to archive.
 */
export async function endSessionAndArchive(
  agent: ArchivableAgent,
  deps: AgentArchiveDeps
): Promise<void> {
  const { ptyId } = agent;
  if (ptyId) {
    try {
      await deps.killPty(ptyId);
    } catch {
      // The process is unreachable, which is the state we were aiming for.
    }
    // Unconditional: the xterm is ours to drop whatever the kill reported, and
    // leaving it mounted against a dead pty is what corrupts the next attach.
    deps.disposeTerminal(ptyId);
  }
  deps.archive(agent.id);
}
