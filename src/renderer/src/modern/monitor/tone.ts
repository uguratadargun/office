import type { Tone } from './fleetRows';

/**
 * Tone → utilities. DESIGN-MODERN.md allows exactly two status colours past the
 * neutrals (`--destructive` and a single green) plus `--muted-foreground`, so
 * "warn" is deliberately not a third hue — it is the foreground at full weight,
 * with the red reserved for something that has actually gone wrong.
 */
export const TONE_TEXT: Record<Tone, string> = {
  normal: 'text-muted-foreground',
  warn: 'text-foreground',
  danger: 'text-destructive'
};

/**
 * The `Progress` fill. Written as complete literal class strings, never
 * interpolated: Tailwind 4 finds classes by scanning the source text, so a
 * template-built name compiles to nothing and the bar loses its colour in the
 * production build only.
 *
 * `bg-primary` is the near-black/near-white ink, so a healthy bar is chrome and
 * only a failing one takes colour.
 */
export const TONE_METER: Record<Tone, string> = {
  normal: '[&_[data-slot=progress-indicator]]:bg-primary/70',
  warn: '[&_[data-slot=progress-indicator]]:bg-primary',
  danger: '[&_[data-slot=progress-indicator]]:bg-destructive'
};
