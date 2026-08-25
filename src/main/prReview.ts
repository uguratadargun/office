/**
 * Local PR review — the part that spawns things.
 *
 * Reads the PR's diff, asks an engine to review it in one shot, files the report
 * on disk and caches the verdict so the chip still knows what it thinks after a
 * restart. The pure half (prompt, verdict parser, paths, chip colour) lives in
 * shared/prReview.ts so it can be tested without a network or a model.
 *
 * It reuses condensePlan/runCondense rather than growing a second one-shot
 * runner. That matters for more than tidiness: condense.ts is the file where
 * "which engines have a VERIFIED non-interactive mode" is written down, and it
 * is deliberately short. A second runner would be a second place for someone to
 * add an unverified flag, and an unverified flag does not fail loudly — it
 * spawns something that exits 2 while the UI says "reviewing…".
 *
 * NOTHING HERE POSTS TO GITHUB. The review is local: a file, a verdict, a chip.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prDiff, type PR } from './github';
import { condensePlan, canCondenseNatively } from '../shared/condense';
import { runCondense } from './condenseRun';
import {
  parseVerdict, repoRefFromUrl, reviewFileName, reviewKey, reviewPrompt,
  type ReviewRecord
} from '../shared/prReview';

/** A review reads a whole diff and writes several paragraphs, so it is slower
 *  than a memory condensation. Still bounded: a wedged engine must not leave a
 *  chip saying "reviewing…" forever. */
const REVIEW_TIMEOUT_MS = 300_000;

export interface ReviewIndex {
  /** reviewKey → the LATEST review for that PR. Older reports stay on disk
   *  under their own timestamped names; only the pointer is overwritten. */
  latest: Record<string, ReviewRecord>;
}

export function reviewsDir(harnessHome: string): string {
  return join(harnessHome, 'hive', 'reviews');
}

function indexPath(harnessHome: string): string {
  return join(reviewsDir(harnessHome), 'index.json');
}

export function loadReviews(harnessHome: string): ReviewIndex {
  try {
    const p = indexPath(harnessHome);
    if (!existsSync(p)) return { latest: {} };
    const d = JSON.parse(readFileSync(p, 'utf8')) as ReviewIndex;
    return d && typeof d.latest === 'object' && d.latest ? d : { latest: {} };
  } catch {
    // A corrupt cache must not stop you reviewing; it only costs the memory of
    // what the last verdict was.
    return { latest: {} };
  }
}

function saveReviews(harnessHome: string, index: ReviewIndex): void {
  try {
    mkdirSync(reviewsDir(harnessHome), { recursive: true });
    writeFileSync(indexPath(harnessHome), JSON.stringify(index, null, 2), 'utf8');
  } catch { /* a cache that cannot be written is not worth failing the review */ }
}

/** The report, with its own header so the file stands alone when someone opens
 *  it outside the app — which is the whole reason it is Markdown on disk rather
 *  than a blob in a JSON cache. */
function reportMarkdown(pr: PR, engine: string, iso: string, body: string): string {
  return [
    `# Review — PR #${pr.number}: ${pr.title}`,
    '',
    `- **URL:** ${pr.url}`,
    `- **Branch:** \`${pr.branch || 'unknown'}\``,
    `- **Host review state:** ${pr.review} · **CI:** ${pr.ci ?? 'none'} · **State:** ${pr.state}${pr.draft ? ' (draft)' : ''}`,
    `- **Reviewed by:** ${engine} (local, one-shot) at ${iso}`,
    '',
    '> This review is LOCAL. Nothing was posted to the host.',
    '',
    '---',
    '',
    body.trim(),
    ''
  ].join('\n');
}

export interface ReviewDeps {
  harnessHome: string;
  /** The engine the god runs on, so a review is written by the same model that
   *  orchestrates the floor. */
  godProvider: string;
  /** Display name of the boss — the review is written in his voice. */
  boss: string;
  issueHost: 'auto' | 'github' | 'gitlab';
  log: (entry: Record<string, unknown>) => void;
  now: () => number;
}

export interface ReviewOutcome {
  ok: boolean;
  record?: ReviewRecord;
  error?: string;
}

/**
 * Review one PR and file the report.
 *
 * The engine choice follows MD-33's rule literally: the god's own engine when it
 * has a verified one-shot mode, otherwise claude as the fallback — never a
 * silent skip, and never an invented flag for an engine we could not check.
 */
export async function reviewPR(cwd: string, pr: PR, deps: ReviewDeps): Promise<ReviewOutcome> {
  const ref = repoRefFromUrl(pr.url);
  if (!ref) return { ok: false, error: `cannot tell which repo ${pr.url || '(no url)'} belongs to` };

  const started = deps.now();
  const diffRes = await prDiff(cwd, pr.number, deps.issueHost);
  if (!diffRes.ok) return { ok: false, error: diffRes.error };

  // MD-33: fall back, never skip. A floor of engines without a verified one-shot
  // still gets its reviews; it just does not get them from its own engine.
  const engine = canCondenseNatively(deps.godProvider) ? deps.godProvider : 'claude';
  const prompt = reviewPrompt({
    number: pr.number, title: pr.title, body: pr.body, state: pr.state,
    draft: pr.draft, review: pr.review, ci: pr.ci ?? 'none', diff: diffRes.diff ?? '', boss: deps.boss
  });
  // '' for the model, deliberately: CONDENSE_MODELS picks a cheap model for a
  // bounded text transform, and a code review is not one. Omitting the flag runs
  // the engine's own configured model instead of one we chose for it.
  const plan = condensePlan(engine, prompt, '');
  if (!plan) return { ok: false, error: `no verified one-shot mode for ${engine}` };

  const run = await runCondense(plan, { cwd, timeoutMs: REVIEW_TIMEOUT_MS });
  const durationMs = deps.now() - started;
  if (!run.ok || !run.text) {
    deps.log({ kind: 'pr_review', number: pr.number, engine, ok: false, error: run.error, durationMs });
    return { ok: false, error: run.error ?? 'the engine returned nothing' };
  }

  const { verdict, reason } = parseVerdict(run.text);
  const iso = new Date(deps.now()).toISOString();
  const path = join(reviewsDir(deps.harnessHome), reviewFileName(ref, pr.number, iso));
  try {
    mkdirSync(reviewsDir(deps.harnessHome), { recursive: true });
    writeFileSync(path, reportMarkdown(pr, engine, iso, run.text), 'utf8');
  } catch (e) {
    return { ok: false, error: `could not write the report: ${e instanceof Error ? e.message : String(e)}` };
  }

  const record: ReviewRecord = {
    key: reviewKey(ref, pr.number), number: pr.number, verdict, reason,
    path, ts: deps.now(), engine, durationMs
  };
  const index = loadReviews(deps.harnessHome);
  index.latest[record.key] = record;
  saveReviews(deps.harnessHome, index);
  deps.log({ kind: 'pr_review', number: pr.number, engine, ok: true, verdict, reason, path, durationMs });
  return { ok: true, record };
}

/** Read one report back for the preview overlay. Bounded by the fact that we
 *  wrote it ourselves; still guarded, because the path comes in over IPC. */
export function readReport(harnessHome: string, path: string): { ok: boolean; text?: string; error?: string } {
  const dir = reviewsDir(harnessHome);
  // Only ever read out of the reviews directory — the renderer supplies this
  // path, and a renderer that can name any path can read any file.
  if (!path.startsWith(dir + '/') && !path.startsWith(dir + '\\')) {
    return { ok: false, error: 'not a review report' };
  }
  try {
    return { ok: true, text: readFileSync(path, 'utf8') };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
