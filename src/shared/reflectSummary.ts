/** One-line outcome for a "condense now" run, for the memory tab's result line.
 *  reflectNow returns one entry per agent it looked at — condensed or not, with
 *  a reason — plus an EMPTY array for three different nothings (no harness home,
 *  a pass already in flight, no memory.md). The caller can't tell those apart,
 *  so the empty case says what it can honestly say and no more. */
export interface ReflectOutcome {
  id: string;
  condensed: boolean;
  reason: string;
  oldBytes?: number;
  newBytes?: number;
}

export function summarizeReflect(results: ReflectOutcome[]): string {
  if (results.length === 0) return 'Nothing to condense (no memory over the threshold, or a pass is already running).';
  return results
    .map((r) =>
      r.condensed && typeof r.oldBytes === 'number' && typeof r.newBytes === 'number'
        ? `${r.id}: condensed ${formatBytes(r.oldBytes)} → ${formatBytes(r.newBytes)}`
        : `${r.id}: unchanged (${r.reason})`
    )
    .join('\n');
}

/** Bytes as the condenser states them — shared with the modern Memory view,
 *  so one file cannot say 12.4 KB while the other says 12,698. */
export function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}
