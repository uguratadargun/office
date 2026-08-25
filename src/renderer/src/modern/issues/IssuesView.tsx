import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, Search } from 'lucide-react';
import { useStore } from '@/store/store';
import { readIssueRepo, writeIssueRepo } from '@/components/issuesTab';
import { chipState, repoRefFromUrl, reviewKey, type ReviewRecord } from '@shared/prReview';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { cn } from '../lib/cn';
import {
  ISSUE_PAGE_SIZE, ciTone, issuesEmptyMessage, openPrs, pageCapNote,
  prSuffix, prsForIssue, railTone, resolveRepo, routingHint, type RailTone, type Segment
} from './issuesData';

/**
 * Issues and pull requests — ONE nav entry, two segments (MD-88 ruling).
 *
 * Ported from the pixel `RepoTab`; the decisions live in `issuesData.ts` and are
 * tested. The two things this screen must not flatten, both carried over
 * deliberately:
 *
 *   - the CI dot is what the HOST's machines ran, the verdict rail is what the
 *     LOCAL review thought of the diff. Two facts, two marks. Merged, a green
 *     pipeline would colour an unreviewed change.
 *   - `→name` on a PR is who HEARS about it (the agent sitting on its head
 *     branch), not its author and not who approved it.
 */

/** An issue as `window.cth.githubIssues` returns it (labels/assignees flattened). */
interface GHIssue {
  number: number;
  title: string;
  body?: string;
  url: string;
  labels: string[];
}
type PR = Awaited<ReturnType<typeof window.cth.githubPRs>>['prs'][number];

const DEBOUNCE_MS = 400;

/** The CI dot. `none` is a hairline ring, not a grey fill — "no pipeline" is an
 *  absence, and a filled grey dot reads as a fourth state. */
function CiDot({ ci }: { ci: PR['ci'] }) {
  const tone = ciTone(ci);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'size-2 shrink-0 rounded-full',
            tone === 'ok' && 'bg-emerald-600 dark:bg-emerald-500',
            tone === 'bad' && 'bg-destructive',
            tone === 'wait' && 'bg-amber-500',
            tone === 'none' && 'border border-border'
          )}
        />
      </TooltipTrigger>
      <TooltipContent>CI: {ci ?? 'no pipeline'}</TooltipContent>
    </Tooltip>
  );
}

/** The local review's verdict, as a 2px rail down the left of the ROW. `none`
 *  draws nothing: an unreviewed PR must look unreviewed, and a grey rail reads
 *  as a third verdict. */
function railClass(tone: RailTone): string {
  return cn(
    'border-l-2',
    tone === 'ready' && 'border-l-emerald-600 dark:border-l-emerald-500',
    tone === 'notReady' && 'border-l-destructive',
    tone === 'running' && 'border-l-muted-foreground',
    tone === 'none' && 'border-l-transparent'
  );
}

export function IssuesView() {
  const boss = useStore((s) => s.bossName);
  const agents = useStore((s) => s.agents);
  const requestDispatchSeed = useStore((s) => s.requestDispatchSeed);
  const requestCommandCenterTab = useStore((s) => s.requestCommandCenterTab);

  const [segment, setSegment] = useState<Segment>('issues');
  const [repos, setRepos] = useState<string[]>([]);
  const [repo, setRepo] = useState<string>(readIssueRepo);
  const [issues, setIssues] = useState<GHIssue[]>([]);
  const [fetched, setFetched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [mine, setMine] = useState(false);
  const [prs, setPrs] = useState<PR[]>([]);
  const [prError, setPrError] = useState<string | null>(null);
  const [mergeBusy, setMergeBusy] = useState<number | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Record<string, ReviewRecord>>({});
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const fetchSeq = useRef(0);
  const searchArmed = useRef(false);
  const host = useRef<'auto' | 'github' | 'gitlab'>('auto');

  useEffect(() => {
    window.cth.getConfig().then((c) => {
      const list = c.registeredRepos ?? [];
      setRepos(list);
      setRepo((cur) => resolveRepo(list, cur));
      host.current = c.issueHost ?? 'auto';
    }).catch(() => { /* an unreadable config only costs the picker */ });
    window.cth.prReviews().then(setReviews).catch(() => { /* an unreadable cache only costs the rail */ });
  }, []);

  // PRs follow the watcher: seed from its last poll, then take its pushes. The
  // watcher owns the polling; this only renders.
  useEffect(() => {
    if (!repo) { setPrs([]); setPrError(null); return; }
    let alive = true;
    setMergeError(null);
    window.cth.githubPRs(repo).then((r) => { if (alive) { setPrs(r.prs); setPrError(r.error); } }).catch(() => { /* noop */ });
    const off = window.cth.onGithubPRs((e) => { if (alive && e.cwd === repo) { setPrs(e.prs); setPrError(e.error); } });
    return () => { alive = false; off(); };
  }, [repo]);

  // Search and "mine" are pushed DOWN to gh/glab, never applied to the fetched
  // page — filtering ten rows here would hide every match past the tenth.
  const fetchIssues = useCallback(async (filter?: { search?: string; mine?: boolean }) => {
    if (!repo) { setIssuesError('No repo selected.'); return; }
    // Typing fires overlapping fetches and only the newest may paint: without
    // this a slow early query landing late overwrites the results for what was
    // typed after it, and the list ends up showing a prefix of the query.
    const seq = ++fetchSeq.current;
    setLoading(true);
    setIssuesError(null);
    try {
      const res = await window.cth.githubIssues(repo, { host: host.current, ...(filter ?? { search: query, mine }) });
      if (seq !== fetchSeq.current) return;
      setFetched(true);
      if (res.ok) setIssues((res.issues ?? []).slice(0, ISSUE_PAGE_SIZE) as GHIssue[]);
      else { setIssues([]); setIssuesError(res.error ?? 'Failed to fetch issues.'); }
    } catch (e) {
      if (seq !== fetchSeq.current) return;
      setFetched(true);
      setIssues([]);
      setIssuesError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }, [repo, query, mine]);

  // Search-as-you-type, debounced — one shell-out per pause, not per letter.
  // The first run is skipped so merely opening the view does not shell out, and
  // it is scoped to the issues segment so switching to PRs never re-fetches.
  useEffect(() => {
    if (segment !== 'issues') return;
    if (!searchArmed.current) { searchArmed.current = true; return; }
    const t = setTimeout(() => { void fetchIssues({ search: query, mine }); }, DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mine, repo, segment]);

  const chooseRepo = (next: string) => { setRepo(next); writeIssueRepo(next); };
  const agentName = (id: string) => (id === 'god' ? boss : (agents.find((a) => a.id === id)?.name ?? id));
  const reviewOf = (pr: PR): ReviewRecord | undefined => {
    const ref = repoRefFromUrl(pr.url);
    return ref ? reviews[reviewKey(ref, pr.number)] : undefined;
  };

  const assignIssue = (issue: GHIssue) => {
    requestDispatchSeed(
      `Issue #${issue.number}: ${issue.title}\n\n${(issue.body ?? '').slice(0, 200)}\n\nURL: ${issue.url}\n\n`
      + `When the work is done, open a PR whose description says "Closes #${issue.number}" — the harness tracks the PR, routes CI failures and review comments back to the owner, and tells you when it merges.`
    );
    requestCommandCenterTab('floor');
  };

  const mergeNow = async (pr: PR) => {
    if (!repo) return;
    setMergeBusy(pr.number);
    setMergeError(null);
    try {
      const r = await window.cth.githubMergePR(repo, pr.number);
      if (!r.ok) setMergeError(r.error ?? 'Merge failed.');
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : String(e));
    } finally { setMergeBusy(null); }
  };

  const reviewNow = async (pr: PR) => {
    if (!repo) return;
    setReviewing(pr.number);
    setReviewError(null);
    try {
      const r = await window.cth.prReviewRun(repo, pr.number);
      if (r.ok && r.record) setReviews((prev) => ({ ...prev, [r.record!.key]: r.record! }));
      else setReviewError(r.error ?? 'Review failed.');
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : String(e));
    } finally { setReviewing(null); }
  };

  const open = openPrs(prs);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── One sticky header for both segments ───────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-md bg-secondary p-0.5">
            {(['issues', 'prs'] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={segment === s ? 'default' : 'ghost'}
                className="h-7"
                onClick={() => setSegment(s)}
              >
                {s === 'issues' ? 'Issues' : 'PRs'}
                {s === 'prs' && open.length > 0 && (
                  <Badge variant={segment === s ? 'secondary' : 'outline'} className="ml-1">{open.length}</Badge>
                )}
              </Button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {repos.length > 0 && (
              <Select value={repo} onValueChange={chooseRepo}>
                <SelectTrigger size="sm" className="w-[260px]">
                  <SelectValue placeholder="Pick a repo" />
                </SelectTrigger>
                <SelectContent>
                  {repos.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {segment === 'issues' && (
              <Button size="sm" onClick={() => void fetchIssues()} disabled={loading || !repo}>
                <RefreshCw className={cn(loading && 'animate-spin')} />
                {loading ? 'Fetching…' : 'Fetch'}
              </Button>
            )}
          </div>
        </div>

        {/* The search box and "assigned to me" belong to the ISSUES segment: the
            PR list follows the watcher and has nothing to fetch. */}
        {segment === 'issues' && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search title and description…"
                aria-label="Search issues"
                className="h-8 w-full rounded-md border bg-background pl-8 pr-3 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>
            <Button size="sm" variant={mine ? 'default' : 'outline'} onClick={() => setMine((v) => !v)} disabled={loading}>
              Assigned to me
            </Button>
          </div>
        )}
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 px-6 py-4">
          {repos.length === 0 && (
            <Empty>No registered repos — add one in Settings to see its issues and pull requests.</Empty>
          )}

          {repos.length > 0 && segment === 'issues' && (
            <>
              {issuesError && <ErrorLine text={issuesError} onDismiss={() => setIssuesError(null)} />}
              {loading && issues.length === 0 && [0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
              {!issuesError && !loading && issues.length === 0 && (
                <Empty>{issuesEmptyMessage({ fetched, filtered: !!query.trim() || mine })}</Empty>
              )}
              {issues.map((issue) => {
                const linked = prsForIssue(prs, issue.number);
                return (
                  <article key={issue.number} className="flex flex-col gap-2 border-b pb-3 last:border-b-0">
                    <div className="flex items-start gap-3">
                      <a
                        href={issue.url} target="_blank" rel="noreferrer"
                        className="group flex-1 text-[13px] leading-5 hover:underline"
                      >
                        <span className="text-muted-foreground">#{issue.number}</span>{' '}
                        {issue.title}
                        <ExternalLink className="ml-1 inline size-3 align-baseline text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </a>
                      <Button size="sm" variant="outline" className="shrink-0" onClick={() => assignIssue(issue)}>
                        Assign
                      </Button>
                    </div>
                    {issue.labels.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {issue.labels.map((l) => <Badge key={l} variant="secondary">{l}</Badge>)}
                      </div>
                    )}
                    {linked.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        {linked.map((pr) => (
                          <PrChip
                            key={pr.number} pr={pr} record={reviewOf(pr)}
                            running={reviewing === pr.number} routesTo={agentName(pr.owner)} boss={boss}
                          />
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
              {pageCapNote(issues.length) && !issuesError && (
                <p className="pt-1 text-xs text-muted-foreground">{pageCapNote(issues.length)}</p>
              )}
            </>
          )}

          {repos.length > 0 && segment === 'prs' && (
            <>
              {prError && <ErrorLine text={`PR watcher: ${prError}`} />}
              {mergeError && <ErrorLine text={mergeError} onDismiss={() => setMergeError(null)} />}
              {reviewError && <ErrorLine text={reviewError} onDismiss={() => setReviewError(null)} />}
              {/* A tab of its own has to say why it is empty — a blank panel
                  reads as broken, and "no open PRs" is a real answer. */}
              {!prError && open.length === 0 && <Empty>No open pull requests.</Empty>}
              {open.map((pr) => {
                const record = reviewOf(pr);
                const running = reviewing === pr.number;
                return (
                  <div
                    key={pr.number}
                    className={cn('flex items-center gap-3 rounded-md py-2 pl-3 pr-1', railClass(railTone(record, running)))}
                  >
                    <CiDot ci={pr.ci} />
                    <a href={pr.url} target="_blank" rel="noreferrer" className="text-[13px] text-muted-foreground hover:underline">
                      #{pr.number}
                    </a>
                    <span className="min-w-0 flex-1 truncate text-[13px]">{pr.title}</span>
                    {prSuffix(pr) && <Badge variant="secondary">{prSuffix(pr)}</Badge>}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="shrink-0 text-xs text-muted-foreground">→{agentName(pr.owner)}</span>
                      </TooltipTrigger>
                      <TooltipContent>{routingHint(agentName(pr.owner), pr.branch, boss)}</TooltipContent>
                    </Tooltip>
                    <Button size="sm" variant="ghost" className="shrink-0" disabled={reviewing !== null} onClick={() => void reviewNow(pr)}>
                      {running ? 'Reviewing…' : record ? 'Re-review' : 'Review'}
                    </Button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            size="sm" className="shrink-0"
                            variant={pr.ready ? 'default' : 'outline'}
                            disabled={pr.draft || mergeBusy === pr.number}
                            onClick={() => void mergeNow(pr)}
                          >
                            {mergeBusy === pr.number ? 'Merging…' : 'Merge'}
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {pr.ready
                          ? 'CI green and review not blocking'
                          : 'Not marked ready by the host — branch protection still decides'}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

/** A PR beside an issue. Here the chip IS the outermost thing that is this PR,
 *  so it carries the verdict; in the PR list the ROW carries it instead and the
 *  chip's is off — two frames read as two verdicts. */
function PrChip({ pr, record, running, routesTo, boss }: {
  pr: PR; record: ReviewRecord | undefined; running: boolean; routesTo: string; boss: string;
}) {
  const state = chipState(record, running);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={pr.url} target="_blank" rel="noreferrer"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs hover:bg-accent',
            state === 'green' && 'border-emerald-600/60 dark:border-emerald-500/60',
            state === 'red' && 'border-destructive/60'
          )}
        >
          <CiDot ci={pr.ci} />
          PR #{pr.number}
          {prSuffix(pr) && <span className="text-muted-foreground">· {prSuffix(pr)}</span>}
          <span className="text-muted-foreground">· →{routesTo}</span>
        </a>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {pr.title}
        <br />{routingHint(routesTo, pr.branch, boss)}
        <br />{record ? `Local review: ${record.verdict}` : 'Not reviewed locally yet.'}
      </TooltipContent>
    </Tooltip>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-[13px] text-muted-foreground">{children}</p>;
}

/** Errors are shown, dismissible, and never replace the content behind them. */
function ErrorLine({ text, onDismiss }: { text: string; onDismiss?: () => void }) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[13px]">
      <span className="min-w-0 flex-1 break-words">{text}</span>
      {onDismiss && (
        <Button size="icon-xs" variant="ghost" onClick={onDismiss} aria-label="Dismiss">×</Button>
      )}
    </div>
  );
}
