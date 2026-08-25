import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { PixelPanel } from './PixelPanel';
import { HistoryTab } from './HistoryTab';
import { ActivityTab } from './ActivityTab';
import { PixelBadge } from './PixelBadge';
import { PixelButton } from './PixelButton';
import { SpritePortrait } from './SpritePortrait';
import { PtyTerminalView } from './PtyTerminalView';
import { MessageQueueComposer } from './MessageQueueComposer';
import { TasksKanban } from './TasksKanban';
import { AskMeTab } from './AskMeTab';
import { TriggersTab } from './triggers/TriggersTab';
import { TriggerHistoryTab } from './triggers/TriggerHistoryTab';
import { WorkersTab } from './WorkersTab';
import { SkillsTab } from './SkillsTab';
import { KnowledgeTab } from './KnowledgeTab';
import { acquireTerminal, disposeTerminal, resetTerminal } from './terminalPool';
import { terminalInstanceKey } from './terminalRecovery';
import { Icon } from './Icon';
import { relSince } from '@shared/relTime';
import { TOKENS_BILLED_TIP } from '@shared/usageFormat';
// react-markdown + remark-gfm are ~360 kB and only render inside a transcript
// entry the user expanded. The IDE and the file overlay already load it lazily.
const MarkdownPreview = lazy(() => import('@/markdown/MarkdownPreview').then((m) => ({ default: m.MarkdownPreview })));
import {
  chipState, repoRefFromUrl, reviewKey, type ReviewRecord
} from '@shared/prReview';
import { readIssueRepo, resolveIssueRepo, verdictFrame, writeIssueRepo } from './issuesTab';
import type { ReflectStatus } from '../../../preload';
import { useDestructive } from './ui/DestructiveAction';
import { MemoryGraphPanel } from './MemoryGraphPanel';
import { useFleetTelemetry } from '@/hooks/useTelemetry';
import { useFleetUsage } from '@/hooks/useFleetUsage';
import { COMMAND_GROUPS } from '@shared/claudeCommands';
import { summarizeReflect } from '@shared/reflectSummary';
import { useStore, triggerHistoryVisible, type Agent } from '@/store/store';
import { usePtyParser } from '@/hooks/usePtyParser';
import {
  buildSpawnCommand,
  decodeProviderModel,
  encodeProviderModel,
  inferAgentProvider,
  effortLevelsFor,
  effortUnsupportedReason,
  isClaudeProvider,
  isValidEffort,
  modelProvidersForAgent,
  modelsForProvider,
  providerPreset,
  tokenizeCommand,
  AGENT_PROVIDER_PRESETS,
  type AgentProvider
} from '@/store/config';
import { canReceiveInbox } from '@shared/agentProvider';
import { capProgress } from '@shared/usageFormat';
import { badgeCounts, parseTasks, TASK_POLL_MS } from '@/store/taskLedger';
import { respawnAgent } from '@/hooks/useRestoreTeam';
import type { HarnessConfig } from '@/store/config';
import { isClearCommand } from '@shared/providerAutomation';
import { sortAgentsForList } from '@shared/agentOrder';

/** Label for the dispatch shortcut. Same Cmd/Ctrl+Enter idiom AskMeTab already
 *  uses to send; printed because a shortcut nobody can see is a shortcut nobody
 *  uses. */
const DISPATCH_SHORTCUT = navigator.userAgent.includes('Mac') ? '⌘↵' : 'Ctrl+↵';

/** How many issues one fetch shows. Named so the list can SAY it was cut here
 *  rather than presenting a truncated page as the whole answer. */
const ISSUE_PAGE_SIZE = 10;

/**
 * An icon-only delete that arms before it fires.
 *
 * Two things in this tab removed something permanently on a single click with no
 * confirmation and no undo — an archived agent's record, and a registered repo.
 * MD-28 put one destructive-action policy in ui/destructive.ts; this is that same
 * machine driven through its hook rather than <DestructiveAction>, because these
 * live in tight flex rows where the component's two-button confirm pair would
 * blow the row out. Ordinary shape: arm, auto-disarm after 4s, second press runs.
 *
 * The resting button also carries a real accessible name. Both of these were bare
 * <button><Icon name="x"/></button>, which a screen reader announces as "button" —
 * so the only way to learn what one did was to press it, and pressing it was the
 * destructive act.
 */
function IconDelete({ label, confirmLabel, onRun }: {
  /** What the button does, in the resting state. Becomes its accessible name. */
  label: string;
  /** Armed label — say what is about to be lost, not "confirm". */
  confirmLabel: string;
  onRun: () => void;
}) {
  const { phase, remaining, press } = useDestructive({ onRun });
  if (phase === 'armed') {
    return (
      <button
        onClick={press}
        title={confirmLabel}
        aria-label={confirmLabel}
        style={{
          flexShrink: 0, padding: '1px 6px', border: 'none', cursor: 'pointer',
          background: 'var(--cth-danger)', color: 'var(--cth-paper-100)',
          boxShadow: 'inset 0 0 0 1px var(--cth-danger-hover)',
          fontFamily: 'var(--cth-font-ui)', fontSize: 11
        }}
      >{confirmLabel}{remaining > 0 ? ` · ${remaining}s` : ''}</button>
    );
  }
  return (
    <button
      onClick={press}
      title={label}
      aria-label={label}
      style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--cth-ink-500)', flexShrink: 0 }}
    ><Icon name="x" /></button>
  );
}

/** Michael's control surface. Shown instead of the plain terminal/files panel
 *  when the god agent is selected: terminal + queue, the floor roster (with
 *  per-agent model + dispatch + assistant access), a memory view, and a live
 *  activity feed / board / usage meter. */

// Both the AskMe (#human) tab and the Triggers tab live here. Triggers replaced
// the old Schedules tab: schedules are now one of four trigger types, and the
// whole surface lives in ./triggers (see src/shared/triggers.ts for the contract).
type CCTab = 'terminal' | 'floor' | 'tasks' | 'issues' | 'prs' | 'human' | 'triggers' | 'trigger-history' | 'history'
  | 'memory' | 'graph' | 'activity' | 'skills' | 'knowledge' | 'workers';

/** An issue as returned by `window.cth.githubIssues` — gh or glab backed (labels/assignees flattened). */
interface GHIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  assignees: string[];
}

type PR = Awaited<ReturnType<typeof window.cth.githubPRs>>['prs'][number];
const REVIEW_WORD: Record<PR['review'], string> = { approved: 'approved', pending: 'review pending', changes_requested: 'changes requested', none: '' };

/** Which tabs carry an open-ask count, and which count each one carries.
 *  Only these two: a badge on a tab that cannot show you the thing it is
 *  counting is a dead end. */
function badgeFor(key: CCTab, counts: { tasks: number; askMe: number }): number {
  return key === 'tasks' ? counts.tasks : key === 'human' ? counts.askMe : 0;
}

/** Canonical tab order. Not every entry is always shown — see `visibleTabs`. */
const TABS: { key: CCTab; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { key: 'terminal', label: 'terminal', icon: 'terminal' },
  { key: 'floor', label: 'monitor', icon: 'mcp' },
  { key: 'tasks', label: 'tasks', icon: 'check' },
  { key: 'issues', label: 'issues', icon: 'info' },
  { key: 'prs', label: 'PRs', icon: 'code' },
  { key: 'human', label: 'ask me', icon: 'bell' },
  { key: 'triggers', label: 'triggers', icon: 'clock' },
  { key: 'trigger-history', label: 'history', icon: 'ledger' },
  { key: 'memory', label: 'memory', icon: 'sparkle' },
  { key: 'graph', label: 'graph', icon: 'web' },
  { key: 'activity', label: 'activity', icon: 'bell' },
  { key: 'history', label: 'prompts', icon: 'ledger' },
  { key: 'skills', label: 'skills', icon: 'sparkle' },
  { key: 'knowledge', label: 'knowledge', icon: 'ledger' },
  { key: 'workers', label: 'workers', icon: 'gear' }
];

/**
 * Open human asks, per badge, from ONE read of the ledger.
 *
 * The Tasks and ASK ME views each poll `hiveTasks` themselves, but neither is
 * mounted unless you are already looking at it — so the one thing the human most
 * needs to notice (a card stalled on THEM) was invisible from every other tab,
 * including the terminal they spend the day in. This poll lives on the panel,
 * which is always mounted, and feeds both labels.
 *
 * The counts differ by design; `badgeCounts` in store/taskLedger.ts says why.
 * The predicates and the interval come from there too — a second parser or a
 * second definition of "open ask" is how a badge starts lying.
 */
function useAskBadges(): { tasks: number; askMe: number } {
  const [counts, setCounts] = useState({ tasks: 0, askMe: 0 });
  useEffect(() => {
    let alive = true;
    const read = async () => {
      // Keep the last good counts on a failed read. A transient error blanking
      // the badge would read as "nothing waits on you", which is the one wrong
      // answer this control can give.
      try {
        const next = badgeCounts(parseTasks(await window.cth.hiveTasks()));
        if (alive) setCounts((prev) =>
          prev.tasks === next.tasks && prev.askMe === next.askMe ? prev : next);
      } catch { /* keep last good */ }
    };
    void read();
    const timer = setInterval(read, TASK_POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  return counts;
}

/** @param fullscreen this instance IS the fullscreen overlay, so it owns the pty
 *  and renders the real terminal. The docked instance renders the "open in
 *  fullscreen" placeholder instead — two live xterms on one pty fight over its
 *  cols/rows and corrupt the display. */
export function CommandCenterPanel({ agent, fullscreen = false }: { agent: Agent; fullscreen?: boolean }) {
  const boss = useStore((s) => s.bossName);
  const [tab, setTab] = useState<CCTab>('terminal');
  // The trigger-history ledger has nothing to say until an outside party can
  // reach us, so its tab appears only once an org key or a webhook exists. This
  // is the first config-gated tab in the panel: TABS stays the canonical order
  // and the gate is applied at render, so nothing else has to know about it.
  // The rule itself lives in the store (`triggerHistoryVisible`) beside the two
  // mirrors it reads — a second copy here would drift from Settings.
  const showHistory = useStore(triggerHistoryVisible);
  const askBadges = useAskBadges();
  // Never leave the panel parked on a tab that has just been hidden.
  useEffect(() => {
    if (!showHistory && tab === 'trigger-history') setTab('terminal');
  }, [showHistory, tab]);
  const visibleTabs = TABS.filter((t) => t.key !== 'trigger-history' || showHistory);

  // External tab requests (the office task board → 'tasks', the boss-room
  // calendar → 'triggers'). seq-keyed so clicking again re-opens the tab even
  // if it was already requested.
  const ccTabRequest = useStore((s) => s.ccTabRequest);
  useEffect(() => {
    if (!ccTabRequest) return;
    const key = ccTabRequest.tab as CCTab;
    if (!TABS.some((t) => t.key === key)) return;
    // Read the gate live rather than depending on it — as a dependency it would
    // re-fire a stale request the moment the tab appeared.
    if (key === 'trigger-history' && !triggerHistoryVisible(useStore.getState())) return;
    setTab(key);
  }, [ccTabRequest]);
  // A task-detail "assign" pre-fills the Floor dispatch box and jumps to it.
  // Seeded via the store one-shot (the detail overlay lives app-wide now);
  // { seq } makes every assign distinct so identical text re-seeds.
  const [dispatchSeed, setDispatchSeed] = useState<{ text: string; seq: number }>({ text: '', seq: 0 });
  const dispatchSeedRequest = useStore((s) => s.dispatchSeedRequest);
  useEffect(() => {
    if (!dispatchSeedRequest) return;
    setDispatchSeed({ text: dispatchSeedRequest.text, seq: dispatchSeedRequest.seq });
  }, [dispatchSeedRequest]);
  // Lifted so the memory-graph tab can jump to a specific agent's memory file.
  const [selectedMemoryAgent, setSelectedMemoryAgent] = useState<string | null>(null);
  const updateAgent = useStore((s) => s.updateAgent);
  const setFullscreen = useStore((s) => s.setFullscreen);
  const fullscreenAgentId = useStore((s) => s.fullscreenAgentId);
  const onPtyStream = usePtyParser(agent.id);
  // True only for the DOCKED panel while the overlay holds this agent.
  const isFullscreenedHere = fullscreenAgentId === agent.id && !fullscreen;
  // v0.3.4: ONE floor-wide auto-delivery switch, moved off the per-agent
  // control strips — toggling applies to every live agent, god included.
  // Seeded from the god's own control state (the floor is kept in sync by
  // this single control, so any agent's state reflects the floor's).
  const [floorDeliveryPaused, setFloorDeliveryPaused] = useState(false);
  useEffect(() => {
    let alive = true;
    window.cth.controlSnapshot(agent.id)
      .then((s) => { if (alive && s) setFloorDeliveryPaused(s.autoDeliveryPaused); })
      .catch(() => { /* none */ });
    return () => { alive = false; };
  }, [agent.id]);
  const toggleFloorDelivery = async () => {
    const next = !floorDeliveryPaused;
    setFloorDeliveryPaused(next);
    const all = useStore.getState().agents;
    await Promise.all(all.map((a) => window.cth.controlAutoDelivery(a.id, next).catch(() => null)));
  };

  return (
    <PixelPanel
      variant="default"
      noPadding
      style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 0, overflow: 'hidden' }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 8px', background: 'var(--cth-cream-100)',
        borderBottom: '1px solid var(--cth-ink-700)', flexShrink: 0
      }}>
        <div style={{
          width: 32, height: 32, background: `var(--cth-${agent.accent}-light)`,
          boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden', flexShrink: 0
        }}>
          <SpritePortrait character={agent.character} scale={1} />
        </div>
        {/* Title + subtitle truncate; the control cluster never shrinks. At
            sidebar width the old header wrapped its 24-char display-font title
            onto three lines and "runs the floor" word-per-line under the two
            wide buttons — everything here is single-line by construction. */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--cth-font-display)', fontSize: 10, lineHeight: '14px', color: 'var(--cth-ink-900)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
          }}>COMMAND CENTER</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 1, minWidth: 0 }}>
            <PixelBadge status={agent.status} />
            <span style={{
              fontSize: 12, color: 'var(--cth-ink-500)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            }}>{boss} runs the floor</span>
          </div>
        </div>
        {/* v0.3.4: floor-wide auto-delivery lives HERE (one switch for every
            agent's queue), and the IDE opens from agent level, not the toolbar.
            Short labels — the tooltips carry the full explanation. */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          <PixelButton
            variant={floorDeliveryPaused ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => { void toggleFloorDelivery(); }}
          >
            <span
              title={floorDeliveryPaused
                ? 'Automatic queue delivery is PAUSED for every agent — messages stay queued until resumed'
                : 'Automatic queue delivery is ON for every agent — click to pause the whole floor'}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <Icon name={floorDeliveryPaused ? 'pause' : 'play'} />
              {floorDeliveryPaused ? 'paused' : 'auto'}
            </span>
          </PixelButton>
          {/* Floor-level surface with no agent of its own: the honest target is
              whoever is selected, stated explicitly rather than left to the
              IDE's fallback so the intent is visible at the call site. */}
          <PixelButton variant="secondary" size="sm" onClick={() => {
            const s = useStore.getState();
            s.setIdeOpen(true, s.selectedId);
          }}>
            <span title="Open the IDE — file editor + git diff" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon name="code" /> IDE
            </span>
          </PixelButton>
        </div>
      </div>

      {/* Tab bar — ONE row, tabs at their natural width, scrolling only if the
          panel is genuinely too narrow for all of them.

          This was an auto-fit grid of equal-width cells, which had a failure mode
          the equal widths caused: every column is sized to the WIDEST tab, so the
          track count is set by the longest label rather than by the total width
          the labels actually need. Adding a 12th tab tipped it over at fullscreen
          width and dropped `setup` onto a second row with most of the first row's
          space still unused — the tabs need ~1320px of content and had ~1610px.

          Content-sized tabs fit the whole set on one line with room to spare, and the
          `.cth-tabbar` rules in global.css (scrollbar-width: none, ::-webkit-
          scrollbar { height: 0 }) already exist for exactly this: a single row that
          scrolls with the scrollbar hidden. The grid never scrolled, so those rules
          have been dead code since it landed.

          Trade-off, deliberate: in the NARROW docked panel the far-right tabs now
          scroll out of view instead of wrapping to a visible second row. One row
          that sometimes needs a scroll beats two rows where one is nearly empty —
          and the grid's own reason for existing (keeping wrapped rows aligned)
          stops applying the moment there is only ever one row. */}
      <div className="cth-tabbar" style={{
        display: 'flex', gap: 4,
        // Docked in the sidebar the panel is narrow, so tabs WRAP: a second row
        // costs a few pixels of a tall column, while a horizontal scroll there
        // would hide half the tabs behind a gesture with no affordance.
        // In focus mode the panel is wide and vertical space is the scarce
        // resource, so it stays ONE row and scrolls instead. `.cth-tabbar` in
        // global.css already hides that scrollbar.
        flexWrap: fullscreen ? 'nowrap' : 'wrap',
        overflowX: fullscreen ? 'auto' : 'visible',
        padding: '6px 8px', background: 'var(--cth-cream-100)',
        borderBottom: '1px solid var(--cth-ink-700)', flexShrink: 0
      }}>
        {visibleTabs.map((t) => {
          const asks = badgeFor(t.key, askBadges);
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              // The badge renders as a bare number, so on its own the button
              // announces "tasks 3". Say what the 3 is.
              title={asks > 0 ? `${t.label} — ${asks} waiting on you` : undefined}
              aria-label={asks > 0 ? `${t.label}, ${asks} waiting on you` : undefined}
              style={{
                whiteSpace: 'nowrap',
                // grow to share any spare width (so the strip still spans the panel
                // exactly as the old grid did), never shrink below the label (a
                // squashed tab is unreadable — overflow into the scroll instead).
                flex: '1 0 auto',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                padding: '4px 8px 3px', border: 'none', cursor: 'pointer',
                background: tab === t.key ? `var(--cth-${agent.accent})` : 'var(--cth-cream-200)',
                // The selected tab is filled with the agent's accent, which is a
                // LIGHT colour in both themes. ink-900 flips to near-white in dark
                // mode, so the active tab's label was pale-on-pale — the one tab
                // you most need to read. On-accent text is dark in both themes.
                color: tab === t.key ? 'var(--cth-on-accent)' : 'var(--cth-ink-900)',
                boxShadow: tab === t.key
                  ? 'inset 0 0 0 1px var(--cth-ink-300)'
                  : 'inset 0 0 0 1px var(--cth-ink-100)',
                fontFamily: 'var(--cth-font-ui)', fontSize: 13
              }}
            >
              <Icon name={t.icon} /> {t.label}
              {/* Hidden at 0: a badge reading "0" is a thing to read and dismiss on
                  every tab, every render, which is how a notification stops being
                  one. */}
              {asks > 0 && (
                <PixelBadge
                  status="blocked"
                  label={String(asks)}
                  /* Sized down to ride inside a tab: the default badge is taller
                     than the label it sits next to, and this strip already scrolls
                     at fullscreen width. */
                  style={{ gap: 3, padding: '0 4px', lineHeight: '14px', fontSize: 10 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tab === 'terminal' && (
          isFullscreenedHere ? (
            <Centered>Terminal is open in fullscreen. Press Esc to bring it back.</Centered>
          ) : agent.ptyId ? (
            <>
              <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                <PtyTerminalView
                  key={terminalInstanceKey(agent.ptyId, agent.terminalGeneration)}
                  ptyId={agent.ptyId}
                  onStreamData={onPtyStream}
                  onUserPrompt={(t) => {
                    updateAgent(agent.id, { lastPrompt: t });
                    if (isClearCommand(t, inferAgentProvider(agent.command, agent.provider))) {
                      updateAgent(agent.id, { contextTokens: 0, contextLimit: undefined, progress: 0 });
                    }
                    void window.cth.historyAdd({ agentId: agent.id, cwd: agent.cwd, text: t });
                  }}
                  onToggleFullscreen={() => setFullscreen(fullscreen ? null : agent.id)}
                  fullscreen={fullscreen}
                  embedded={!fullscreen}
                />
              </div>
              <MessageQueueComposer agent={agent} />
            </>
          ) : (
            <Centered>{boss} has no live terminal.</Centered>
          )
        )}
        {tab === 'floor' && <FloorTab seed={dispatchSeed} />}
        {tab === 'tasks' && <TasksKanban />}
        {tab === 'issues' && <RepoTab view="issues" />}
        {tab === 'prs' && <RepoTab view="prs" />}
        {tab === 'human' && <AskMeTab />}
        {tab === 'triggers' && <TriggersTab />}
        {tab === 'trigger-history' && <TriggerHistoryTab />}
        {tab === 'memory' && (
          <MemoryTab godId={agent.id} who={selectedMemoryAgent ?? undefined} onWho={setSelectedMemoryAgent} />
        )}
        {tab === 'graph' && (
          <MemoryGraphPanel
            godId={agent.id}
            onJumpToMemory={(id) => { setSelectedMemoryAgent(id); setTab('memory'); }}
          />
        )}
        {tab === 'activity' && <ActivityTab />}
        {tab === 'history' && <HistoryTab agentId={agent.id} />}
        {tab === 'skills' && <SkillsTab agentCwd={agent.cwd} />}
        {tab === 'knowledge' && <KnowledgeTab />}
        {tab === 'workers' && <WorkersTab />}
      </div>
    </PixelPanel>
  );
}

// ─── Floor tab — roster, model, dispatch, dirs, assistant ────────────────────

function FloorTab({ seed }: { seed: { text: string; seq: number } }) {
  const boss = useStore((s) => s.bossName);
  const agents = useStore((s) => s.agents);
  const select = useStore((s) => s.select);
  const updateAgent = useStore((s) => s.updateAgent);
  const toolCounts = useStore((s) => s.toolCounts);
  // Live OpenTelemetry per agent — merged into each agent card below (the old
  // standalone Fleet tab folded in here so the roster shows identity + controls
  // AND live cost/usage in one place).
  const { samples, spark, rate, lastTool, breakers } = useFleetTelemetry();
  // Same readout the roster cards poll — it carries the per-thread split that
  // raw telemetry samples (which are lifetime-only) cannot.
  const fleetUsage = useFleetUsage();
  const [repos, setRepos] = useState<string[]>([]);
  // Floor-wide token budget (drives the breaker); also the token-meter denominator
  // when set. Undefined/0 means no budget — and then there is no meter at all.
  const [tokenCap, setTokenCap] = useState<number | undefined>(undefined);
  // Per-agent token limit (overrides the floor budget for that agent), keyed by id.
  const [agentTokenCaps, setAgentTokenCaps] = useState<Record<string, number>>({});
  const [restarting, setRestarting] = useState<string | null>(null);
  const [engineProvider, setEngineProvider] = useState<AgentProvider>('claude');
  const [engineModel, setEngineModel] = useState<string | undefined>(undefined);
  const [restartErrors, setRestartErrors] = useState<Record<string, string>>({});
  // The harness's own default model (Settings → default model). Michael and every
  // new agent spawn on this, so the picker marks it — otherwise the only entry
  // reading "default" was the CLI's, which is a different thing entirely.
  const [defaultModel, setDefaultModel] = useState<string | undefined>(undefined);
  const [dispatchTo, setDispatchTo] = useState<string>(''); // '' = the boss decides
  const [dispatchText, setDispatchText] = useState('');
  // The OUTCOME rides with the text. Both results used to be one string rendered
  // in one muted colour and wiped by one 4s timer, so a dispatch that never
  // reached Michael looked exactly like one that did — and the reason was gone
  // before you could read it. A failure now stays until it is dismissed.
  const [dispatchMsg, setDispatchMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    window.cth.getConfig().then((c) => {
      setRepos(c.registeredRepos ?? []);
      setTokenCap(c.costCapTokens);
      setAgentTokenCaps(c.agentTokenCaps ?? {});
      setEngineProvider(c.godProvider ?? 'claude');
      setEngineModel(c.godModel);
      setDefaultModel(c.defaultModel);
    }).catch(() => { /* noop */ });
  }, []);

  // Seed the dispatch box from a task-card "assign" (keyed on seq so repeat
  // assigns re-prefill). seq === 0 is the untouched initial state — skip it.
  useEffect(() => {
    // The owner picker resets with the text: an assign says "Michael decides",
    // and inheriting whoever was selected before is how a broadcast happens.
    if (seed.seq > 0) { setDispatchText(seed.text); setDispatchTo(''); }
  }, [seed.seq, seed.text]);

  // Restart an agent's PTY in place. `resume:true` reattaches its prior Claude
  // conversation (`--resume <sessionId>`, resolved in the main process from the
  // hive registry by agent id) — this is "Restart & Continue": a clean re-draw
  // of the TUI in a fresh process WITHOUT losing the thread, which is the escape
  // hatch for a corrupted/garbled terminal (e.g. xterm reflow after dragging the
  // window between displays of different sizes). With `resume` unset it's the
  // old behavior: a model change that starts a fresh session.
  const restartWithModel = async (
    a: Agent,
    model: string | undefined,
    opts: {
      resume?: boolean;
      provider?: AgentProvider;
      /** Resume if we can, start fresh if we can't, instead of refusing.
       *  "Restart & Continue" wants the hard failure — continuing is the entire
       *  point, so silently starting a blank session would be worse than an
       *  error. A model change wants the soft one: the user asked to change
       *  model, and an agent with no recorded session still has to get one. */
      resumeOptional?: boolean;
      /** Reasoning-effort level to (re)spawn on. Omitted = keep the agent's
       *  current one; this is the only path that can apply an effort change,
       *  since the flag is a spawn argument. */
      effort?: string;
    } = {}
  ) => {
    if (!a.ptyId) return;
    setRestarting(a.id);
    setRestartErrors((errors) => ({ ...errors, [a.id]: '' }));
    try {
      const cfg = await window.cth.getConfig();
      // Respawn on the same CLI this agent already runs on (inferred from its
      // command if not explicitly tagged) so an Antigravity/Codex worker stays
      // on its own binary. tokenizeCommand keeps quoted model labels one arg.
      // opts.provider overrides the inferred provider — used when changing GOD's engine.
      const previousProvider = inferAgentProvider(a.command, a.provider);
      const provider = opts.provider ?? previousProvider;
      let resume = opts.resume === true && provider === previousProvider;
      if (opts.resume && !resume && !opts.resumeOptional) {
        throw new Error('Cannot resume a session through a different provider.');
      }
      let resumeSessionId: string | undefined;
      if (resume) {
        // A precondition miss is fatal for an explicit "continue", and merely
        // means "start fresh" for an opportunistic one (see resumeOptional).
        const giveUpOnResume = (reason: string) => {
          if (!opts.resumeOptional) throw new Error(reason);
          resume = false;
          resumeSessionId = undefined;
        };
        const registry = await window.cth.hiveRegistry();
        resumeSessionId = registry.agents[a.id]?.sessionId;
        if (!resumeSessionId) {
          giveUpOnResume('No recorded session ID; current process was left running.');
        } else if (provider === 'claude' && !(await window.cth.resolveSessionCwd(resumeSessionId))) {
          giveUpOnResume('Session transcript not found; current process was left running.');
        }
      }
      // Capture the live grid before replacing anything. Restart & Continue
      // recreates only this agent's xterm; model changes retain the old
      // in-place reset behavior.
      const oldEntry = acquireTerminal(a.ptyId);
      let cols = oldEntry.term.cols || 100;
      let rows = oldEntry.term.rows || 30;
      try {
        oldEntry.fit.fit();
        cols = oldEntry.term.cols;
        rows = oldEntry.term.rows;
      } catch { /* host not sized yet */ }

      const killed = await window.cth.killPty(a.ptyId);
      // A pty that is ALREADY gone is the state this kill was trying to reach, so
      // it is not a failure. This is the single most common way to arrive at
      // "Restart & Continue": the session died on its own — a crash, or Ctrl-C
      // twice — main dropped it from the session map, and kill then answers
      // `no pty: <id>`. Treating that as fatal aborted before the respawn and
      // turned the one situation the button exists for into a dead end.
      if (!killed.ok && !/^no pty:/.test(killed.error ?? '')) {
        throw new Error(killed.error ?? 'Could not stop the current process.');
      }
      if (resume) {
        // A blank xterm can retain corrupt renderer/DOM/subscription state even
        // after its PTY is healthy. Throw that one terminal away, acquire its
        // replacement BEFORE spawning (so startup output has a listener), then
        // bump the key so React remounts only this agent's terminal card.
        disposeTerminal(a.ptyId);
        acquireTerminal(a.ptyId);
        updateAgent(a.id, {
          terminalGeneration: (a.terminalGeneration ?? 0) + 1,
          status: 'idle',
          action: 'recreating terminal…'
        });
      } else {
        resetTerminal(a.ptyId);
      }
      // An effort level belongs to the ENGINE, so a provider switch drops one the
      // new engine does not accept rather than splicing an unknown flag.
      const effort = opts.effort !== undefined ? opts.effort : a.effort;
      const nextEffort = isValidEffort(provider, effort) ? effort : undefined;
      const command = buildSpawnCommand(cfg, model, provider, nextEffort);
      const [exe, ...args] = tokenizeCommand(command.trim());
      const hive = a.isGod
        ? { id: a.id, name: a.name, cwd: a.cwd, provider, isGod: true, role: 'orchestrator (god)' }
        : a.isAssistant
        ? { id: a.id, name: a.name, cwd: a.cwd, provider, isAssistant: true, role: `${boss}'s prep assistant` }
        : { id: a.id, name: a.name, cwd: a.cwd, provider, role: a.description };
      const res = await window.cth.spawnPty({
        id: a.ptyId,
        cwd: a.cwd,
        command: exe,
        args,
        provider,
        cols,
        rows,
        hive,
        resume,
        resumeSessionId,
        requireResume: resume
      });
      if (!res.ok) throw new Error(res.error ?? 'Restart failed.');
      if (resume && res.resumed !== true) {
        throw new Error('Resume was refused; no replacement session was accepted.');
      }
      if (res.ok) {
        // Record the model even on a resume. A same-provider model change now
        // RESUMES the session (that is the point — you keep the conversation and
        // just swap the model), so "resume ⇒ the model is unchanged" stopped
        // being true. Skipping the patch left the live process on the new model
        // while the selector and the persisted agent kept the old one, and the
        // next restore relaunched the old command. `command` is rebuilt from the
        // selected model above, so on a genuine no-change restart this is a no-op.
        const patch = resume
          ? {
              command: command.trim(),
              provider,
              model,
              effort: nextEffort,
              status: 'idle' as const,
              action: 'continuing…'
            }
          : {
              command: command.trim(),
              provider,
              model,
              effort: nextEffort,
              status: 'idle' as const,
              action: provider === previousProvider ? 'restarting…' : `switching to ${providerPreset(provider).label}…`
            };
        updateAgent(a.id, patch);
      }
    } catch (error) {
      setRestartErrors((errors) => ({
        ...errors,
        [a.id]: error instanceof Error ? error.message : String(error)
      }));
    } finally {
      setRestarting(null);
    }
  };

  // ALL human dispatch flows through the god — never directly into a worker's
  // inbox. Direct dispatch bypassed the orchestrator's whole job: no 4-part
  // contract, no card in tasks.json, no board awareness — and the old
  // 'broadcast' DEFAULT sent the same task to every worker at once. A worker
  // picked in the dropdown is forwarded as a SUGGESTION the god may follow.
  const dispatch = async () => {
    const body = dispatchText.trim();
    if (!body) return;
    const suggested = dispatchTo ? agents.find((a) => a.id === dispatchTo) : undefined;
    const full = suggested
      ? `${body}\n\n(The human suggests ${suggested.name} (${suggested.id}) for this — your call as orchestrator.)`
      : body;
    const res = await window.cth.hiveSend(
      { to: 'god', act: 'request', subject: 'Task from the human', body: full },
      'human'
    );
    // Only clear the box on success. Wiping the text after a FAILED send threw
    // away the thing the user typed and left them nothing to retry with.
    if (res.ok) setDispatchText('');
    setDispatchMsg(res.ok
      ? { ok: true, text: `sent to ${boss}${suggested ? ` (suggesting ${suggested.name})` : ''}` }
      : { ok: false, text: `not sent — ${res.error ?? 'unknown error'}` });
    // A success is self-evident and can fade; a failure is the whole message and
    // waits to be dismissed.
    if (res.ok) setTimeout(() => setDispatchMsg((m) => (m?.ok ? null : m)), 4000);
  };

  // Set/clear one agent's token limit; persist the whole map (writeConfig replaces
  // the top-level key, so we send the full merged map). Drives that agent's meter
  // and the breaker's per-agent trip.
  const setAgentCap = (id: string, tokens: number | undefined) => {
    const next = { ...agentTokenCaps };
    if (tokens && tokens > 0) next[id] = tokens; else delete next[id];
    setAgentTokenCaps(next);
    void window.cth.updateConfig({ agentTokenCaps: next }).catch(() => { /* noop */ });
  };

  // No budget configured means NO meter. The old fallback divided cumulative
  // session tokens by a hardcoded 1M, so with neither a floor budget nor a
  // per-agent cap set — the default state — every bar drifted toward 100%
  // against a number nobody had chosen. capProgress() is the same predicate the
  // roster card and the detail strip use, and it returns null when unbudgeted.
  const budgeted = !!(tokenCap && tokenCap > 0);
  // Fleet totals across the roster (for the AGENTS summary band).
  let sumTokens = 0, sumInput = 0, sumCacheRead = 0, sumRate = 0;
  for (const a of agents) {
    const s = samples[a.id];
    if (s) {
      sumTokens += s.input + s.output + s.cacheRead + s.cacheCreation;
      sumInput += s.input + s.cacheRead + s.cacheCreation;
      sumCacheRead += s.cacheRead;
    }
    sumRate += rate[a.id] ?? 0;
  }
  const fleetCachePct = sumInput > 0 ? Math.round((sumCacheRead / sumInput) * 100) : 0;

  return (
    <Scroll>
      <Section title={`DISPATCH — VIA ${boss.toUpperCase()}`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 8, color: 'var(--cth-ink-500)', flexShrink: 0 }}>
            SUGGESTED OWNER
          </span>
          <Select value={dispatchTo} onChange={setDispatchTo}>
            <option value="">{boss} decides</option>
            {sortAgentsForList(agents.filter((a) => !a.isGod)).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </div>
        <textarea
          value={dispatchText}
          onChange={(e) => setDispatchText(e.target.value)}
          // The primary action of this tab was mouse-or-Tab only, while every
          // other input in this file already answers a key. Plain Enter stays a
          // newline — this is a multi-line task description, not a chat line.
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && dispatchText.trim()) {
              e.preventDefault();
              void dispatch();
            }
          }}
          rows={2}
          placeholder={`Describe the task… (${boss} decomposes, writes the card, and assigns)`}
          style={textareaStyle}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <PixelButton variant="primary" size="sm" onClick={dispatch} disabled={!dispatchText.trim()}>
            dispatch
          </PixelButton>
          <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 10, color: 'var(--cth-ink-300)', flexShrink: 0 }}>
            {DISPATCH_SHORTCUT}
          </span>
          {dispatchMsg && (
            <span role="status" style={{
              fontSize: 12, wordBreak: 'break-word',
              color: dispatchMsg.ok ? 'var(--cth-ink-500)' : 'var(--cth-coral)'
            }}>
              {dispatchMsg.text}
              {!dispatchMsg.ok && (
                <button
                  onClick={() => setDispatchMsg(null)}
                  title="Dismiss"
                  aria-label="Dismiss this error"
                  style={{
                    marginLeft: 6, border: 'none', background: 'transparent', cursor: 'pointer',
                    color: 'var(--cth-ink-500)', fontSize: 12, padding: 0
                  }}
                >&times;</button>
              )}
            </span>
          )}
        </div>
      </Section>

      <Section title="AGENTS">
        {sortAgentsForList(agents).map((a) => {
          const agentProvider = inferAgentProvider(a.command, a.provider);
          const agentPreset = providerPreset(agentProvider);
          const sample = samples[a.id];
          const breaker = breakers[a.id];
          const armed = !!breaker && (breaker.level === 'constrained' || breaker.level === 'stopped');
          // `tokens` stays LIFETIME — it is what the budget bar measures, and a
          // cleared conversation does not un-spend the budget. `shownTokens` is
          // this conversation, which is what the number beside the bar is read as.
          const tokens = sample ? sample.input + sample.output + sample.cacheRead + sample.cacheCreation : 0;
          const shownTokens = fleetUsage[a.id]?.thread.totalTokens ?? tokens;
          const agentCap = agentTokenCaps[a.id]; // per-agent limit, if set
          // null when this agent has neither its own cap nor a floor budget —
          // the meter is then not rendered at all.
          const cap = capProgress(tokens, agentCap, tokenCap);
          const meterColor = armed || (cap && cap.pct >= 90) ? 'var(--cth-coral)'
            : cap && cap.pct >= 60 ? 'var(--cth-lemon)' : 'var(--cth-mint)';
          // Sparkline only when the agent is actually burning tokens; otherwise the
          // flat baseline is just a mystery line. Label it with the live rate.
          const sparkSeries = spark[a.id] ?? [];
          const hasSpark = sparkSeries.some((v) => v > 0);
          const rateVal = Math.round(rate[a.id] ?? 0);
          const rateLabel = rateVal > 0 ? `${fmtTokens(rateVal)}/m` : 'rate';
          const currentModelKnown = modelsForProvider(agentProvider)
            .some((model) => model.id === a.model);
          return (
          <div key={a.id} style={{
            display: 'flex', flexDirection: 'column', gap: 4,
            padding: 6, marginBottom: 6,
            background: armed ? 'var(--cth-coral-light)' : 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 24, height: 24, background: `var(--cth-${a.accent}-light)`,
                boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
                display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden', flexShrink: 0
              }}>
                <SpritePortrait character={a.character} scale={1} />
              </div>
              <button
                onClick={() => select(a.id)}
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
                  fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)'
                }}
              >{a.name}{a.isGod ? ' (god)' : ''}</button>
              <PixelBadge status={armed ? 'looping' : a.status} />
              {armed && <span title={breaker?.reason} style={{ color: 'var(--cth-coral)', fontSize: 12 }}>⚠</span>}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--cth-ink-500)' }}>
                {(toolCounts[a.id] ?? 0)} tool calls
              </span>
              <TokenLimitEditor value={agentCap} onSet={(t) => setAgentCap(a.id, t)} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--cth-ink-500)', wordBreak: 'break-all' }}>{a.cwd}</div>
            {/* Live telemetry (folded in from the old Fleet tab) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {hasSpark ? (
                <span style={{ flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 10, color: 'var(--cth-ink-500)', flexShrink: 0 }}>{rateLabel}</span>
                  <Sparkline series={sparkSeries} />
                </span>
              ) : (
                <span style={{ flex: 1 }} />
              )}
              {lastTool[a.id] && (
                <span style={{
                  fontSize: 10, lineHeight: '14px', padding: '0 5px', flexShrink: 0,
                  background: 'var(--cth-paper-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', color: 'var(--cth-ink-700)'
                }}>{lastTool[a.id]}</span>
              )}
              {/* The count stays either way; only the word changes, because a
                  bare number in a row of numbers says nothing about what it is.
                  'billed', not 'tokens': this is spend summed over every request
                  the thread ever made, and the bare word was being read as the
                  context window (which is the `ctx` gauge one row down). */}
              <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 10, color: 'var(--cth-ink-300)', flexShrink: 0 }}>{cap ? 'budget' : 'billed'}</span>
              <span
                title={`BILLED — ${TOKENS_BILLED_TIP}. This conversation: ${shownTokens.toLocaleString()} (lifetime ${tokens.toLocaleString()}).`}
                style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-900)', width: 56, textAlign: 'right' }}
              >{fmtTokens(shownTokens)}</span>
              {/* A bar whose only label is a `title` needs a mouse and is not
                  reliably announced, so this meter — and the loose numbers beside
                  it — read as nothing at all to a screen reader. */}
              {cap && (
                <>
                  <div
                    role="progressbar"
                    aria-label={`${a.name} token budget`}
                    aria-valuemin={0}
                    aria-valuemax={cap.cap}
                    aria-valuenow={Math.min(tokens, cap.cap)}
                    aria-valuetext={`${tokens.toLocaleString()} of ${cap.cap.toLocaleString()} tokens used (${cap.pct}%)`}
                    title={`CUMULATIVE lifetime usage: ${tokens.toLocaleString()} of ${cap.cap.toLocaleString()} tokens${agentCap ? ' (agent limit)' : ' (floor budget)'} — not the context window, and not reset by /clear`}
                    style={{ width: 96, height: 8, background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', flexShrink: 0 }}
                  >
                    <div style={{ width: `${cap.pct}%`, height: '100%', background: meterColor }} />
                  </div>
                  <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-500)', width: 30, textAlign: 'right' }}>{cap.pct}%</span>
                </>
              )}
            </div>
            {/* Context window — the SAME exact statusLine-fed numbers as the
                avatar-card gauge (tokens currently in the window vs the real
                200k/1M size). Distinct from the cumulative budget meter above,
                which keeps growing forever and pins at 100% — that one is
                spend, this one is headroom before compaction. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 10, color: 'var(--cth-ink-300)', flexShrink: 0 }}>ctx</span>
              {a.contextTokens !== undefined && a.contextLimit ? (() => {
                const cpct = Math.min(100, Math.round((a.contextTokens! / a.contextLimit!) * 100));
                const ccolor = cpct >= 88 ? 'var(--cth-coral)' : cpct >= 75 ? 'var(--cth-lemon)' : `var(--cth-${a.accent})`;
                return (
                  <>
                    <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-900)', width: 56, textAlign: 'right' }}>
                      {fmtTokens(a.contextTokens!)}
                    </span>
                    <div
                      role="progressbar"
                      aria-label={`${a.name} context window`}
                      aria-valuemin={0}
                      aria-valuemax={a.contextLimit!}
                      aria-valuenow={Math.min(a.contextTokens!, a.contextLimit!)}
                      aria-valuetext={`${a.contextTokens!.toLocaleString()} of ${a.contextLimit!.toLocaleString()} tokens in the context window (${cpct}%)`}
                      title={`Context window: ${a.contextTokens!.toLocaleString()} of ${a.contextLimit!.toLocaleString()} tokens (${cpct}%)`}
                      style={{ width: 96, height: 8, background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', flexShrink: 0 }}
                    >
                      <div style={{ width: `${cpct}%`, height: '100%', background: ccolor }} />
                    </div>
                    <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-500)', width: 30, textAlign: 'right' }}>{cpct}%</span>
                  </>
                );
              })() : (
                <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-300)' }}>
                  no status tick yet
                </span>
              )}
            </div>
            {/* Non-god agents get the cross-provider model picker + restart controls
                here. The GOD agent's model lives in the engine row below
                (provider+model+apply), so we DON'T render this second selector for
                it — one model picker, not two. */}
            {!a.isGod && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Select
                value={encodeProviderModel(agentProvider, a.model)}
                disabled={restarting === a.id}
                onChange={(value) => {
                  const choice = decodeProviderModel(value);
                  if (!choice) return;
                  // Switching model within the SAME provider continues the
                  // conversation — that's the whole point of switching mid-task
                  // ("this got hard, go up a tier"), and starting fresh threw
                  // away the context that made the switch necessary.
                  // `resume` is best-effort: restartWithModel already refuses it
                  // across providers, and falls back to a fresh session when no
                  // session id or transcript is recorded.
                  void restartWithModel(a, choice.model, {
                    provider: choice.provider,
                    resume: choice.provider === agentProvider,
                    resumeOptional: true
                  });
                }}
              >
                {(!agentPreset.supportsModel || !currentModelKnown) && (
                  <option value={encodeProviderModel(agentProvider, a.model)}>
                    {agentPreset.label} · {a.model ?? 'current'}
                  </option>
                )}
                {modelProvidersForAgent(a.isGod).map((preset) => (
                  <optgroup key={preset.id} label={preset.label}>
                    {modelsForProvider(preset.id).map((model) => {
                      // `defaultModel` is a Claude model id, so it can only mark
                      // an entry in the Claude group.
                      const isHarnessDefault = preset.id === 'claude'
                        && !!defaultModel && model.id === defaultModel;
                      return (
                        <option
                          key={`${preset.id}:${model.id ?? 'cli-default'}`}
                          value={encodeProviderModel(preset.id, model.id)}
                        >
                          {model.label}{isHarnessDefault ? ' · default' : ''}
                        </option>
                      );
                    })}
                  </optgroup>
                ))}
              </Select>
              <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>
                {restarting === a.id
                  ? 'restarting…'
                  : `${agentPreset.label} model (restarts agent)`}
              </span>
              {/* Restart & Continue — kill + respawn keeping the SAME model and
                  resuming the prior conversation (--resume). Use this to redraw a
                  garbled TUI (e.g. after dragging the window across displays)
                  without losing the thread. */}
              {(agentProvider === 'claude' || agentPreset.resumeFlag || agentPreset.resumeSubcommand) && <>
                <span style={{ flex: 1 }} />
                <PixelButton
                  variant="secondary"
                  size="sm"
                  disabled={restarting === a.id}
                  onClick={() => restartWithModel(a, a.model, { resume: true })}
                >
                  <span title="Kill and respawn this agent, resuming its current conversation — fixes a corrupted/garbled terminal without losing context">
                    restart &amp; continue
                  </span>
                </PixelButton>
              </>}
            </div>
            )}
            <EffortEditor
              agent={a}
              provider={agentProvider}
              busy={restarting === a.id}
              onPick={(effort) => updateAgent(a.id, { effort })}
              onRestart={
                agentProvider === 'claude' || agentPreset.resumeFlag || agentPreset.resumeSubcommand
                  ? () => void restartWithModel(a, a.model, { resume: true, resumeOptional: true })
                  : undefined
              }
            />
            {restartErrors[a.id] && (
              // Dismissible. This was cleared ONLY at the start of the next
              // restart, so an agent that failed to restart once wore a stale red
              // line on its card indefinitely — including after the cause was
              // fixed some other way. A card with no way out of its error state
              // stops meaning anything.
              <div role="status" style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, color: 'var(--cth-coral)' }}>
                <span style={{ flex: 1, wordBreak: 'break-word' }}>{restartErrors[a.id]}</span>
                <button
                  onClick={() => setRestartErrors((errors) => ({ ...errors, [a.id]: '' }))}
                  title="Dismiss"
                  aria-label={`Dismiss the restart error for ${a.name}`}
                  style={{
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    color: 'var(--cth-ink-500)', fontSize: 12, padding: 0, flexShrink: 0
                  }}
                >&times;</button>
              </div>
            )}
            {a.isGod && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--cth-ink-500)', flexShrink: 0 }}>engine:</span>
                <Select
                  value={engineProvider}
                  disabled={restarting === a.id}
                  onChange={(v) => {
                    const p = v as AgentProvider;
                    setEngineProvider(p);
                    const preset = AGENT_PROVIDER_PRESETS.find((x) => x.id === p);
                    setEngineModel(preset?.recommendedOrchestratorModel);
                  }}
                >
                  {AGENT_PROVIDER_PRESETS.filter((p) => canReceiveInbox(p.id)).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}{p.id === 'claude' ? ' ★' : ''}
                    </option>
                  ))}
                </Select>
                <Select
                  value={engineModel ?? ''}
                  disabled={restarting === a.id}
                  onChange={(v) => setEngineModel(v || undefined)}
                >
                  {modelsForProvider(engineProvider).map((m) => (
                    <option key={m.label} value={m.id ?? ''}>{m.label}</option>
                  ))}
                </Select>
                <PixelButton
                  variant="secondary"
                  size="sm"
                  disabled={restarting === a.id}
                  onClick={async () => {
                    const currentProvider = inferAgentProvider(a.command, a.provider);
                    if (engineProvider !== currentProvider) {
                      if (!window.confirm(`This restarts ${boss}; a conversation on a different engine can't be resumed.`)) return;
                    }
                    await window.cth.updateConfig({ godProvider: engineProvider, godModel: engineModel });
                    await restartWithModel(a, engineModel, { provider: engineProvider, resume: false });
                  }}
                >
                  {restarting === a.id ? 'restarting…' : 'apply'}
                </PixelButton>
                {/* Redraw a garbled terminal without losing the thread (resume the
                    SAME engine+model). Kept here since the god has no per-agent row above. */}
                <PixelButton
                  variant="secondary"
                  size="sm"
                  disabled={restarting === a.id}
                  onClick={() => restartWithModel(a, a.model, { resume: true })}
                >
                  <span title={`Kill and respawn ${boss}, resuming the current conversation — fixes a corrupted/garbled terminal without losing context`}>
                    restart &amp; continue
                  </span>
                </PixelButton>
              </div>
            )}
          </div>
          );
        })}
        {/* Fleet summary band */}
        <div style={{
          display: 'flex', gap: 14, marginTop: 2, padding: '6px 8px',
          background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
          fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-900)', flexWrap: 'wrap'
        }}>
          <span>Σ <strong>{fmtTokens(sumTokens)}</strong> tok</span>
          <span style={{ color: 'var(--cth-ink-700)' }}>inputs {fmtTokens(sumInput)} (cache {fleetCachePct}%)</span>
          <span style={{ color: 'var(--cth-ink-700)' }}>{Math.round(sumRate).toLocaleString()} tok/min</span>
        </div>
        <div style={{ marginTop: 6 }}>
          <Muted>
            live from each agent&apos;s OpenTelemetry · {budgeted
              ? <>bars show tokens used vs each agent&apos;s limit, else the {fmtTokens(tokenCap!)} floor budget</>
              : 'cumulative session tokens. No budget is set, so there is no meter — set a floor token budget in Settings, or a per-agent cap above'}
          </Muted>
        </div>
      </Section>

      <ArchivedSection />


      <Section title="DIRECTORIES">
        {repos.length === 0 && <Muted>No registered repos.</Muted>}
        {repos.map((r) => (
          <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{ flex: 1, fontSize: 12, color: 'var(--cth-ink-700)', wordBreak: 'break-all' }}>{r}</span>
            <button
              onClick={() => window.cth.openTerminalAt(r)}
              title="Open in Terminal.app"
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--cth-ink-500)' }}
            ><Icon name="terminal" /></button>
            <IconDelete
              label="Remove from registered projects (agents in this folder are not affected)"
              confirmLabel="remove project"
              onRun={() => {
                // Drops the quick-pick only — agents already working in this folder keep their cwd.
                const next = repos.filter((x) => x !== r);
                setRepos(next);
                void window.cth.updateConfig({ registeredRepos: next }).catch(() => { /* noop */ });
              }}
            />
          </div>
        ))}
      </Section>
    </Scroll>
  );
}

// ─── Issues tab — the registered repos' issues, and the PRs that answer them ──

/**
 * Lifted wholesale out of the Monitor tab (MD-43). It used to sit below the
 * roster, the telemetry meters, the archived list and the directory registry, so
 * the one surface you open to pick up work was the one you had to scroll
 * furthest to reach — and it shared a scroll container with a section that grows
 * with the fleet. Nothing about the behaviour changed in the move: same fetch,
 * same debounced search, same PR cross-references.
 *
 * `repos` is read again here rather than threaded down from the Monitor tab —
 * the two tabs never mount together, so sharing it would mean lifting state into
 * the panel for no one's benefit.
 */
/**
 * The review report, rendered in the app.
 *
 * <dialog>.showModal() for the same reason MD-41 used it: role, aria-modal,
 * focus move and restore, a focus trap, background inert and Escape are one
 * call, and none of them stay correct by hand. The `close` listener is NATIVE —
 * React 18 does not dispatch cancel/close for <dialog>, so the onClose prop
 * typechecks and silently never fires.
 */
function ReviewPreview({ record, text, onClose, onRerun, busy }: {
  record: ReviewRecord;
  text: string;
  onClose: () => void;
  onRerun: () => void;
  busy: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const unmountingRef = useRef(false);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  useEffect(() => {
    const el = dialogRef.current;
    if (!el || el.open) return;
    const onNativeClose = (): void => { if (!unmountingRef.current) onCloseRef.current(); };
    el.addEventListener('close', onNativeClose);
    el.showModal();
    return () => {
      unmountingRef.current = true;
      el.removeEventListener('close', onNativeClose);
      if (el.open) el.close();
    };
  }, []);

  const verdictColor = record.verdict === 'ready' ? 'var(--cth-mint)'
    : record.verdict === 'not_ready' ? 'var(--cth-coral)' : 'var(--cth-ink-300)';
  const verdictWord = record.verdict === 'ready' ? 'READY'
    : record.verdict === 'not_ready' ? 'NOT READY' : 'NO VERDICT';
  return (
    <dialog
      ref={dialogRef}
      aria-label={`Review of PR #${record.number}`}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, width: '100vw', maxWidth: '100vw',
        height: '100vh', maxHeight: '100vh', margin: 0, padding: 24, border: 'none',
        background: 'var(--cth-overlay)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box'
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: 760, maxWidth: '94vw', maxHeight: '90vh', display: 'flex' }}>
        <PixelPanel variant="dialog" title="REVIEW" noPadding style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: 0 }}>
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, overflowY: 'auto' }}>
            {/* The verdict, and the reason, ABOVE the report — the answer people
                opened this for should not need scrolling to. */}
            <div style={{ borderLeft: `4px solid ${verdictColor}`, paddingLeft: 8 }}>
              <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 10, color: 'var(--cth-ink-900)' }}>
                PR #{record.number} · {verdictWord}
              </div>
              {record.verdict === 'not_ready' && record.reason && (
                <div style={{ fontSize: 12, color: 'var(--cth-ink-900)', marginTop: 3 }}>{record.reason}</div>
              )}
              {record.verdict === 'unknown' && (
                <div style={{ fontSize: 12, color: 'var(--cth-ink-500)', marginTop: 3 }}>
                  The engine did not end with a VERDICT line, so this is not an approval — read the report and judge it yourself.
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--cth-ink-500)', marginTop: 3 }}>
                {record.engine} · {new Date(record.ts).toLocaleString()} · {(record.durationMs / 1000).toFixed(1)}s · local only, nothing was posted
              </div>
            </div>
            <div style={{ minHeight: 0 }}>
              <Suspense fallback={null}><MarkdownPreview source={text} /></Suspense>
            </div>
          </div>
          <div style={{ padding: 10, display: 'flex', gap: 6, justifyContent: 'flex-end', borderTop: '1px solid var(--cth-ink-100)' }}>
            <PixelButton variant="secondary" size="sm" disabled={busy} onClick={onRerun}>
              {busy ? 'reviewing…' : 're-review'}
            </PixelButton>
            <PixelButton variant="primary" size="sm" onClick={onClose}>close</PixelButton>
          </div>
        </PixelPanel>
      </div>
    </dialog>
  );
}

/**
 * Issues and pull requests, as two tabs over ONE body.
 *
 * They were one screen and it read as two unrelated lists stacked on top of
 * each other. They are still one component because almost everything here is
 * shared — the repo choice, the PR poll, the local review cache, the chip and
 * its buttons — and a second copy of that is a second thing to keep in step.
 * `view` picks which half renders; the other half's state simply sits idle.
 *
 * Both views read and write the SAME remembered repo (`cth.issuesRepo`): you
 * are working on one repo at a time, and a tab switch that silently moved you
 * to a different repo's PRs is exactly the confusion this split is fixing.
 */
function RepoTab({ view }: { view: 'issues' | 'prs' }) {
  const boss = useStore((s) => s.bossName);
  const agents = useStore((s) => s.agents);
  const requestDispatchSeed = useStore((s) => s.requestDispatchSeed);
  const requestCommandCenterTab = useStore((s) => s.requestCommandCenterTab);
  const [repos, setRepos] = useState<string[]>([]);
  // Seeded from the remembered choice so leaving the tab and coming back does
  // not silently move you to the first repo — and re-checked against the
  // registered list once config lands, in case that repo is gone.
  const [issueRepo, setIssueRepo] = useState<string>(readIssueRepo);
  const [issues, setIssues] = useState<GHIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [issueQuery, setIssueQuery] = useState('');
  const [issueMine, setIssueMine] = useState(false);
  const issueFetchSeq = useRef(0);
  const issueSearchArmed = useRef(false);
  const issueHost = useRef<'auto' | 'github' | 'gitlab'>('auto');
  const [prs, setPrs] = useState<PR[]>([]);
  const [prError, setPrError] = useState<string | null>(null);
  const [mergeBusy, setMergeBusy] = useState<number | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  // Local review verdicts, keyed host/owner/repo#number, loaded once from the
  // main-process cache so chips are coloured before anything is re-run.
  const [reviews, setReviews] = useState<Record<string, ReviewRecord>>({});
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ record: ReviewRecord; text: string } | null>(null);

  useEffect(() => {
    window.cth.getConfig().then((c) => {
      const list = c.registeredRepos ?? [];
      setRepos(list);
      setIssueRepo((cur) => resolveIssueRepo(list, cur));
      issueHost.current = c.issueHost ?? 'auto';
    }).catch(() => { /* noop */ });
  }, []);

  useEffect(() => {
    window.cth.prReviews().then(setReviews).catch(() => { /* an unreadable cache only costs the colour */ });
  }, []);

  // PRs for the selected repo: seed from the watcher's last poll, then follow
  // its pushes. The watcher owns the polling; this just renders.
  useEffect(() => {
    const repo = issueRepo || repos[0];
    setMergeError(null);
    if (!repo) { setPrs([]); setPrError(null); return; }
    let alive = true;
    window.cth.githubPRs(repo).then((r) => { if (alive) { setPrs(r.prs); setPrError(r.error); } }).catch(() => { /* noop */ });
    const off = window.cth.onGithubPRs((e) => { if (alive && e.cwd === repo) { setPrs(e.prs); setPrError(e.error); } });
    return () => { alive = false; off(); };
  }, [issueRepo, repos]);

  const chooseRepo = (repo: string) => { setIssueRepo(repo); writeIssueRepo(repo); };

  const mergeNow = async (pr: PR) => {
    const repo = issueRepo || repos[0];
    if (!repo) return;
    setMergeBusy(pr.number);
    setMergeError(null);
    try {
      const r = await window.cth.githubMergePR(repo, pr.number);
      if (!r.ok) setMergeError(r.error ?? 'Merge failed.');
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : String(e));
    } finally {
      setMergeBusy(null);
    }
  };

  const reviewNow = async (pr: PR) => {
    const repo = issueRepo || repos[0];
    if (!repo) return;
    setReviewing(pr.number);
    setReviewError(null);
    try {
      const r = await window.cth.prReviewRun(repo, pr.number);
      if (r.ok && r.record) {
        const record = r.record;
        setReviews((prev) => ({ ...prev, [record.key]: record }));
        // Re-run from inside the overlay: swap in the new report rather than
        // leaving the previous verdict on screen with a fresh timestamp.
        setPreview((open) => {
          if (!open || open.record.number !== pr.number) return open;
          void window.cth.prReviewReport(record.path)
            .then((rep) => { if (rep.ok && rep.text) setPreview({ record, text: rep.text }); })
            .catch(() => { /* the chip already carries the new verdict */ });
          return open;
        });
      } else {
        setReviewError(r.error ?? 'Review failed.');
      }
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setReviewing(null);
    }
  };

  const openPreview = async (record: ReviewRecord) => {
    setReviewError(null);
    const r = await window.cth.prReviewReport(record.path).catch((e: unknown) => ({
      ok: false as const, error: e instanceof Error ? e.message : String(e)
    }));
    if (r.ok && r.text) setPreview({ record, text: r.text });
    else setReviewError(r.error ?? 'Could not read the report.');
  };

  // Search and "mine" are pushed down to `glab`, not applied to the fetched
  // page — filtering 30 rows client-side would hide every match past the 30th.
  // `filter` is passed in so the toggle can fetch with its next value rather
  // than the stale one this render closed over.
  const fetchIssues = async (filter?: { search?: string; mine?: boolean }) => {
    const repo = issueRepo || repos[0];
    if (!repo) { setIssuesError('No repo selected.'); return; }
    // Typing fires overlapping fetches; only the newest may paint. Without this
    // a slow early query landing late overwrites the results for what was typed
    // after it — the list ends up showing a prefix of the query.
    const seq = ++issueFetchSeq.current;
    setIssuesLoading(true);
    setIssuesError(null);
    try {
      const res = await window.cth.githubIssues(repo, {
        host: issueHost.current,
        ...(filter ?? { search: issueQuery, mine: issueMine })
      });
      if (seq !== issueFetchSeq.current) return;
      if (res.ok) {
        setIssues((res.issues ?? []).slice(0, ISSUE_PAGE_SIZE));
      } else {
        setIssues([]);
        setIssuesError(res.error ?? 'Failed to fetch issues.');
      }
    } catch (e) {
      if (seq !== issueFetchSeq.current) return;
      setIssues([]);
      setIssuesError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === issueFetchSeq.current) setIssuesLoading(false);
    }
  };

  // Search-as-you-type, debounced — one `glab` call per pause, not per letter.
  // The first run is skipped so merely opening the panel doesn't shell out; the
  // Fetch button covers that.
  useEffect(() => {
    if (view !== 'issues') return;
    if (!issueSearchArmed.current) { issueSearchArmed.current = true; return; }
    const t = setTimeout(() => { void fetchIssues({ search: issueQuery, mine: issueMine }); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueQuery, issueMine, issueRepo]);

  // The dispatch box lives on the Monitor tab now, so "assign" goes through the
  // same store one-shot a task-detail assign uses, and follows it over.
  const assignIssue = (issue: GHIssue) => {
    const body = (issue.body ?? '').slice(0, 200);
    requestDispatchSeed(
      `Issue #${issue.number}: ${issue.title}\n\n${body}\n\nURL: ${issue.url}\n\n` +
      `When the work is done, open a PR whose description says "Closes #${issue.number}" — the harness tracks the PR, routes CI failures and review comments back to the owner, and tells you when it merges.`
    );
    requestCommandCenterTab('floor');
  };

  const agentName = (id: string) => id === 'god' ? boss : (agents.find((a) => a.id === id)?.name ?? id);
  const ciDot = (ci: PR['ci']) => ci === 'success' ? 'var(--cth-mint)' : ci === 'failure' ? 'var(--cth-coral)' : ci === 'pending' ? 'var(--cth-lemon)' : 'var(--cth-ink-300)';
  const reviewOf = (pr: PR): ReviewRecord | undefined => {
    const ref = repoRefFromUrl(pr.url);
    return ref ? reviews[reviewKey(ref, pr.number)] : undefined;
  };
  /** review / preview as ordinary small buttons, so they sit at the right of a
   *  PR row next to Merge instead of reading as more chip text.
   *
   *  `flexShrink: 0` is the whole reason these matched Assign in the markup and
   *  still rendered narrower on screen: the PR row gives the title `flex: 1` and
   *  the Issues tab is a narrow side panel, so every other item in the row was
   *  being compressed to make the title fit. Same size prop, smaller button. */
  const PrActions = ({ pr }: { pr: PR }) => {
    const record = reviewOf(pr);
    return (
      <>
        {pr.state === 'open' && (
          <PixelButton
            variant="secondary"
            size="sm"
            style={{ flexShrink: 0 }}
            onClick={() => void reviewNow(pr)}
            disabled={reviewing !== null}
            title={record
              ? `Re-review this diff locally (last run ${new Date(record.ts).toLocaleString()}, by ${record.engine}). Nothing is posted to the host.`
              : `Have ${boss} read this diff and give a verdict. Local only — nothing is posted to the host.`}
          >{reviewing === pr.number ? 'reviewing…' : 'Review'}</PixelButton>
        )}
        {record && (
          <PixelButton
            variant="secondary"
            size="sm"
            style={{ flexShrink: 0 }}
            onClick={() => void openPreview(record)}
            title={`Open ${boss}'s review of PR #${pr.number}`}
          >Preview</PixelButton>
        )}
      </>
    );
  };
  /** `framed` is off in the PULL REQUESTS list, where the ROW already carries the
   *  verdict colour and a second border inside it read as two separate verdicts.
   *  It stays on beside an issue, where the chip is the outermost thing that is
   *  this PR and dropping the colour would lose the verdict entirely. */
  const PrChip = ({ pr, framed = true }: { pr: PR; framed?: boolean }) => {
    const suffix = pr.state !== 'open' ? pr.state : pr.draft ? 'draft' : pr.ready ? 'ready' : REVIEW_WORD[pr.review];
    // The trailing name is NOT who opened the PR and not who approved it — a chip
    // reading "approved · Michael" was read as "approved BY Michael" by the first
    // person who saw it. `owner` is prWatcher.ownerFor: the live agent whose
    // checkout currently sits on the PR's head branch, falling back to Michael
    // when none does. So it answers "who hears about this PR", which is why most
    // chips say Michael — usually nobody is sitting on that branch. The arrow
    // says routing rather than authorship in one character.
    const routesTo = agentName(pr.owner);
    const record = reviewOf(pr);
    const state = chipState(record, reviewing === pr.number);
    // The verdict frame is SEPARATE from the CI dot on purpose: CI is what the
    // host's machines ran, the frame is what Michael thought of the diff, and
    // collapsing them would let a green pipeline colour an unreviewed change.
    // It wraps the WHOLE chip — a border on the label alone was read as
    // decoration next to a green CI dot, which is how a NOT READY PR looked
    // approved.
    const frame = verdictFrame(framed ? state : 'neutral');
    return (
      <a href={pr.url} target="_blank" rel="noreferrer" title={[
        pr.title,
        `CI: ${pr.ci ?? 'none'} · host review: ${pr.review} · ${pr.state}`,
        pr.state === 'open' ? `routes to: ${routesTo} (the agent on branch ${pr.branch || '?'}, else ${boss})` : '',
        record
          ? `${boss}'s local review: ${record.verdict === 'ready' ? 'READY' : record.verdict === 'not_ready' ? `NOT READY — ${record.reason ?? 'see report'}` : 'no verdict (the engine did not answer in the required form)'}`
          : 'Not reviewed locally yet.'
      ].filter(Boolean).join('\n')} style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, fontSize: 10, lineHeight: '14px', padding: '0 5px',
        background: 'var(--cth-cream-200)', boxShadow: `inset 0 0 0 ${frame.width}px ${frame.color}`,
        color: 'var(--cth-ink-700)', textDecoration: 'none'
      }}>
        {/* Titled, because a green square beside a red frame is the one thing
            here that can still be misread as a second verdict. */}
        <span title={`CI: ${pr.ci ?? 'none'}`} style={{ width: 6, height: 6, background: ciDot(pr.ci), flexShrink: 0 }} />
        PR #{pr.number}
        {suffix && ` · ${suffix}`}
        {pr.state === 'open' && ` · →${routesTo}`}
        {state === 'running' && ' · reviewing…'}
        {state !== 'running' && record?.verdict === 'not_ready' && ' · not ready'}
        {state !== 'running' && record?.verdict === 'ready' && ' · reviewed'}
      </a>
    );
  };

  return (
    <Scroll>
      <Section title={view === 'issues' ? 'ISSUES' : 'PULL REQUESTS'}>
        {repos.length === 0 && <Muted>No registered repos.</Muted>}
        {repos.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <Select value={issueRepo || repos[0]} onChange={chooseRepo}>
                {repos.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </Select>
              {/* The PR list follows the watcher's poll, so it has nothing to fetch. */}
              {view === 'issues' && (
                <PixelButton variant="primary" size="sm" onClick={() => fetchIssues()} disabled={issuesLoading}>
                  {issuesLoading ? 'fetching…' : 'Fetch issues'}
                </PixelButton>
              )}
            </div>
            {view === 'issues' && (
            <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input
                value={issueQuery}
                onChange={(e) => setIssueQuery(e.target.value)}
                placeholder="Search title + description…"
                style={{ ...textareaStyle, height: 30 }}
              />
              <PixelButton
                variant={issueMine ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setIssueMine((v) => !v)}
                disabled={issuesLoading}
              >
                assigned to me
              </PixelButton>
            </div>
            {issuesError && (
              <div style={{
                fontSize: 12, color: 'var(--cth-ink-700)', marginBottom: 6,
                padding: 6, background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
                wordBreak: 'break-word'
              }}>{issuesError}</div>
            )}
            {!issuesError && !issuesLoading && issues.length === 0 && (
              <Muted>{issueQuery.trim() || issueMine ? 'No issues match that filter.' : 'No issues fetched yet.'}</Muted>
            )}
            {/* The fetch is capped at 10 (see fetchIssues). A full page said
                nothing about being a page, so an issue you could not see was
                indistinguishable from an issue that does not exist — and the
                search box is the only way past it. */}
            {!issuesError && !issuesLoading && issues.length === ISSUE_PAGE_SIZE && (
              <Muted>Showing the first {ISSUE_PAGE_SIZE} — narrow it with the search box above.</Muted>
            )}
            {issues.map((issue) => (
              <div key={issue.number} style={{
                display: 'flex', flexDirection: 'column', gap: 4,
                padding: 6, marginBottom: 6,
                background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--cth-ink-900)', flex: 1, wordBreak: 'break-word' }}>
                    <strong>#{issue.number}</strong> {issue.title}
                  </span>
                  <PixelButton variant="secondary" size="sm" onClick={() => assignIssue(issue)}>
                    Assign
                  </PixelButton>
                </div>
                {issue.labels.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {issue.labels.map((label) => (
                      <span key={label} style={{
                        fontSize: 10, lineHeight: '14px', padding: '0 5px',
                        background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
                        color: 'var(--cth-ink-700)'
                      }}>{label}</span>
                    ))}
                  </div>
                )}
                {prs.some((p) => p.issues.includes(issue.number)) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {prs.filter((p) => p.issues.includes(issue.number)).map((p) => (
                      <span key={p.number} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <PrChip pr={p} /><PrActions pr={p} />
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            </>
            )}
            {view === 'prs' && (
              <>
                {prError && <Muted>PR watcher: {prError}</Muted>}
                {/* A tab of its own has to say why it is empty — a blank panel
                    reads as broken, and "no PRs" is a real answer. */}
                {!prError && !prs.some((p) => p.state === 'open') && <Muted>No open pull requests.</Muted>}
                {mergeError && (
                  <div style={{ fontSize: 12, color: 'var(--cth-ink-700)', marginBottom: 6, padding: 6, background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', wordBreak: 'break-word' }}>{mergeError}</div>
                )}
                {prs.filter((p) => p.state === 'open').map((pr) => {
                  // The verdict frames the ROW and ONLY the row: the row is the
                  // outermost thing that is this PR, and a border on the chip alone
                  // sat too close to the CI dot to read as a verdict at all. Two
                  // frames read as two verdicts, so the chip's is off in here.
                  const rowFrame = verdictFrame(chipState(reviewOf(pr), reviewing === pr.number));
                  return (
                  <div key={pr.number} style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: 6, marginBottom: 6,
                    background: 'var(--cth-paper-100)', boxShadow: `inset 0 0 0 ${rowFrame.width}px ${rowFrame.color}`
                  }}>
                    <PrChip pr={pr} framed={false} />
                    <span style={{ fontSize: 12, color: 'var(--cth-ink-900)', flex: 1, wordBreak: 'break-word' }}>{pr.title}</span>
                    <PrActions pr={pr} />
                    <PixelButton
                      variant={pr.ready ? 'primary' : 'secondary'}
                      size="sm"
                      style={{ flexShrink: 0 }}
                      disabled={!(pr.state === 'open' && !pr.draft) || mergeBusy === pr.number}
                      title={pr.ready ? 'CI green and review not blocking' : 'Not marked ready by the host (CI missing/pending or review outstanding) — branch protection still decides'}
                      onClick={() => void mergeNow(pr)}
                    >
                      {mergeBusy === pr.number ? 'merging…' : 'Merge'}
                    </PixelButton>
                  </div>
                  );
                })}
              </>
            )}
          </>
        )}
      </Section>
      {reviewError && (
        <div role="status" style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, color: 'var(--cth-coral)', marginTop: 6 }}>
          <span style={{ flex: 1, wordBreak: 'break-word' }}>{reviewError}</span>
          <button
            onClick={() => setReviewError(null)}
            title="Dismiss"
            aria-label="Dismiss the review error"
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--cth-ink-500)', fontSize: 12, padding: 0, flexShrink: 0 }}
          >&times;</button>
        </div>
      )}
      {preview && (
        <ReviewPreview
          record={preview.record}
          text={preview.text}
          busy={reviewing !== null}
          onClose={() => setPreview(null)}
          onRerun={() => {
            const pr = prs.find((p) => p.number === preview.record.number);
            if (pr) void reviewNow(pr);
          }}
        />
      )}
    </Scroll>
  );
}

// ─── Archived agents — retained + flagged, kept off the floor ────────────────

function ArchivedSection() {
  const archivedAgents = useStore((s) => s.archivedAgents);
  const removeArchivedAgent = useStore((s) => s.removeArchivedAgent);
  const addAgent = useStore((s) => s.addAgent);
  const [open, setOpen] = useState(false);
  /** The id currently spawning, so its own button says so and every other row's
   *  stays clickable. */
  const [restoringId, setRestoringId] = useState<string | null>(null);
  /** Why a restore failed, per id. Sticky: this is the whole message, and the
   *  row it belongs to is still on screen to read it. */
  const [restoreErrors, setRestoreErrors] = useState<Record<string, string>>({});
  // Only ever the FALLBACK spawn recipe, for a record persisted before agents
  // carried their own `command`. A normal archived agent never needs it.
  const [config, setConfig] = useState<HarnessConfig | null>(null);
  useEffect(() => {
    window.cth.getConfig().then(setConfig).catch(() => { /* command usually wins anyway */ });
  }, []);

  // Restore = respawn. Not a flag flip: `addAgent` drops the id from
  // archivedAgents (active xor archived) and the main process clears the
  // registry's `archived` on every spawn, so both sides of the wire are already
  // archive's inverse. See store/respawn.ts.
  const restore = async (a: Agent) => {
    if (restoringId) return;
    setRestoringId(a.id);
    setRestoreErrors((prev) => { const { [a.id]: _gone, ...rest } = prev; return rest; });
    try {
      const out = await respawnAgent(a, config);
      if (out.agent) {
        addAgent(out.agent);
      } else if (out.alreadyLive) {
        // Its terminal is already running — the record is stale, not the agent.
        removeArchivedAgent(a.id);
      } else {
        setRestoreErrors((prev) => ({ ...prev, [a.id]: out.error ?? 'spawn failed' }));
      }
    } finally {
      setRestoringId(null);
    }
  };

  if (archivedAgents.length === 0) return null;
  return (
    <Section title={`ARCHIVED (${archivedAgents.length})`}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 8px 1px', border: 'none', cursor: 'pointer',
          background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
          fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)',
          marginBottom: open ? 6 : 0
        }}
      >{open ? '▾' : '▸'} {open ? 'hide' : 'show'} closed agents</button>
      {open && archivedAgents.map((a) => (
        <div key={a.id} style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
          padding: 6, marginBottom: 6, opacity: 0.7,
          background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
        }}>
          <div style={{
            width: 24, height: 24, background: `var(--cth-${a.accent}-light)`,
            boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden', flexShrink: 0
          }}>
            <SpritePortrait character={a.character} scale={1} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-700)' }}>{a.name}</div>
            <div style={{ fontSize: 11, color: 'var(--cth-ink-500)', wordBreak: 'break-all' }}>{a.cwd}</div>
          </div>
          {/* No arm-then-confirm here, unlike the delete beside it: restoring is
              reversible by archiving again, and a confirm on a harmless action
              is what trains people to click through the one next to it. */}
          <PixelButton
            variant="secondary"
            size="sm"
            disabled={restoringId !== null}
            title={
              restoringId === a.id ? `Starting ${a.name} back up…`
                : restoringId ? 'Another agent is starting up'
                  : `Bring ${a.name} back onto the floor — same id, memory and history`
            }
            onClick={() => void restore(a)}
          >{restoringId === a.id ? 'starting…' : 'restore'}</PixelButton>
          <IconDelete
            label={`Delete ${a.name}'s archived record permanently`}
            confirmLabel="delete record"
            onRun={() => removeArchivedAgent(a.id)}
          />
          {/* In the row, not under the list: an error that outlives the record it
              is about is a message with nothing to act on. */}
          {restoreErrors[a.id] && (
            <div role="status" style={{
              flexBasis: '100%', fontSize: 11, lineHeight: '15px',
              color: 'var(--cth-ink-700)', wordBreak: 'break-word'
            }}>could not restore — {restoreErrors[a.id]}</div>
          )}
        </div>
      ))}
    </Section>
  );
}

// ─── Memory tab ──────────────────────────────────────────────────────────────

function MemoryTab({ godId, who: controlledWho, onWho }: { godId: string; who?: string; onWho?: (id: string) => void }) {
  const agents = useStore((s) => s.agents);
  // Selection is controllable from the graph tab; falls back to local state.
  const [internalWho, setInternalWho] = useState<string>(godId);
  const who = controlledWho ?? internalWho;
  const setWho = onWho ?? setInternalWho;
  const [mem, setMem] = useState('');
  const [query, setQuery] = useState('');
  const [searchOut, setSearchOut] = useState('');
  const [busy, setBusy] = useState(false);
  // Full-text search across hive files (board, tasks, memory) — additive.
  const [textQuery, setTextQuery] = useState('');
  const [textResults, setTextResults] = useState<Array<{ source: string; excerpt: string }>>([]);
  const [textSearched, setTextSearched] = useState(false);
  const [textBusy, setTextBusy] = useState(false);
  // Manual memory maintenance — the three background loops (wake-up digest,
  // mining, condensing) run on their own timers; these are the "do it now"
  // handles. One shared result line, same <Pre> idiom as the searches above.
  const [maintBusy, setMaintBusy] = useState<'wake' | 'mine' | 'condense' | null>(null);
  const [maintOut, setMaintOut] = useState('');
  // The condenser runs on its own timer and rewrites memory.md unattended. Until
  // now the only evidence it had run was the file being different — so show what
  // it is doing right next to the button that makes it do it on demand.
  const [reflect, setReflect] = useState<ReflectStatus | null>(null);
  const loadReflect = useCallback(() => {
    window.cth.reflectStatus().then(setReflect).catch(() => setReflect(null));
  }, []);
  useEffect(() => {
    loadReflect();
    const t = setInterval(loadReflect, 15_000);
    return () => clearInterval(t);
  }, [loadReflect]);

  const runMaint = async (kind: 'wake' | 'mine' | 'condense') => {
    setMaintBusy(kind);
    setMaintOut('');
    try {
      if (kind === 'wake') {
        const res = await window.cth.memoryWakeUp();
        setMaintOut(res.ok ? (res.output || 'No digest yet.') : `Couldn't wake up: ${res.error}`);
      } else if (kind === 'mine') {
        // Fire-and-forget in main (it serializes writers itself) — the ok only
        // says the pass was STARTED, so don't report it as finished.
        const res = await window.cth.mineNow();
        setMaintOut(res.ok ? 'Mining started — new notes reach the palace as it works.' : 'Could not start mining.');
      } else {
        setMaintOut(summarizeReflect(await window.cth.reflectNow(who)));
        loadReflect(); // a manual pass moves last-run/last-changed too
      }
    } catch (e) {
      setMaintOut(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setMaintBusy(null); }
  };

  useEffect(() => {
    window.cth.hiveMemory(who).then(setMem).catch(() => setMem(''));
  }, [who]);

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      const res = await window.cth.searchMemory(query.trim());
      setSearchOut(res.ok ? (res.output || 'Nothing matched yet.') : `Couldn't search: ${res.error}`);
    } finally { setBusy(false); }
  };

  const textSearch = async () => {
    if (!textQuery.trim()) return;
    setTextBusy(true);
    try {
      const res = await window.cth.textSearch(textQuery.trim());
      setTextResults(res.ok ? res.results.slice(0, 10) : []);
    } catch { setTextResults([]); }
    finally { setTextBusy(false); setTextSearched(true); }
  };

  return (
    <Scroll>
      <Section title="TEXT SEARCH (board, tasks, memory)">
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={textQuery}
            onChange={(e) => setTextQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') textSearch(); }}
            placeholder="Find exact text across hive files…"
            style={{ ...textareaStyle, height: 30 }}
          />
          <PixelButton variant="primary" size="sm" onClick={textSearch} disabled={textBusy || !textQuery.trim()}>
            {textBusy ? '…' : 'search'}
          </PixelButton>
        </div>
        {textResults.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {textResults.map((r, i) => (
              <div key={i} style={{ marginBottom: 4 }}>
                <div style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-500)' }}>{r.source}</div>
                <Pre>{r.excerpt}</Pre>
              </div>
            ))}
          </div>
        )}
        {textSearched && textResults.length === 0 && <Muted>Nothing matched.</Muted>}
      </Section>

      <Section title="SEMANTIC SEARCH (MemPalace)">
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
            placeholder="What does the hive know about…"
            style={{ ...textareaStyle, height: 30 }}
          />
          <PixelButton variant="primary" size="sm" onClick={search} disabled={busy || !query.trim()}>
            {busy ? '…' : 'search'}
          </PixelButton>
        </div>
        {searchOut && <Pre>{searchOut}</Pre>}
      </Section>

      <Section title="MEMORY FILE">
        <Select value={who} onChange={setWho}>
          {sortAgentsForList(agents).map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
        </Select>
        <Pre>{mem || 'No memory recorded yet.'}</Pre>
      </Section>

      <Section title="MAINTENANCE">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <PixelButton size="sm" onClick={() => runMaint('wake')} disabled={!!maintBusy}>
            {maintBusy === 'wake' ? '…' : 'wake up'}
          </PixelButton>
          <PixelButton size="sm" onClick={() => runMaint('mine')} disabled={!!maintBusy}>
            {maintBusy === 'mine' ? '…' : 'mine now'}
          </PixelButton>
          <PixelButton size="sm" onClick={() => runMaint('condense')} disabled={!!maintBusy}>
            {maintBusy === 'condense' ? '…' : 'condense now'}
          </PixelButton>
        </div>
        <Muted>
          wake up = the digest an agent gets on start · mine now = push changed memory.md files
          into the palace · condense now = shrink the selected agent&apos;s memory.md above
        </Muted>
        {reflect && (
          <Muted>
            {!reflect.enabled
              // Not an error — it is a setting, so say where to change it rather
              // than leaving the row looking broken.
              ? 'Automatic condensing is OFF (Settings → Memory & Knowledge). Memory files grow without limit; “condense now” still works.'
              : reflect.running ? 'Condensing now…'
              : [
                  reflect.lastRunMs
                    ? `last checked ${relSince(new Date(reflect.lastRunMs).toISOString())}, ${reflect.lastScanned} agent${reflect.lastScanned === 1 ? '' : 's'}`
                    : 'not run yet this session',
                  reflect.nextRunMs ? `next in ${Math.max(1, Math.round((reflect.nextRunMs - Date.now()) / 60_000))}m` : 'not scheduled'
                ].join(' · ')}
            {reflect.enabled && reflect.lastChanged.length > 0 && (
              <>
                {' · '}rewrote{' '}
                {reflect.lastChanged
                  .map((r) => `${r.id} (${fmtTokens(r.oldBytes ?? 0)}B→${fmtTokens(r.newBytes ?? 0)}B)`)
                  .join(', ')}
              </>
            )}
            {reflect.enabled && reflect.lastRunMs !== null && reflect.lastChanged.length === 0
              && ' · nothing needed condensing'}
          </Muted>
        )}
        {maintOut && <Pre>{maintOut}</Pre>}
      </Section>
    </Scroll>
  );
}

// ─── Fleet telemetry bits (folded into the Floor AGENTS cards) ───────────────

/** Block-character sparkline of recent token deltas — neo-brutalist mono. */
function Sparkline({ series }: { series: number[] }) {
  const blocks = '▁▂▃▄▅▆▇█';
  const max = Math.max(1, ...series);
  const text = series.length
    ? series.map((v) => blocks[Math.min(blocks.length - 1, Math.round((v / max) * (blocks.length - 1)))]).join('')
    : '▁▁▁▁▁▁';
  return (
    <span style={{ flex: 1, fontFamily: 'var(--cth-font-mono)', fontSize: 12, lineHeight: '12px', color: 'var(--cth-sky)', whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0 }}>
      {text}
    </span>
  );
}

/** Re-exported so WorkersTab's existing import keeps working; the wording
 *  itself now lives in src/shared/usageFormat.ts alongside the label and the
 *  billed-vs-context explanation, so all four call sites cannot drift. */
export { TOKENS_BILLED_TIP };

/** Compact token count: 1K / 10K / 100K / 1M / 100M / 1B (trailing .0 trimmed). */
function fmtTokens(n: number): string {
  if (n >= 1e9) return `${+(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

/** Per-agent token-limit control (top-right of each agent card). Shows the
 *  current limit as a lemon chip, or "set limit"; click to edit a token number.
 *  Enter / ✓ / blur commit; Escape cancels. */
/** Per-agent reasoning EFFORT (MD-42).
 *
 *  Effort is a SPAWN ARGUMENT, not something a running CLI can be told, so this
 *  control is honest about that: it records the choice and says the process has
 *  to be restarted for it to mean anything — with the restart button right here,
 *  because a setting that needs a second action somewhere else does not get used.
 *
 *  Engines without a verified effort flag get a DISABLED select carrying the
 *  reason. Hiding it entirely was the other option, but a control that silently
 *  exists for one engine and not another reads as a bug in the app rather than a
 *  fact about the CLI (same call as the inbox-unsupported list). */
function EffortEditor({ agent, provider, busy, onPick, onRestart }: {
  agent: Agent;
  provider: AgentProvider;
  busy: boolean;
  onPick: (effort: string | undefined) => void;
  onRestart?: () => void;
}) {
  const levels = effortLevelsFor(provider);
  const reason = effortUnsupportedReason(provider);
  // A level recorded under a different engine must not look active under this one.
  const current = isValidEffort(provider, agent.effort) ? agent.effort! : '';
  // The recorded command is what a revive/restore replays, so "pending" is
  // exactly: the level we would spawn with differs from the one in that command.
  const spawned = (agent.command ?? '').match(/--effort\s+(\S+)/)?.[1] ?? '';
  const pending = !!agent.ptyId && current !== spawned;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: 'var(--cth-ink-500)', flexShrink: 0 }}>effort:</span>
      <span title={reason ? `${providerPreset(provider).label} ${reason}` : 'Reasoning effort this agent is spawned with'}>
        <Select
          value={current}
          disabled={busy || !levels}
          onChange={(v) => onPick(v || undefined)}
        >
          <option value="">engine default</option>
          {(levels ?? []).map((level) => <option key={level} value={level}>{level}</option>)}
        </Select>
      </span>
      {!levels ? (
        <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>{reason}</span>
      ) : pending ? (
        <>
          <span style={{ fontSize: 11, color: 'var(--cth-ink-900)' }}>
            applies on next restart
          </span>
          {onRestart && (
            <PixelButton variant="secondary" size="sm" disabled={busy} onClick={onRestart}>
              <span title={`Restart ${agent.name} now so the new effort level takes effect (keeps the conversation)`}>
                restart now
              </span>
            </PixelButton>
          )}
        </>
      ) : (
        <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>
          {current ? `running at ${current}` : 'the engine picks'}
        </span>
      )}
    </div>
  );
}

function TokenLimitEditor({ value, onSet }: { value?: number; onSet: (tokens: number | undefined) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value != null ? String(value) : '');
  const skipBlur = useRef(false);
  const commit = () => {
    const raw = text.trim();
    const n = raw === '' ? undefined : Number(raw);
    onSet(typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined);
    setEditing(false);
  };
  if (!editing) {
    return (
      <button
        onClick={() => { setText(value != null ? String(value) : ''); setEditing(true); }}
        title="Set this agent's total token limit"
        style={{
          flexShrink: 0, padding: '1px 6px', border: 'none', cursor: 'pointer',
          background: value && value > 0 ? 'var(--cth-lemon)' : 'var(--cth-cream-200)',
          boxShadow: `inset 0 0 0 1px ${value && value > 0 ? 'var(--cth-ink-900)' : 'var(--cth-ink-700)'}`,
          fontFamily: 'var(--cth-font-ui)', fontSize: 11, color: 'var(--cth-ink-900)'
        }}
      >{value && value > 0
        ? <>limit <span style={{ fontFamily: 'var(--cth-font-mono)' }}>{fmtTokens(value)}</span></>
        : 'set limit'}</button>
    );
  }
  return (
    <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <input
        type="number" min="0" step="100000" value={text} autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') { skipBlur.current = true; setEditing(false); }
        }}
        onBlur={() => { if (skipBlur.current) { skipBlur.current = false; return; } commit(); }}
        placeholder="tokens"
        style={{
          width: 84, padding: '2px 4px', background: 'var(--cth-paper-100)', border: 'none',
          boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)', fontFamily: 'var(--cth-font-mono)',
          fontSize: 11, color: 'var(--cth-ink-900)', outline: 'none'
        }}
      />
      <button
        onMouseDown={(e) => e.preventDefault()} onClick={commit} title="Save limit"
        style={{ flexShrink: 0, padding: '1px 5px', border: 'none', cursor: 'pointer', background: 'var(--cth-mint)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', fontSize: 11, color: 'var(--cth-ink-900)' }}
      >✓</button>
    </span>
  );
}

// ─── small shared bits ───────────────────────────────────────────────────────

export function Scroll({ children }: { children: React.ReactNode }) {
  // minWidth:0 + overflowX:hidden keep wide children (native selects, long paths,
  // budget rows) from forcing a horizontal scrollbar in the narrow sidebar — they
  // wrap/shrink instead. Vertical scroll stays.
  return <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: 10, background: 'var(--cth-paper-200)' }}>{children}</div>;
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 9, lineHeight: '12px', color: 'var(--cth-ink-500)', marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, textAlign: 'center', color: 'var(--cth-ink-700)', fontSize: 13, background: 'var(--cth-paper-200)' }}>
      {children}
    </div>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>{children}</div>;
}

function Pre({ children }: { children: React.ReactNode }) {
  return (
    <pre style={{
      margin: '6px 0 0', padding: 8, maxHeight: 200, overflow: 'auto',
      background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
      fontFamily: 'var(--cth-font-mono)', fontSize: 12, lineHeight: '16px',
      color: 'var(--cth-ink-900)', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
    }}>{children}</pre>
  );
}

const textareaStyle: React.CSSProperties = {
  flex: 1, width: '100%', resize: 'none', padding: '6px 8px',
  background: 'var(--cth-paper-100)', border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
  fontFamily: 'var(--cth-font-mono)', fontSize: 12, lineHeight: '17px',
  color: 'var(--cth-ink-900)', outline: 'none', boxSizing: 'border-box'
};

function Select({ value, onChange, disabled, children }: {
  value: string; onChange: (v: string) => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: '3px 6px', background: 'var(--cth-paper-100)',
        border: 'none', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
        fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)', cursor: 'pointer',
        // Never let a long option name push the sidebar wider than it is.
        minWidth: 0, maxWidth: '100%'
      }}
    >{children}</select>
  );
}
