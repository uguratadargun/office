import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Sparkles, Sunrise, Pickaxe, Shrink } from 'lucide-react';
import { useStore } from '@/store/store';
import { MarkdownPreview } from '@/markdown/MarkdownPreview';
// The shared MarkdownPreview emits three class names whose only stylesheet is
// `design/global.css`, which the modern entry never imports — without this the
// file renders as correct, completely unstyled HTML (see modern/ide/markdown.css).
import '../ide/markdown.css';
import { summarizeReflect } from '@shared/reflectSummary';
import { relSince } from '@shared/relTime';
import { useNavTarget } from '../navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../components/ui/select';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { MemoryGraph } from './MemoryGraph';
import {
  MEMORY_FILE,
  anchorAgentId,
  hitAgentId,
  memoryDir,
  memoryFileMeta,
  memoryPickerOptions,
  palaceLine,
  type PalaceStatus
} from './memoryModel';

interface ReflectState {
  enabled: boolean;
  lastRunMs: number | null;
  nextRunMs: number | null;
  running: boolean;
  lastChanged: Array<{ id: string; condensed: boolean; reason: string; oldBytes?: number; newBytes?: number }>;
  lastScanned: number;
}

const REFLECT_POLL_MS = 15_000;

/**
 * Memory — what the hive has written down, and what it can find in it.
 *
 * The pixel UI has had this since the beginning (`CommandCenterPanel`'s memory
 * and graph tabs); the modern nav simply never got one, so from this UI an
 * agent's notes were unreachable (MD-138). Same four questions, same IPC, no
 * new channels:
 *
 *   Files   — one agent's `memory.md`, RENDERED (pixel shows raw text in a
 *             `<pre>`; this is markdown, so show markdown) with its size and
 *             age, because the condenser's thresholds are stated in bytes and
 *             "is this file about to be rewritten" was previously unanswerable.
 *   Search  — the two searches that already exist, kept apart on purpose: exact
 *             text across board/tasks/memory, and MemPalace's semantic recall.
 *   Graph   — who talks to whom, plus the shared-topic layer.
 *
 * Read-only, like the pixel tab: memory.md is written BY agents and rewritten by
 * the condenser on a timer, so an edit box here would be a text field that
 * silently loses what you type. The IDE is the place that edits files.
 */
export function MemoryView() {
  const agents = useStore((s) => s.agents);
  const godId = useMemo(() => agents.find((a) => a.isGod)?.id ?? agents[0]?.id ?? '', [agents]);
  const options = useMemo(() => memoryPickerOptions(agents), [agents]);

  const [tab, setTab] = useState('files');
  const [who, setWho] = useState(godId);
  // The picker starts empty until the roster arrives, and a deep link may name
  // an agent that has since left the floor — both fall back to god.
  useEffect(() => {
    if (!who && godId) setWho(godId);
  }, [who, godId]);

  // ── deep link: navigate('memory', { anchor: agentId }) ─────────────────────
  const target = useNavTarget();
  useEffect(() => {
    if (target.id !== 'memory') return;
    setWho((current) => anchorAgentId(target.anchor, agents, current || godId));
    if (target.anchor) setTab('files');
    // `seq` on purpose: a second link to the agent already on screen must still
    // switch back to Files (navigation.ts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.seq]);

  // ── the file ───────────────────────────────────────────────────────────────
  const [mem, setMem] = useState('');
  const [mtime, setMtime] = useState<number | null>(null);
  const [harnessHome, setHarnessHome] = useState<string | null>(null);
  useEffect(() => {
    window.cth.getConfig().then((c) => setHarnessHome(c.harnessHome ?? null)).catch(() => setHarnessHome(null));
  }, []);

  const loadFile = useCallback(async () => {
    if (!who) { setMem(''); setMtime(null); return; }
    try { setMem((await window.cth.hiveMemory(who)) ?? ''); } catch { setMem(''); }
    // `hive:memory` hands back the text and nothing else. The mtime comes from
    // the root-confined directory listing instead — a failure here costs the
    // age line and nothing more, which is why it is a separate try.
    const dir = memoryDir(harnessHome, who);
    if (!dir) { setMtime(null); return; }
    try {
      const res = await window.cth.listDir(dir, '.');
      const entry = res.ok ? res.entries.find((e) => e.name === MEMORY_FILE) : undefined;
      setMtime(entry ? entry.mtime : null);
    } catch { setMtime(null); }
  }, [who, harnessHome]);
  useEffect(() => { void loadFile(); }, [loadFile]);

  const meta = useMemo(() => memoryFileMeta(mem, mtime), [mem, mtime]);

  // ── MemPalace ──────────────────────────────────────────────────────────────
  const [palace, setPalace] = useState<PalaceStatus | null>(null);
  useEffect(() => {
    window.cth.memoryStatus().then(setPalace).catch(() => setPalace(null));
  }, []);
  const line = useMemo(() => palaceLine(palace), [palace]);

  // ── searches ───────────────────────────────────────────────────────────────
  const [textQuery, setTextQuery] = useState('');
  const [textHits, setTextHits] = useState<Array<{ source: string; excerpt: string }>>([]);
  const [textRan, setTextRan] = useState(false);
  const [textBusy, setTextBusy] = useState(false);
  const runTextSearch = async () => {
    if (!textQuery.trim()) return;
    setTextBusy(true);
    try {
      const res = await window.cth.textSearch(textQuery.trim());
      setTextHits(res.ok ? res.results.slice(0, 20) : []);
    } catch { setTextHits([]); }
    finally { setTextBusy(false); setTextRan(true); }
  };

  const [semQuery, setSemQuery] = useState('');
  const [semOut, setSemOut] = useState('');
  const [semBusy, setSemBusy] = useState(false);
  const runSemanticSearch = async () => {
    if (!semQuery.trim()) return;
    setSemBusy(true);
    try {
      const res = await window.cth.searchMemory(semQuery.trim());
      setSemOut(res.ok ? (res.output || 'Nothing matched yet.') : `Couldn’t search: ${res.error}`);
    } finally { setSemBusy(false); }
  };

  // ── maintenance ────────────────────────────────────────────────────────────
  const [maintBusy, setMaintBusy] = useState<'wake' | 'mine' | 'condense' | null>(null);
  const [maintOut, setMaintOut] = useState('');
  const [reflect, setReflect] = useState<ReflectState | null>(null);
  const loadReflect = useCallback(() => {
    window.cth.reflectStatus().then(setReflect).catch(() => setReflect(null));
  }, []);
  useEffect(() => {
    loadReflect();
    const t = setInterval(loadReflect, REFLECT_POLL_MS);
    return () => clearInterval(t);
  }, [loadReflect]);

  const runMaint = async (kind: 'wake' | 'mine' | 'condense') => {
    setMaintBusy(kind);
    setMaintOut('');
    try {
      if (kind === 'wake') {
        const res = await window.cth.memoryWakeUp();
        setMaintOut(res.ok ? (res.output || 'No digest yet.') : `Couldn’t wake up: ${res.error}`);
      } else if (kind === 'mine') {
        // main serialises palace writers itself and answers as soon as the pass
        // is STARTED — so say started, never finished.
        const res = await window.cth.mineNow();
        setMaintOut(res.ok ? 'Mining started — new notes reach the palace as it works.' : 'Could not start mining.');
      } else {
        setMaintOut(summarizeReflect(await window.cth.reflectNow(who)));
        loadReflect();
        void loadFile(); // a condense rewrites the file on screen
      }
    } catch (e) {
      setMaintOut(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setMaintBusy(null); }
  };

  const openAgent = (id: string) => { setWho(id); setTab('files'); };
  const selected = options.find((o) => o.id === who);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs value={tab} onValueChange={setTab} className="flex h-full min-h-0 flex-col gap-0">
        <div className="flex h-11 shrink-0 items-center gap-3 border-b px-6">
          <TabsList variant="line">
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="search">Search</TabsTrigger>
            <TabsTrigger value="graph">Graph</TabsTrigger>
          </TabsList>
          <span className="min-w-0 flex-1" />
          {/* MemPalace's five booleans as one word, with the sentence that says
              which switch would change it. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant={line.tone} className="shrink-0 gap-1 font-normal">
                <Sparkles className="size-3" />
                MemPalace {line.label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">{line.detail}</TooltipContent>
          </Tooltip>
        </div>

        {/* ── Files ───────────────────────────────────────────────────────── */}
        <TabsContent value="files" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b px-6">
            <Select value={who} onValueChange={setWho}>
              <SelectTrigger size="sm" aria-label="Agent" className="h-7 w-56 shrink-0">
                {selected
                  ? <span className="truncate text-sm font-medium">{selected.name}</span>
                  : <span className="truncate text-sm text-muted-foreground">Pick an agent</span>}
              </SelectTrigger>
              <SelectContent className="max-w-[min(28rem,90vw)]">
                {options.map((o) => (
                  <SelectItem key={o.id} value={o.id} textValue={o.name} title={o.label}>
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-1.5">
                        <span className="font-medium">{o.name}</span>
                        {o.isGod && <span className="text-xs text-muted-foreground">god</span>}
                        {o.presence && <span className="text-xs text-muted-foreground">· {o.presence}</span>}
                      </span>
                      <span className="truncate font-mono text-xs text-muted-foreground">{o.label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Separator orientation="vertical" className="h-4" />
            <span className="truncate font-mono text-xs text-muted-foreground" title={`${memoryDir(harnessHome, who) ?? ''}/${MEMORY_FILE}`}>
              {MEMORY_FILE} · {meta.sizeLabel}
              {meta.modifiedLabel ? ` · ${meta.modifiedLabel}` : ''}
            </span>
            <span className="min-w-0 flex-1" />
            {/* Read-only, so the actions here are the three background loops'
                "do it now" handles — the same three the pixel tab exposes. */}
            <Button size="sm" variant="ghost" disabled={!!maintBusy} onClick={() => void runMaint('wake')}>
              <Sunrise /> {maintBusy === 'wake' ? 'Waking…' : 'Wake up'}
            </Button>
            <Button size="sm" variant="ghost" disabled={!!maintBusy} onClick={() => void runMaint('mine')}>
              <Pickaxe /> {maintBusy === 'mine' ? 'Mining…' : 'Mine now'}
            </Button>
            <Button size="sm" variant="ghost" disabled={!!maintBusy || !who} onClick={() => void runMaint('condense')}>
              <Shrink /> {maintBusy === 'condense' ? 'Condensing…' : 'Condense now'}
            </Button>
          </div>

          {maintOut && (
            <pre className="max-h-32 shrink-0 overflow-auto border-b bg-muted/40 px-6 py-2 font-mono text-xs whitespace-pre-wrap">
              {maintOut}
            </pre>
          )}
          {reflect && (
            <p className="shrink-0 border-b px-6 py-1.5 text-xs text-muted-foreground">{condenserLine(reflect)}</p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {meta.empty
              ? <p className="p-6 text-sm text-muted-foreground">Nothing written down yet — this agent has an empty memory.md.</p>
              : <MarkdownPreview source={mem} baseRel={MEMORY_FILE} />}
          </div>
        </TabsContent>

        {/* ── Search ──────────────────────────────────────────────────────── */}
        <TabsContent value="search" className="min-h-0 overflow-y-auto">
          <div className="flex flex-col gap-8 p-6">
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="text-sm font-medium">Exact text</h2>
                <p className="text-xs text-muted-foreground">
                  Every line of board.md, tasks.json and every agent’s memory.md that contains what you type.
                </p>
              </div>
              <div className="flex max-w-2xl gap-2">
                <Input
                  value={textQuery}
                  onChange={(e) => setTextQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void runTextSearch(); }}
                  placeholder="Find exact text across hive files…"
                  aria-label="Search hive files"
                />
                <Button onClick={() => void runTextSearch()} disabled={textBusy || !textQuery.trim()}>
                  <Search /> {textBusy ? 'Searching…' : 'Search'}
                </Button>
              </div>
              {textHits.length > 0 && (
                <ul className="flex max-w-3xl flex-col gap-2">
                  {textHits.map((h, i) => {
                    const owner = hitAgentId(h.source);
                    return (
                      <li key={`${h.source}-${i}`} className="rounded-md border p-2">
                        {/* Only a memory hit belongs to somebody — board.md and
                            tasks.json are the hive's, so they get no link. */}
                        {owner ? (
                          <button
                            type="button"
                            className="font-mono text-xs text-muted-foreground underline-offset-2 hover:underline"
                            onClick={() => openAgent(owner)}
                          >
                            {h.source}
                          </button>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">{h.source}</span>
                        )}
                        <p className="mt-1 font-mono text-xs whitespace-pre-wrap">{h.excerpt}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
              {textRan && textHits.length === 0 && <p className="text-sm text-muted-foreground">Nothing matched.</p>}
            </section>

            <section className="flex flex-col gap-3">
              <div>
                <h2 className="text-sm font-medium">Semantic recall</h2>
                <p className="text-xs text-muted-foreground">
                  {line.searchable
                    ? 'MemPalace answers from what the whole floor has written, ranked by meaning rather than by wording.'
                    : line.detail}
                </p>
              </div>
              <div className="flex max-w-2xl gap-2">
                <Input
                  value={semQuery}
                  onChange={(e) => setSemQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void runSemanticSearch(); }}
                  placeholder="What does the hive know about…"
                  aria-label="Search MemPalace"
                  disabled={!line.searchable}
                />
                <Button onClick={() => void runSemanticSearch()} disabled={semBusy || !semQuery.trim() || !line.searchable}>
                  <Sparkles /> {semBusy ? 'Searching…' : 'Search'}
                </Button>
              </div>
              {semOut && (
                <pre className="max-w-3xl overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
                  {semOut}
                </pre>
              )}
            </section>
          </div>
        </TabsContent>

        {/* ── Graph ───────────────────────────────────────────────────────── */}
        <TabsContent value="graph" className="min-h-0 flex-1 overflow-hidden">
          <MemoryGraph godId={godId} onOpenAgent={openAgent} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** The condenser's own state, said in one line — it rewrites these files
 *  unattended, so "off" has to read as a SETTING and not as a failure. */
function condenserLine(r: ReflectState): string {
  if (!r.enabled) return 'Condenser off (Settings › Memory & Knowledge) — “Condense now” still works.';
  if (r.running) return 'Condenser running now…';
  const when = r.lastRunMs
    ? `last checked ${relSince(r.lastRunMs)}, ${r.lastScanned} agent${r.lastScanned === 1 ? '' : 's'}`
    : 'not run yet this session';
  const changed = r.lastChanged.length > 0
    ? ` · rewrote ${r.lastChanged.map((c) => c.id).join(', ')}`
    : r.lastRunMs !== null ? ' · nothing needed condensing' : '';
  return `Condenser · ${when}${changed}`;
}

export default MemoryView;
