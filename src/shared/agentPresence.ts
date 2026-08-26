/**
 * Does this agent have a process, and if not — why not?
 *
 * MD-114. A released ephemeral worker (Dwight) sat on the roster reading
 * `idle`, with no terminal, no Wake and no Restart: the harness had torn his
 * PTY down on his `act:"done"` report, but the roster entry kept `status:
 * 'idle'` and `sleeping: false`. Every "is this agent parked?" test in both
 * front-ends asks `agent.sleeping`, and that flag is set by exactly ONE path
 * (the idle-hibernate rule). So an agent that lost its process any OTHER way —
 * a worker release, a crash, a kill from outside the app, a reload that
 * outlived its PTY — fell through every branch and rendered as a healthy idle
 * agent that could not be talked to or restarted. It looked stuck because the
 * UI was describing a state the agent was not in.
 *
 * The fix is to stop treating `sleeping` as the question. The question is
 * WHETHER THERE IS A LIVE PROCESS — `ptyId` — and `sleeping` only answers the
 * follow-up "was that on purpose?". Three states, named once, so no surface can
 * invent a fourth:
 *
 *   live    — has a `ptyId`; there is a terminal to attach to.
 *   asleep  — no process, put down deliberately by the idle rule. Expected.
 *   parked  — no process, and nobody said it was going to happen. The zombie.
 *
 * `asleep` and `parked` differ ONLY in the copy shown to the human. Everything
 * else — rank in the roster, the Wake control, the faded row — is keyed on
 * "processless", because a card you cannot type into is a card you cannot type
 * into whichever way it got there.
 */

/** The two fields presence is derived from. Deliberately not `Agent`: this
 *  module is under `src/shared`, so main, both renderers and the tests can all
 *  ask the question without importing a renderer type. */
export interface PresenceAgent {
  /** Present iff a real PTY in the main process is bound to this agent. */
  ptyId?: string;
  /** The idle-hibernate rule parked it. Never set by any other route — which is
   *  precisely why it is the wrong thing to branch on. */
  sleeping?: boolean;
}

export type AgentPresence = 'live' | 'asleep' | 'parked';

export function agentPresence(a: PresenceAgent): AgentPresence {
  if (a.ptyId) return 'live';
  return a.sleeping ? 'asleep' : 'parked';
}

/**
 * True when this agent has no process behind it, however it lost one.
 *
 * This is the predicate every CONTROL should use: Wake, the roster's asleep
 * tier, the faded row, the "no terminal here" pane. `hasTerminalSurface` in
 * `@shared/hibernate` answers a different question (is there something worth
 * OPENING) and deliberately keeps returning true for a sleeping agent.
 */
export function isProcessless(a: PresenceAgent): boolean {
  return agentPresence(a) !== 'live';
}

/**
 * The badge word. `asleep` for both parked states ON PURPOSE: the roster badge
 * is one word wide and the two states take the same action, so splitting the
 * vocabulary there would buy a distinction the user cannot act on and cost the
 * two front-ends a word to disagree about. The honest difference is spelled out
 * where there is room for it — `presenceCopy`, in the detail pane.
 */
export function presenceWord(a: PresenceAgent, status: string): string {
  return isProcessless(a) ? 'asleep' : status;
}

/**
 * The action a card wears once the roster has parked it for having no process.
 * It is a different fact from the hibernate rule's `'sleeping'` — that one is a
 * decision, this one is a death — and `presenceCopy` reads it to keep the two
 * apart on screen. One spelling, in `@shared`, because the store writes it and
 * this module matches on it.
 */
export const PARKED_ACTION = 'session ended';

/** Title + body for the empty terminal pane. This is where `parked` earns its
 *  own name: telling someone their agent is "asleep" when it actually died is
 *  the lie MD-114 was filed about.
 *
 *  MD-114b — `sleeping` alone stopped being enough to answer this. Parking a
 *  dead pty sets that same flag (it has to: `sleeping` is the one processless
 *  state the hive knows how to end by itself, so it is what makes mail wake the
 *  agent). The flag now means "no process, wake me on mail" and `PARKED_ACTION`
 *  is what still says which way it got there. Without this, killing an agent's
 *  CLI from a terminal produced a pane calmly explaining it had been shut down
 *  after the idle window — the same lie, one layer down. */
export function presenceCopy(a: PresenceAgent & { action?: string }): { title: string; body: string } {
  if (agentPresence(a) === 'asleep' && a.action !== PARKED_ACTION) {
    return {
      title: 'Asleep',
      body: 'Its session was shut down after the idle window. Waking respawns it under its own id, so its memory, inbox and CLI conversation all reattach.'
    };
  }
  return {
    title: 'Parked — no process',
    body: 'Its session ended without being put to sleep: it finished as an ephemeral worker, crashed, or was closed from outside the app. Waking respawns it under its own id, so its memory, inbox and CLI conversation all reattach.'
  };
}

/* ── The other half: not creating one ──────────────────────────────────── */

/**
 * What a PTY teardown must do to the ROSTER card behind it.
 *
 * `teardownPty` in main runs on every route a PTY can end by — an explicit
 * `pty:kill`, node-pty's own exit, the ephemeral-worker controller's release —
 * and it already tells the hive registry the agent is archived. It told the
 * RENDERER nothing, which is how a card outlives its process.
 *
 * The rule is not "always tell the renderer", and that distinction is the whole
 * reason this is a function rather than one line at the call site:
 *
 *  - `sleeping` — the hibernate path. It broadcasts `hive:agentSleeping`
 *    itself, before the kill, so a second message here would be a duplicate.
 *  - `worker` — an ephemeral worker being RELEASED. One-shot by construction:
 *    its objective is done, it already replied in-thread, its worktree is
 *    preserved or GC'd by the controller, and `hive.setArchived` has already
 *    written it off in the registry. Archiving the card is the roster catching
 *    up with a decision main already made. Waking it would respawn a worker
 *    with no objective, which is why this is 'archive' and not 'sleep'.
 *  - anything else — a normal agent's PTY ending. This is 'none' DELIBERATELY:
 *    Restart & Continue is `killPty` followed by `spawnPty` under the same id,
 *    so a broadcast here would archive the card out from under a restart that
 *    is halfway done. Those agents are covered by the UI half instead — they
 *    render as `parked` with a Wake, and `reconcileWithLivePtys` files them
 *    under restorable at the next reload.
 */
export type TeardownRosterEffect = 'sleep' | 'archive' | 'none';

export function teardownRosterEffect(o: { sleeping: boolean; worker: boolean }): TeardownRosterEffect {
  if (o.sleeping) return 'sleep';
  return o.worker ? 'archive' : 'none';
}


/* ── Third half: noticing a pty that died while the app was running ────── */

/**
 * MD-114b. The first pass fixed how a PROCESSLESS agent reads and what its
 * buttons do — and then the floor produced the shape it did not cover.
 *
 * Six agents were sitting in `roster.json` with `sleeping: false` AND
 * `ptyId: 'pty-<id>'`, with nothing alive behind that id. `isProcessless` says
 * `live` for those, correctly: the card claims a process. The card is simply
 * WRONG, and nothing was ever going to notice — `reconcileWithLivePtys` runs
 * once, at boot, so a pty that dies while the window stays open is never
 * checked again. Orcun collected two unread inbox messages he could not be
 * woken to read, because a wake is only ever sent to an agent the store thinks
 * is asleep.
 *
 * So the roster has to re-check, and `pty:list` is the only truth: the main
 * process's live map. This is the pure half of that loop — which ids to park.
 *
 * The subtlety is Restart & Continue: it is `killPty(id)` followed by
 * `spawnPty({ id })` under the SAME id, so between those two awaits the id is
 * legitimately absent from `pty:list`. Parking on the first miss would park a
 * card in the middle of its own restart — ptyId cleared, `sleeping: true` — and
 * the restart's patch would then be fighting it, which is precisely the "asleep
 * card on top of a live process" state MD-113 had to go and fix.
 *
 * So an id must be missing for a MINIMUM AGE, not merely twice. Age rather than
 * a count of scans, because scans are not evenly spaced: the loop also scans on
 * window focus, and two focus events can land seconds apart — which is exactly
 * what happened the first time this was tried, and would have re-opened the
 * race that counting was there to close.
 */
export interface PtyScanAgent extends PresenceAgent {
  id: string;
}

export interface DeadPtyScan {
  /** Epoch ms each still-missing id was FIRST seen missing. Carry it into the
   *  next scan. An id whose pty came back is dropped, so a flapping process can
   *  never accumulate its way to a park. */
  missingSince: Record<string, number>;
  /** Agent ids to park now: missing for at least `MIN_PARK_AGE_MS`. */
  park: string[];
}

/** How long a pty must be absent from `pty:list` before its card is parked.
 *  Comfortably longer than a restart's kill→spawn gap (a registry read, a git
 *  probe and a process spawn), and short enough that a dead agent is never left
 *  looking healthy for long. */
export const MIN_PARK_AGE_MS = 8_000;

export function scanDeadPtys(
  agents: readonly PtyScanAgent[],
  livePtyIds: readonly string[],
  previous: Record<string, number> = {},
  now: number = Date.now()
): DeadPtyScan {
  const live = new Set(livePtyIds);
  const missingSince: Record<string, number> = {};
  const park: string[] = [];
  for (const a of agents) {
    // No ptyId at all is the FIRST pass's case — already parked or asleep, and
    // nothing here should touch it. Only a card claiming a process is checked.
    if (!a.ptyId || a.sleeping) continue;
    if (live.has(a.ptyId)) continue;
    const since = previous[a.id] ?? now;
    if (now - since >= MIN_PARK_AGE_MS) park.push(a.id);
    else missingSince[a.id] = since;
  }
  return { missingSince, park };
}
