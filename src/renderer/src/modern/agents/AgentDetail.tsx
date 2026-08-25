import { useEffect, useState } from 'react';
import './terminal-tokens.css';
import { Code2, SquareTerminal, Pencil, X, PanelRightClose, Sunrise, StickyNote } from 'lucide-react';
import { useStore, type Agent } from '@/store/store';
import { useDestructive } from '@/components/ui/useDestructive';
import { wakeSleepingAgent } from '@/hooks/useRestoreTeam';
import { isProcessless, presenceCopy } from '@shared/agentPresence';
import { useFleetUsage } from '@/hooks/useFleetUsage';
import { useFleetTelemetry } from '@/hooks/useTelemetry';
import { usePtyParser } from '@/hooks/usePtyParser';
import { PtyTerminalView } from '@/components/PtyTerminalView';
import { terminalInstanceKey } from '@/components/terminalRecovery';
import { disposeTerminal } from '@/components/terminalPool';
import { endSessionAndArchive } from '@shared/agentArchive';
import { formatTokens, formatUsd, billedVsContextNote } from '@shared/usageFormat';
import { parseTasks, selectAgentWork, TASK_POLL_MS, type HiveTask } from '@/store/taskLedger';
import { navigate } from '../navigation';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Separator } from '../components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Overlay } from '../overlay';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { cn } from '../lib/cn';
import { rowCap, statusBadge } from './agentsModel';
import { AgentControls } from './AgentControls';
import { MessagesTab } from './MessagesTab';

type Tab = 'terminal' | 'messages';

/**
 * One agent. Header → controls → usage → what it is working on → terminal.
 *
 * Michael keeps his own area: his old Command Center tabs are being rebuilt as
 * separate nav entries, so here he is an agent like any other plus a pointer.
 *
 * TWO PLACES RENDER THIS, ONE COMPONENT. The Agents area gives it a full
 * column; the Floor gives it the shell's right inspector, where it is ~460px
 * wide and sits beside the scene you picked the agent from. `variant` is the
 * whole difference — a second copy of this file is how the two front-ends
 * would start to drift, and the terminal, the composer and the controls are
 * exactly what must NOT drift.
 */
export function AgentDetail({ agent, variant = 'page', onClose }: {
  agent: Agent;
  /** `inspector`: narrow, in the shell's right slot, with a close button. */
  variant?: 'page' | 'inspector';
  /** Rendered as the close affordance when given (inspector variant). */
  onClose?: () => void;
}) {
  const compact = variant === 'inspector';
  const [tab, setTab] = useState<Tab>('terminal');
  const [noteOpen, setNoteOpen] = useState(false);
  const [caps, setCaps] = useState<{ agent?: Record<string, number>; floor?: number }>({});
  const archiveAgent = useStore((s) => s.archiveAgent);
  const setEditAgentId = useStore((s) => s.setEditAgentId);
  const setIdeOpen = useStore((s) => s.setIdeOpen);
  const [fullscreen, setFullscreen] = useState(false);
  const usage = useFleetUsage()[agent.id];
  const { breakers } = useFleetTelemetry();
  const breaker = breakers[agent.id];
  const onPtyStream = usePtyParser(agent.id);

  useEffect(() => {
    window.cth.getConfig()
      .then((c) => setCaps({ agent: c.agentTokenCaps, floor: c.costCapTokens }))
      .catch(() => { /* no caps readable → no meter, never a fake one */ });
  }, []);

  // While this agent's terminal is in the overlay, THAT view owns the pty and
  // sizes it. A second xterm on the same pty fights over cols/rows and corrupts
  // the display, so the embed unmounts and re-fits when fullscreen closes.
  const isFullscreenedHere = fullscreen;
  const cap = usage ? rowCap(usage.totalTokens, caps.agent?.[agent.id], caps.floor) : null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className={cn('flex h-12 shrink-0 items-center gap-2 border-b', compact ? 'px-2' : 'px-4')}>
        <h1 className="truncate text-base font-semibold">{agent.name}</h1>
        {/* MD-114 — `statusBadge` reads PRESENCE, so this stops saying `idle`
            directly above a pane explaining the agent has no process. */}
        <Badge variant={statusBadge(agent).tone} className="font-normal">{statusBadge(agent).label}</Badge>
        {/* At inspector width the header is already name + status + four
            actions; the subtitle would push those off the edge. */}
        {!compact && (
          <span className="truncate text-xs text-muted-foreground" title={agent.cwd}>
            {agent.description || agent.project}
          </span>
        )}
        <span className="flex-1" />
        {/* `setIdeOpen` alone was a no-op in this UI: the modern IDE is a nav
            AREA, not the pixel overlay, so nothing was listening for the flag
            and the click did nothing at all. Name the workspace, then actually
            go there. IdeView releases the pin once it has used it, so this
            names the root for THIS visit rather than for the rest of the
            session. */}
        <IconAction
          label={`Open the IDE — files and diffs for ${agent.project}`}
          onClick={() => { setIdeOpen(true, agent.id); navigate('ide'); }}
        >
          <Code2 />
        </IconAction>
        <IconAction label={`Open Terminal.app at ${agent.cwd}`} onClick={() => void window.cth.openTerminalAt(agent.cwd)}>
          <SquareTerminal />
        </IconAction>
        <IconAction
          label={agent.note ? 'Private note — yours, never sent to the agent' : 'Add a private note about this agent'}
          onClick={() => setNoteOpen((v) => !v)}
          active={!!agent.note}
        >
          <StickyNote />
        </IconAction>
        <IconAction label="Edit this agent" onClick={() => setEditAgentId(agent.id)}>
          <Pencil />
        </IconAction>
        <KillAction agent={agent} onKilled={() => archiveAgent(agent.id)} />
        {onClose && (
          <IconAction label="Close this panel — the agent keeps running" onClick={onClose}>
            <PanelRightClose />
          </IconAction>
        )}
      </header>

      {noteOpen && <NoteRow agent={agent} onClose={() => setNoteOpen(false)} />}

      {agent.isGod && (
        <p className="shrink-0 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          Command Center — the boss’s dashboards now live in their own areas: Tasks, Monitor, Issues.
        </p>
      )}

      {!!agent.ptyId && <AgentControls agentId={agent.id} />}

      {/* ── Usage ───────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 text-xs">
        {usage ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="font-mono">billed {formatTokens(usage.totalTokens)}</span>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                {billedVsContextNote(usage, agent.contextTokens)}
              </TooltipContent>
            </Tooltip>
            <span className="text-muted-foreground">{formatUsd(usage)}</span>
            {usage.model && <span className="text-muted-foreground">{usage.model}</span>}
            {cap && (
              <span className={cn('text-muted-foreground', cap.over && 'text-destructive')}>
                cap {cap.label} · {cap.pct}%
              </span>
            )}
            <BreakerChip level={breaker?.level} reason={breaker?.reason} />
          </>
        ) : (
          <span className="text-muted-foreground">No usage signal for this agent yet.</span>
        )}
      </div>

      <WorkingOn agentId={agent.id} />

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="min-h-0 flex-1 gap-0">
        <TabsList className="mx-3 my-1.5 shrink-0 self-start">
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
          <TabsTrigger value="messages">Messages</TabsTrigger>
        </TabsList>

        <TabsContent value="terminal" className="min-h-0 flex-1 border-t">
          {isFullscreenedHere ? (
            <Empty title="In fullscreen">This agent’s terminal is open in the overlay.</Empty>
          ) : isProcessless(agent) ? (
            // MD-114 — one branch for BOTH ways an agent ends up processless.
            // `agent.sleeping` used to gate this, so an agent that lost its pty
            // any other way fell through to a dead-end "No PTY" pane with no
            // control on it at all: no terminal, no Wake, nothing to press.
            // `presenceCopy` is what still tells the two apart, in the only
            // place with room to say it honestly.
            <Empty title={presenceCopy(agent).title} action={<WakeButton agent={agent} />}>
              {presenceCopy(agent).body}
            </Empty>
          ) : agent.ptyId ? (
            <PtyTerminalView
              key={terminalInstanceKey(agent.ptyId, agent.terminalGeneration)}
              ptyId={agent.ptyId}
              embedded
              onStreamData={onPtyStream}
              onUserPrompt={(t) => { void window.cth.historyAdd({ agentId: agent.id, cwd: agent.cwd, text: t }); }}
              onToggleFullscreen={() => setFullscreen(true)}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="messages" className="min-h-0 flex-1 border-t">
          <MessagesTab agentId={agent.id} agentName={agent.name} />
        </TabsContent>
      </Tabs>

      {fullscreen && agent.ptyId && (
        <Overlay>
          <PtyTerminalView
            key={`fs-${terminalInstanceKey(agent.ptyId, agent.terminalGeneration)}`}
            ptyId={agent.ptyId}
            fullscreen
            onStreamData={onPtyStream}
            onUserPrompt={(t) => { void window.cth.historyAdd({ agentId: agent.id, cwd: agent.cwd, text: t }); }}
            onToggleFullscreen={() => setFullscreen(false)}
          />
        </Overlay>
      )}
    </div>
  );
}

/**
 * The breaker, read-only. A missing level is UNKNOWN and renders nothing —
 * printing "healthy" for an agent the breaker has never seen would be a green
 * light nobody gave.
 */
function BreakerChip({ level, reason }: { level?: string; reason?: string }) {
  if (!level || level === 'healthy') return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={level === 'stopped' ? 'destructive' : 'secondary'} className="font-normal">
          breaker: {level}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{reason || `The circuit breaker set this agent to ${level}.`}</TooltipContent>
    </Tooltip>
  );
}

function IconAction({ label, onClick, destructive, active, children }: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  /** Marks a toggle that currently holds something — the note icon when a note
   *  exists, so a written note is visible without opening the editor. */
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          onClick={onClick}
          className={cn(
            destructive && 'text-destructive hover:text-destructive',
            active && 'bg-selected text-selected-foreground hover:bg-selected-hover'
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{label}</TooltipContent>
    </Tooltip>
  );
}

/** What this agent is on right now, straight from the shared ledger. */
function WorkingOn({ agentId }: { agentId: string }) {
  const [tasks, setTasks] = useState<HiveTask[]>([]);
  const openTaskDetail = useStore((s) => s.openTaskDetail);

  useEffect(() => {
    let alive = true;
    const read = async () => {
      try {
        const next = parseTasks(await window.cth.hiveTasks());
        if (alive) setTasks(next);
      } catch { /* the ledger is hand-written; an unreadable read is not an error state */ }
    };
    void read();
    const t = setInterval(read, TASK_POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [agentId]);

  const { active } = selectAgentWork(tasks, agentId);
  if (active.length === 0) return null;

  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-4 py-1.5 text-xs">
      <span className="text-muted-foreground">working on</span>
      {active.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => openTaskDetail(t.id)}
          className="max-w-[28ch] truncate rounded-md border px-1.5 py-0.5 hover:bg-accent"
          title={`${t.id} — ${t.title}`}
        >
          {t.id}
        </button>
      ))}
      <Separator orientation="vertical" className="h-3" />
      <span className="truncate text-muted-foreground">{active[0].title}</span>
    </div>
  );
}

function Empty({ title, children, action }: {
  title: string;
  children: React.ReactNode;
  /** A state that tells the user to do something has to offer the control. The
   *  "Asleep" copy said "Wake it" beside nothing at all. */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{children}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Wake a hibernated agent. Thin on purpose: `wakeSleepingAgent` is the same
 *  path the hive takes when work arrives for a sleeping agent, so there is one
 *  respawn to keep correct rather than a second one drawn in this UI. */
export function WakeButton({ agent, size = 'sm' }: { agent: Agent; size?: 'sm' | 'xs' }) {
  const [busy, setBusy] = useState(false);
  // MD-114 — a respawn can genuinely fail (no saved command, a worktree that
  // will not open, main refusing the spawn), and it used to fail into the
  // console. A button that does nothing and says nothing is the exact complaint
  // this card came from, so the failure STAYS on screen until the next attempt.
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-center gap-1.5">
      <Button
        size={size}
        variant="outline"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void wakeSleepingAgent(agent.id)
            .then((r) => { if (!r.ok) setError(r.error ?? 'spawn failed'); })
            .finally(() => setBusy(false));
        }}
      >
        <Sunrise /> {busy ? 'Waking…' : 'Wake'}
      </Button>
      {error && <p className="text-xs text-destructive">could not wake — {error}</p>}
    </div>
  );
}

/**
 * Archive, armed. The pixel panel has always made this two presses with a
 * countdown (`useDestructive`); this UI shipped it as ONE click on an icon
 * 16px from Edit, under a tooltip that says there is no undo. Same machine,
 * same wording, so the two front-ends cannot disagree about how hard it is to
 * destroy a process.
 *
 * MD-109: what this button PROMISES is "take this agent off the floor", and
 * ending its process is only how that happens for an agent that still has one.
 * The old handler had it the other way round — it returned early when there was
 * no `ptyId` — so an agent parked on standby (`sleepAgent` clears `ptyId`) could
 * be armed and confirmed and simply never left the roster. `endSessionAndArchive`
 * is the shared action that keeps the two halves in the right order.
 */
function KillAction({ agent, onKilled }: { agent: Agent; onKilled: () => void }) {
  // No live process: the button is pure bookkeeping, so it must not talk about
  // killing one. Same two-press arming either way — archiving is still undo-less.
  const live = !!agent.ptyId;
  const kill = useDestructive({
    onRun: () => {
      void endSessionAndArchive(agent, {
        killPty: (ptyId) => window.cth.killPty(ptyId),
        disposeTerminal,
        archive: onKilled
      });
    }
  });
  const armed = kill.phase === 'armed';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size={armed ? 'xs' : 'icon-sm'}
          variant={armed ? 'destructive' : 'ghost'}
          aria-label={armed
            ? `Confirm — archive ${agent.name}${live ? ' and end its process' : ''}`
            : `Archive ${agent.name}${live ? ' and end its process' : ''}`}
          onClick={kill.press}
          className={armed ? undefined : 'text-destructive hover:text-destructive'}
        >
          {armed
            ? <>archive {agent.name}{kill.remaining > 0 && <span className="opacity-75"> · {kill.remaining}s</span>}</>
            : <X />}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {armed
          ? (live
            ? 'Press again to end its process and archive it. The PTY is really gone.'
            : 'Press again to archive it. You can restore it from Archived.')
          : (live
            ? "End this agent's process and move it to Archived. Asks once more first — the PTY is really gone."
            : 'Move this agent to Archived. It has no running process; you can restore it later.')}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The private note — the human's own scratch line about an agent, never sent to
 * it. It was still being persisted and still editable in the pixel UI, so a note
 * written there was invisible AND uneditable here: the field silently became
 * write-only depending on which front-end you happened to open.
 */
function NoteRow({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const setAgentNote = useStore((s) => s.setAgentNote);
  return (
    <div className="flex shrink-0 flex-col gap-1 border-b bg-muted/30 px-4 py-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">Private note</span>
        <span className="text-xs text-muted-foreground">yours — {agent.name} never sees it</span>
        <span className="flex-1" />
        <Button size="xs" variant="ghost" onClick={onClose}>Done</Button>
      </div>
      {/* A textarea, not an input: the note is a bullet list, one line per
          bullet, and an input silently eats the newlines. */}
      <Textarea
        autoFocus
        rows={3}
        value={agent.note ?? ''}
        onChange={(e) => setAgentNote(agent.id, e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
        placeholder="one line per bullet…"
        className="min-h-[64px] text-xs"
      />
    </div>
  );
}
