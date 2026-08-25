/**
 * Should this usage snapshot become a new cost-ledger row?
 *
 * Two sources feed the ledger and they need opposite treatment:
 *
 *   - LIVE (`sessionId` non-empty, from the OTLP collector). Every beat carries a
 *     fresh export, so every beat is a real row. Unchanged: always append.
 *   - TRANSCRIPT FALLBACK (`sessionId === ''`). This is the only source for an
 *     agent with no live PTY — hibernated, or never exporting at all (the
 *     `munder-developer` case: 532M billed tokens, zero ledger rows). The sample
 *     is re-read from a file, so a FROZEN transcript yields the identical
 *     snapshot every ~30s. Appending those rewrote the same row forever —
 *     2,417 dupes observed, which is why the ledger gated on `sessionId` at all.
 *
 * The gate that keeps the fallback honest is transcript POSITION: the sample's
 * `ts` is the transcript's last-activity mtime (see `transcriptFallback` in
 * src/main/telemetry.ts), so a file nobody has written to produces a
 * byte-identical key. Append only when the key moves.
 *
 * The key includes the token totals as well as the position because mtime is a
 * filesystem fact: a touched-but-unchanged transcript must not manufacture a row.
 */

/** The fields of a usage sample this decision reads. Structural on purpose —
 *  `src/shared` must not import from `src/main`. */
export interface LedgerRowSource {
  /** Nullable because the UsageProvider seam (src/main/usage.ts) types it that
   *  way; '' and null both mean "no live session", i.e. the transcript path. */
  sessionId: string | null;
  ts: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

/** Identity of one ledger row: where the transcript was, and what it said. */
export function ledgerRowKey(s: LedgerRowSource): string {
  return [s.sessionId ?? '', s.ts, s.input, s.output, s.cacheRead, s.cacheCreation].join('|');
}

/**
 * `prevKey` is the key of the last row appended for THIS agent, or undefined
 * when none has been (a fresh process). Undefined therefore appends — the first
 * beat after a restart writes one row, which is information, not a duplicate.
 */
export function shouldAppendLedgerRow(prevKey: string | undefined, s: LedgerRowSource): boolean {
  if (s.sessionId) return true;
  return ledgerRowKey(s) !== prevKey;
}
