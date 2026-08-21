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

/**
 * List up to 30 open issues in the repo at `cwd`, via `gh` or `glab` per
 * `filter.host`, optionally narrowed by search / assigned-to-me.
 *
 * Returns `{ ok: false, error }` on any failure — spawn error (e.g. the CLI is
 * not installed), non-zero exit (e.g. unauthenticated / not a repo), or a JSON
 * parse failure — so callers never have to try/catch.
 */
export function listIssues(cwd: string, filter: IssueFilter = {}): Promise<{ ok: boolean; issues?: GHIssue[]; error?: string }> {
  return new Promise((resolve) => {
    const host = !filter.host || filter.host === 'auto' ? detectHost(cwd) : filter.host;
    const { cmd, args } = issueListCommand(host, filter);
    const proc = spawn(cmd, args, { cwd });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (e) => resolve({ ok: false, error: e.message }));
    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: stderr.trim() || `${cmd} exited ${code}` });
        return;
      }
      try {
        resolve({ ok: true, issues: mapIssues(JSON.parse(stdout)) });
      } catch (e) {
        resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    });
  });
}

/** A CI (GitHub Actions) workflow run, normalized for the renderer. */
export interface CIRun {
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
}

/** Shape `gh run list --json` emits for each run (the fields we ask for). */
interface RawCIRun {
  name?: string;
  status?: string;
  conclusion?: string | null;
  url?: string;
  databaseId?: number;
}

/**
 * List up to 5 recent CI (GitHub Actions) workflow runs in the repo at `cwd`
 * via the `gh` CLI.
 *
 * Returns `{ ok: false, error }` on any failure — spawn error (e.g. `gh` not
 * installed), non-zero exit (e.g. unauthenticated / not a repo / no Actions),
 * or a JSON parse failure — so callers never have to try/catch.
 */
export function listCIRuns(cwd: string): Promise<{ ok: boolean; runs?: CIRun[]; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawnCli('gh', ['run', 'list', '--limit', '5', '--json', 'name,status,conclusion,url,databaseId'], cwd);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (e) => resolve({ ok: false, error: e.message }));
    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: stderr.trim() || `gh exited ${code}` });
        return;
      }
      try {
        const raw = JSON.parse(stdout) as RawCIRun[];
        const runs: CIRun[] = (Array.isArray(raw) ? raw : []).map((r) => ({
          name: r.name ?? '',
          status: r.status ?? '',
          conclusion: r.conclusion ?? null,
          url: r.url ?? ''
        }));
        resolve({ ok: true, runs });
      } catch (e) {
        resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    });
  });
}
