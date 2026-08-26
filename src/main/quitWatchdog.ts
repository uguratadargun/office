/**
 * The one clock that cannot be starved.
 *
 * MD-137, and the reason the obvious fix was not enough. Bounding the exit with
 * `setTimeout(() => app.exit(0), 5000)` looks airtight and is not: in Electron's
 * main process the Node event loop is pumped by Chromium's message loop, so once
 * the quit has destroyed the windows and then wedges, the pump stops and every
 * pending JS timer stops with it. Measured on this app: the deadline armed, the
 * windows gone, and 22 s later neither the 5 s deadline nor a 500 ms heartbeat
 * interval had fired even once. A promise that the app will be gone cannot be
 * kept by the same loop that is the thing hanging.
 *
 * A worker thread was the first attempt at an independent clock and did not fire
 * either — the worker's own bootstrap is scheduled through the main thread, so a
 * loop that dies in the same breath can strand it before its script ever runs.
 * What does survive is a SEPARATE PROCESS: fork+exec hands it to the OS, and
 * from then on nothing about our loop can reach it.
 *
 * Two details keep it honest:
 *   • It is detached and unref'd, so it never keeps us alive or holds our stdio.
 *   • It re-checks before firing. It cannot be cancelled from in here — Node's
 *     'exit' hook runs while Electron's own shutdown is still wedged, so
 *     cancelling there disarmed the watchdog at the exact moment it was needed
 *     (measured). Instead it verifies the pid is STILL an Electron process, which
 *     both skips a pointless SIGKILL after a clean exit and closes the only real
 *     hazard: an OS that recycled our pid onto someone else's process.
 */
import { spawn } from 'node:child_process';
import { basename } from 'node:path';

/** How long after the graceful `app.exit(0)` the watchdog gives up and kills.
 *  Small on purpose: it only has to lose the race with a working event loop. */
export const WATCHDOG_MARGIN_MS = 300;

let armed = false;

/** Make an executable name safe to drop inside a `case` pattern in double
 *  quotes. Our own execPath is not attacker-controlled, but a product name with
 *  a space or a quote in it would silently break the guard, and a guard that
 *  cannot match is worse than no guard at all. */
function shQuoteGlob(name: string): string {
  return name.replace(/[^A-Za-z0-9._ -]/g, '?');
}

/**
 * Arm the out-of-process kill. Idempotent — a second quit request must not stack
 * a second watchdog. Best-effort: if the helper cannot be spawned we are no worse
 * off than the in-loop deadline alone, which the caller has already armed.
 */
export function armQuitWatchdog(deadlineMs: number): void {
  if (armed) return;
  armed = true;
  const pid = process.pid;
  const ms = Math.max(0, Math.round(deadlineMs)) + WATCHDOG_MARGIN_MS;
  try {
    const child = process.platform === 'win32'
      // `timeout` needs a console; `ping` to loopback is the portable sleep in a
      // detached cmd. /T /F takes our child processes down with us.
      ? spawn('cmd.exe', ['/d', '/s', '/c',
          `ping -n ${Math.max(2, Math.ceil(ms / 1000) + 1)} 127.0.0.1 >nul & taskkill /pid ${pid} /T /F >nul 2>&1`],
        { detached: true, stdio: 'ignore', windowsHide: true })
      // The `ps` guard is what makes firing safe: by the time it wakes, our pid
      // may belong to something else entirely, and killing a stranger would be a
      // far worse bug than the hang. It fires only if that pid is still running
      // OUR executable — matched against `process.execPath`'s basename, never a
      // hardcoded "Electron" (in a packaged build the process is named after the
      // product, and a guard that never matches is a watchdog that never fires).
      : spawn('/bin/sh', ['-c',
          `sleep ${(ms / 1000).toFixed(2)}; case "$(ps -p ${pid} -o comm= 2>/dev/null)" in *${shQuoteGlob(basename(process.execPath))}*) kill -9 ${pid} 2>/dev/null;; esac`],
        { detached: true, stdio: 'ignore' });
    child.unref();
    console.log(`[quit] watchdog armed (${ms}ms, pid ${child.pid})`);
  } catch (e) {
    console.error('[quit] watchdog could not be armed:', e);
  }
}
