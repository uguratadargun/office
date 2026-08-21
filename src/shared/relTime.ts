/**
 * "3d ago" for an ISO timestamp.
 *
 * Three components already carry a private copy of this arithmetic
 * (`TriggerHistoryTab`, `SchedulesSection`, `WorkersTab`) — all of them take a
 * millisecond delta the caller computed. This one takes the raw stamp instead,
 * because the sources that carry one (kg `meta.addedAt`) can carry a malformed
 * one, and `Date.parse` of garbage is `NaN` — which renders as "NaNm ago" if
 * nobody checks. `now` is injectable so the buckets are testable.
 */
export function relSince(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso || 'unknown';
  const a = Math.max(0, now - t);
  if (a < 45_000) return 'just now';
  const mins = Math.round(a / 60_000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}
