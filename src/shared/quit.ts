/**
 * The quit contract: once quitting is DECIDED, the app is gone in five seconds.
 *
 * MD-137. Every exit route (Cmd-Q, dock quit, red-X, the dialog's "kill & quit",
 * Ctrl-C in the launching terminal, an automated `close()`) used to end in an
 * unbounded wait somewhere:
 *
 *   • `before-quit` preventDefault()ed whenever a PTY was registered and then
 *     waited FOREVER for a renderer reply. No window, a crashed renderer or a
 *     headless run meant nobody could ever answer, so the app never quit.
 *   • The count it warned about came from the PTY registry, not from live
 *     processes — a session whose child died without firing node-pty's exit
 *     event (the wedged-across-sleep case `healthCheckPtys` already documents)
 *     kept reading as "1 agent still running" with nothing running.
 *   • SIGINT/SIGTERM went through the same prevented path, so Ctrl-C hung.
 *   • A second Cmd-Q while the dialog was up queued a second blocked request
 *     instead of meaning what the user obviously meant.
 *   • Even once a renderer HAD answered, nothing re-checked that it was still
 *     there. A window torn down mid-dialog left the app waiting on a promise
 *     from a surface that no longer existed — the blank white window that never
 *     goes away.
 *   • Teardown itself has no upper bound: a PTY that ignores every signal, a
 *     socket that will not close or a hung analytics flush could each hold the
 *     process open after the user had already said goodbye.
 *
 * The rule the human asked for, in one sentence: **the wait for a human is
 * unbounded, the wait for the machine is five seconds.** While the dialog is up
 * and a renderer has confirmed it is showing, no clock runs — the user is
 * deciding, and hurrying them would be the bug. The moment the exit is decided
 * (kill & quit pressed, a signal arrived, or nobody could be asked), one budget
 * of QUIT_DEADLINE_MS covers everything that follows — PTY kills, service
 * teardown, the roster/analytics flush (MD-105) — and when it expires the
 * process exits regardless of what is still alive.
 *
 * This module is pure: no electron, no node-pty. The main process supplies the
 * four effects (count, ask, teardown, hard exit) and this decides the sequence,
 * which is why the whole contract is testable with fake timers.
 */

/** One budget for the entire decided exit: renderer-free kills, service
 *  teardown and the final flush all live inside it. Shared so the main process,
 *  both UIs' copy ("closing in 5s…") and the tests read ONE number. */
export const QUIT_DEADLINE_MS = 5_000;

/** How long a quit request waits for a renderer to say "the dialog is up".
 *  Nobody home (window gone, renderer crashed, headless, or wedged in a long
 *  task) → the exit is decided and the deadline above takes over. */
export const QUIT_ASK_TIMEOUT_MS = 2_000;

/** Grace between the polite kill and the process-tree SIGKILL sweep during a
 *  quit: ZERO, deliberately.
 *
 *  The normal grace (`KILL_GRACE_MS`, 4 s) is tuned for stopping one agent
 *  mid-session, where the app lives on and a deferred sweep has plenty of ticks
 *  to run on. On quit there are no more ticks — the process ends within
 *  milliseconds of the kill — so any grace at all means the sweep never happens
 *  and a child that ignores SIGHUP is orphaned to PID 1 for the machine's
 *  uptime. Measured exactly that before this was zero. */
export const QUIT_KILL_GRACE_MS = 0;

/** Upper bound on the final analytics flush during a decided exit. It lives
 *  INSIDE QUIT_DEADLINE_MS — the goodbye is one budget, not a chain of them. */
export const QUIT_FLUSH_BUDGET_MS = 1_200;

/** Where a quit request came from. `close` is the primary window's red-X, which
 *  with no live PTY just closes the window — it is not an app quit. */
export type QuitReason = 'quit' | 'close' | 'signal';

/**
 * What the caller must do with the event it is handling.
 *   `allow`  — let it through untouched (nothing to warn about).
 *   `ask`    — a dialog was sent; preventDefault and wait for the user.
 *   `exit`   — the exit is decided and under way; do NOT preventDefault.
 */
export type QuitDecision = 'allow' | 'ask' | 'exit';

export interface QuitControllerDeps {
  /** PTYs whose process is actually alive right now — never the raw registry. */
  livePtyCount: () => number;
  /** Show the quit dialog. Returns false when there is no renderer to ask. */
  askRenderer: (ptyCount: number) => boolean;
  /** Kill PTYs, stop services, flush, `app.quit()`. May throw; may hang. */
  teardown: () => void;
  /** `app.exit(0)` — the deadline's last word, when the loop is alive to say it. */
  hardExit: () => void;
  /** Arm a kill that does NOT depend on this event loop (see main/quitWatchdog).
   *  Optional so the pure tests can assert it is armed without providing one. */
  armWatchdog?: (deadlineMs: number) => void;
  /** Overridable for tests. */
  deadlineMs?: number;
  askTimeoutMs?: number;
  /** Observability hook: 'asked' | 'acked' | 'deciding' | 'deadline'. */
  onPhase?: (phase: 'asked' | 'acked' | 'deciding' | 'deadline', detail?: string) => void;
}

export interface QuitController {
  /** A quit/close was requested from `reason`. */
  request: (reason: QuitReason) => QuitDecision;
  /** The renderer confirmed the dialog is on screen — stop the ask timer. */
  dialogShown: () => void;
  /** The renderer that was going to answer is gone (window closed, webContents
   *  destroyed, render process crashed). Nobody can answer any more. */
  rendererGone: () => void;
  /** "Keep them running" — forget the pending request. */
  cancel: () => void;
  /** "Kill all & quit" — decide the exit now. */
  confirm: () => void;
  /** Has the exit been decided (deadline armed, teardown started)? */
  isExiting: () => boolean;
  /** The budget this controller was built with — so a caller can echo the same
   *  number to the UI's countdown instead of inventing a second one. */
  deadlineMs: number;
}

export function createQuitController(deps: QuitControllerDeps): QuitController {
  const deadlineMs = deps.deadlineMs ?? QUIT_DEADLINE_MS;
  const askTimeoutMs = deps.askTimeoutMs ?? QUIT_ASK_TIMEOUT_MS;
  const phase = deps.onPhase ?? ((): void => { /* noop */ });

  /** A dialog is out and we have not been told it is on screen yet. */
  let askTimer: ReturnType<typeof setTimeout> | null = null;
  /** A dialog is out (acked or not) — the state a second Cmd-Q confirms. */
  let pending = false;
  let exiting = false;

  const clearAsk = (): void => {
    if (askTimer !== null) { clearTimeout(askTimer); askTimer = null; }
  };

  const beginExit = (why: string): void => {
    if (exiting) return; // idempotent: teardown re-enters quit, signals repeat
    exiting = true;
    pending = false;
    clearAsk();
    phase('deciding', why);
    // Arm the deadline BEFORE teardown, never after: teardown is the thing most
    // likely to hang, and a timer armed behind it would never be set at all.
    // TWO deadlines, because one of them can be starved. In Electron's main
    // process the Node loop is pumped by Chromium's message loop, so once
    // `app.quit()` has destroyed the windows and then wedges, no JS timer ever
    // fires again — measured on this app: armed, windows gone, still sleeping 22 s
    // later. The in-loop timer is the GRACEFUL one (exit code 0, tidy); the
    // watchdog runs on its own thread and is the one that actually keeps the
    // promise. Never unref'd: holding the loop open is precisely this timer's job.
    setTimeout(() => { phase('deadline', why); deps.hardExit(); }, deadlineMs);
    try { deps.armWatchdog?.(deadlineMs); } catch { /* best-effort */ }
    try { deps.teardown(); } catch { /* teardown is best-effort; the deadline still holds */ }
  };

  return {
    deadlineMs,
    isExiting: () => exiting,
    request: (reason) => {
      // Already going: never intercept again. The teardown's own `app.quit()`
      // re-enters this path, and so does a second signal.
      if (exiting) return 'allow';
      // (5) A second Cmd-Q with the dialog up is a confirmation, not a second
      // blocked request. The user asked twice; that is an answer.
      if (pending) { beginExit(`second ${reason}`); return 'exit'; }
      // (4) A signal has no user to ask — the terminal that sent it is waiting.
      if (reason === 'signal') { beginExit('signal'); return 'exit'; }

      const count = deps.livePtyCount();
      if (count === 0) {
        // Closing the last window on macOS is not quitting the app; a Cmd-Q is.
        if (reason === 'close') return 'allow';
        // Nothing to warn about, but still bound it: a hung service or flush
        // must not outlive the goodbye either.
        beginExit('no live ptys');
        return 'exit';
      }

      let asked = false;
      try { asked = deps.askRenderer(count); } catch { asked = false; }
      // (3) Nobody could be asked → do not wait for an answer that cannot come.
      if (!asked) { beginExit('no renderer'); return 'exit'; }
      pending = true;
      phase('asked', String(count));
      // Also not unref'd, for the same reason: this timer is the only thing that
      // will ever answer a quit nobody else can.
      askTimer = setTimeout(() => { askTimer = null; beginExit('no dialog ack'); }, askTimeoutMs);
      return 'ask';
    },
    dialogShown: () => {
      if (exiting || !pending) return;
      // A human is looking at it now. From here the wait is theirs, not ours.
      clearAsk();
      phase('acked');
    },
    rendererGone: () => {
      // The ACK is a promise that a HUMAN is looking at the dialog, and it is
      // the only thing that turns the clock off. When the surface that made that
      // promise dies, the promise dies with it — otherwise the app waits forever
      // on a window that is no longer there. This is the blank-white-window case:
      // the quit was asked, the renderer answered or was about to, and then it
      // was torn down; before this the wait had nothing left to end it.
      if (!pending) return;
      beginExit('renderer gone');
    },
    cancel: () => {
      if (exiting) return;
      pending = false;
      clearAsk();
    },
    confirm: () => beginExit('confirmed')
  };
}

/**
 * Keep only the PTY records whose process is really running.
 *
 * The phantom "1 agent still running" was never a bug in the dialog: it faithfully
 * reported the PTY REGISTRY, and a registry entry outlives its child whenever
 * node-pty's exit event never fires — the wedged-across-sleep case the main
 * process's own `healthCheckPtys` already documents, and an externally SIGKILLed
 * process group leaves the same residue. Counting is therefore a liveness
 * question, not a bookkeeping one, and `alive` is a pure existence probe
 * (signal 0) supplied by the caller so this stays testable.
 *
 * A record with no usable pid counts as NOT live: we cannot prove it is running,
 * and over-reporting is precisely the failure being fixed.
 */
export function liveOnly<T extends { pid?: number }>(entries: readonly T[], alive: (pid: number) => boolean): T[] {
  return entries.filter((e) => typeof e.pid === 'number' && e.pid > 0 && alive(e.pid));
}
