import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { cn } from '../lib/cn';

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
export function GitRail({ root, onOpenFile, onOpenDiff, refreshToken }: GitRailProps) {
  const [mainRoot, setMainRoot] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.cth.gitMainRepo(root).then((r) => { if (!cancelled) setMainRoot(r ?? root); });
    return () => { cancelled = true; };
  }, [root]);

  return (
    <Tabs defaultValue="changes" className="flex h-full min-h-0 flex-col gap-0">
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
        {mainRoot && <History root={mainRoot} />}
      </TabsContent>
      <TabsContent value="compare" className="min-h-0 overflow-y-auto">
        {mainRoot && <Compare root={mainRoot} />}
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
      className="size-4 shrink-0 justify-center rounded-sm p-0 font-mono text-[10px] leading-none"
    >
      {c}
    </Badge>
  );
}

function Changes({ root, onOpenDiff, refreshToken }: Pick<GitRailProps, 'root' | 'onOpenDiff' | 'refreshToken'>) {
  const [state, setState] = useState<{ status?: GitStatus; error?: string; loading: boolean }>({ loading: true });
  const [branch, setBranch] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    const [st, br] = await Promise.all([window.cth.gitStatus(root), window.cth.gitBranch(root)]);
    setState('error' in st ? { error: st.error, loading: false } : { status: st as GitStatus, loading: false });
    setBranch('error' in br ? null : br.current);
  }, [root]);

  useEffect(() => { void refresh(); }, [refresh, refreshToken]);

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
        <Button
          variant="ghost" size="icon-xs" aria-label="Refresh git status"
          className="ml-auto" onClick={() => void refresh()}
        >
          {state.loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </Button>
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
            'flex h-7 w-full items-center gap-2 px-3 text-left text-[13px] outline-none',
            'hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
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

function History({ root }: { root: string }) {
  const [rows, setRows] = useState<CommitRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openSha, setOpenSha] = useState<string | null>(null);
  const [files, setFiles] = useState<FileChange[] | null>(null);

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

  if (error) return <p className="p-3 text-xs text-destructive">{error}</p>;
  if (!rows) return <p className="p-3 text-xs text-muted-foreground">Reading the log…</p>;

  return (
    <div className="flex flex-col">
      {rows.map((c) => (
        <div key={c.sha}>
          <button
            type="button"
            onClick={() => setOpenSha((s) => (s === c.sha ? null : c.sha))}
            className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span className="truncate text-[13px]">{c.subject}</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {String(c.sha).slice(0, 7)} · {c.author}
            </span>
          </button>
          {openSha === c.sha && (
            <div className="border-y bg-muted/40 py-1">
              {(files ?? []).map((f) => (
                <div key={f.path} className="flex items-center gap-2 px-4 py-0.5 text-[12px]">
                  <StatusBadge code={f.status} />
                  <span className="truncate text-muted-foreground">{f.path}</span>
                </div>
              ))}
              {files?.length === 0 && <p className="px-4 text-[12px] text-muted-foreground">No files.</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Compare({ root }: { root: string }) {
  const [branches, setBranches] = useState<string[]>([]);
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');
  const [result, setResult] = useState<{ ahead: number; behind: number; files: FileChange[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    const r = await window.cth.gitCompareRefs(root, base, head);
    if ('error' in r) { setError(r.error); setResult(null); return; }
    setResult({ ahead: r.ahead, behind: r.behind, files: r.files as FileChange[] });
  }, [base, head, root]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Base</Label>
        <RefSelect value={base} onChange={setBase} options={branches} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Head</Label>
        <RefSelect value={head} onChange={setHead} options={branches} />
      </div>
      <Button size="sm" onClick={() => void run()} disabled={!base || !head}>Compare</Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {result && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">
            {result.ahead} ahead · {result.behind} behind · {result.files.length} files
          </p>
          {result.files.map((f) => (
            <div key={f.path} className="flex items-center gap-2 text-[12px]">
              <StatusBadge code={f.status} />
              <span className="truncate">{f.path}</span>
            </div>
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
  const [query, setQuery] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SearchResults | null>(null);

  const run = useCallback(async () => {
    if (!query.trim()) { setRes(null); return; }
    setBusy(true);
    try {
      setRes(await window.cth.ideSearch(root, query, { regex, caseSensitive, limit: 300 }));
    } finally {
      setBusy(false);
    }
  }, [caseSensitive, query, regex, root]);

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 border-b p-3">
        <div className="flex items-center gap-1.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // Enter, not debounce: a repo-wide grep is expensive and the user
            // knows when the query is finished.
            onKeyDown={(e) => { if (e.key === 'Enter') void run(); }}
            placeholder="Search the workspace"
            aria-label="Search the workspace"
            className="h-7 text-[13px]"
          />
        </div>
        <div className="flex gap-1.5">
          <Toggle on={regex} onClick={() => setRegex((v) => !v)} label=".*" title="Regular expression" />
          <Toggle on={caseSensitive} onClick={() => setCaseSensitive((v) => !v)} label="Aa" title="Case sensitive" />
          <Button size="xs" className="ml-auto" onClick={() => void run()} disabled={busy || !query.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            Search
          </Button>
        </div>
      </div>

      {res?.error && <p className="p-3 text-xs text-destructive">{res.error}</p>}
      {res && !res.error && res.hits.length === 0 && (
        <p className="p-3 text-xs text-muted-foreground">No matches.</p>
      )}
      {res?.hits.map((h, i) => (
        <button
          key={`${h.file}:${h.line}:${i}`}
          type="button"
          onClick={() => onOpenFile(h.file, h.line)}
          className="flex w-full flex-col gap-0.5 px-3 py-1 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="truncate text-[12px] text-muted-foreground">{h.file}:{h.line}</span>
          <span className="truncate font-mono text-[12px]">{h.text.trim()}</span>
        </button>
      ))}
      {res?.truncated && (
        <p className="p-3 text-xs text-muted-foreground">Results truncated — narrow the query.</p>
      )}
    </div>
  );
}

/** A two-state option chip. shadcn's Toggle is not in ui/*, and Button carries
 *  the pressed state fine through its variant + aria-pressed. */
function Toggle({ on, onClick, label, title }: { on: boolean; onClick: () => void; label: string; title: string }) {
  return (
    <Button
      size="xs"
      variant={on ? 'default' : 'outline'}
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className="font-mono"
    >
      {label}
    </Button>
  );
}
