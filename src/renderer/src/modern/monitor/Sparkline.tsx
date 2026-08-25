import { sparkPoints } from './fleetRows';

/**
 * Token burn over the last ~14 telemetry pushes.
 *
 * SVG rather than the pixel UI's block-character line: at 13px in a dense table
 * row, `▁▂▃▄▅` is a smudge. Deliberately axis-less and label-less — it is a
 * shape, and the exact rate is the number next to it. `currentColor` so it
 * inherits the row's tone in both themes without a `dark:` utility.
 *
 * Renders nothing when the series is flat or too short: a flat baseline reads
 * as "idle" when it actually means "no data", which is the mystery-line problem
 * the pixel version solved by hiding it too.
 */
export function Sparkline({ series, className }: { series: number[]; className?: string }) {
  const W = 56;
  const H = 14;
  const points = sparkPoints(series, W, H);
  if (!points) return null;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      aria-hidden
      className={className}
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
