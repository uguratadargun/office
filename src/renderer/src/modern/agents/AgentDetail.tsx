import { useEffect, useState } from 'react';
import './terminal-tokens.css';
import { Code2, SquareTerminal, Pencil, X } from 'lucide-react';
import { useStore, type Agent } from '@/store/store';
import { useFleetUsage } from '@/hooks/useFleetUsage';
import { useFleetTelemetry } from '@/hooks/useTelemetry';
import { usePtyParser } from '@/hooks/usePtyParser';
import { PtyTerminalView } from '@/components/PtyTerminalView';
import { terminalInstanceKey } from '@/components/terminalRecovery';
import { disposeTerminal } from '@/components/terminalPool';
import { formatTokens, formatUsd, billedVsContextNote } from '@shared/usageFormat';
import { parseTasks, selectAgentWork, TASK_POLL_MS, type HiveTask } from '@/store/taskLedger';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Overlay } from '../overlay';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { cn } from '../lib/cn';
import { rowCap, statusTone } from './agentsModel';
import { AgentControls } from './AgentControls';

type Tab = 'terminal' | 'messages';

/**
 * One agent. Header → controls → usage → what it is working on → terminal.
 *
 * Michael keeps his own area: his old Command Center tabs are being rebuilt as
 * separate nav entries, so here he is an agent like any other plus a pointer.
 */
export function AgentDetail({ agent }: { agent: Agent }) {
  const [tab, setTab] = useState<Tab>('terminal');
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
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <h1 className="truncate text-base font-semibold">{agent.name}</h1>
        <Badge variant={statusTone(agent.status)} className="font-normal">{agent.status}</Badge>
        <span className="truncate text-xs text-muted-foreground" title={agent.cwd}>
          {agent.description || agent.project}
        </span>
        <span className="flex-1" />
        <IconAction label={`Open the IDE — files and diffs for ${agent.project}`} onClick={() => setIdeOpen(true, agent.id)}>
          <Code2 />
        </IconAction>
        <IconAction label={`Open Terminal.app at ${agent.cwd}`} onClick={() => void window.cth.openTerminalAt(agent.cwd)}>
          <SquareTerminal />
        </IconAction>
        <IconAction label="Edit this agent" onClick={() => setEditAgentId(agent.id)}>
          <Pencil />
        </IconAction>
        <IconAction
          label="End this agent's process. The PTY is really gone — there is no undo."
          destructive
          onClick={() => {
            if (!agent.ptyId) return;
            void window.cth.killPty(agent.ptyId).then(() => {
              disposeTerminal(agent.ptyId!);
              archiveAgent(agent.id);
            });
          }}
        >
          <X />
        </IconAction>
      </header>

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
          ) : agent.sleeping ? (
            <Empty title="Asleep">Its session was shut down after the idle window. Wake it to reattach.</Empty>
          ) : agent.ptyId ? (
            <PtyTerminalView
              key={terminalInstanceKey(agent.ptyId, agent.terminalGeneration)}
              ptyId={agent.ptyId}
              embedded
              onStreamData={onPtyStream}
              onUserPrompt={(t) => { void window.cth.historyAdd({ agentId: agent.id, cwd: agent.cwd, text: t }); }}
              onToggleFullscreen={() => setFullscreen(true)}
            />
          ) : (
            <Empty title="No PTY">This agent has no live process.</Empty>
          )}
        </TabsContent>

        <TabsContent value="messages" className="min-h-0 flex-1 border-t">
          <Empty title="Messages">The inbox/outbox thread lands next.</Empty>
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

function IconAction({ label, onClick, destructive, children }: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
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
          className={destructive ? 'text-destructive hover:text-destructive' : undefined}
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

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{children}</p>
    </div>
  );
}
