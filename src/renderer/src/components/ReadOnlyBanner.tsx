import { useEffect, useState } from 'react';
import { OWNERSHIP_BANNER_HINT } from '@shared/hiveOwnership';

/**
 * "Another Office instance owns this workspace." — the pixel skin.
 *
 * MD-139 made a second window read-only, which is the correct behaviour and is
 * also completely invisible: a window that has stopped orchestrating looks
 * exactly like a working one whose floor has gone quiet, and that is the state
 * a human spent an afternoon diagnosing. Modern says so; this window did not,
 * so opening the second copy in the classic UI put you back in the afternoon
 * (MD-152).
 *
 * Same read, same sentences — the headline comes from main (`ownershipBanner`)
 * and the follow-up from `OWNERSHIP_BANNER_HINT`, so the two windows cannot
 * describe one lock two ways. Only the skin is local.
 *
 * Colours come from --cth-* tokens only; no hex literals.
 */
export function ReadOnlyBanner() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Ownership is decided once, at bootstrap, and only changes when the
    // workspace folder does — which reloads the renderer anyway. One read.
    void window.cth.hiveOwnership?.()
      .then((r) => { if (!cancelled) setMessage(r.owner ? null : r.message); })
      .catch(() => { /* older main: assume the ordinary single-instance case */ });
    return () => { cancelled = true; };
  }, []);

  // Renders nothing in the ordinary single-instance case, which is everybody's.
  if (!message) return null;

  return (
    <div
      role="status"
      style={{
        flexShrink: 0,
        display: 'flex', alignItems: 'baseline', gap: 8,
        padding: '6px 12px',
        background: 'var(--cth-lemon)',
        borderBottom: '1px solid var(--cth-ink-700)',
        fontFamily: 'var(--cth-font-ui)', fontSize: 12, lineHeight: '16px',
        color: 'var(--cth-ink-900)'
      }}
    >
      <span style={{
        flexShrink: 0,
        fontFamily: 'var(--cth-font-display)', fontSize: 9, lineHeight: '16px',
        color: 'var(--cth-ink-700)'
      }}>READ-ONLY</span>
      <span style={{ minWidth: 0 }}>
        {message} <span style={{ color: 'var(--cth-ink-700)' }}>{OWNERSHIP_BANNER_HINT}</span>
      </span>
    </div>
  );
}
