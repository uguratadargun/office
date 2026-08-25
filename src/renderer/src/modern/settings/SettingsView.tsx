import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '../components/ui/input';
import { ScrollArea } from '../components/ui/scroll-area';
import { Skeleton } from '../components/ui/skeleton';
import { cn } from '../lib/cn';
import { useNavTarget } from '../navigation';
import { SECTIONS, isSection, searchSettings, matchingSections, type Section, type SettingMatch } from './index';
import { useConfig } from './useConfig';
import { GeneralSection } from './GeneralSection';
import { AgentsSection } from './AgentsSection';
import { AutonomySection } from './AutonomySection';
import { ConnectionsSection } from './ConnectionsSection';
import { VoiceSection } from './VoiceSection';
import { MemorySection } from './MemorySection';

/**
 * Settings — six sections, one row grammar, one config read.
 *
 * Search is the part that is genuinely different from the pixel modal. There,
 * searching filters the nav to matching sections and you then hunt for the row
 * yourself; here a result names its section AND its row id, so choosing one
 * switches section and scrolls the row into view with a brief highlight. That
 * is the whole reason `settings/index.ts` carries a DOM id per entry.
 */
export function SettingsView() {
  const api = useConfig();
  const [section, setSection] = useState<Section>('General');
  const [query, setQuery] = useState('');
  const paneRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => searchSettings(query), [query]);
  const hitSections = useMemo(() => matchingSections(matches), [matches]);
  const searching = query.trim().length > 0;
  // While searching, the nav shows only sections that contain a hit — but never
  // an empty nav: a query that matches nothing keeps the full list, so the user
  // can still navigate instead of staring at a blank rail.
  const navSections = searching && hitSections.length > 0 ? hitSections : SECTIONS;

  /**
   * Go to a row: switch section, then scroll to it once it has rendered and
   * mark it briefly so the eye lands on the right line.
   *
   * The highlight is applied imperatively rather than through React state
   * because the target is a row rendered by one of six section components, and
   * threading a `flash` prop through all of them — and through `Row` — would put
   * a transient visual detail into every component's API. Two frames: one for
   * the section swap to commit, one for layout.
   */
  const goTo = useCallback((target: Section, id?: string) => {
    setSection(target);
    setQuery('');
    if (!id) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = paneRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('bg-accent', 'rounded-md');
      window.setTimeout(() => el.classList.remove('bg-accent', 'rounded-md'), 1600);
    }));
  }, []);

  // A section the search filtered away must not stay selected — the pane would
  // show rows the nav no longer offers a way back to.
  useEffect(() => {
    if (searching && hitSections.length > 0 && !hitSections.includes(section)) {
      setSection(hitSections[0]);
    }
  }, [searching, hitSections, section]);

  /**
   * A cross-area deep link (`navigate('settings', { section, anchor })`).
   *
   * This is the MD-94 S1 fix: every Integrations "Settings ↗" used to call
   * `navigate('settings')` and land on General, because General is where this
   * view starts and nothing told it otherwise. The link now names its pane and
   * its row, and `goTo` is exactly the machinery a search hit already used —
   * the only new part is keying on `seq`, so clicking a SECOND row of the same
   * page re-runs the scroll instead of doing nothing.
   */
  const target = useNavTarget();
  useEffect(() => {
    if (target.id !== 'settings' || !target.section) return;
    if (!isSection(target.section)) return;
    goTo(target.section, target.anchor);
  }, [target, goTo]);

  return (
    <div className="flex h-full min-h-0">
      {/* ── Section rail ──────────────────────────────────────────────────── */}
      <div className="flex w-56 shrink-0 flex-col gap-2 border-r p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings"
            aria-label="Search settings"
            className="h-8 pl-8 text-[13px]"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
              if (e.key === 'Enter' && matches[0]) goTo(matches[0].section, matches[0].id);
            }}
          />
        </div>

        {searching ? (
          <SearchResults matches={matches} onPick={goTo} />
        ) : (
          <nav aria-label="Settings sections" className="flex flex-col gap-0.5">
            {navSections.map((s) => (
              <button
                key={s}
                type="button"
                aria-current={s === section ? 'page' : undefined}
                onClick={() => setSection(s)}
                className={cn(
                  'flex h-8 items-center rounded-md px-2 text-left text-[13px] transition-colors',
                  'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  s === section
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground'
                )}
              >
                {s}
              </button>
            ))}
          </nav>
        )}
      </div>

      {/* ── Pane ──────────────────────────────────────────────────────────── */}
      <ScrollArea className="min-w-0 flex-1">
        <div ref={paneRef} className="mx-auto max-w-3xl p-6">
          {api.config === null ? <PaneSkeleton /> : (
            <>
              {section === 'General' && <GeneralSection api={api} />}
              {section === 'Agents & Models' && <AgentsSection api={api} />}
              {section === 'Autonomy & Budgets' && <AutonomySection api={api} />}
              {section === 'Connections' && <ConnectionsSection api={api} />}
              {section === 'Voice' && <VoiceSection api={api} />}
              {section === 'Memory & Knowledge' && <MemorySection api={api} />}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function SearchResults({
  matches,
  onPick
}: {
  matches: SettingMatch[];
  onPick: (section: Section, id: string) => void;
}) {
  if (matches.length === 0) {
    return (
      <p className="px-2 py-3 text-[12px] leading-relaxed text-muted-foreground">
        Nothing matches. Try the name of the service — “slack”, “groq” — or what it does.
      </p>
    );
  }
  return (
    <div role="listbox" aria-label="Search results" className="flex flex-col gap-0.5 overflow-y-auto">
      {matches.map((m) => (
        <button
          key={m.id}
          type="button"
          role="option"
          aria-selected={false}
          onClick={() => onPick(m.section, m.id)}
          className={cn(
            'flex flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors',
            'outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50'
          )}
        >
          <span className="text-[13px] leading-tight">
            {m.start >= 0 ? (
              <>
                {m.label.slice(0, m.start)}
                <mark className="rounded-sm bg-transparent font-medium text-foreground underline decoration-2 underline-offset-2">
                  {m.label.slice(m.start, m.end)}
                </mark>
                {m.label.slice(m.end)}
              </>
            ) : m.label}
          </span>
          <span className="text-[11px] text-muted-foreground">{m.section} › {m.group}</span>
        </button>
      ))}
    </div>
  );
}

function PaneSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
