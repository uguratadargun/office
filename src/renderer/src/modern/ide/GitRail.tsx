import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ArrowLeftRight, GitBranchPlus, Loader2, RefreshCw, Search } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '../components/ui/alert-dialog';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { getSession, subscribe, update } from './ideStore';
import { cn } from '../lib/cn';
import { IconButton } from '../components/IconButton';

/** Local mirrors of the main-side git shapes, kept renderer-local exactly as
 *  the pixel IDE and GitTab do — the preload types are not exported. */
interface StatusEntry { path: string; index: string; worktree: string }
interface GitStatus { staged: StatusEntry[]; unstaged: StatusEntry[]; untracked: string[] }
type SearchResults = Awaited<ReturnType<typeof window.cth.ideSearch>>;
/** The two git shapes this rail renders. Derived from the preload calls rather
 *  than retyped, so they cannot drift from what main actually sends. */
type CommitRow = Extract<Awaited<ReturnType<typeof window.cth.gitLogGraph>>, unknown[]>[number];
type FileChange = Extract<Awaited<ReturnType<typeof window.cth.gitCommitFiles>>, unknown[]>[number];

export interface GitRailProps {
  root: string;
  /** Open a working-tree file (edit tab). */
  onOpenFile: (rel: string, line?: number) => void;
  /** Open a file's HEAD-vs-working diff. */
  onOpenDiff: (rel: string) => void;
  /** Open a revision-pinned diff (`revA` vs `revB`) at the MAIN repo root. This
   *  is what makes a commit's file list and a compare's file list clickable. */
  onOpenRevDiff: (repo: string, revA: string, revB: string, rel: string, revLabel: string) => void;
  /** Bumped by the host to force a status refresh after a save. */
  refreshToken: number;
}

/**
 * The left rail: CHANGES · HISTORY · COMPARE · SEARCH.
 *
 * History and compare run against the repo's MAIN working tree (`gitMainRepo`),
 * not `root` — agents work in linked worktrees, and a worktree's log only shows
 * its own branch, which is never the question being asked here.
 */
export function GitRail({ root, onOpenFile, onOpenDiff, onOpenRevDiff, refreshToken }: GitRailProps) {
  const [mainRoot, setMainRoot] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.cth.gitMainRepo(root).then((r) => { if (!cancelled) setMainRoot(r ?? root); });
    return () => { cancelled = true; };
  }, [root]);

  // Which rail tab is showing lives in the session store, not in `Tabs`: an
  // uncontrolled Tabs unmounted the Search pane on every switch, so a
  // Search → Changes → Search round trip lost the query and its hits (MD-94 S2).
  const rail = useSyncExternalStore(subscribe, () => getSession(root).rail);

  return (
    <Tabs
      value={rail}
      onValueChange={(v) => update(root, (s) => ({ ...s, rail: v }))}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <TabsList variant="line" className="h-9 w-full shrink-0 justify-start gap-1 rounded-none border-b px-2">
        <TabsTrigger value="changes" className="h-7 flex-none px-2 text-xs">Changes</TabsTrigger>
        <TabsTrigger value="history" className="h-7 flex-none px-2 text-xs">History</TabsTrigger>
        <TabsTrigger value="compare" className="h-7 flex-none px-2 text-xs">Compare</TabsTrigger>
        <TabsTrigger value="search" className="h-7 flex-none px-2 text-xs">Search</TabsTrigger>
      </TabsList>

      <TabsContent value="changes" className="min-h-0 overflow-y-auto">
        <Changes root={root} onOpenDiff={onOpenDiff} refreshToken={refreshToken} />
      </TabsContent>
      <TabsContent value="history" className="min-h-0 overflow-y-auto">
        {mainRoot && <History root={mainRoot} onOpenRevDiff={onOpenRevDiff} />}
      </TabsContent>
      <TabsContent value="compare" className="min-h-0 overflow-y-auto">
        {mainRoot && <Compare root={mainRoot} onOpenRevDiff={onOpenRevDiff} />}
      </TabsContent>
      <TabsContent value="search" className="min-h-0 overflow-y-auto">
        <SearchPane root={root} onOpenFile={onOpenFile} />
      </TabsContent>
    </Tabs>
  );
}

/** Git's two-letter status codes, as one readable word. */
const STATUS_LABEL: Record<string, string> = {
  M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'conflict', '?': 'new'
};

function StatusBadge({ code }: { code: string }) {
  const c = code.trim() || '?';
  return (
    <Badge
      variant="secondary"
      title={STATUS_LABEL[c] ?? c}
      className="size-5 shrink-0 justify-center rounded-sm p-0 font-mono text-xs leading-none"
    >
      {c}
    </Badge>
  );
}

function Changes({ root, onOpenDiff, refreshToken }: Pick<GitRailProps, 'root' | 'onOpenDiff' | 'refreshToken'>) {
  const [state, setState] = useState<{ status?: GitStatus; error?: string; loading: boolean }>({ loading: true });
  const [branch, setBranch] = useState<string | null>(null);

  /** `quiet` skips the spinner: the 4 s poll must not blink the refresh icon
   *  four times a minute for a read nobody asked for. */
  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setState((s) => ({ ...s, loading: true }));
    const [st, br] = await Promise.all([window.cth.gitStatus(root), window.cth.gitBranch(root)]);
    setState('error' in st ? { error: st.error, loading: false } : { status: st as GitStatus, loading: false });
    setBranch('error' in br ? null : br.current);
  }, [root]);

  // Pixel re-reads status on a 4 s timer; mount-only meant an external edit —
  // an agent writing in this very worktree, which is the normal case — never
  // showed up until you clicked refresh (MD-94 S2).
  useEffect(() => {
    void refresh();
    const t = setInterval(() => { void refresh(true); }, 4000);
    return () => { clearInterval(t); };
  }, [refresh, refreshToken]);

  if (state.error) return <p className="p-3 text-xs text-destructive">{state.error}</p>;
  const s = state.status;
  const rows: Array<{ rel: string; code: string; group: string }> = s
    ? [
        ...s.staged.map((e) => ({ rel: e.path, code: e.index, group: 'Staged' })),
        ...s.unstaged.map((e) => ({ rel: e.path, code: e.worktree, group: 'Changed' })),
        ...s.untracked.map((p) => ({ rel: p, code: '?', group: 'Untracked' }))
      ]
    : [];

  return (
    <div className="flex flex-col">
      <div className="flex h-8 items-center gap-2 px-3">
        <span className="truncate font-mono text-xs text-muted-foreground">{branch ?? '—'}</span>
        <IconButton
          label="Refresh git status" size="icon-xs"
          className="ml-auto" onClick={() => void refresh()}
        >
          {state.loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </IconButton>
      </div>
      {rows.length === 0 && !state.loading && (
        <p className="px-3 py-2 text-xs text-muted-foreground">No changes — the worktree is clean.</p>
      )}
      {rows.map((r, i) => (
        <button
          key={`${r.group}:${r.rel}`}
          type="button"
          onClick={() => onOpenDiff(r.rel)}
          title={`${r.rel} · ${STATUS_LABEL[r.code.trim()] ?? r.code}`}
          className={cn(
            'flex h-7 w-full items-center gap-2 px-3 text-left text-sm outline-none',
            'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
            // Group headings would cost a row each in a rail this narrow; the
            // group is in the tooltip and the badge letter, and a hairline
            // marks where one ends.
            i > 0 && rows[i - 1].group !== r.group && 'border-t'
          )}
        >
          <StatusBadge code={r.code} />
          <span className="truncate">{r.rel}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * A destructive-ish git action behind a real dialog. `window.confirm` blocks
 * the renderer and looks nothing like the shell; both call sites here move a
 * repo the human may have agents running in, so the sentence matters more than
 * the chrome.
 */
function ConfirmAction({ trigger, title, body, confirmLabel, onConfirm }: {
  trigger: React.ReactNode;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span onClick={(e) => { e.stopPropagation(); setOpen(true); }}>{trigger}</span>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setOpen(false); onConfirm(); }}>{confirmLabel}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function History({ root, onOpenRevDiff }: {
  root: string;
  onOpenRevDiff: GitRailProps['onOpenRevDiff'];
}) {
  const [rows, setRows] = useState<CommitRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openSha, setOpenSha] = useState<string | null>(null);
  const [files, setFiles] = useState<FileChange[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.cth.gitLogGraph(root, 60).then((r) => {
      if (cancelled) return;
      if ('error' in r) setError(r.error); else setRows(r as CommitRow[]);
    });
    return () => { cancelled = true; };
  }, [root]);

  useEffect(() => {
    if (!openSha) { setFiles(null); return; }
    let cancelled = false;
    void window.cth.gitCommitFiles(root, openSha).then((r) => {
      if (!cancelled) setFiles('error' in r ? [] : (r as FileChange[]));
    });
    return () => { cancelled = true; };
  }, [openSha, root]);

  /** Detached checkout at a commit. Main refuses on a dirty tree or a live
   *  agent, so the worst case is the message coming back below. */
  const jump = async (c: CommitRow) => {
    const res = await window.cth.gitCheckout(root, c.sha, true);
    setNote(res.ok ? `now at ${String(c.sha).slice(0, 7)} (detached HEAD)` : res.error);
  };

  if (error) return <p className="p-3 text-xs text-destructive">{error}</p>;
  if (!rows) return <p className="p-3 text-xs text-muted-foreground">Reading the log…</p>;

  return (
    <div className="flex flex-col">
      {note && <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">{note}</p>}
      {rows.map((c) => (
        <div key={c.sha}>
          <div
            className={cn(
              'group flex items-center gap-1 pr-1 hover:bg-accent',
              openSha === c.sha && 'bg-selected hover:bg-selected-hover'
            )}
          >
            <button
              type="button"
              onClick={() => setOpenSha((s) => (s === c.sha ? null : c.sha))}
              className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="truncate text-sm">{c.subject}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {String(c.sha).slice(0, 7)} · {c.author}
              </span>
            </button>
            <ConfirmAction
              title={`Jump the repo to ${String(c.sha).slice(0, 7)}?`}
              body={`"${String(c.subject).slice(0, 80)}" — this detaches HEAD in ${root}. Git refuses automatically if the tree is dirty or an agent is mid-run.`}
              confirmLabel="Jump here"
              onConfirm={() => void jump(c)}
              trigger={
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost" size="icon-xs"
                      aria-label={`Jump the repo to ${String(c.sha).slice(0, 7)}`}
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <GitBranchPlus />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Jump the repo here (detached HEAD)</TooltipContent>
                </Tooltip>
              }
            />
          </div>
          {openSha === c.sha && (
            <div className="border-y bg-muted/40 py-1">
              {(files ?? []).map((f) => (
                <button
                  key={f.path}
                  type="button"
                  // The whole point of expanding a commit: see what it did to
                  // this file. These rows were plain divs that did nothing.
                  onClick={() => onOpenRevDiff(root, `${c.sha}^`, c.sha, f.path, String(c.sha).slice(0, 7))}
                  title={`Diff ${f.path} at ${String(c.sha).slice(0, 7)}`}
                  className="flex w-full items-center gap-2 px-4 py-0.5 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <StatusBadge code={f.status} />
                  <span className="truncate text-muted-foreground">{f.path}</span>
                </button>
              ))}
              {files?.length === 0 && <p className="px-4 text-xs text-muted-foreground">No files.</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Compare({ root, onOpenRevDiff }: {
  root: string;
  onOpenRevDiff: GitRailProps['onOpenRevDiff'];
}) {
  const [branches, setBranches] = useState<string[]>([]);
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');
  const [result, setResult] = useState<
    { ahead: number; behind: number; mergeBase: string | null; files: FileChange[] } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.cth.gitBranches(root).then((r) => {
      if (cancelled || 'error' in r) return;
      const all = [...r.local, ...r.remote];
      setBranches(all);
      // Default to "what has my branch got that the trunk has not", which is
      // the question this pane exists to answer.
      setHead(r.current ?? all[0] ?? '');
      setBase(all.find((b) => b === 'main' || b === 'master') ?? all[0] ?? '');
    });
    return () => { cancelled = true; };
  }, [root]);

  const run = useCallback(async () => {
    if (!base || !head) return;
    setError(null);
    setNote(null);
    const r = await window.cth.gitCompareRefs(root, base, head);
    if ('error' in r) { setError(r.error); setResult(null); return; }
    setResult({ ahead: r.ahead, behind: r.behind, mergeBase: r.mergeBase, files: r.files as FileChange[] });
  }, [base, head, root]);

  /** Ordinary (attached) checkout of the head ref. `origin/` is stripped so the
   *  local tracking branch is what you land on, as in the pixel pane. */
  const switchTo = async () => {
    const res = await window.cth.gitCheckout(root, head.replace(/^origin\//, ''), false);
    setNote(res.ok ? `switched to ${head}` : res.error);
  };

  /** Three-dot compare: the left side is the merge base, so the diff shows what
   *  HEAD added rather than everything BASE moved on by. Falls back to `base`
   *  when there is no common ancestor to name. */
  const leftRev = result?.mergeBase ?? base;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Base</Label>
        <RefSelect value={base} onChange={setBase} options={branches} />
      </div>
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost" size="icon-xs" aria-label="Swap base and head"
              onClick={() => { const b = base; setBase(head); setHead(b); }}
            >
              <ArrowLeftRight />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Swap base ↔ head</TooltipContent>
        </Tooltip>
        <span className="text-xs text-muted-foreground">swap</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Head</Label>
        <RefSelect value={head} onChange={setHead} options={branches} />
      </div>
      <Button size="sm" onClick={() => void run()} disabled={!base || !head}>Compare</Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {result && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">
            {result.ahead} ahead · {result.behind} behind · {result.files.length} files
          </p>
          <ConfirmAction
            title={`Switch this repo to '${head}'?`}
            body={`${root} moves to ${head}. Git refuses automatically if the tree is dirty or an agent is mid-run.`}
            confirmLabel="Switch branch"
            onConfirm={() => void switchTo()}
            trigger={
              <Button variant="outline" size="xs" className="w-full" disabled={!head}>
                Switch to {head}
              </Button>
            }
          />
          {result.files.map((f) => (
            <button
              key={f.path}
              type="button"
              // Same fix as the History file rows: these were inert divs.
              onClick={() => onOpenRevDiff(root, leftRev, head, f.path, `${base}…${head}`)}
              title={`Diff ${f.path} between ${base} and ${head}`}
              className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <StatusBadge code={f.status} />
              <span className="truncate">{f.path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RefSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-full font-mono text-xs">
        <SelectValue placeholder="pick a ref" />
      </SelectTrigger>
      <SelectContent>
        {options.map((b) => (
          <SelectItem key={b} value={b} className="font-mono text-xs">{b}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SearchPane({ root, onOpenFile }: { root: string; onOpenFile: (rel: string, line?: number) => void }) {
  // Query, toggles and hits live in the session store: the rail's Tabs unmounts
  // this pane on every switch, so holding them here meant Search → Changes →
  // Search came back empty (MD-94 S2).
  const { query, regex, caseSensitive, busy, results: res } =
    useSyncExternalStore(subscribe, () => getSession(root).search);
  const setSearch = useCallback(
    (fields: Partial<ReturnType<typeof getSession>['search']>) =>
      update(root, (s) => ({ ...s, search: { ...s.search, ...fields } })),
    [root]
  );

  const run = useCallback(async () => {
    const q = getSession(root).search;
    if (!q.query.trim()) { setSearch({ results: null }); return; }
    setSearch({ busy: true });
    try {
      const hits = await window.cth.ideSearch(root, q.query, {
        regex: q.regex, caseSensitive: q.caseSensitive, limit: 500
      });
      setSearch({ results: hits, busy: false });
    } catch {
      setSearch({ busy: false });
    }
  }, [root, setSearch]);

  /** `file:line` rows told you nothing about shape. Grouping by file — with a
   *  per-file count — is how the pixel pane read. */
  const groups: Array<{ file: string; hits: Array<{ line: number; text: string }> }> = [];
  for (const h of res?.hits ?? []) {
    const last = groups[groups.length - 1];
    if (last && last.file === h.file) last.hits.push({ line: h.line, text: h.text });
    else groups.push({ file: h.file, hits: [{ line: h.line, text: h.text }] });
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 border-b p-3">
        <div className="flex items-center gap-1.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setSearch({ query: e.target.value })}
            // Enter, not debounce: a repo-wide grep is expensive and the user
            // knows when the query is finished.
            onKeyDown={(e) => { if (e.key === 'Enter') void run(); }}
            placeholder="Search the workspace"
            aria-label="Search the workspace"
            className="h-7 text-sm"
          />
        </div>
        <div className="flex gap-1.5">
          <Toggle on={regex} onClick={() => setSearch({ regex: !regex })} label=".*" title="Regular expression" />
          <Toggle
            on={caseSensitive}
            onClick={() => setSearch({ caseSensitive: !caseSensitive })}
            label="Aa" title="Case sensitive"
          />
          {/* Outline, not filled: Enter in the field already runs the search,
              and Compare (the other rail pane) is this rail's one primary. */}
          <Button variant="outline" size="xs" className="ml-auto" onClick={() => void run()} disabled={busy || !query.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            Search
          </Button>
        </div>
      </div>

      {res?.error && <p className="p-3 text-xs text-destructive">{res.error}</p>}
      {res && !res.error && res.hits.length === 0 && (
        <p className="p-3 text-xs text-muted-foreground">No matches.</p>
      )}
      {res && !res.error && res.hits.length > 0 && (
        <p className="px-3 py-1.5 text-xs text-muted-foreground">
          {res.hits.length} {res.hits.length === 1 ? 'match' : 'matches'} in {groups.length}{' '}
          {groups.length === 1 ? 'file' : 'files'}
        </p>
      )}
      {groups.map((g) => (
        <div key={g.file}>
          <div className="flex items-center gap-2 border-t bg-muted/40 px-3 py-1">
            <span className="min-w-0 flex-1 truncate font-mono text-xs" title={g.file}>{g.file}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{g.hits.length}</span>
          </div>
          {g.hits.map((h, i) => (
            <button
              key={`${g.file}:${h.line}:${i}`}
              type="button"
              onClick={() => onOpenFile(g.file, h.line)}
              className="flex w-full items-center gap-2 px-3 py-0.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="w-9 shrink-0 text-right font-mono text-xs text-muted-foreground">{h.line}</span>
              <span className="truncate font-mono text-xs">{h.text.trim()}</span>
            </button>
          ))}
        </div>
      ))}
      {res?.truncated && (
        <p className="p-3 text-xs text-muted-foreground">Results truncated — narrow the query.</p>
      )}
    </div>
  );
}

/** A two-state option chip. shadcn's Toggle is not in ui/*, and Button carries
 *  the pressed state fine through aria-pressed and a ring — not by going solid,
 *  which would be a second filled button in the rail (MD-100). */
function Toggle({ on, onClick, label, title }: { on: boolean; onClick: () => void; label: string; title: string }) {
  return (
    <Button
      size="xs"
      variant="outline"
      className={cn('font-mono', on && 'border-ring bg-accent')}
      aria-pressed={on}
      title={title}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
