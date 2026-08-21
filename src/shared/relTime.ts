/**
 * "3d ago" for a timestamp.
 *
 * Three components already carry a private copy of this arithmetic
 * (`TriggerHistoryTab`, `SchedulesSection`, `WorkersTab`) — all of them take a
 * millisecond delta the caller computed. This one takes the raw stamp instead,
 * because the sources that carry one (kg `meta.addedAt`) can carry a malformed
 * one, and `Date.parse` of garbage is `NaN` — which renders as "NaNm ago" if
 * nobody checks. `now` is injectable so the buckets are testable.
 *
 * Epoch milliseconds are accepted as well as an ISO string: the hive event log
 * stamps `ts: Date.now()`, and the alternative was every caller round-tripping
 * through `new Date(ts).toISOString()` just to get parsed straight back.
 */
export function relSince(stamp: string | number, now: number = Date.now()): string {
  const t = typeof stamp === 'number' ? stamp : Date.parse(stamp);
  if (!Number.isFinite(t)) return (typeof stamp === 'string' ? stamp : '') || 'unknown';
  const a = Math.max(0, now - t);
  if (a < 45_000) return 'just now';
  const mins = Math.round(a / 60_000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}
