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
