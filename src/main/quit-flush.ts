/**
 * The final analytics flush on quit — and why it must never re-enter
 * `app.quit()` from a microtask.
 *
 * MD-105. The `will-quit` handler preventDefault()s once, races the flush
 * against a short timeout, then calls `app.quit()` again. That worked with a
 * real PostHog client (the flush resolves from a network callback or the timer
 * — both macrotasks). A build with no `POSTHOG_KEY` has NO client, so
 * `endSession()` resolves immediately and the re-quit ran as a MICROTASK — i.e.
 * still inside Electron's emission of `will-quit`, before native code has
 * looked at `preventDefault`. Electron's `Browser::Quit()` is a no-op while
 * `is_quitting_` is set, so that call did nothing; then the prevented event
 * cleared `is_quitting_`, and nothing ever quit again. Every window was gone,
 * the PTYs were dead, and the main process sat there until it was force-killed
 * — pixel and modern alike, because the bug is below both.
 *
 * Two rules, both enforced here rather than at the call site:
 *   1. When there is nothing to flush, do not intercept the quit at all.
 *   2. When there is, re-enter quit from a MACROTASK (`setImmediate`), so the
 *      call lands after Electron has finished processing the prevented event.
 */
export interface QuitFlushDeps {
  /** Is there a live analytics client with a session still open? */
  needsFlush: () => boolean;
  /** Fire session_ended and drain. May hang — it is raced against the timeout. */
  endSession: () => Promise<void>;
  /** `app.quit`. */
  quit: () => void;
  /** Upper bound on how long a hung network may delay the quit. */
  timeoutMs?: number;
  /** Macrotask scheduler; `setImmediate` in production, injectable for tests. */
  defer?: (fn: () => void) => void;
}

export interface WillQuitEvent {
  preventDefault: () => void;
}

export function createWillQuitHandler(deps: QuitFlushDeps): (e: WillQuitEvent) => void {
  const timeoutMs = deps.timeoutMs ?? 1200;
  const defer = deps.defer ?? ((fn) => setImmediate(fn));
  let flushed = false;
  return (e) => {
    if (flushed) return;
    flushed = true;
    if (!deps.needsFlush()) return; // rule 1: nothing to wait for, let the quit through
    e.preventDefault();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (): void => {
      if (timer) clearTimeout(timer);
      defer(deps.quit); // rule 2: never from inside the will-quit emit
    };
    Promise.race([
      deps.endSession(),
      new Promise<void>((r) => { timer = setTimeout(r, timeoutMs); })
    ]).then(finish, finish);
  };
}
