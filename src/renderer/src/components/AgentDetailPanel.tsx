import { useEffect, useState } from 'react';
import { PixelPanel } from './PixelPanel';
import { PixelBadge } from './PixelBadge';
import { PixelButton } from './PixelButton';
import { useDestructive } from './ui/DestructiveAction';
import { SpritePortrait } from './SpritePortrait';
import { PtyTerminalView } from './PtyTerminalView';
import { terminalInstanceKey } from './terminalRecovery';
import { MessageQueueComposer } from './MessageQueueComposer';
import { CommandCenterPanel } from './CommandCenterPanel';
import { disposeTerminal } from './terminalPool';
import { SidebarTabs } from './SidebarTabs';
import { ThreadsPanel } from './ThreadsPanel';
import { ToolWaterfall } from './ToolWaterfall';
import { AgentControlStrip } from './AgentControlStrip';
import { GitTab } from './GitTab';
import { Icon } from './Icon';
import { UsageReadout } from './UsageReadout';
import { useFleetUsage } from '@/hooks/useFleetUsage';
import { COLUMNS } from './TasksKanban';
import { openQuestion, parseTasks, selectAgentWork, TASK_POLL_MS, type HiveTask } from '@/store/taskLedger';
import { relSince } from '@shared/relTime';
import { useStore, type Agent } from '@/store/store';
import { usePtyParser } from '@/hooks/usePtyParser';

export interface AgentDetailPanelProps {
  agent: Agent;
}

export function AgentDetailPanel({ agent }: AgentDetailPanelProps) {
  const [openTerminalState, setOpenTerminalState] = useState<'idle' | 'opening' | 'ok' | 'error'>('idle');
  const [openTerminalError, setOpenTerminalError] = useState<string | undefined>();
  const archiveAgent = useStore(s => s.archiveAgent);
  const updateAgent = useStore(s => s.updateAgent);
  const setFullscreen = useStore(s => s.setFullscreen);
  const fullscreenAgentId = useStore(s => s.fullscreenAgentId);
  const sidebarTab = useStore(s => s.sidebarTab);
  const setSidebarTab = useStore(s => s.setSidebarTab);
  // Budgets were enforceable but not observable — the breaker could stop an
  // agent over a number the user was never shown. One poll for the whole floor;
  // Michael's own panel is the CommandCenter, which returns above this.
  const fleetUsage = useFleetUsage();
  const [caps, setCaps] = useState<{ agent?: Record<string, number>; floor?: number }>({});
  useEffect(() => {
    window.cth.getConfig()
      .then((c) => setCaps({ agent: c.agentTokenCaps, floor: c.costCapTokens }))
      .catch(() => { /* no caps readable → the readout shows no meter, not a fake one */ });
  }, []);
  const isReal = !!agent.ptyId;
  // While this agent is shown in the fullscreen overlay, the fullscreen view
  // owns the pty (it sizes it to fill the screen). Keeping the embedded terminal
  // mounted too means two xterms fight over the pty's cols/rows — which corrupts
  // the display and breaks scrolling. So we unmount the embedded one here; it
  // re-mounts and re-fits when fullscreen closes.
  const isFullscreenedHere = fullscreenAgentId === agent.id;

  const onPtyStream = usePtyParser(agent.id);

  // Arms in place rather than expanding into a labelled confirm row: this lives in
  // a tight icon toolbar, and DestructiveAction's two-button layout would push the
  // header wider than the panel. Same machine, no undo — the PTY is really gone,
  // so a window that pretends otherwise would be a lie. Must sit above the isGod
  // early return — hooks can't be conditional.
  const kill = useDestructive({
    onRun: () => {
      if (!agent.ptyId) return;
      void window.cth.killPty(agent.ptyId).then(() => {
        disposeTerminal(agent.ptyId!);
        archiveAgent(agent.id);
      });
    },
  });

  // Michael gets the full command-center dashboard instead of the plain panel.
  if (agent.isGod) return <CommandCenterPanel agent={agent} />;

  const openTerminal = async () => {
    setOpenTerminalState('opening');
    setOpenTerminalError(undefined);
    try {
      const result = await window.cth.openTerminalAt(agent.cwd);
      if (result.ok) {
        setOpenTerminalState('ok');
        setTimeout(() => setOpenTerminalState('idle'), 1500);
      } else {
        setOpenTerminalState('error');
        setOpenTerminalError(result.error ?? 'unknown error');
        setTimeout(() => setOpenTerminalState('idle'), 4000);
      }
    } catch (e) {
      setOpenTerminalState('error');
      setOpenTerminalError(e instanceof Error ? e.message : String(e));
      setTimeout(() => setOpenTerminalState('idle'), 4000);
    }
  };

  return (
    <PixelPanel
      variant="default"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: 0,
        overflow: 'hidden'
      }}
      noPadding
    >
      {/* Thin header strip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 8px',
        background: 'var(--cth-cream-100)',
        borderBottom: '1px solid var(--cth-ink-700)',
        flexShrink: 0
      }}>
        <div style={{
          width: 32, height: 32,
          background: `var(--cth-${agent.accent}-light)`,
          boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden',
          flexShrink: 0
        }}>
          <SpritePortrait character={agent.character} scale={1} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--cth-font-display)',
            fontSize: 10, lineHeight: '14px',
            color: 'var(--cth-ink-900)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
          }}>{agent.name.toUpperCase()}</div>
          <div style={{
            display: 'flex', gap: 6, alignItems: 'center', marginTop: 1
          }}>
            <PixelBadge status={agent.status} />
            <span style={{
              fontSize: 12, color: 'var(--cth-ink-500)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            }}>{agent.project}</span>
          </div>
        </div>
        {/* v0.3.4: the IDE lives at agent level (replaces the old files tab) —
            opens the full-window Monaco editor rooted at this agent's workspace. */}
        <PixelButton variant="secondary" size="sm" onClick={() => useStore.getState().setIdeOpen(true, agent.id)}>
          <span title={`Open the IDE — file editor + git diff for ${agent.project}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="code" /> IDE
          </span>
        </PixelButton>
        <PixelButton variant="secondary" size="sm" onClick={openTerminal} disabled={openTerminalState === 'opening'}>
          <span title={`open Terminal.app at ${agent.cwd}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="terminal" />
            {openTerminalState === 'opening' ? '...' : openTerminalState === 'ok' ? 'ok' : openTerminalState === 'error' ? 'err' : 'open'}
          </span>
        </PixelButton>
        {!agent.isGod && !agent.isAssistant && (
          <PixelButton variant="secondary" size="sm" onClick={() => useStore.getState().setEditAgentId(agent.id)}>
            edit
          </PixelButton>
        )}
        {isReal && (
          <PixelButton
            variant="destructive" size="sm" onClick={kill.press}
            title={kill.phase === 'armed'
              ? `Close ${agent.name} for good? The PTY ends and the agent is archived.`
              : `Close ${agent.name}`}
          >
            {kill.phase === 'armed' ? `sure? ${kill.remaining}s` : <Icon name="x" />}
          </PixelButton>
        )}
      </div>

      {openTerminalError && (
        <div style={{
          fontSize: 12, color: 'var(--cth-coral)',
          padding: '2px 8px',
          background: 'var(--cth-coral-light)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        }}>{openTerminalError}</div>
      )}

      {/* #7C — operator control (pause / halt / steer) for live agents */}
      {isReal && <AgentControlStrip agentId={agent.id} />}

      {/* What this agent has actually spent, and against which ceiling. */}
      <UsageReadout
        usage={fleetUsage[agent.id]}
        agentCap={caps.agent?.[agent.id]}
        floorCap={caps.floor}
        accent={agent.accent}
      />

      {/* What this agent is actually doing right now — the panel used to say
          nothing about it, so following the floor meant reading terminals. */}
      <WorkingOn agent={agent} />

      {/* Tabs */}
      <SidebarTabs current={sidebarTab} accent={agent.accent} onChange={setSidebarTab} />

      {/* Active tab body — fills remaining space */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {sidebarTab === 'terminal' && (
          isReal && agent.ptyId ? (
            isFullscreenedHere ? (
              <EmptyTab title="In fullscreen">
                This terminal is open in fullscreen. Press Esc or exit fullscreen to bring it back here.
              </EmptyTab>
            ) : (
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                <PtyTerminalView
                  key={terminalInstanceKey(agent.ptyId, agent.terminalGeneration)}
                  ptyId={agent.ptyId}
                  onStreamData={onPtyStream}
                  onUserPrompt={(t) => {
                    updateAgent(agent.id, { lastPrompt: t });
                    if (t.trim().toLowerCase() === '/clear') {
                      updateAgent(agent.id, { contextTokens: 0, contextLimit: undefined, progress: 0 });
                    }
                    void window.cth.historyAdd({ agentId: agent.id, cwd: agent.cwd, text: t });
                  }}
                  onToggleFullscreen={() => setFullscreen(agent.id)}
                  fullscreen={false}
                  embedded
                />
              </div>
              <MessageQueueComposer agent={agent} />
            </div>
            )
          ) : (
            <EmptyTab title="No PTY">
              This agent has no live terminal. Spawn an agent through "add agent" to use the terminal tab.
            </EmptyTab>
          )
        )}

        {sidebarTab === 'git' && (
          <GitTab cwd={agent.cwd} />
        )}

        {sidebarTab === 'messages' && (
          <ThreadsPanel agentId={agent.id} />
        )}

        {sidebarTab === 'traces' && (
          <ToolWaterfall agentId={agent.id} />
        )}
      </div>
    </PixelPanel>
  );
}

function EmptyTab({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: 16, gap: 8,
      background: 'var(--cth-paper-200)'
    }}>
      <div style={{
        fontFamily: 'var(--cth-font-display)', fontSize: 10, lineHeight: '14px',
        color: 'var(--cth-ink-500)'
      }}>{title.toUpperCase()}</div>
      <p style={{
        margin: 0, fontSize: 13, textAlign: 'center', color: 'var(--cth-ink-700)',
        maxWidth: 280
      }}>{children}</p>
    </div>
  );
}

/* ─── "Working on" ─────────────────────────────────────────────────────────── */

const PILL = (status: HiveTask['status']) =>
  (COLUMNS.find((c) => c.key === status) ?? COLUMNS[0]);

/**
 * The agent's live work: its in-flight kanban cards, plus one line of what the
 * floor already knows about it.
 *
 * Read-only. A row opens the SAME task detail the board opens (store.openTaskDetail
 * is the app-wide host — the kanban card, the floor sticky note and this row all
 * go through it), so there is no second navigation to keep in step.
 *
 * The ledger poll is this component's own, matching every other ledger consumer
 * in the app (board, ASK ME, detail overlay, command center all keep a private
 * TASK_POLL_MS interval on the same IPC). The ACTIVITY line adds no poller at
 * all: `agent` is the live store object the floor renders from, and the usage
 * numbers are already on screen in the UsageReadout directly above this.
 */
function WorkingOn({ agent }: { agent: Agent }) {
  const [tasks, setTasks] = useState<HiveTask[]>([]);
  const openTaskDetail = useStore((s) => s.openTaskDetail);

  useEffect(() => {
    let alive = true;
    const read = async () => {
      // parseTasks normalizes the hand-written ledger; nothing downstream may
      // see a raw card (a card without dependsOn crashed the detail once).
      try {
        const next = parseTasks(await window.cth.hiveTasks());
        if (alive) setTasks(next);
      } catch { /* keep the last good ledger rather than blanking the section */ }
    };
    void read();
    const timer = setInterval(() => { void read(); }, TASK_POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const { active, recent } = selectAgentWork(tasks, agent.id);

  return (
    <div style={{
      flexShrink: 0,
      padding: '4px 8px 6px',
      background: 'var(--cth-cream-100)',
      borderBottom: '1px solid var(--cth-ink-300)',
      // A busy agent can hold several cards; the terminal below keeps its space
      // and this scrolls instead of pushing it off screen.
      maxHeight: 168, overflowY: 'auto'
    }}>
      <div style={{
        fontFamily: 'var(--cth-font-display)', fontSize: 9, lineHeight: '12px',
        color: 'var(--cth-ink-500)', marginBottom: 3
      }}>WORKING ON</div>

      {active.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>
          Idle — no card assigned
        </div>
      ) : active.map((t) => {
        const pill = PILL(t.status);
        const ask = openQuestion(t);
        return (
          <button
            key={t.id}
            onClick={() => openTaskDetail(t.id)}
            title={`${t.id} — ${t.title}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              width: '100%', textAlign: 'left',
              padding: '2px 4px', marginBottom: 2,
              border: 'none', background: 'transparent', cursor: 'pointer',
              font: 'inherit', color: 'var(--cth-ink-900)'
            }}
          >
            <span style={{
              flexShrink: 0,
              fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
              padding: '0 3px', color: 'var(--cth-ink-900)', background: pill.accent
            }}>{pill.label}</span>
            <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--cth-ink-500)' }}>{t.id}</span>
            <span style={{
              flex: 1, minWidth: 0, fontSize: 12,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            }}>{t.title}</span>
            {/* Why it is stuck, not just that it is — an open ask is something
                the human can act on from the Tasks board. */}
            {ask && (
              <span title={ask.q} style={{
                flexShrink: 0, fontSize: 11, color: 'var(--cth-coral)'
              }}>asks you</span>
            )}
            <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--cth-ink-500)' }}>
              {relSince(t.createdAt)}
            </span>
          </button>
        );
      })}

      {/* One line of live floor state. `carrying` is the tool the last hook
          event reported; `recentTextTs` is the last thing it said. */}
      <div style={{
        marginTop: 3, fontSize: 11, color: 'var(--cth-ink-500)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
      }}>
        {agent.status} · {agent.action || 'idle'}
        {agent.carrying ? ` · ${agent.carrying}` : ''}
        {agent.recentTextTs ? ` · ${relSince(agent.recentTextTs)}` : ''}
      </div>

      {recent.length > 0 && (
        <div style={{ marginTop: 3, fontSize: 11, color: 'var(--cth-ink-300)' }}>
          finished: {recent.map((t) => (
            <button
              key={t.id}
              onClick={() => openTaskDetail(t.id)}
              title={`${t.id} — ${t.title}`}
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                font: 'inherit', color: 'inherit', padding: '0 4px 0 0'
              }}
            >{t.id}</button>
          ))}
        </div>
      )}
    </div>
  );
}
