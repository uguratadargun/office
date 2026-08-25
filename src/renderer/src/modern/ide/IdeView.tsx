import { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useStore, type Agent } from '@/store/store';
import { MonacoEditor } from '@/ide/MonacoEditor';
import { MonacoDiff } from '@/ide/MonacoDiff';
import { isImagePath, isSvgPath } from '@shared/imageTypes';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../components/ui/resizable';
import { Separator } from '../components/ui/separator';
import { Skeleton } from '../components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { FileTree } from './FileTree';
import { GitRail } from './GitRail';
import { ImageView } from './ImageView';
import { cn } from '../lib/cn';

// Monaco reads --cth-* off the document with light-mode fallbacks; this points
// those names at modern values so the editor is not a white slab in dark mode.
// See the file's own header.
import './monaco-tokens.css';

type TabMode = 'edit' | 'diff' | 'image';
interface Tab { key: string; rel: string; mode: TabMode }
const tabKey = (mode: TabMode, rel: string) => `${mode}::${rel}`;
const basename = (rel: string) => rel.split('/').pop() || rel;

interface EditBuffer {
  content: string;
  original: string;
  status: 'loading' | 'ready' | 'error';
  error?: string;
  saving?: boolean;
}
interface DiffBuffer {
  status: 'loading' | 'ready' | 'binary' | 'error';
  head: string;
  working: string;
  error?: string;
}

/** A buffer only counts as dirty once it has actually loaded — the tab marker,
 *  the save button and the close guard all read this one function, or the ✕
 *  discards what the guard refuses to. */
const isDirty = (b?: EditBuffer) => !!b && b.status === 'ready' && b.content !== b.original;

/**
 * Snapshot the workspace once. Preference order, most trustworthy first:
 * the agent the opener named, the current selection, then god / the first agent
 * so the IDE still opens on SOMETHING. Everything past the first is marked
 * `inferred`, because those are the paths that can disagree with what the user
 * was actually looking at — and this view puts a directory on screen.
 */
function pickTarget(pinnedId: string | null): { agent: Agent | null; root: string | null; inferred: boolean } {
  const s = useStore.getState();
  const byId = (id: string | null) => (id ? s.agents.find((a) => a.id === id) ?? null : null);
  const named = byId(pinnedId);
  if (named?.cwd) return { agent: named, root: named.cwd, inferred: false };
  const guess = byId(s.selectedId) ?? s.agents.find((a) => a.isGod) ?? s.agents[0] ?? null;
  if (guess?.cwd) return { agent: guess, root: guess.cwd, inferred: true };
  return { agent: null, root: null, inferred: false };
}

export function IdeView() {
  // The pixel IDE is a fullscreen overlay opened FOR an agent and closed again,
  // so a snapshot is right there. Here it is a nav view that outlives the
  // selection, so it re-picks whenever the selected agent changes.
  const selectedId = useStore((s) => s.selectedId);
  const agentCount = useStore((s) => s.agents.length);
  /**
   * "Open IDE" on an agent names the workspace for THIS visit, not for the rest
   * of the session. `ideAgentId` was never cleared, so one click pinned the IDE
   * to that agent forever — every later visit ignored the selection and opened
   * the same tree. Capture it on mount, then release it: the shell remounts
   * this view on every navigation (AppShell keys ViewBoundary on the nav id),
   * so the next visit re-reads a fresh pin or falls back to the selection.
   */
  const [pinnedId] = useState(() => useStore.getState().ideAgentId);
  useEffect(() => {
    if (pinnedId) useStore.getState().setIdeOpen(false, null);
  }, [pinnedId]);
  const target = useMemo(() => pickTarget(pinnedId), [selectedId, pinnedId, agentCount]);
  const root = target.root;

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, EditBuffer>>({});
  const [diffs, setDiffs] = useState<Record<string, DiffBuffer>>({});
  const [reveal, setReveal] = useState<{ rel: string; line: number } | null>(null);
  /** Bumped after a save so the changes rail re-reads `git status`. */
  const [gitToken, setGitToken] = useState(0);

  // A new workspace invalidates every open buffer — they are all paths under
  // the old root.
  useEffect(() => { setTabs([]); setActiveKey(null); setEdits({}); setDiffs({}); }, [root]);

  const openFile = useCallback(async (rel: string, line?: number) => {
    if (!root) return;
    const mode: TabMode = isImagePath(rel) && !isSvgPath(rel) ? 'image' : 'edit';
    const key = tabKey(mode, rel);
    setTabs((t) => (t.some((x) => x.key === key) ? t : [...t, { key, rel, mode }]));
    setActiveKey(key);
    if (line) setReveal({ rel, line });
    if (mode !== 'edit') return;
    // Already open and loaded: jumping to a second search hit in the same file
    // must not throw away unsaved edits.
    if (edits[key] && edits[key].status !== 'error') return;
    setEdits((e) => ({ ...e, [key]: { content: '', original: '', status: 'loading' } }));
    const res = await window.cth.readFile(root, rel);
    setEdits((e) => ({
      ...e,
      [key]: res.ok
        ? { content: res.content, original: res.content, status: 'ready' }
        : { content: '', original: '', status: 'error', error: res.error }
    }));
  }, [edits, root]);

  const openDiff = useCallback(async (rel: string) => {
    if (!root) return;
    const key = tabKey('diff', rel);
    setTabs((t) => (t.some((x) => x.key === key) ? t : [...t, { key, rel, mode: 'diff' }]));
    setActiveKey(key);
    setDiffs((d) => ({ ...d, [key]: { status: 'loading', head: '', working: '' } }));
    const res = await window.cth.gitDiff(root, rel);
    setDiffs((d) => ({
      ...d,
      [key]: 'ok' in res && res.ok === false
        ? { status: 'error', head: '', working: '', error: res.error }
        : {
            status: (res as { isBinary?: boolean }).isBinary ? 'binary' : 'ready',
            head: (res as { head?: string }).head ?? '',
            working: (res as { working?: string }).working ?? ''
          }
    }));
  }, [root]);

  const save = useCallback(async (key: string) => {
    const buf = edits[key];
    const tab = tabs.find((t) => t.key === key);
    if (!root || !buf || !tab || buf.status !== 'ready') return;
    setEdits((e) => ({ ...e, [key]: { ...e[key], saving: true } }));
    const res = await window.cth.writeFile(root, tab.rel, buf.content);
    setEdits((e) => ({
      ...e,
      [key]: res.ok
        ? { ...e[key], original: e[key].content, saving: false, status: 'ready' }
        : { ...e[key], saving: false, status: 'error', error: res.error }
    }));
    if (res.ok) setGitToken((n) => n + 1);
  }, [edits, root, tabs]);

  const close = useCallback((key: string) => {
    if (isDirty(edits[key]) && !window.confirm('Discard unsaved changes to this file?')) return;
    setTabs((t) => {
      const next = t.filter((x) => x.key !== key);
      setActiveKey((cur) => (cur === key ? next[next.length - 1]?.key ?? null : cur));
      return next;
    });
    setEdits((e) => { const { [key]: _drop, ...rest } = e; return rest; });
    setDiffs((d) => { const { [key]: _drop, ...rest } = d; return rest; });
  }, [edits]);

  if (!root) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
        <p className="text-sm">No workspace available.</p>
        <p className="text-sm text-muted-foreground">
          Spawn an agent first — the IDE opens on its working directory.
        </p>
      </div>
    );
  }

  const active = tabs.find((t) => t.key === activeKey) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        {target.agent ? (
          <>
            <span className="truncate text-sm font-medium">{target.agent.name}</span>
            {target.agent.isGod && <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">god</Badge>}
            {/* Never assert a name we had to guess at — one quiet word stops
                someone trusting the wrong agent's directory. */}
            {target.inferred && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[11px] text-muted-foreground">(assumed)</span>
                </TooltipTrigger>
                <TooltipContent>
                  No agent was named when the IDE opened — showing the current selection.
                </TooltipContent>
              </Tooltip>
            )}
          </>
        ) : (
          <span className="text-sm text-muted-foreground">no agent</span>
        )}
        <Separator orientation="vertical" className="mx-1 h-4" />
        <span title={root} className="truncate font-mono text-xs text-muted-foreground">
          {basename(root)}
        </span>
      </header>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="24%" minSize="14%" maxSize="40%" className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-hidden">
            <GitRail root={root} onOpenFile={openFile} onOpenDiff={openDiff} refreshToken={gitToken} />
          </div>
          <Separator />
          <div className="min-h-0 flex-[1.2] overflow-y-auto">
            <FileTree root={root} activeRel={active?.rel} onOpenFile={(rel) => void openFile(rel)} />
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize="76%" className="flex min-h-0 flex-col">
          {tabs.length > 0 && (
            <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b px-1">
              {tabs.map((t) => {
                const dirty = isDirty(edits[t.key]);
                return (
                  <div
                    key={t.key}
                    className={cn(
                      'group flex h-7 shrink-0 items-center gap-1.5 rounded-md pr-1 pl-2 text-xs',
                      t.key === activeKey ? 'bg-accent font-medium' : 'hover:bg-accent/60'
                    )}
                  >
                    <button type="button" onClick={() => setActiveKey(t.key)} className="max-w-56 truncate outline-none">
                      {t.mode === 'diff' ? `${basename(t.rel)} (diff)` : basename(t.rel)}
                    </button>
                    {/* The dot is the same signal `isDirty` gates the close
                        guard on, so they can never disagree. */}
                    {dirty && <span aria-label="unsaved changes" className="size-1.5 rounded-full bg-foreground" />}
                    <Button
                      variant="ghost" size="icon-xs" aria-label={`Close ${t.rel}`}
                      className="size-5" onClick={() => close(t.key)}
                    >
                      <X />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="min-h-0 flex-1">
            {!active && (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                Pick a file from the tree, a change from the rail, or search the workspace.
              </div>
            )}

            {active?.mode === 'edit' && (
              <EditPane
                buffer={edits[active.key]}
                path={active.rel}
                revealLine={reveal?.rel === active.rel ? reveal.line : undefined}
                onChange={(v) => setEdits((e) => ({ ...e, [active.key]: { ...e[active.key], content: v } }))}
                onSave={() => void save(active.key)}
              />
            )}

            {active?.mode === 'diff' && <DiffPane buffer={diffs[active.key]} path={active.rel} />}
            {active?.mode === 'image' && <ImageView root={root} rel={active.rel} />}
          </div>

          {active?.mode === 'edit' && (
            <footer className="flex h-7 shrink-0 items-center gap-2 border-t px-3 text-[11px] text-muted-foreground">
              <span className="truncate font-mono">{active.rel}</span>
              <span className="ml-auto">
                {edits[active.key]?.saving
                  ? 'saving…'
                  : isDirty(edits[active.key]) ? 'unsaved — ⌘S' : 'saved'}
              </span>
            </footer>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function EditPane({
  buffer, path, revealLine, onChange, onSave
}: {
  buffer?: EditBuffer;
  path: string;
  revealLine?: number;
  onChange: (v: string) => void;
  onSave: () => void;
}) {
  if (!buffer || buffer.status === 'loading') {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }
  if (buffer.status === 'error') {
    return <p className="p-4 text-sm text-destructive">{buffer.error ?? 'Could not read this file.'}</p>;
  }
  return (
    <MonacoEditor
      path={path}
      value={buffer.content}
      onChange={onChange}
      onSave={onSave}
      revealLine={revealLine}
    />
  );
}

function DiffPane({ buffer, path }: { buffer?: DiffBuffer; path: string }) {
  if (!buffer || buffer.status === 'loading') return <Skeleton className="m-4 h-40" />;
  if (buffer.status === 'error') {
    return <p className="p-4 text-sm text-destructive">{buffer.error ?? 'Could not diff this file.'}</p>;
  }
  if (buffer.status === 'binary') {
    return <p className="p-4 text-sm text-muted-foreground">Binary file — nothing to diff.</p>;
  }
  return <MonacoDiff path={path} original={buffer.head} modified={buffer.working} />;
}
