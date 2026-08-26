import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, Search } from 'lucide-react';
import { useStore } from '@/store/store';
import { navigate } from '../navigation';
import { readIssueRepo, writeIssueRepo } from '@/components/issuesTab';
import { chipState, repoRefFromUrl, reviewKey, type ReviewRecord } from '@shared/prReview';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { ScrollArea } from '../components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { IconButton } from '../components/IconButton';
import { cn } from '../lib/cn';
import { AssigneeList, AssigneeStack } from './AssigneeStack';
import type { Person } from '@shared/people';
import {
  canReview, ciTone, issuesEmptyMessage, openPrs, prSuffix, prsForIssue, railTone, repoLabel,
  resolveRepo, routingHint, type RailTone, type Segment
} from './issuesData';
import { ISSUE_PAGE_SIZE, appendPage, hasMorePages, pageCapNote, pageLimit } from './paging';

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
  /** Assignees with names + avatars (MD-128). Optional because this local type
   *  is re-declared rather than imported — the renderer never imports main — so
   *  an older payload simply draws no faces instead of throwing. */
  people?: Person[];
}
type PR = Awaited<ReturnType<typeof window.cth.githubPRs>>['prs'][number];

const DEBOUNCE_MS = 400;

/** The CI dot. `none` is a hairline ring, not a grey fill — "no pipeline" and a
 *  canceled run are both an ABSENCE of a verdict, and a filled grey dot reads as
 *  a verdict of its own. The tooltip still names which absence it is. */
function CiDot({ ci }: { ci: PR['ci'] }) {
  const tone = ciTone(ci);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'size-2 shrink-0 rounded-full',
            tone === 'ok' && 'bg-success',
            tone === 'bad' && 'bg-destructive',
            tone === 'wait' && 'bg-warning',
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
    tone === 'ready' && 'border-l-success',
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
  const select = useStore((s) => s.select);

  const [segment, setSegment] = useState<Segment>('issues');
  const [repos, setRepos] = useState<string[]>([]);
  const [repo, setRepo] = useState<string>(readIssueRepo);
  const [issues, setIssues] = useState<GHIssue[]>([]);
  const [fetched, setFetched] = useState(false);
  const [loading, setLoading] = useState(false);
  /** How many pages have been ASKED for. Page 1 is the automatic first load;
   *  every sentinel hit adds one. A filter change puts it back to 1 — the old
   *  page count belongs to the old query. */
  const [pages, setPages] = useState(1);
  const [morePages, setMorePages] = useState(false);
  /** PRs arrive whole from the watcher, so their paging is how many are
   *  RENDERED, not how many are fetched. Same 20 at a time, same sentinel. */
  const [prPages, setPrPages] = useState(1);
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
  const [preview, setPreview] = useState<{ record: ReviewRecord; text: string } | null>(null);

  const fetchSeq = useRef(0);
  const searchArmed = useRef(false);
  /** Set synchronously the moment the sentinel fires, cleared when the fetch
   *  settles. An observer can fire several times while a row is scrolling into
   *  place, and `loading` is React state — it is not true yet on the second
   *  call in the same tick, which is exactly how a sentinel launches four
   *  identical `gh` calls at once. */
  const pageInFlight = useRef(false);
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
  const fetchIssues = useCallback(async (
    filter?: { search?: string; mine?: boolean },
    /** Which page this call is FOR. Page 1 replaces the list; a later page
     *  merges onto it — neither CLI has an offset, so page N is "ask for N
     *  pages' worth" and `appendPage` dedupes the overlap. */
    page = 1
  ) => {
    if (!repo) { setIssuesError('No repo selected.'); return; }
    // Typing fires overlapping fetches and only the newest may paint: without
    // this a slow early query landing late overwrites the results for what was
    // typed after it, and the list ends up showing a prefix of the query.
    const seq = ++fetchSeq.current;
    const askedFor = pageLimit(page);
    setLoading(true);
    setIssuesError(null);
    try {
      const res = await window.cth.githubIssues(repo, {
        host: host.current, ...(filter ?? { search: query, mine }), limit: askedFor
      });
      if (seq !== fetchSeq.current) return;
      setFetched(true);
      if (res.ok) {
        const batch = (res.issues ?? []) as GHIssue[];
        setIssues((prev) => (page === 1 ? batch : appendPage(prev, batch)));
        // A short answer is the only evidence the host has run out.
        setMorePages(hasMorePages(batch.length, askedFor));
        setPages(page);
      } else { setIssues([]); setMorePages(false); setIssuesError(res.error ?? 'Failed to fetch issues.'); }
    } catch (e) {
      if (seq !== fetchSeq.current) return;
      setFetched(true);
      setIssues([]);
      setMorePages(false);
      setIssuesError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
      pageInFlight.current = false;
    }
  }, [repo, query, mine]);

  /** One more page of issues. The ref is the guard, not `loading`: see its
   *  declaration. A failed page leaves the list exactly as it was. */
  const loadMoreIssues = useCallback(() => {
    if (pageInFlight.current || loading || !morePages) return;
    pageInFlight.current = true;
    void fetchIssues({ search: query, mine }, pages + 1);
  }, [fetchIssues, loading, morePages, pages, query, mine]);

  // Search-as-you-type, debounced — one shell-out per pause, not per letter.
  //
  // The very first run is skipped, so mounting alone shells out nothing. The
  // repo then resolves from config a tick later, and THAT re-run does fetch:
  // arriving at a repo you have selected and seeing an empty list you have to
  // press a button to fill is worse than one automatic load. Scoped to the
  // issues segment, so switching to PRs and back never re-fetches.
  useEffect(() => {
    if (segment !== 'issues') return;
    if (!searchArmed.current) { searchArmed.current = true; return; }
    // A new filter is a new list: page 1, and no stale "there is more" from the
    // previous query's last answer.
    setPages(1);
    setMorePages(false);
    const t = setTimeout(() => { void fetchIssues({ search: query, mine }, 1); }, DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mine, repo, segment]);

  const chooseRepo = (next: string) => { setRepo(next); writeIssueRepo(next); };
  const agentName = (id: string) => (id === 'god' ? boss : (agents.find((a) => a.id === id)?.name ?? id));
  const reviewOf = (pr: PR): ReviewRecord | undefined => {
    const ref = repoRefFromUrl(pr.url);
    return ref ? reviews[reviewKey(ref, pr.number)] : undefined;
  };

  /**
   * Hand the issue to the dispatch box and GO THERE.
   *
   * This used to write `requestDispatchSeed` + `requestCommandCenterTab('floor')`
   * and stop — both of which only the pixel Command Center reads, so in this UI
   * Assign was a button that did nothing visible at all: you stayed on Issues
   * with nothing seeded anywhere. The seed request survives (the Agents overview
   * consumes it now); the tab request is kept for the pixel UI, and the actual
   * navigation is the part that was missing.
   *
   * Clearing the selection is not incidental — the Agents area shows the
   * dispatch box only with no agent selected, so navigating without this would
   * land the user on some agent's terminal instead of the box holding their
   * issue.
   */
  const assignIssue = (issue: GHIssue) => {
    requestDispatchSeed(
      `Issue #${issue.number}: ${issue.title}\n\n${(issue.body ?? '').slice(0, 200)}\n\nURL: ${issue.url}\n\n`
      + `When the work is done, open a PR whose description says "Closes #${issue.number}" — the harness tracks the PR, routes CI failures and review comments back to the owner, and tells you when it merges.`
    );
    requestCommandCenterTab('floor');
    select(null);
    navigate('agents');
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

  /** Open (or refresh) the report dialog for a verdict. The report is a file on
   *  disk, read on demand — the record only carries the verdict and its path. */
  const showReport = async (record: ReviewRecord) => {
    setReviewError(null);
    try {
      const r = await window.cth.prReviewReport(record.path);
      if (r.ok && r.text) setPreview({ record, text: r.text });
      else setReviewError(r.error ?? 'Could not read the report.');
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : String(e));
    }
  };

  const reviewNow = async (pr: PR) => {
    if (!repo) return;
    setReviewing(pr.number);
    setReviewError(null);
    try {
      const r = await window.cth.prReviewRun(repo, pr.number);
      if (r.ok && r.record) {
        const record = r.record;
        setReviews((prev) => ({ ...prev, [record.key]: record }));
        // Re-run from inside the dialog swaps in the NEW report rather than
        // leaving the previous verdict on screen under a fresh timestamp.
        setPreview((cur) => {
          if (cur && cur.record.number === pr.number) void showReport(record);
          return cur;
        });
      } else setReviewError(r.error ?? 'Review failed.');
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : String(e));
    } finally { setReviewing(null); }
  };

  const open = openPrs(prs);
  /** The watcher hands over every PR it has; this is how many are on screen. */
  const shownPrs = open.slice(0, pageLimit(prPages));
  const morePrs = shownPrs.length < open.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── One sticky header for both segments ───────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <Tabs value={segment} onValueChange={(v) => setSegment(v as Segment)}>
            <TabsList>
              <TabsTrigger value="issues">Issues</TabsTrigger>
              <TabsTrigger value="prs">
                PRs
                {open.length > 0 && <Badge variant="secondary" className="ml-1.5">{open.length}</Badge>}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="ml-auto flex items-center gap-2">
            {repos.length > 0 && (
              <Select value={repo} onValueChange={chooseRepo}>
                <SelectTrigger size="sm" className="w-[260px]">
                  <SelectValue placeholder="Pick a repo" />
                </SelectTrigger>
                <SelectContent>
                  {/* Basename first — the trigger truncates at the end, and the
                      folder's name is the half worth keeping. See `repoLabel`. */}
                  {repos.map((r) => <SelectItem key={r} value={r}>{repoLabel(r)}</SelectItem>)}
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
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search title and description…"
                aria-label="Search issues"
                className="h-8 pl-8"
              />
            </div>
            {/* A pressed filter is a toggle, not the page's action: it says so
                with aria-pressed and a ring, not by going solid. */}
            <Button
              size="sm" variant="outline" aria-pressed={mine} disabled={loading}
              className={cn(mine && 'border-ring bg-accent')}
              onClick={() => setMine((v) => !v)}
            >
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
              {/* Review is reachable from an issue's chips now, so its failures
                  have to be visible on this segment too — otherwise a review
                  started here fails into an error surface you cannot see. */}
              {reviewError && <ErrorLine text={reviewError} onDismiss={() => setReviewError(null)} />}
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
                        className="group flex-1 text-sm leading-5 hover:underline"
                      >
                        <span className="text-muted-foreground">#{issue.number}</span>{' '}
                        {issue.title}
                        <ExternalLink className="ml-1 inline size-3 align-baseline text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </a>
                      {/* Who the HOST says owns it, next to the button that
                          hands it to an agent — the two answer the same
                          question from opposite ends (MD-128). */}
                      <AssigneeStack people={issue.people} label="Assigned to" />
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
                      // Wide gap BETWEEN chip groups, tight gap inside one: with
                      // both at 8px, "PR #2094 · ready  Review  PR #2088" gave a
                      // button no clearer owner than the chip on its right.
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                        {/* The chip AND its actions: reviewing the PR that closes
                            the issue you are reading was previously only
                            reachable by switching to the PRs segment and finding
                            it again. Same handlers as that segment, so a review
                            started here lands in the same cache and rail. */}
                        {linked.map((pr) => (
                          <span key={pr.number} className="inline-flex items-center gap-1">
                            <PrChip
                              pr={pr} record={reviewOf(pr)}
                              running={reviewing === pr.number} routesTo={agentName(pr.owner)} boss={boss}
                            />
                            <PrActions
                              pr={pr} record={reviewOf(pr)} running={reviewing === pr.number}
                              busy={reviewing !== null} boss={boss} size="xs"
                              onReview={() => void reviewNow(pr)} onReport={(r) => void showReport(r)}
                            />
                          </span>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
              {!issuesError && issues.length > 0 && morePages && (
                <PageSentinel loading={loading} onLoadMore={loadMoreIssues} />
              )}
              {!issuesError && pageCapNote(issues.length, morePages) && (
                <p className="pt-1 text-xs text-muted-foreground">{pageCapNote(issues.length, morePages)}</p>
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
              {shownPrs.map((pr) => {
                const record = reviewOf(pr);
                const running = reviewing === pr.number;
                return (
                  <div
                    key={pr.number}
                    className={cn('flex items-center gap-3 rounded-md py-2 pl-3 pr-1', railClass(railTone(record, running)))}
                  >
                    <CiDot ci={pr.ci} />
                    <a href={pr.url} target="_blank" rel="noreferrer" className="text-sm text-muted-foreground hover:underline">
                      #{pr.number}
                    </a>
                    <span className="min-w-0 flex-1 truncate text-sm">{pr.title}</span>
                    <AssigneeStack people={pr.assignees} label="Assigned to" />
                    {/* MD-130 — the decision and the faces that made it travel
                        together. `prSuffix` returns '' when nobody is attached,
                        so an unattributed "approved" cannot be drawn. */}
                    {prSuffix(pr) && (
                      <>
                        <Badge variant="secondary" className="shrink-0">{prSuffix(pr)}</Badge>
                        <AssigneeStack people={pr.decidedBy} label={pr.review === 'approved' ? 'Approved by' : 'Changes requested by'} />
                      </>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="shrink-0 text-xs text-muted-foreground">→{agentName(pr.owner)}</span>
                      </TooltipTrigger>
                      <TooltipContent>{routingHint(agentName(pr.owner), pr.branch, boss)}</TooltipContent>
                    </Tooltip>
                    <PrActions
                      pr={pr} record={record} running={running} busy={reviewing !== null} boss={boss}
                      onReview={() => void reviewNow(pr)} onReport={(r) => void showReport(r)}
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            size="sm" className="shrink-0"
                            // Outline whatever the verdict: one filled button
                            // per view, and a list of ten ready PRs would
                            // otherwise be ten of them. Ready is already said
                            // twice — the row's left rail and the CI dot.
                            variant="outline"
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
              {/* The watcher has already fetched these, so "more" is instant —
                  no skeleton to show, and nothing in flight to guard against. */}
              {morePrs && <PageSentinel loading={false} onLoadMore={() => setPrPages((p) => p + 1)} />}
              {!prError && shownPrs.length > 0 && pageCapNote(shownPrs.length, morePrs) && (
                <p className="pt-1 text-xs text-muted-foreground">{pageCapNote(shownPrs.length, morePrs)}</p>
              )}
            </>
          )}
        </div>
      </ScrollArea>

      <ReviewDialog
        preview={preview}
        pr={prs.find((p) => p.number === preview?.record.number)}
        busy={reviewing !== null}
        onClose={() => setPreview(null)}
        onRerun={() => {
          const pr = prs.find((p) => p.number === preview?.record.number);
          if (pr) void reviewNow(pr);
        }}
      />
    </div>
  );
}

/**
 * The local review's report. A Dialog rather than a Sheet: it is something you
 * read and then decide about, not a panel you work alongside the list.
 *
 * The body is rendered as preformatted text, not markdown. The report is written
 * by an engine and its exact shape is what `parseVerdict` reads — showing it
 * verbatim means what you read is what was parsed, and a heading that failed to
 * render is visible rather than silently swallowed.
 */
function ReviewDialog({ preview, pr, busy, onClose, onRerun }: {
  preview: { record: ReviewRecord; text: string } | null;
  /** The live PR behind the report, for the people rows. Absent if it has
   *  since left the list — the report still reads, it just loses the faces. */
  pr: PR | undefined;
  busy: boolean;
  onClose: () => void;
  onRerun: () => void;
}) {
  return (
    <Dialog open={!!preview} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        {preview && (
          <>
            <DialogHeader>
              <DialogTitle>Review of PR #{preview.record.number}</DialogTitle>
              <DialogDescription>
                {preview.record.verdict === 'ready' ? 'READY'
                  : preview.record.verdict === 'not_ready' ? `NOT READY — ${preview.record.reason ?? 'see report'}`
                    : 'No verdict — the engine did not answer in the required form'}
                {' · '}{preview.record.engine}
                {' · '}{new Date(preview.record.ts).toLocaleString()}
              </DialogDescription>
            </DialogHeader>
            {/* MD-128/MD-130 — modern Issues has no issue-detail pane; this
                dialog is the one DETAIL surface a PR has, so the full names go
                here. `AssigneeList` prints them out rather than relying on a
                tooltip, which is the difference between a row and a pane. */}
            {pr && (
              <div className="flex flex-col gap-1.5">
                <AssigneeList people={pr.assignees} label="Assigned to" />
                <AssigneeList
                  people={pr.decidedBy}
                  label={pr.review === 'approved' ? 'Approved by' : 'Changes requested by'}
                />
              </div>
            )}
            <ScrollArea className="max-h-[60vh]">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5">{preview.text}</pre>
            </ScrollArea>
            <DialogFooter>
              <Button variant="outline" onClick={onRerun} disabled={busy}>
                {busy ? 'Reviewing…' : 'Re-run review'}
              </Button>
              <Button onClick={onClose}>Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Review / Report for one PR, in both places a PR appears.
 *
 * Ported from the pixel `PrActions`, and shared for the reason the pixel UI
 * shared it: the PR list and an issue's chips must not drift into two different
 * review flows. Both call the same `prReviewRun` / `prReviewReport` and write
 * the same cache, so a review started beside an issue shows up on the PR row.
 *
 * `Review` is gated on the PR still being open (`canReview`) — beside an issue
 * the chips include merged and closed PRs, and re-reviewing a merged diff spends
 * an engine run on a decision nothing can act on. `Report` is not gated: a
 * verdict already on disk stays readable whatever happened to the PR since.
 */
function PrActions({ pr, record, running, busy, boss, size = 'sm', onReview, onReport }: {
  pr: PR;
  record: ReviewRecord | undefined;
  running: boolean;
  /** A review is running SOMEWHERE — one engine, one diff at a time. */
  busy: boolean;
  boss: string;
  /** `xs` beside a chip: a default-size button next to a rounded-full chip reads
   *  as the primary thing in the issue row, and that is Assign, one line up. The
   *  PR list keeps `sm`, where it sits in a row of `sm` buttons beside Merge. */
  size?: 'sm' | 'xs';
  onReview: () => void;
  onReport: (record: ReviewRecord) => void;
}) {
  // Nothing to offer — render nothing rather than an empty flex gap beside a chip.
  if (!canReview(pr) && !record) return null;
  return (
    <>
      {canReview(pr) && (
        <Tooltip>
          {/* The span is load-bearing: `disabled` sets `pointer-events-none`, so
              a disabled Button IS the Radix trigger that never sees a hover, and
              the tooltip explaining why it is off can never open. Wrapping keeps
              the reason reachable while another review is running. */}
          <TooltipTrigger asChild>
            <span className="shrink-0">
              <Button size={size} variant="ghost" disabled={busy} onClick={onReview}>
                {running ? 'Reviewing…' : record ? 'Re-review' : 'Review'}
              </Button>
            </span>
          </TooltipTrigger>
          {/* The pixel tooltip's real payload is the last line: a local review
              is never posted to the host, and without saying so the button
              reads as "request changes on GitHub". */}
          <TooltipContent className="max-w-xs">
            {record
              ? `Re-read this diff locally (last run ${new Date(record.ts).toLocaleString()}, by ${record.engine}).`
              : `Have ${boss} read this diff and give a verdict.`}
            <br />Local only — nothing is posted to the host.
          </TooltipContent>
        </Tooltip>
      )}
      {record && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size={size} variant="ghost" className="shrink-0" onClick={() => onReport(record)}>
              Report
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open {boss}&apos;s review of PR #{pr.number}</TooltipContent>
        </Tooltip>
      )}
    </>
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
            state === 'green' && 'border-success/60',
            state === 'red' && 'border-destructive/60'
          )}
        >
          <CiDot ci={pr.ci} />
          PR #{pr.number}
          {/* Same qualified decision as the PR row — one vocabulary in both
              places a PR appears, so a chip can never say less than the row. */}
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

/**
 * The row at the bottom of a paged list (MD-127).
 *
 * It is BOTH the trigger and the feedback: an `IntersectionObserver` on this
 * element asks for the next page as it comes into view, and while that page is
 * in flight the same row is the skeleton. Two elements would mean the trigger
 * unmounting the moment it fired — which disconnects the observer and, on a
 * short page, never reconnects.
 *
 * The button is not a fallback for a missing observer; it is the keyboard and
 * screen-reader route to the same action, and the thing to click when a fetch
 * failed and the sentinel is already on screen (an observer does not re-fire
 * for an element that never left the viewport).
 */
function PageSentinel({ loading, onLoadMore }: { loading: boolean; onLoadMore: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  // The callback changes every render (it closes over the page count), so the
  // observer must not be rebuilt from it — that would disconnect and reconnect
  // on every keystroke, and a reconnect fires immediately for an element that
  // is already visible.
  const latest = useRef(onLoadMore);
  latest.current = onLoadMore;

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) latest.current();
    }, {
      // Start the fetch a screenful early, so the next page is usually there
      // by the time the reader arrives at the bottom.
      rootMargin: '400px 0px'
    });
    io.observe(el);
    return () => { io.disconnect(); };
  }, []);

  return (
    <div ref={ref} className="flex flex-col gap-2 pt-1">
      {loading
        ? <Skeleton className="h-9 w-full" />
        : (
          <Button variant="ghost" size="sm" className="self-start" onClick={onLoadMore}>
            Load {ISSUE_PAGE_SIZE} more
          </Button>
        )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Errors are shown, dismissible, and never replace the content behind them —
 *  a failed fetch must not also throw away the rows you were reading. */
function ErrorLine({ text, onDismiss }: { text: string; onDismiss?: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertDescription className="flex items-start gap-2">
        <span className="min-w-0 flex-1 break-words">{text}</span>
        {onDismiss && <IconButton size="icon-xs" label="Dismiss" onClick={onDismiss}>×</IconButton>}
      </AlertDescription>
    </Alert>
  );
}
