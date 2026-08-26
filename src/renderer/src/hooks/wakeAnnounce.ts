/**
 * MD-146 — telling a JUST-WOKEN session that it has mail.
 *
 * THE BUG. Mail is the wake signal: `hive.deliver` emits `hive:agentWake`, the
 * renderer respawns the agent, and `respawnedRecord` hands the card back with
 * `status: 'idle'` the instant `spawnPty` resolves. The queue drain runs on
 * every store change (debounced 200 ms) and gates on exactly that status — so
 * the inbox nudge was typed into a CLI roughly a fifth of a second old, still
 * painting its banner and replaying a resumed transcript. The pty write
 * SUCCEEDS (there is a tty; nothing is reading it yet), so the queue item is
 * acknowledged and dropped, and the nudge loop had already recorded that
 * message id as "nudged" at ENQUEUE time — so it is never offered again.
 *
 * The agent then sits at a prompt, at 0% CPU, with the unread file still in its
 * inbox, until a SECOND message arrives — which works, because by then the pty
 * is live and the CLI is listening. That is the whole shape of the report.
 *
 * THE RULE. A new session has never been told anything. Whenever an agent gains
 * a pty it did not have — the Wake button, wake-on-mail, and the restore path at
 * app start all end there — the standing inbox is announced to it ONCE, and not
 * until the session is actually ready to hear it.
 *
 * Readiness is evidence, not a timer: the pty has PRODUCED output (proof the
 * process is up and writing) and then gone QUIET (proof it has finished and is
 * sitting at a prompt) — the same two facts that make a card read idle. The
 * bounded fallback exists because a readiness signal that never arrives must
 * cost a badly-timed announce, never a silently unread inbox.
 */

/** How long a pty must be quiet after speaking before it counts as "at a
 *  prompt". Long enough to sit out a banner repaint, short enough that a woken
 *  agent starts within a few seconds of being asked to. */
export const ANNOUNCE_QUIET_MS = 6_000;

/**
 * The hard bound. Announce anyway this long after the session appeared, even
 * with no usable readiness signal at all.
 *
 * Deliberately the same as `BOOT_GRACE_MS`, not a third number: that constant is
 * this codebase's existing answer to "how long may a CLI take to become able to
 * read its stdin", and a fallback shorter than it would fire inside the boot
 * this module exists to wait out.
 */
export const ANNOUNCE_FALLBACK_MS = 35_000;

export interface SessionAgent {
  id: string;
  /** Present iff a live pty is bound to the card. */
  ptyId?: string;
}

/**
 * Which agents are looking at a session they were not looking at before.
 *
 * Keyed on the pty id, not on a boolean: Restart & Continue kills and respawns
 * under the SAME id, and a card that goes live → dead → live is a new session
 * whether or not the string changed. An id that is unchanged between calls is
 * the same running CLI and must not be announced to twice — that is the
 * "delivery to a live pty is unaffected" half of the fix.
 */
export function newSessions(
  previous: Readonly<Record<string, string>>,
  agents: readonly SessionAgent[]
): { started: string[]; sessions: Record<string, string> } {
  const sessions: Record<string, string> = {};
  const started: string[] = [];
  for (const a of agents) {
    if (!a.ptyId) continue;           // processless: nothing to announce into
    sessions[a.id] = a.ptyId;
    if (previous[a.id] !== a.ptyId) started.push(a.id);
  }
  return { started, sessions };
}

/**
 * Is this session ready to be told about its mail?
 *
 * @param spawnedAt    when the new pty was first observed
 * @param lastOutputAt main's last-write timestamp for that pty (0 / undefined
 *                     while it has never written)
 */
export function announceDue(o: {
  spawnedAt: number;
  lastOutputAt?: number;
  now: number;
}): boolean {
  // The bound comes first on purpose: once it is up, nothing about the output
  // stream can talk us out of announcing.
  if (o.now - o.spawnedAt >= ANNOUNCE_FALLBACK_MS) return true;
  const last = o.lastOutputAt ?? 0;
  // Never on silence alone. A pty that has not written a byte has not started;
  // announcing there is the original bug with a longer delay in front of it.
  if (last <= 0) return false;
  return o.now - last >= ANNOUNCE_QUIET_MS;
}
