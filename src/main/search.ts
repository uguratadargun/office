/**
 * Repo-wide search for the IDE ("find in files").
 *
 * Two backends, picked in this order:
 *
 *   ripgrep   `rg --json` when `rg` is on PATH. Fastest, and honours .gitignore
 *             by itself.
 *   git grep  Otherwise. Chosen over a hand-rolled directory walk on purpose:
 *             a walker that "honours .gitignore" means reimplementing gitignore
 *             semantics (negations, `**` , directory-vs-file rules, nested
 *             ignore files), which is a lot of code to get subtly wrong — and
 *             git is already a hard prerequisite of this app, already wrapped in
 *             main, and already knows the answer. Inside a repo it searches
 *             tracked files; outside one, `--no-index --exclude-standard` reads
 *             the ignore files directly.
 *
 * If neither binary exists the search reports that plainly rather than silently
 * returning fewer results than the repo contains — a search that quietly misses
 * files is worse than one that says it cannot run.
 *
 * Deliberately free of any `electron` import so it can be unit-tested as a plain
 * Node module.
 */
import { spawn } from 'node:child_process';

/** One matching line. `ranges` are JS string indices into `text`, so they are
 *  correct for non-ASCII lines (ripgrep's own submatch offsets are BYTE offsets
 *  and would mis-highlight there — see matchRanges). */
export interface SearchHit {
  /** Path relative to the search root, as the backend reported it. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** The line's text, trailing newline stripped. */
  text: string;
  /** [start, end) index pairs of the matches within `text`. */
  ranges: [number, number][];
}

export interface SearchOptions {
  regex?: boolean;
  caseSensitive?: boolean;
  /** Stop after this many hits and report truncation. */
  limit?: number;
}

export interface SearchResult {
  hits: SearchHit[];
  /** True when the search stopped at `limit` — there are more matches. */
  truncated: boolean;
  /** Which backend ran, for the results pane's footer. */
  backend: 'ripgrep' | 'git' | 'none';
  error?: string;
}

/** Default hit cap. A one-character query in a large repo matches essentially
 *  every line; the cap is what keeps that from being an out-of-memory bug
 *  instead of a search. */
export const DEFAULT_LIMIT = 500;
/** Hard ceiling on a single search, in ms. */
const SEARCH_TIMEOUT_MS = 15_000;
/** Refuse absurd lines (minified bundles) — one such line can be megabytes and
 *  is never a useful result. */
const MAX_LINE_CHARS = 1000;

// ─── pure parts ──────────────────────────────────────────────────────────────

/** Escape a literal query for use inside a RegExp. */
export function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The RegExp used to locate matches WITHIN a result line, or null when the user
 * typed an invalid regex (the caller reports that instead of searching).
 *
 * Both backends get their own pattern flags, but the highlight is computed here
 * for BOTH so there is one definition of "what matched" — and because doing it
 * in JS sidesteps ripgrep's byte offsets breaking on non-ASCII lines.
 */
export function buildMatcher(query: string, opts: SearchOptions = {}): RegExp | null {
  const source = opts.regex ? query : escapeRegExp(query);
  try {
    return new RegExp(source, opts.caseSensitive ? 'g' : 'gi');
  } catch {
    return null;   // invalid user regex
  }
}

/** Every match of `matcher` in `text`, as [start, end) pairs. Zero-width
 *  matches (`a*`, `^`) are stepped past rather than looped on forever. */
export function matchRanges(text: string, matcher: RegExp | null): [number, number][] {
  if (!matcher) return [];
  const re = new RegExp(matcher.source, matcher.flags.includes('g') ? matcher.flags : `${matcher.flags}g`);
  const out: [number, number][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    out.push([m.index, m.index + m[0].length]);
    if (out.length > 100) break;   // one line, one hundred highlights, enough
  }
  return out;
}

/** One `rg --json` line → a raw hit, or null for the begin/end/summary events
 *  interleaved with the matches. */
export function parseRgLine(line: string): { file: string; line: number; text: string } | null {
  if (!line.startsWith('{')) return null;
  let ev: unknown;
  try { ev = JSON.parse(line); } catch { return null; }
  if (!ev || typeof ev !== 'object') return null;
  const e = ev as { type?: unknown; data?: unknown };
  if (e.type !== 'match' || !e.data || typeof e.data !== 'object') return null;
  const d = e.data as { path?: { text?: unknown }; lines?: { text?: unknown }; line_number?: unknown };
  const file = typeof d.path?.text === 'string' ? d.path.text : null;
  const text = typeof d.lines?.text === 'string' ? d.lines.text : null;
  const lineNo = typeof d.line_number === 'number' ? d.line_number : null;
  // A match in a non-UTF8 file arrives as {bytes: "..."} with no `text`; skip it
  // rather than render mojibake.
  if (file === null || text === null || lineNo === null) return null;
  return { file, line: lineNo, text: text.replace(/\r?\n$/, '') };
}

/** One NUL-separated `git grep -z -n` record (`path\0line\0text`) → a raw hit.
 *  `-z` is what makes a path containing a colon parse correctly. */
export function parseGitGrepRecord(record: string): { file: string; line: number; text: string } | null {
  if (!record) return null;
  const first = record.indexOf('\0');
  if (first < 0) return null;
  const second = record.indexOf('\0', first + 1);
  if (second < 0) return null;
  const file = record.slice(0, first);
  const lineNo = Number(record.slice(first + 1, second));
  if (!file || !Number.isInteger(lineNo) || lineNo <= 0) return null;
  return { file, line: lineNo, text: record.slice(second + 1).replace(/\r?\n$/, '') };
}

/** Take at most `limit`, and say whether anything was left behind. Truncation
 *  is reported, never silent: "500 results" and "the first 500 of many" send a
 *  reader looking in very different places. */
export function capHits(hits: SearchHit[], limit = DEFAULT_LIMIT): { hits: SearchHit[]; truncated: boolean } {
  return hits.length > limit
    ? { hits: hits.slice(0, limit), truncated: true }
    : { hits, truncated: false };
}

/** Both backends' idea of a relative path, made the same one. ripgrep reports
 *  `./src/x.ts` for a `.` pathspec while git grep reports `src/x.ts`; the
 *  renderer opens the file BY this path, so a leading `./` from one backend
 *  would mean a click works under git and 404s under ripgrep. Normalized here,
 *  where both backends pass through, rather than at either call site. */
export function normalizePath(file: string): string {
  return file.replace(/^\.[/\\]/, '').replace(/\\/g, '/');
}

/** Turn a backend's raw line into a finished hit, or null when it should be
 *  dropped (a match only inside a line too long to be worth showing). */
export function toHit(
  raw: { file: string; line: number; text: string } | null,
  matcher: RegExp | null
): SearchHit | null {
  if (!raw) return null;
  if (raw.text.length > MAX_LINE_CHARS) return null;
  return { ...raw, file: normalizePath(raw.file), ranges: matchRanges(raw.text, matcher) };
}

// ─── the backends ────────────────────────────────────────────────────────────

/** ripgrep-on-PATH, probed once per process. Null until probed. */
let rgAvailable: boolean | null = null;

/** Reset the cached probe — tests only; a user does not install ripgrep mid-session. */
export function resetBackendCache(): void { rgAvailable = null; }

function probe(bin: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean): void => { if (!done) { done = true; resolve(v); } };
    try {
      const proc = spawn(bin, args, { stdio: 'ignore' });
      proc.on('error', () => finish(false));
      proc.on('close', (code) => finish(code === 0));
      setTimeout(() => { try { proc.kill(); } catch { /* noop */ } finish(false); }, 3000);
    } catch { finish(false); }
  });
}

async function hasRipgrep(): Promise<boolean> {
  if (rgAvailable === null) rgAvailable = await probe('rg', ['--version']);
  return rgAvailable;
}

/**
 * Stream one backend, feeding whole lines (or NUL records) to `parse` until the
 * limit is hit, then kill the child — without that, searching for `e` walks the
 * entire repo to fill a list we already truncated.
 */
function runBackend(
  bin: string,
  args: string[],
  cwd: string,
  separator: '\n' | '\0',
  parse: (chunk: string) => SearchHit | null,
  limit: number
): Promise<{ hits: SearchHit[]; truncated: boolean; error?: string }> {
  return new Promise((resolve) => {
    const hits: SearchHit[] = [];
    let truncated = false;
    let buffer = '';
    let stderr = '';
    let settled = false;
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(bin, args, { cwd });
    } catch (e) {
      resolve({ hits, truncated: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }

    const done = (error?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { proc.kill('SIGKILL'); } catch { /* already gone */ }
      resolve({ hits, truncated, error });
    };
    const timer = setTimeout(() => { truncated = true; done(); }, SEARCH_TIMEOUT_MS);

    proc.stdout?.on('data', (d: Buffer) => {
      if (settled) return;
      buffer += d.toString('utf8');
      let idx: number;
      while ((idx = buffer.indexOf(separator)) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const hit = parse(chunk);
        if (!hit) continue;
        hits.push(hit);
        if (hits.length >= limit) { truncated = true; done(); return; }
      }
    });
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    proc.on('error', (e) => done(e.message));
    proc.on('close', (code) => {
      // Flush a final record with no trailing separator.
      if (!settled && buffer) {
        const hit = parse(buffer);
        if (hit && hits.length < limit) hits.push(hit);
      }
      // Exit 1 means "no matches" for both rg and git grep — not an error.
      done(code === 0 || code === 1 || code === null ? undefined : (stderr.trim() || `${bin} exited ${code}`));
    });
  });
}

/**
 * Search `root` for `query`. Never throws: a bad regex, a missing backend and a
 * dead child all come back as a result with an `error`, because this is called
 * on every keystroke of a debounced box.
 */
export async function searchRepo(root: string, query: string, opts: SearchOptions = {}): Promise<SearchResult> {
  const q = query.trim();
  if (!q) return { hits: [], truncated: false, backend: 'none' };
  const limit = opts.limit && opts.limit > 0 ? opts.limit : DEFAULT_LIMIT;

  const matcher = buildMatcher(q, opts);
  if (opts.regex && !matcher) {
    return { hits: [], truncated: false, backend: 'none', error: 'invalid regular expression' };
  }
  const parseWith = (raw: { file: string; line: number; text: string } | null): SearchHit | null => toHit(raw, matcher);

  if (await hasRipgrep()) {
    const args = ['--json', '--line-number', '--no-heading'];
    if (!opts.regex) args.push('--fixed-strings');
    args.push(opts.caseSensitive ? '--case-sensitive' : '--ignore-case');
    args.push('--regexp', q, '--', '.');
    const r = await runBackend('rg', args, root, '\n', (l) => parseWith(parseRgLine(l)), limit);
    return { ...r, backend: 'ripgrep' };
  }

  // git grep. Inside a repo it searches tracked files (so .gitignore is honoured
  // by construction); outside one, --no-index --exclude-standard reads the
  // ignore files directly. Both are tried because `root` may be a plain folder.
  const inRepo = await probe('git', ['-C', root, 'rev-parse', '--is-inside-work-tree']);
  if (!inRepo && !(await probe('git', ['--version']))) {
    return {
      hits: [], truncated: false, backend: 'none',
      error: 'no search backend: install ripgrep (rg) or git'
    };
  }
  const args = ['-C', root, 'grep', '--line-number', '--null', '--no-color', '-I'];
  if (!inRepo) args.push('--no-index', '--exclude-standard');
  args.push(opts.regex ? '-E' : '-F');
  if (!opts.caseSensitive) args.push('-i');
  // `-- .` limits the search to this root even when it is a SUBDIRECTORY of a
  // repo — git grep otherwise searches the whole repository from anywhere in it,
  // which would return paths outside the folder the IDE has open.
  args.push('-e', q, '--', '.');
  // Records are newline-separated; `--null` only NUL-separates the three FIELDS
  // within a record (path\0line\0text), which is what makes a path containing a
  // colon parse correctly.
  const r = await runBackend('git', args, root, '\n', (rec) => parseWith(parseGitGrepRecord(rec)), limit);
  return { ...r, backend: 'git' };
}
