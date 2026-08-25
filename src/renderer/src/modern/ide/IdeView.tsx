import { useCallback, useDeferredValue, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Image as ImageIcon, Save, X } from 'lucide-react';
import { useStore, type Agent } from '@/store/store';
import { MonacoEditor } from '@/ide/MonacoEditor';
import { MonacoDiff } from '@/ide/MonacoDiff';
import { MarkdownPreview } from '@/markdown/MarkdownPreview';
import { isImagePath, isSvgPath } from '@shared/imageTypes';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '../components/ui/alert-dialog';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../components/ui/resizable';
import { Separator } from '../components/ui/separator';
import { Skeleton } from '../components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { FileTree } from './FileTree';
import { GitRail } from './GitRail';
import { ImageView } from './ImageView';
import {
  getSession, isDirty, settleSave, subscribe, tabKey, update,
  type DiffBuffer, type EditBuffer, type MdView, type Tab, type TabMode
} from './ideStore';
import { cn } from '../lib/cn';

// Monaco reads --cth-* off the document with light-mode fallbacks; this points
// those names at modern values so the editor is not a white slab in dark mode.
// See the file's own header.
import './monaco-tokens.css';
// The shared MarkdownPreview's three class names have no stylesheet under the
// modern entry; this supplies them in modern tokens. See the file's own header.
import './markdown.css';

const basename = (rel: string) => rel.split('/').pop() || rel;
const isMarkdown = (rel: string) => /\.(md|markdown)$/i.test(rel);

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
   * the same tree. Capture it on mount, then release it.
   */
  const [pinnedId] = useState(() => useStore.getState().ideAgentId);
  useEffect(() => {
    if (pinnedId) useStore.getState().setIdeOpen(false, null);
  }, [pinnedId]);
  const target = useMemo(() => pickTarget(pinnedId), [selectedId, pinnedId, agentCount]);
  const root = target.root;

  /**
   * Tabs and buffers live in `ideStore`, not in this component. The shell keys
   * `ViewBoundary` on the nav id, so this view is UNMOUNTED on every navigation
   * — holding editor state in `useState` meant a click on Agents threw away
   * every open tab and every unsaved edit with no prompt (MD-94 S1). Reading it
   * back out of a module store makes the round trip a no-op instead.
   */
  const session = useSyncExternalStore(subscribe, () => getSession(root));
  const { tabs, activeKey, edits, diffs, mdViews } = session;
  const patch = useCallback(
    (fn: Parameters<typeof update>[1]) => { if (root) update(root, fn); },
    [root]
  );

  const [reveal, setReveal] = useState<{ rel: string; line: number } | null>(null);
  /** The tab the close guard is asking about — null when it is not asking. */
  const [confirmClose, setConfirmClose] = useState<string | null>(null);

  const setActiveKey = useCallback((key: string | null) => {
    patch((s) => ({ ...s, activeKey: key }));
  }, [patch]);

  const openFile = useCallback(async (rel: string, line?: number) => {
    if (!root) return;
    // SVG is a picture first, with `view source` one click away — it has no
    // null byte, so it used to land in Monaco as unhighlighted plaintext.
    const mode: TabMode = isImagePath(rel) ? 'image' : 'edit';
    const key = tabKey(mode, rel);
    patch((s) => ({
      ...s,
      tabs: s.tabs.some((x) => x.key === key) ? s.tabs : [...s.tabs, { key, rel, mode }],
      activeKey: key
    }));
    if (line) setReveal({ rel, line });
    if (mode !== 'edit') return;
    // Already open and loaded: jumping to a second search hit in the same file
    // must not throw away unsaved edits.
    if (getSession(root).edits[key] && getSession(root).edits[key].status !== 'error') return;
    patch((s) => ({ ...s, edits: { ...s.edits, [key]: { content: '', original: '', status: 'loading' } } }));
    const res = await window.cth.readFile(root, rel);
    patch((s) => ({
      ...s,
      edits: {
        ...s.edits,
        [key]: res.ok
          ? { content: res.content, original: res.content, status: 'ready' }
          : { content: '', original: '', status: 'error', error: res.error }
      }
    }));
  }, [patch, root]);

  /** Open the source of a file that is currently showing as a picture (SVG). */
  const openSource = useCallback(async (rel: string) => {
    if (!root) return;
    const key = tabKey('edit', rel);
    patch((s) => ({
      ...s,
      tabs: s.tabs.some((x) => x.key === key) ? s.tabs : [...s.tabs, { key, rel, mode: 'edit' as TabMode }],
      activeKey: key
    }));
    if (getSession(root).edits[key] && getSession(root).edits[key].status !== 'error') return;
    patch((s) => ({ ...s, edits: { ...s.edits, [key]: { content: '', original: '', status: 'loading' } } }));
    const res = await window.cth.readFile(root, rel);
    patch((s) => ({
      ...s,
      edits: {
        ...s.edits,
        [key]: res.ok
          ? { content: res.content, original: res.content, status: 'ready' }
          : { content: '', original: '', status: 'error', error: res.error }
      }
    }));
  }, [patch, root]);

  const openDiff = useCallback(async (rel: string) => {
    if (!root) return;
    const key = tabKey('diff', rel);
    patch((s) => ({
      ...s,
      tabs: s.tabs.some((x) => x.key === key) ? s.tabs : [...s.tabs, { key, rel, mode: 'diff' as TabMode }],
      activeKey: key,
      diffs: { ...s.diffs, [key]: { status: 'loading', head: '', working: '' } }
    }));
    const res = await window.cth.gitDiff(root, rel);
    patch((s) => ({
      ...s,
      diffs: {
        ...s.diffs,
        [key]: 'ok' in res && res.ok === false
          ? { status: 'error', head: '', working: '', error: res.error }
          : {
              status: (res as { isBinary?: boolean }).isBinary ? 'binary' : 'ready',
              head: (res as { head?: string }).head ?? '',
              working: (res as { working?: string }).working ?? ''
            }
      }
    }));
  }, [patch, root]);

  /**
   * A revision-pinned diff: `revA` vs `revB` for one path, both sides read
   * through the metadata-guarded `git:showFile` at the MAIN repo root. This is
   * what makes a commit's file list and a compare's file list clickable — they
   * were inert `<div>`s (MD-94 S1).
   */
  const openRevDiff = useCallback(async (
    repo: string, revA: string, revB: string, rel: string, revLabel: string
  ) => {
    if (!root) return;
    const key = tabKey('revdiff', rel, revA, revB);
    patch((s) => ({
      ...s,
      tabs: s.tabs.some((x) => x.key === key)
        ? s.tabs
        : [...s.tabs, { key, rel, mode: 'revdiff' as TabMode, revA, revB, revLabel }],
      activeKey: key,
      diffs: { ...s.diffs, [key]: { status: 'loading', head: '', working: '' } }
    }));
    const [a, b] = await Promise.all([
      window.cth.gitShowFile(repo, revA, rel),
      window.cth.gitShowFile(repo, revB, rel)
    ]);
    patch((s) => {
      if (!a.ok || !b.ok) {
        const error = !a.ok ? a.error : (b as { error: string }).error;
        return { ...s, diffs: { ...s.diffs, [key]: { status: 'error', head: '', working: '', error } } };
      }
      if (a.isBinary || b.isBinary) {
        return { ...s, diffs: { ...s.diffs, [key]: { status: 'binary', head: '', working: '' } } };
      }
      return { ...s, diffs: { ...s.diffs, [key]: { status: 'ready', head: a.content, working: b.content } } };
    });
  }, [patch, root]);

  /**
   * Save the buffer as it stands, then settle against the SNAPSHOT that was
   * written. Two bugs closed here: a write already in flight is not started
   * twice, and a failed write no longer replaces the editor with its error —
   * the buffer stays `ready`, stays dirty, and the message goes in a bar above
   * it, so the edits remain reachable and the ✕ still guards them.
   */
  const save = useCallback(async (key: string) => {
    if (!root) return;
    const s0 = getSession(root);
    const buf = s0.edits[key];
    const tab = s0.tabs.find((t) => t.key === key);
    if (!buf || !tab || buf.status !== 'ready' || buf.saving) return;
    const sent = buf.content;
    patch((s) => ({ ...s, edits: { ...s.edits, [key]: { ...s.edits[key], saving: true, saveError: undefined } } }));
    const res = await window.cth.writeFile(root, tab.rel, sent);
    patch((s) => ({
      ...s,
      edits: { ...s.edits, [key]: settleSave(s.edits[key], sent, res) },
      gitToken: res.ok ? s.gitToken + 1 : s.gitToken
    }));
  }, [patch, root]);

  const doClose = useCallback((key: string) => {
    patch((s) => {
      const next = s.tabs.filter((x) => x.key !== key);
      const { [key]: _e, ...edits } = s.edits;
      const { [key]: _d, ...diffs } = s.diffs;
      return {
        ...s,
        tabs: next,
        activeKey: s.activeKey === key ? next[next.length - 1]?.key ?? null : s.activeKey,
        edits,
        diffs
      };
    });
  }, [patch]);

  const close = useCallback((key: string) => {
    // `window.confirm` blocks the whole renderer and looks nothing like the
    // rest of the shell; DESIGN-MODERN calls for AlertDialog.
    if (isDirty(edits[key])) { setConfirmClose(key); return; }
    doClose(key);
  }, [doClose, edits]);

  const active = tabs.find((t) => t.key === activeKey) ?? null;
  const activeBuffer = active?.mode === 'edit' ? edits[active.key] : undefined;

  /**
   * ⌘/Ctrl+S at the WINDOW, not only inside Monaco. Monaco owns the keystroke
   * while it has focus; with the caret in the tree, the rail or the search box
   * the same chord did nothing at all (MD-94 S2).
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return;
      if (!activeKey) return;
      e.preventDefault();
      void save(activeKey);
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [activeKey, save]);

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

  const md = active?.mode === 'edit' && isMarkdown(active.rel);
  const mdView: MdView = md ? (mdViews[active!.rel] ?? 'preview') : 'code';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        {target.agent ? (
          <>
            <span className="truncate text-sm font-medium">{target.agent.name}</span>
            {target.agent.isGod && <Badge variant="secondary" className="h-5 px-1.5 text-xs">god</Badge>}
            {/* Never assert a name we had to guess at — one quiet word stops
                someone trusting the wrong agent's directory. */}
            {target.inferred && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs text-muted-foreground">(assumed)</span>
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
            <GitRail
              root={root}
              onOpenFile={openFile}
              onOpenDiff={openDiff}
              onOpenRevDiff={openRevDiff}
              refreshToken={session.gitToken}
            />
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
              {tabs.map((t) => (
                <TabChip
                  key={t.key}
                  tab={t}
                  active={t.key === activeKey}
                  dirty={isDirty(edits[t.key])}
                  onSelect={() => setActiveKey(t.key)}
                  onClose={() => close(t.key)}
                />
              ))}
            </div>
          )}

          {/* The editor toolbar: markdown mode switch, the SVG round trip back
              to the picture, and an explicit Save for anyone who does not know
              the chord. */}
          {active?.mode === 'edit' && activeBuffer?.status === 'ready' && (
            <div className="flex h-8 shrink-0 items-center gap-1 border-b px-2">
              {md && (
                <div className="flex items-center gap-0.5" role="group" aria-label="Markdown view">
                  {(['code', 'split', 'preview'] as const).map((v) => (
                    <Button
                      key={v}
                      size="xs"
                      variant={mdView === v ? 'secondary' : 'ghost'}
                      aria-pressed={mdView === v}
                      onClick={() => patch((s) => ({ ...s, mdViews: { ...s.mdViews, [active.rel]: v } }))}
                    >
                      {v}
                    </Button>
                  ))}
                </div>
              )}
              {isSvgPath(active.rel) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="xs" variant="ghost" aria-label="Show this file as an image"
                      onClick={() => void openFile(active.rel)}
                    >
                      <ImageIcon /> image
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Show this file as an image</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* Span, not the Button: a disabled trigger is pointer-events:none
                      and would swallow its own tooltip. `ml-auto` rides the span
                      because the span is what the flex row now lays out. */}
                  <span className="ml-auto inline-flex">
                    <Button
                      size="xs" variant="ghost" aria-label="Save (Cmd/Ctrl+S)"
                      disabled={!isDirty(activeBuffer) || activeBuffer.saving}
                      onClick={() => void save(active.key)}
                    >
                      <Save /> save
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Save (⌘S)</TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* A failed WRITE never takes the editor away — the edits are still in
              the buffer and still the only copy that exists. */}
          {active?.mode === 'edit' && activeBuffer?.saveError && (
            <div className="flex shrink-0 items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                Could not save — your changes are still here, unsaved. {activeBuffer.saveError}
              </span>
              <Button size="xs" variant="ghost" onClick={() => void save(active.key)}>retry</Button>
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
                buffer={activeBuffer}
                path={active.rel}
                root={root}
                mdView={md ? mdView : 'code'}
                revealLine={reveal?.rel === active.rel ? reveal.line : undefined}
                onChange={(v) => patch((s) => ({
                  ...s, edits: { ...s.edits, [active.key]: { ...s.edits[active.key], content: v } }
                }))}
                onSave={() => void save(active.key)}
                onOpenMarkdownLink={(rel) => void openFile(rel)}
              />
            )}

            {(active?.mode === 'diff' || active?.mode === 'revdiff') && (
              <DiffPane buffer={diffs[active.key]} path={active.rel} />
            )}
            {active?.mode === 'image' && (
              <ImageView
                root={root}
                rel={active.rel}
                // Only SVG has a source worth reading; a PNG's bytes are not a
                // round trip anyone wants.
                onViewSource={isSvgPath(active.rel) ? () => void openSource(active.rel) : undefined}
              />
            )}
          </div>

          {active?.mode === 'edit' && (
            <footer className="flex h-7 shrink-0 items-center gap-2 border-t px-3 text-xs text-muted-foreground">
              <span className="truncate font-mono">{active.rel}</span>
              <span className={cn('ml-auto', activeBuffer?.saveError && 'text-destructive')}>
                {activeBuffer?.saving
                  ? 'saving…'
                  : activeBuffer?.saveError
                    ? 'not saved'
                    : isDirty(activeBuffer) ? 'unsaved — ⌘S' : 'saved'}
              </span>
            </footer>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>

      <AlertDialog open={confirmClose !== null} onOpenChange={(o) => { if (!o) setConfirmClose(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmClose ? tabs.find((t) => t.key === confirmClose)?.rel : ''} has edits that were
              never written to disk. Closing the tab throws them away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (confirmClose) doClose(confirmClose); setConfirmClose(null); }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TabChip({ tab, active, dirty, onSelect, onClose }: {
  tab: Tab; active: boolean; dirty: boolean; onSelect: () => void; onClose: () => void;
}) {
  const suffix = tab.mode === 'diff' ? ' (diff)' : tab.mode === 'revdiff' ? ` (${tab.revLabel})` : '';
  return (
    <div
      className={cn(
        'group flex h-7 shrink-0 items-center gap-1.5 rounded-md pr-1 pl-2 text-xs',
        active ? 'bg-selected font-medium hover:bg-selected-hover' : 'hover:bg-accent'
      )}
    >
      <button type="button" onClick={onSelect} className="max-w-56 truncate outline-none">
        {basename(tab.rel)}{suffix}
      </button>
      {/* The dot is the same signal `isDirty` gates the close guard on, so they
          can never disagree. */}
      {dirty && <span aria-label="unsaved changes" className="size-1.5 rounded-full bg-foreground" />}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`Close ${tab.rel}`} className="size-5" onClick={onClose}>
            <X />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Close {basename(tab.rel)}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function EditPane({
  buffer, path, root, mdView, revealLine, onChange, onSave, onOpenMarkdownLink
}: {
  buffer?: EditBuffer;
  path: string;
  root: string;
  mdView: MdView;
  revealLine?: number;
  onChange: (v: string) => void;
  onSave: () => void;
  onOpenMarkdownLink: (rel: string) => void;
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
  // Only a failed READ has no content to show. A failed WRITE keeps the editor.
  if (buffer.status === 'error') {
    return <p className="p-4 text-sm text-destructive">{buffer.error ?? 'Could not read this file.'}</p>;
  }
  return (
    <div className="flex h-full min-h-0">
      {mdView !== 'preview' && (
        <div className="min-h-0 min-w-0 flex-1">
          <MonacoEditor
            path={path}
            value={buffer.content}
            onChange={onChange}
            onSave={onSave}
            revealLine={revealLine}
          />
        </div>
      )}
      {mdView !== 'code' && (
        <MdPane
          rel={path}
          root={root}
          source={buffer.content}
          split={mdView === 'split'}
          onOpenMarkdownLink={onOpenMarkdownLink}
        />
      )}
    </div>
  );
}

/** Renders the LIVE edit buffer, deferred so fast typing never blocks the
 *  editor. In split view it takes the right half behind a hairline. */
function MdPane({ rel, root, source, split, onOpenMarkdownLink }: {
  rel: string; root: string; source: string; split: boolean; onOpenMarkdownLink: (rel: string) => void;
}) {
  const deferred = useDeferredValue(source);
  return (
    <div className={cn('min-h-0 min-w-0 flex-1 overflow-auto bg-background', split && 'border-l')}>
      {/* `root` is what lets a report's screenshots render inline instead of
          collapsing to placeholder chips. */}
      <MarkdownPreview source={deferred} baseRel={rel} root={root} onOpenMarkdownLink={onOpenMarkdownLink} />
    </div>
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
