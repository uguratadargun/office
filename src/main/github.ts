import { spawn, spawnSync } from 'node:child_process';
import { resolveCommand, userShellPath } from './shellEnv';

/** Spawn a CLI the way every other spawn site in the app does: resolve the bare
 *  binary against the login-shell PATH and hand the child that PATH too.
 *  LaunchServices gives a Dock-launched app PATH=/usr/bin:/bin:/usr/sbin:/sbin,
 *  where a bare `glab`/`gh` is ENOENT. */
function spawnCli(bin: string, args: string[], cwd: string) {
  return spawn(resolveCommand(bin), args, {
    cwd,
    env: { ...process.env, PATH: userShellPath() }
  });
}

/** An issue, normalized for the renderer — same shape from either host. */
export interface GHIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  assignees: string[];
}

/** Which CLI backs the ISSUES panel. 'auto' picks per repo from its origin
 *  remote, so a hive holding both GitHub and GitLab checkouts works without the
 *  user flipping a global switch between them. */
export type IssueHost = 'auto' | 'github' | 'gitlab';

/**
 * The union of what `gh issue list --json` and `glab issue list -O json` emit.
 * The two hosts disagree on every field name that matters (number/iid,
 * body/description, url/web_url) and on the shape of labels + assignees, so the
 * mapper below reads either — one mapper beats two that drift apart.
 */
interface RawIssue {
  number?: number;
  iid?: number;
  title?: string;
  body?: string | null;
  description?: string | null;
  url?: string;
  web_url?: string;
  labels?: Array<string | { name?: string }>;
  assignees?: Array<{ login?: string; username?: string }>;
}

/** Flatten either host's issue objects into the renderer's shape. */
export function mapIssues(raw: unknown): GHIssue[] {
  return (Array.isArray(raw) ? (raw as RawIssue[]) : []).map((i) => ({
    number: i.number ?? i.iid ?? 0,
    title: i.title ?? '',
    body: i.body ?? i.description ?? '',
    url: i.url ?? i.web_url ?? '',
    labels: (i.labels ?? [])
      .map((l) => (typeof l === 'string' ? l : l.name ?? ''))
      .filter(Boolean),
    assignees: (i.assignees ?? []).map((a) => a.login ?? a.username ?? '').filter(Boolean)
  }));
}

/** Server-side narrowing for `listIssues` — both hosts do both, so neither is
 *  limited to whatever the first page happened to contain. */
export interface IssueFilter {
  /** Free text matched against title + description. */
  search?: string;
  /** Only issues assigned to the authenticated user. */
  mine?: boolean;
  /** Which CLI to use. Default 'auto' — detected from the repo's origin remote. */
  host?: IssueHost;
}

/**
 * Resolve 'auto' from the repo's origin remote.
 *
 * ponytail: matches the string "gitlab" in the remote URL, so a self-hosted
 * GitLab on a custom domain reads as GitHub. Pin the host in Settings when that
 * bites; a real fix means asking each CLI whether it recognizes the repo, which
 * is two extra process spawns on every fetch.
 */
export function detectHost(cwd: string): 'github' | 'gitlab' {
  const res = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' });
  return /gitlab/i.test(res.stdout ?? '') ? 'gitlab' : 'github';
}

/** The CLI + argv for a filter. Exported for the test — a dropped flag silently
 *  widens the result set, which looks like working software. */
export function issueListCommand(
  host: 'github' | 'gitlab',
  filter: IssueFilter = {}
): { cmd: string; args: string[] } {
  const search = filter.search?.trim();
  if (host === 'gitlab') {
    const args = ['issue', 'list', '--output', 'json', '--per-page', '30'];
    if (filter.mine) args.push('--assignee', '@me');
    if (search) args.push('--search', search);
    return { cmd: 'glab', args };
  }
  const args = ['issue', 'list', '--json', 'number,title,body,assignees,labels,url,state', '--limit', '30'];
  if (filter.mine) args.push('--assignee', '@me');
  if (search) args.push('--search', search);
  return { cmd: 'gh', args };
}

/** Run a CLI that prints JSON; never throws. The one spawn+parse shape every
 *  gh/glab call in this file shares. */
export function runJson(cmd: string, args: string[], cwd: string): Promise<{ ok: boolean; json?: unknown; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawnCli(cmd, args, cwd);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (e) => resolve({ ok: false, error: e.message }));
    proc.on('close', (code) => {
      if (code !== 0) { resolve({ ok: false, error: stderr.trim() || `${cmd} exited ${code}` }); return; }
      try { resolve({ ok: true, json: stdout.trim() ? JSON.parse(stdout) : null }); }
      catch (e) { resolve({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
    });
  });
}

/**
 * List up to 30 open issues in the repo at `cwd`, via `gh` or `glab` per
 * `filter.host`, optionally narrowed by search / assigned-to-me.
 *
 * Returns `{ ok: false, error }` on any failure — spawn error (e.g. the CLI is
 * not installed), non-zero exit (e.g. unauthenticated / not a repo), or a JSON
 * parse failure — so callers never have to try/catch.
 */
export async function listIssues(cwd: string, filter: IssueFilter = {}): Promise<{ ok: boolean; issues?: GHIssue[]; error?: string }> {
  const host = !filter.host || filter.host === 'auto' ? detectHost(cwd) : filter.host;
  const { cmd, args } = issueListCommand(host, filter);
  const r = await runJson(cmd, args, cwd);
  return r.ok ? { ok: true, issues: mapIssues(r.json) } : { ok: false, error: r.error };
}

// ─── Pull requests — one shape for gh and glab ──────────────────────────────

export type PRState = 'open' | 'merged' | 'closed';
export type PRReview = 'approved' | 'changes_requested' | 'pending' | 'none';
export type PRCI = 'success' | 'failure' | 'pending' | null;

export interface PRComment {
  /** Host id, prefixed by kind so a review and an issue comment can't collide. */
  id: string;
  author: string;
  body: string;
  url: string;
  /** True for a bot account (`login` ends `[bot]`, or the host's own bot flag).
   *  The watcher drops bot comments before they reach an agent's inbox. */
  bot: boolean;
}

/** GitHub's convention for a bot login; GitLab and the REST comments endpoint
 *  each carry an explicit bot flag instead, passed in as `explicit`. */
function isBotAuthor(login: string | undefined, explicit?: boolean): boolean {
  if (explicit === true) return true;
  return !!login && login.endsWith('[bot]');
}

/** A pull / merge request, normalized for the watcher and the renderer. */
export interface PR {
  number: number;
  title: string;
  url: string;
  /** Head branch — how we find the agent that owns it. */
  branch: string;
  state: PRState;
  draft: boolean;
  review: PRReview;
  ci: PRCI;
  /** The failing check's URL when `ci === 'failure'`, else null. */
  ciUrl: string | null;
  /** Issues this PR closes (`closes #N` in title/body ∪ the host's own list). */
  issues: number[];
  /** Review bodies + conversation comments; inline code comments are merged in
   *  by the watcher (they need a second call on both hosts). */
  comments: PRComment[];
}

const CLOSING_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;

/** Issue numbers named with a closing keyword. A bare `#N` is a mention. */
export function linkedIssues(text: string): number[] {
  const out: number[] = [];
  for (const m of (text ?? '').matchAll(CLOSING_RE)) {
    const n = Number(m[1]);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

interface RawCheck {
  __typename?: string;
  status?: string;        // CheckRun: QUEUED | IN_PROGRESS | COMPLETED
  conclusion?: string | null; // CheckRun: SUCCESS | FAILURE | NEUTRAL | CANCELLED | TIMED_OUT | ACTION_REQUIRED | SKIPPED | STALE
  state?: string;         // StatusContext: EXPECTED | ERROR | FAILURE | PENDING | SUCCESS
  detailsUrl?: string;
  targetUrl?: string;
}

const BAD = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STALE']);

/** Collapse gh's statusCheckRollup to one light: failure > pending > success. */
export function ciFromRollup(rollup: unknown): { ci: PRCI; ciUrl: string | null } {
  const checks = Array.isArray(rollup) ? (rollup as RawCheck[]) : [];
  if (checks.length === 0) return { ci: null, ciUrl: null };
  let pending = false;
  for (const c of checks) {
    const verdict = c.__typename === 'StatusContext' ? c.state : (c.status === 'COMPLETED' ? c.conclusion : 'PENDING');
    if (verdict && BAD.has(verdict)) return { ci: 'failure', ciUrl: c.detailsUrl ?? c.targetUrl ?? null };
    if (!verdict || verdict === 'PENDING' || verdict === 'EXPECTED') pending = true;
  }
  return { ci: pending ? 'pending' : 'success', ciUrl: null };
}

interface RawGitHubPR {
  number?: number; title?: string; body?: string | null; url?: string;
  state?: string; isDraft?: boolean; headRefName?: string; reviewDecision?: string;
  statusCheckRollup?: unknown;
  closingIssuesReferences?: Array<{ number?: number }> | null;
  reviews?: Array<{ id?: string; author?: { login?: string; is_bot?: boolean }; body?: string; state?: string }> | null;
  comments?: Array<{ id?: string; author?: { login?: string; is_bot?: boolean }; body?: string; url?: string }> | null;
}

const GH_REVIEW: Record<string, PRReview> = {
  APPROVED: 'approved', CHANGES_REQUESTED: 'changes_requested', REVIEW_REQUIRED: 'pending'
};

/** Flatten `gh pr list --json …` output. */
export function mapGitHubPRs(raw: unknown): PR[] {
  return (Array.isArray(raw) ? (raw as RawGitHubPR[]) : []).map((p) => {
    const url = p.url ?? '';
    const text = `${p.title ?? ''}\n${p.body ?? ''}`;
    const issues = linkedIssues(text);
    for (const ref of p.closingIssuesReferences ?? []) {
      if (typeof ref?.number === 'number' && !issues.includes(ref.number)) issues.push(ref.number);
    }
    const comments: PRComment[] = [];
    for (const r of p.reviews ?? []) {
      if (r?.body) comments.push({ id: `review:${r.id ?? ''}`, author: r.author?.login ?? '', body: r.body, url, bot: isBotAuthor(r.author?.login, r.author?.is_bot) });
    }
    for (const c of p.comments ?? []) {
      if (c?.body) comments.push({ id: `comment:${c.id ?? ''}`, author: c.author?.login ?? '', body: c.body, url: c.url ?? url, bot: isBotAuthor(c.author?.login, c.author?.is_bot) });
    }
    return {
      number: p.number ?? 0,
      title: p.title ?? '',
      url,
      branch: p.headRefName ?? '',
      state: p.state === 'MERGED' ? 'merged' : p.state === 'CLOSED' ? 'closed' : 'open',
      draft: p.isDraft === true,
      review: GH_REVIEW[p.reviewDecision ?? ''] ?? 'none',
      ...ciFromRollup(p.statusCheckRollup),
      issues,
      comments
    };
  });
}

interface RawGitLabMR {
  iid?: number; title?: string; description?: string | null; web_url?: string;
  state?: string; draft?: boolean; work_in_progress?: boolean; source_branch?: string;
}

/** Flatten `glab mr list --output json`. The list endpoint carries no pipeline,
 *  approvals or notes — `enrichGitLabMR` fills those for open MRs. */
export function mapGitLabMRs(raw: unknown): PR[] {
  return (Array.isArray(raw) ? (raw as RawGitLabMR[]) : []).map((m) => ({
    number: m.iid ?? 0,
    title: m.title ?? '',
    url: m.web_url ?? '',
    branch: m.source_branch ?? '',
    state: m.state === 'merged' ? 'merged' : m.state === 'closed' ? 'closed' : 'open',
    draft: m.draft === true || m.work_in_progress === true,
    review: 'none',
    ci: null,
    ciUrl: null,
    issues: linkedIssues(`${m.title ?? ''}\n${m.description ?? ''}`),
    comments: []
  }));
}

/** The CLI + argv that lists PRs. Exported for the test — every field the
 *  mapper reads must be asked for, or it silently reads as empty. */
export function prListCommand(host: 'github' | 'gitlab'): { cmd: string; args: string[] } {
  if (host === 'gitlab') return { cmd: 'glab', args: ['mr', 'list', '--all', '--output', 'json', '--per-page', '20'] };
  return {
    cmd: 'gh',
    args: ['pr', 'list', '--state', 'all', '--limit', '20', '--json',
      'number,title,body,url,state,isDraft,headRefName,reviewDecision,statusCheckRollup,closingIssuesReferences,reviews,comments']
  };
}

/** Merge now (human pressed the button) or arm the host's auto-merge (opt-in).
 *  Either way the HOST's branch protection is the gate — we never decide. */
export function mergeCommand(host: 'github' | 'gitlab', number: number, auto: boolean): { cmd: string; args: string[] } {
  const n = String(number);
  if (host === 'gitlab') {
    // `--when-pipeline-succeeds` is glab's long-standing name for auto-merge;
    // newer builds alias it to --auto-merge. // TODO-verify on glab ≥ 1.50
    return { cmd: 'glab', args: auto ? ['mr', 'merge', n, '--when-pipeline-succeeds', '--squash', '--yes'] : ['mr', 'merge', n, '--squash', '--yes'] };
  }
  return { cmd: 'gh', args: auto ? ['pr', 'merge', n, '--auto', '--squash'] : ['pr', 'merge', n, '--squash'] };
}

/** Open, not a draft, CI green, and nobody is blocking review. */
export function isReady(pr: PR): boolean {
  return pr.state === 'open' && !pr.draft && pr.ci === 'success' && (pr.review === 'approved' || pr.review === 'none');
}

/** Inline code-review comments need a second call on both hosts. */
async function inlineComments(host: 'github' | 'gitlab', pr: PR, cwd: string): Promise<{ ok: boolean; comments?: PRComment[]; error?: string }> {
  if (host === 'gitlab') {
    const r = await runJson('glab', ['api', `projects/:id/merge_requests/${pr.number}/notes?per_page=50`], cwd);
    if (!r.ok) return { ok: false, error: r.error };
    const notes = Array.isArray(r.json) ? (r.json as Array<{ id?: number; body?: string; system?: boolean; author?: { username?: string; bot?: boolean } }>) : [];
    const comments = notes.filter((n) => !n.system && n.body).map((n) => ({
      id: `note:${n.id ?? ''}`, author: n.author?.username ?? '', body: n.body ?? '', url: `${pr.url}#note_${n.id ?? ''}`,
      bot: n.author?.bot === true
    }));
    return { ok: true, comments };
  }
  const r = await runJson('gh', ['api', `repos/{owner}/{repo}/pulls/${pr.number}/comments?per_page=50`], cwd);
  if (!r.ok) return { ok: false, error: r.error };
  const rows = Array.isArray(r.json) ? (r.json as Array<{ id?: number; body?: string; html_url?: string; user?: { login?: string; type?: string } }>) : [];
  const comments = rows.filter((c) => c.body).map((c) => ({
    id: `inline:${c.id ?? ''}`, author: c.user?.login ?? '', body: c.body ?? '', url: c.html_url ?? pr.url,
    bot: c.user?.type === 'Bot'
  }));
  return { ok: true, comments };
}

/** The authenticated CLI user's login/username — used to filter the agent's
 *  own PR comments out of its own inbox (it wrote them; they are not review
 *  feedback to act on). `gh api ... --jq .login` prints a bare string, not
 *  JSON, so this runs its own text-only spawn rather than `runJson`. */
function runText(cmd: string, args: string[], cwd: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawnCli(cmd, args, cwd);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (e) => resolve({ ok: false, error: e.message }));
    proc.on('close', (code) => {
      if (code !== 0) { resolve({ ok: false, error: stderr.trim() || `${cmd} exited ${code}` }); return; }
      resolve({ ok: true, text: stdout.trim() });
    });
  });
}

/** The logged-in CLI user, so the watcher can drop the agent's own PR
 *  comments (it wrote them) from what gets routed back to its inbox. */
export async function viewerLogin(cwd: string, host: 'github' | 'gitlab'): Promise<{ ok: boolean; login?: string; error?: string }> {
  if (host === 'gitlab') {
    const r = await runJson('glab', ['api', 'user'], cwd);
    if (!r.ok) return { ok: false, error: r.error };
    const login = (r.json as { username?: string } | null)?.username;
    return login ? { ok: true, login } : { ok: false, error: 'glab api user: no username in response' };
  }
  const r = await runText('gh', ['api', 'user', '--jq', '.login'], cwd);
  if (!r.ok) return { ok: false, error: r.error };
  return r.text ? { ok: true, login: r.text } : { ok: false, error: 'gh api user: empty login' };
}

/**
 * Derive a GitLab MR's review state.
 *
 * GitLab does NOT express "changes requested" through the approvals endpoint —
 * it expresses it as unresolved discussion threads, surfaced on the MR object as
 * `blocking_discussions_resolved`. Reading approvals alone made
 * `changes_requested` unreachable, so a rejected MR read `'none'`, `isReady()`
 * returned true, and opt-in auto-merge armed on it. That is why this is a
 * separate, exported, pure function: it is the one piece worth pinning in tests.
 *
 * Unknown is treated as blocking. If the host does not report
 * `blocking_discussions_resolved` at all we return `'pending'` (never `'none'`),
 * because "we could not tell whether anyone is blocking" must never read as
 * "nobody is blocking" on the path that can merge code.
 */
export function gitlabReview(mrView: unknown, approvals: unknown): PRReview {
  const v = (mrView ?? {}) as { blocking_discussions_resolved?: boolean };
  if (v.blocking_discussions_resolved === false) return 'changes_requested';
  const a = (approvals ?? {}) as { approved?: boolean; approvals_required?: number };
  if (a.approved === true) return 'approved';
  if ((a.approvals_required ?? 0) > 0) return 'pending';
  // No approval rule and no *confirmed* clean discussion state — stay pending.
  return v.blocking_discussions_resolved === true ? 'none' : 'pending';
}

/** GitLab's list endpoint has no pipeline/approval data; fetch it per open MR. */
async function enrichGitLabMR(pr: PR, cwd: string): Promise<{ ok: boolean; pr?: PR; error?: string }> {
  const view = await runJson('glab', ['mr', 'view', String(pr.number), '--output', 'json'], cwd);
  if (!view.ok) return { ok: false, error: `mr view: ${view.error}` };
  const v = (view.json ?? {}) as { head_pipeline?: { status?: string; web_url?: string } | null; blocking_discussions_resolved?: boolean };
  const status = v.head_pipeline?.status;
  const ci: PRCI = !status ? null
    : status === 'success' ? 'success'
    : ['failed', 'canceled', 'cancelled'].includes(status) ? 'failure'
    : 'pending';
  const appr = await runJson('glab', ['api', `projects/:id/merge_requests/${pr.number}/approvals`], cwd);
  if (!appr.ok) return { ok: false, error: `approvals: ${appr.error}` };
  const review = gitlabReview(view.json, appr.json);
  return { ok: true, pr: { ...pr, ci, ciUrl: ci === 'failure' ? v.head_pipeline?.web_url ?? null : null, review } };
}

/**
 * List the 20 most recent PRs/MRs (any state) for the repo at `cwd`, enriched
 * so open ones carry inline comments and (GitLab) pipeline + approval state.
 *
 * ponytail: N+1 CLI calls per poll (1 list + 1–3 per OPEN PR). Fine for the
 * handful of PRs a floor has in flight; one failing secondary call fails the
 * poll by design so the caller keeps its previous snapshot rather than
 * accept partial data. Batch via GraphQL if a repo ever has dozens open.
 */
export async function listPRs(cwd: string, host: IssueHost = 'auto'): Promise<{ ok: boolean; prs?: PR[]; error?: string }> {
  const h = host === 'auto' ? detectHost(cwd) : host;
  const { cmd, args } = prListCommand(h);
  const r = await runJson(cmd, args, cwd);
  if (!r.ok) return { ok: false, error: r.error };
  const base = h === 'gitlab' ? mapGitLabMRs(r.json) : mapGitHubPRs(r.json);
  const prs: PR[] = [];
  for (const pr of base) {
    if (pr.state !== 'open') { prs.push(pr); continue; }
    const enriched = h === 'gitlab' ? await enrichGitLabMR(pr, cwd) : { ok: true as const, pr };
    if (!enriched.ok) return { ok: false, error: enriched.error };
    const inline = await inlineComments(h, pr, cwd);
    if (!inline.ok) return { ok: false, error: inline.error };
    prs.push({ ...enriched.pr!, comments: [...(enriched.pr?.comments ?? []), ...(inline.comments ?? [])] });
  }
  return { ok: true, prs };
}

/** Merge now, or arm the host's auto-merge. The host's protection rules decide. */
export async function mergePR(cwd: string, number: number, auto: boolean, host: IssueHost = 'auto'): Promise<{ ok: boolean; error?: string }> {
  const h = host === 'auto' ? detectHost(cwd) : host;
  const { cmd, args } = mergeCommand(h, number, auto);
  const r = await runJson(cmd, args, cwd);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
