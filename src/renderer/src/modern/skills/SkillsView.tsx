import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, FolderOpen, RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ScrollArea } from '../components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { IconButton } from '../components/IconButton';
import { DestructiveButton } from '../components/DestructiveButton';
import {
  catalogSourceNote, facetCounts, filterCatalog, filterLocal, installOutcome, installedEmptyCopy,
  isInstalled, isRemovable, setRow,
  type CatalogSkill, type LocalSkill, type RowState
} from './skillsModel';

/**
 * SKILLS — what the agents here can already do, and what else they could.
 *
 * Two questions, one search box: "why did my agent just do that?" (Installed)
 * and "what else is out there?" (Browse). They are different questions, but the
 * user's way of asking either one is usually a single word, so splitting the
 * search would mean typing it twice.
 *
 * INSTALLING IS A DECISION, NOT A CLICK — and this screen is the one place in
 * the modern UI where that is true. A skill is instructions that run inside an
 * agent holding the user's tools and keys. So the catalog always links out,
 * every install names its publisher, and removing one is armed like any other
 * destructive action.
 *
 * The reasoning that is testable lives in `skillsModel.ts`.
 */

const PROVIDER_LABEL: Record<LocalSkill['provider'], string> = {
  claude: 'Claude Code',
  opencode: 'OpenCode',
  codex: 'Codex'
};

const CATALOG_SOURCE = 'abubakarsiddik31/claude-skills-collection';

export function SkillsView() {
  const [mode, setMode] = useState<'installed' | 'browse'>('installed');
  const [query, setQuery] = useState('');
  const [local, setLocal] = useState<LocalSkill[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogSkill[] | null>(null);
  const [catalogMeta, setCatalogMeta] = useState<{ stale: boolean; error?: string } | null>(null);
  const [owner, setOwner] = useState('all');
  const [category, setCategory] = useState('all');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Record<string, RowState>>({});

  const loadLocal = useCallback(async () => {
    try { setLocal(await window.cth.skillsLocal()); } catch { setLocal([]); }
  }, []);

  const loadCatalog = useCallback(async (force = false) => {
    setBusy(true);
    try {
      const res = await window.cth.skillsCatalog(force);
      setCatalog(res.skills);
      setCatalogMeta({ stale: res.stale, error: res.error });
    } catch {
      setCatalog([]);
      setCatalogMeta({ stale: true, error: 'could not reach the catalog' });
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void loadLocal(); }, [loadLocal]);
  // Fetched only when Browse is actually opened: someone who just wanted to see
  // what is installed should not cost a network round trip.
  useEffect(() => {
    if (mode === 'browse' && catalog === null) void loadCatalog();
  }, [mode, catalog, loadCatalog]);

  const shownLocal = useMemo(() => filterLocal(local ?? [], query), [local, query]);
  const owners = useMemo(() => facetCounts(catalog ?? [], 'owner'), [catalog]);
  const categories = useMemo(() => facetCounts(catalog ?? [], 'category'), [catalog]);
  const cat = useMemo(
    () => filterCatalog(catalog ?? [], { query, owner, category }),
    [catalog, query, owner, category]
  );

  async function install(s: CatalogSkill) {
    setRows((r) => setRow(r, s.url, { busy: true }));
    try {
      const res = await window.cth.skillsInstall(s.url, s.name);
      setRows((r) => setRow(r, s.url, installOutcome(res)));
      // The installed pane has to reflect it immediately, or the user presses
      // install again to check.
      if (res.ok) void loadLocal();
    } catch (e) {
      setRows((r) => setRow(r, s.url, { error: e instanceof Error ? e.message : 'install failed' }));
    }
  }

  async function uninstall(s: LocalSkill) {
    setRows((r) => setRow(r, s.path, { busy: true }));
    try {
      const res = await window.cth.skillsUninstall(s.path);
      if (res.ok) { setRows((r) => setRow(r, s.path, null)); void loadLocal(); }
      else setRows((r) => setRow(r, s.path, { error: res.error ?? 'could not remove it' }));
    } catch (e) {
      setRows((r) => setRow(r, s.path, { error: e instanceof Error ? e.message : 'uninstall failed' }));
    }
  }

  const sourceNote = catalogSourceNote(catalogMeta);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Controls ────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-3">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'installed' | 'browse')}>
          <TabsList>
            <TabsTrigger value="installed">
              Installed{local ? ` ${local.length}` : ''}
            </TabsTrigger>
            <TabsTrigger value="browse">
              Browse{catalog ? ` ${catalog.length}` : ''}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={mode === 'installed' ? 'Search installed skills' : 'Search the skills catalog'}
          placeholder={mode === 'installed' ? 'Search installed skills…' : 'Search the catalog…'}
          className="min-w-40 flex-1"
        />

        {mode === 'browse' && (
          <>
            <Facet
              label="All categories"
              aria="Filter by category"
              value={category}
              onChange={setCategory}
              options={categories}
            />
            <Facet
              label="All publishers"
              aria="Filter by publisher"
              value={owner}
              onChange={setOwner}
              options={owners}
            />
          </>
        )}

        <IconButton
          label={mode === 'installed' ? 'Rescan installed skills' : 'Re-fetch the catalog'}
          disabled={busy}
          onClick={() => (mode === 'installed' ? void loadLocal() : void loadCatalog(true))}
        >
          <RefreshCw className={busy ? 'animate-spin' : undefined} />
        </IconButton>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-3">
          {mode === 'installed' ? (
            local === null ? <Loading />
            : shownLocal.length === 0 ? (
              <Empty>{installedEmptyCopy(local.length, query)}</Empty>
            ) : shownLocal.map((s) => (
              <InstalledRow
                key={s.path}
                skill={s}
                state={rows[s.path]}
                onUninstall={() => void uninstall(s)}
              />
            ))
          ) : catalog === null ? <Loading />
          : (
            <>
              {sourceNote && (
                <Alert>
                  <AlertDescription>{sourceNote}</AlertDescription>
                </Alert>
              )}
              <p className="text-xs text-muted-foreground">
                {cat.matching.length} matching
                {/* Never a silent truncation: if the list is capped, say so and
                    say by how much, so the count and the rows agree. */}
                {cat.capped && ` · showing the first ${cat.shown.length}`}
                {' · curated by '}{CATALOG_SOURCE}
              </p>
              {cat.shown.length === 0
                ? <Empty>Nothing in the catalog matches that.</Empty>
                : cat.shown.map((s) => (
                  <CatalogRow
                    key={s.url + s.name}
                    skill={s}
                    state={rows[s.url]}
                    // Read off the local list, which is refreshed after install
                    // AND uninstall — not off a flag this row remembers.
                    installed={isInstalled(s, local)}
                    onInstall={() => void install(s)}
                  />
                ))}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function Facet({ label, aria, value, onChange, options }: {
  label: string;
  aria: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, number][];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" aria-label={aria} className="max-w-52">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{label}</SelectItem>
        {options.map(([v, n]) => (
          <SelectItem key={v} value={v}>{v} ({n})</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function InstalledRow({ skill, state, onUninstall }: {
  skill: LocalSkill;
  state?: RowState;
  onUninstall: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{skill.name}</span>
        <Badge variant="secondary" className="shrink-0 font-normal">{PROVIDER_LABEL[skill.provider]}</Badge>
        <Badge variant={skill.scope === 'project' ? 'default' : 'outline'} className="shrink-0 font-normal">
          {skill.scope}
        </Badge>
      </div>
      {skill.description && (
        <p className="text-xs leading-5 text-muted-foreground">{skill.description}</p>
      )}
      {/* The path is the answer to "which one of these is actually running?" —
          two skills can share a name across scopes. */}
      <p className="font-mono text-xs break-all text-muted-foreground">{skill.path}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="xs" onClick={() => void window.cth.skillsReveal(skill.path)}>
          <FolderOpen /> Open folder
        </Button>
        {isRemovable(skill) ? (
          <DestructiveButton
            size="xs"
            label="Uninstall"
            confirmLabel={`Delete ${skill.name}?`}
            consequence="The skill's folder is deleted. There is no undo — reinstall it from Browse."
            disabled={state?.busy}
            onRun={onUninstall}
          />
        ) : (
          // Bundled skills are re-copied into every agent on spawn, so a remove
          // button here would delete a folder that comes straight back.
          <span className="text-xs text-muted-foreground">Ships with the app</span>
        )}
        {state?.error && <span className="text-xs text-destructive">{state.error}</span>}
      </div>
    </div>
  );
}

function CatalogRow({ skill, state, installed, onInstall }: {
  skill: CatalogSkill;
  state?: RowState;
  /** Already on disk — derived from the installed list, never remembered here. */
  installed: boolean;
  onInstall: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{skill.name}</span>
        <Badge variant="outline" className="shrink-0 font-normal">{skill.category}</Badge>
        {/* The publisher is the whole basis for trusting this thing enough to
            run it inside an agent holding your keys — it is never hidden. */}
        <Badge variant="secondary" className="shrink-0 font-normal">{skill.owner}</Badge>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{skill.description}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          variant={installed ? 'outline' : 'default'}
          disabled={!!state?.busy || installed}
          onClick={onInstall}
        >
          {state?.busy ? 'Installing…' : installed ? 'Installed' : 'Install'}
        </Button>
        <Button variant="ghost" size="xs" onClick={() => void window.cth.openExternal(skill.url)}>
          <ExternalLink /> Learn more
        </Button>
        {state?.error && (
          <span className="min-w-0 flex-1 text-xs text-destructive">{state.error}</span>
        )}
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-6 text-center text-xs text-muted-foreground">{children}</p>;
}
