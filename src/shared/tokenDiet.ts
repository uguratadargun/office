/**
 * Three gates that stop the harness paying for a turn that carries no news.
 *
 * Every API request re-reads the WHOLE context, so a byte added to a transcript
 * is billed again by every request after it: 98% of this fleet's tokens are
 * `cache_read` of context already sent (measured, see
 * docs/superpowers/plans/2026-08-25-token-ledger.md). That makes "don't send it
 * at all" the only lever that compounds — trimming a prompt saves its size times
 * every request left in the session.
 *
 * Pure, so the two traps below are covered by tests rather than by hoping.
 */

/** What `fleetDelta()` says when no agent moved since the last beat. Shared so
 *  the no-op gate and the digest can never drift apart on a string literal. */
export const FLEET_DELTA_NONE = '(no agent changed since the last beat)';

/**
 * True when a heartbeat beat has nothing to tell god.
 *
 * A beat wakes god for a full turn — his context is ~133k tokens, so a beat that
 * only says "quiet, nothing changed" costs ~380k billed tokens and produces one
 * "acknowledged" reply. 41% of god's wakeups were exactly that.
 *
 * A null delta is the FIRST beat: no baseline yet, so it is real news and must
 * still be sent.
 */
export function beatIsNoop(actionable: number, delta: string | null): boolean {
  return actionable === 0 && delta === FLEET_DELTA_NONE;
}

/**
 * The roster line minus its volatile header.
 *
 * `rosterContext()` opens with `[LIVE ROSTER — … snapshot 12s ago]`, and that
 * age changes on every single prompt. Comparing the raw strings to decide
 * "has the floor changed?" would therefore answer YES forever and quietly turn
 * the whole gate into a no-op — the failure mode that has a test.
 */
export function rosterFingerprint(text: string): string {
  return text.replace(/^\[[^\]]*\]\s*/, '');
}

/** True when this roster says something the last injected one did not. */
export function rosterIsNews(prev: string | null | undefined, next: string): boolean {
  return !prev || rosterFingerprint(prev) !== rosterFingerprint(next);
}

// ─── (MD-164) the overnight burn: standup, heartbeat self-feed, reflect retry ──
//
// Measured over 08-26/27: an idle floor still cost ~8.1M cache-read tokens in a
// night, and every one of them came from a timer writing to god's PTY. God never
// hibernates, so mail addressed to him is always a full-context turn. The three
// gates below are the "don't send it at all" lever applied to the three timers
// that kept writing: the hourly standup, the heartbeat, and the condense retry.

/** The subset of a fleet.json row the beat/standup delta actually compares. */
export interface FleetBeatRow {
  id: string;
  name?: string;
  tokens?: number;
  breaker?: string;
  inboxBacklog?: number;
}

/** One agent's state at the previous beat. */
export interface FleetBeatSnap { tokens: number; breaker: string; inbox: number }

/** A mutable baseline holder. Each consumer (heartbeat, standup) owns its OWN —
 *  sharing one would make whichever fires first eat the other's delta. */
export interface FleetBaseline { prev: Map<string, FleetBeatSnap> | null }

/**
 * One line per NON-GOD agent whose tokens, breaker level or inbox depth moved
 * since this baseline's previous call. Advances the baseline as a side effect,
 * so call it exactly once per beat.
 *
 * THE TRAP this closes: god is a row in fleet.json, and re-engaging him spends
 * tokens, which changes his row, which makes the NEXT beat read as "something
 * changed" — a self-feeding ~7-minute wake loop on a floor where nothing at all
 * was happening. God's own spend is never news to god, so his row is dropped
 * before the comparison.
 *
 * The second trap: with god filtered out an empty floor has no rows, and "no
 * baseline yet" (null) counts as news. Returning null forever would re-arm the
 * same loop, so a floor with no non-god rows reports NONE, not null.
 */
export function fleetDeltaFrom(
  rows: FleetBeatRow[], godId: string | undefined, baseline: FleetBaseline
): string | null {
  const mine = rows.filter((r) => r.id !== godId);
  const now = new Map<string, FleetBeatSnap>(mine.map((r) => [
    r.id,
    { tokens: r.tokens ?? 0, breaker: r.breaker ?? 'healthy', inbox: r.inboxBacklog ?? 0 }
  ]));
  const prev = baseline.prev;
  baseline.prev = now;
  // No baseline yet: real news only if there is somebody to have a baseline for.
  if (!prev) return mine.length ? null : FLEET_DELTA_NONE;

  const byId = new Map(mine.map((r) => [r.id, r]));
  const lines: string[] = [];
  for (const [id, cur] of now) {
    const was = prev.get(id);
    const name = byId.get(id)?.name ?? id;
    if (!was) { lines.push(`+ ${name}: new on the floor`); continue; }
    const bits: string[] = [];
    if (cur.tokens !== was.tokens) bits.push(`+${cur.tokens - was.tokens} tok`);
    if (cur.breaker !== was.breaker) bits.push(`breaker ${was.breaker} → ${cur.breaker}`);
    if (cur.inbox !== was.inbox) bits.push(`inbox ${was.inbox} → ${cur.inbox}`);
    if (bits.length) lines.push(`• ${name}: ${bits.join(', ')}`);
  }
  for (const [id] of prev) if (!now.has(id)) lines.push(`- ${id}: gone from the floor`);
  return lines.length ? lines.join('\n') : FLEET_DELTA_NONE;
}

/** True when a non-god agent actually moved since the last look. `null` (no
 *  baseline yet) is NOT movement — it is the absence of a comparison. */
export function hasNonGodDelta(delta: string | null): boolean {
  return delta !== null && delta !== FLEET_DELTA_NONE;
}

/**
 * True when the scheduled dispatch (the hourly ops standup) has nothing to
 * stand up about, and firing it would only buy a full-context god turn that
 * answers "no change, floor idle".
 *
 * Skips when the previous standup is STILL UNREAD in the recipient's inbox
 * (piling a second one on top changes nothing), when no non-god agent is awake
 * (there is nobody to review), or when nothing but god has moved since the last
 * one. A null delta is the first look — no baseline, so it still counts as news
 * and the standup fires.
 */
export function standupIsNoop(args: {
  previousUnread: boolean; awakeNonGod: number; delta: string | null;
}): boolean {
  if (args.previousUnread) return true;
  if (args.awakeNonGod <= 0) return true;
  return args.delta === FLEET_DELTA_NONE;
}

/** How many heartbeat re-engages a single quiet stretch may spend. A quiet
 *  stretch ends the moment a non-god agent moves or new actionable mail lands;
 *  until then one nudge is all god can act on. */
export const QUIET_REENGAGE_CAP = 1;

/**
 * True when this beat is allowed to write to god's inbox.
 *
 * Two conditions, both required: the beat must carry news (`actionable > 0` or a
 * non-god delta — `beatIsNoop`'s rule, which also lets the very first baseline
 * beat through), and the current quiet stretch must not have spent its cap yet.
 * The cap is what turns the old loop into a single nudge: repeating a message
 * god has already been handed cannot make him act on it twice.
 */
export function reengageAllowed(args: {
  actionable: number; delta: string | null; sentThisWindow: number; cap?: number;
}): boolean {
  if (beatIsNoop(args.actionable, args.delta)) return false;
  return args.sentThisWindow < (args.cap ?? QUIET_REENGAGE_CAP);
}

/** True when the quiet stretch is over and the re-engage cap should reset:
 *  a non-god agent moved, or god's actionable inbox GREW (new mail, not the
 *  same unread message counted again). */
export function quietWindowReset(args: {
  delta: string | null; actionable: number; lastActionable: number;
}): boolean {
  return hasNonGodDelta(args.delta) || args.actionable > args.lastActionable;
}

/** Ceiling on the condense retry backoff — a full day. Past this the file is
 *  not going to condense on its own and a human needs to look at it; retrying
 *  hourly forever only spends tokens saying so. */
export const CONDENSE_RETRY_CAP_MS = 24 * 60 * 60 * 1000;

/**
 * How long to wait before re-attempting a condense for one agent.
 *
 * A `condense-abort` is almost never transient — the file's shape is what the
 * verifier rejected, and it has not changed. Retrying on the plain interval ran
 * 14 pointless headless Haiku calls against one agent in a single night
 * (`condense-abort` 18:43→23:44). Doubling per consecutive abort turns that into
 * four, and a success resets the count to zero.
 */
export function condenseRetryDelayMs(
  consecutiveAborts: number, baseMs: number, capMs: number = CONDENSE_RETRY_CAP_MS
): number {
  const n = Math.max(0, Math.floor(consecutiveAborts));
  if (n === 0) return baseMs;
  return Math.min(capMs, baseMs * 2 ** n);
}
