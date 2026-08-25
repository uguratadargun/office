import { useSyncExternalStore } from 'react';
import { badgeCounts, parseTasks, TASK_POLL_MS } from '@/store/taskLedger';

/**
 * The two counts the nav rail can wear: cards carrying an open question, and
 * questions that are actually waiting on the human.
 *
 * ONE poller, not one per badge. Both badges are mounted at once and both read
 * the same `tasks.json`, so a hook-per-badge would double the 5s read for no
 * reason. It is a module store for the same reason `navigation.ts` is: the rail
 * is rendered by the shell, and the shell must not learn what a task is.
 *
 * A FAILED READ KEEPS THE LAST GOOD COUNTS. Blanking on a transient error would
 * say "nothing is waiting on you", which is the one wrong answer this control
 * can give — it is the reason someone looks at it at all.
 */
export interface NavBadgeCounts { tasks: number; askMe: number }

const EMPTY: NavBadgeCounts = { tasks: 0, askMe: 0 };
let counts: NavBadgeCounts = EMPTY;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

async function read(): Promise<void> {
  try {
    const next = badgeCounts(parseTasks(await window.cth.hiveTasks()));
    // Identity is the subscription's change signal, so only a real change may
    // produce a new object — otherwise every poll re-renders the whole rail.
    if (next.tasks === counts.tasks && next.askMe === counts.askMe) return;
    counts = next;
    listeners.forEach((l) => l());
  } catch { /* keep the last good counts */ }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    void read();
    timer = setInterval(() => void read(), TASK_POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
  };
}

const snapshot = (): NavBadgeCounts => counts;

export function useNavBadgeCounts(): NavBadgeCounts {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}
