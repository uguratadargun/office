/**
 * Interval maths for the trigger forms. Pure, and deliberately a COPY of the
 * pixel tab's (`components/triggers/ui.tsx`) rather than an import: that module
 * is the pixel mini design system, and pulling it in would drag `--cth-*` styled
 * components into the modern bundle for the sake of two functions.
 */
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const WEEK = 604_800_000;

export const INTERVAL_OPTS: { ms: number; label: string }[] = [
  { ms: 15 * MINUTE, label: '15m' },
  { ms: 30 * MINUTE, label: '30m' },
  { ms: HOUR, label: '1h' },
  { ms: 2 * HOUR, label: '2h' },
  { ms: 6 * HOUR, label: '6h' },
  { ms: 12 * HOUR, label: '12h' },
  { ms: DAY, label: '24h' },
  { ms: WEEK, label: 'weekly' }
];

/** A truthful label for ANY stored interval, preset or not — arbitrary intervals
 *  persist, so this is computed rather than looked up. Snapping to the nearest
 *  preset would put a label on screen that the saved value does not match. */
export function fmtInterval(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'off';
  if (ms === WEEK) return 'weekly';
  if (ms % WEEK === 0) return `${ms / WEEK}w`;
  if (ms % DAY === 0) return `${ms / DAY}d`;
  if (ms % HOUR === 0) return `${ms / HOUR}h`;
  if (ms % MINUTE === 0) return `${ms / MINUTE}m`;
  return `${Math.round(ms / 1000)}s`;
}

/** "12m ago" / "in 48m". Same shape the pixel rows use. */
export function relTime(ms: number): string {
  const past = ms >= 0;
  const a = Math.abs(ms);
  if (a < 45_000) return 'just now';
  const mins = Math.round(a / 60_000);
  const unit = mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
  return past ? `${unit} ago` : `in ${unit}`;
}
