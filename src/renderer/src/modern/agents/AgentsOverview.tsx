import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, History, RotateCcw, RotateCw, Send, Trash2, X } from 'lucide-react';
import { useStore, type Agent } from '@/store/store';
import { useRestoreTeam, respawnAgent } from '@/hooks/useRestoreTeam';
import { effortLevelsFor, effortUnsupportedReason, isValidEffort, modelsForProvider, providerPreset, AGENT_PROVIDER_PRESETS } from '@/store/config';
import { useFleetUsage } from '@/hooks/useFleetUsage';
import { useFleetTelemetry } from '@/hooks/useTelemetry';
import { sortAgentsForList } from '@shared/agentOrder';
import { formatTokens } from '@shared/usageFormat';
import { acquireTerminal, disposeTerminal, resetTerminal } from '@/components/terminalPool';
import { tokenizeCommand } from '@/store/config';
import type { AgentProvider } from '@shared/agentProvider';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import { Input } from '../components/ui/input';
import { ScrollArea } from '../components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Separator } from '../components/ui/separator';
import { Textarea } from '../components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { cn } from '../lib/cn';
import { billedChip, dispatchBody, dispatchOutcome, statusTone, type DispatchOutcome } from './agentsModel';
import { buildRestartSpawn, killWasFatal, restartPatch, resumeWasRefused, type RestartKind } from './restart';
import { WakeButton } from './AgentDetail';

/** The Agents landing screen — what you get with nothing selected: give the
 *  floor work, see every agent's engine and spend at once, and reach the ones
 *  that were archived. */
export function AgentsOverview({ onSelect }: { onSelect: (id: string) => void }) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
        <Dispatch />
        <PreviousSession />
        <Roster onSelect={onSelect} />
        <ArchivedSection />
      </div>
    </ScrollArea>
  );
}

/* ── Dispatch ──────────────────────────────────────────────────────────── */

/**
 * ALL human dispatch flows through the god — never straight into a worker's
 * inbox. Direct dispatch bypassed the orchestrator's whole job: no 4-part
 * contract, no card in tasks.json, no board awareness. A worker picked here is
 * forwarded as a SUGGESTION the god may follow (see agentsModel.dispatchBody).
 */
function Dispatch() {
  const boss = useStore((s) => s.bossName);
  const agents = useStore((s) => s.agents);
  const [text, setText] = useState('');
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState<DispatchOutcome | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);

  /**
   * THIS BOX IS THE APP'S ONE DISPATCH TARGET, so it has to answer when
   * something elsewhere hands it work: Issues → Assign and a task detail's
   * Assign both write `dispatchSeedRequest` and expect the text to be waiting
   * here. Nothing in this UI read it, which is why both of those buttons were
   * silent no-ops.
   *
   * `{ seq }` makes every request distinct, so assigning the same issue twice
   * re-seeds instead of looking broken. The text is REPLACED, matching the
   * pixel Command Center — a seed is a whole brief, not an append.
   */
  const seed = useStore((s) => s.dispatchSeedRequest);
  const seenSeq = useRef(0);
  useEffect(() => {
    if (!seed || seed.seq === seenSeq.current) return;
    seenSeq.current = seed.seq;
    setText(seed.text);
    setMsg(null);
    box.current?.focus();
  }, [seed]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    const picked = to ? agents.find((a) => a.id === to) : undefined;
    const suggested = picked ? { id: picked.id, name: picked.name } : undefined;
    const res = await window.cth.hiveSend(
      { to: 'god', act: 'request', subject: 'Task from the human', body: dispatchBody(body, suggested) },
      'human'
    );
    // Only clear on success — wiping the text after a FAILED send threw away the
    // thing the user typed and left them nothing to retry with.
    if (res.ok) setText('');
    const outcome = dispatchOutcome(res, boss, suggested);
    setMsg(outcome);
    if (!outcome.sticky) setTimeout(() => setMsg((m) => (m && !m.sticky ? null : m)), 4000);
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">Dispatch</h2>
        <p className="text-xs text-muted-foreground">Goes to {boss}, who decides who does it.</p>
      </div>
      <Textarea
        ref={box}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="What needs doing?"
        className="min-h-[72px]"
      />
      <div className="flex items-center gap-2">
        <Select value={to || 'none'} onValueChange={(v) => setTo(v === 'none' ? '' : v)}>
          <SelectTrigger size="sm" className="w-52" aria-label="Suggest an agent">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{boss} decides</SelectItem>
            {agents.filter((a) => !a.isGod).map((a) => (
              <SelectItem key={a.id} value={a.id}>suggest {a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" disabled={!text.trim()} onClick={() => void send()}>
          <Send /> Send
        </Button>
        {msg && (
          <span className={cn('text-xs', msg.ok ? 'text-muted-foreground' : 'text-destructive')}>
            {msg.text}
            {msg.sticky && (
              <Button size="xs" variant="ghost" className="ml-1" onClick={() => setMsg(null)}>dismiss</Button>
            )}
          </span>
        )}
      </div>
    </section>
  );
}

/* ── Roster ────────────────────────────────────────────────────────────── */

function Roster({ onSelect }: { onSelect: (id: string) => void }) {
  const agents = useStore((s) => s.agents);
  const boss = useStore((s) => s.bossName);
  const updateAgent = useStore((s) => s.updateAgent);
  const usage = useFleetUsage();
  const { rate, breakers } = useFleetTelemetry();
  const [caps, setCaps] = useState<Record<string, number>>({});
  const [config, setConfig] = useState<Awaited<ReturnType<typeof window.cth.getConfig>> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    window.cth.getConfig()
      .then((c) => { setConfig(c); setCaps(c.agentTokenCaps ?? {}); })
      .catch(() => { /* no config → the roster still lists, it just cannot restart */ });
  }, []);

  /** Set or clear one agent's token ceiling. writeConfig replaces the whole
   *  top-level key, so the merged map goes back every time. */
  const setCap = (id: string, tokens: number | undefined) => {
    const next = { ...caps };
    if (tokens && tokens > 0) next[id] = tokens; else delete next[id];
    setCaps(next);
    void window.cth.updateConfig({ agentTokenCaps: next }).catch(() => { /* noop */ });
  };

  /**
   * @param over  what the user just picked in the row. Undefined keeps the
   *              agent's current value — the row is three independent pickers
   *              plus two restart buttons, and any of them can be the one that
   *              changed.
   */
  const restart = async (a: Agent, kind: RestartKind, over?: { model?: string; provider?: AgentProvider; effort?: string }) => {
    if (!a.ptyId || !config) return;
    setBusy(a.id);
    setErrors((e) => { const { [a.id]: _drop, ...rest } = e; return rest; });
    try {
      const provider = over?.provider ?? ((a.provider ?? 'claude') as AgentProvider);
      const model = over?.model ?? a.model;
      // `effortForSpawn` drops a level the new engine does not accept, so a
      // provider switch cannot splice an unknown flag onto the command.
      const effort = over?.effort !== undefined ? over.effort : a.effort;
      const spawn = buildRestartSpawn({
        kind, agent: a, provider, model, effort,
        config, bossName: boss, cols: 100, rows: 30
      });
      const killed = await window.cth.killPty(a.ptyId);
      if (killWasFatal(killed)) throw new Error(killed.error ?? 'Could not stop the current process.');
      if (spawn.resume) {
        // A blank xterm can retain corrupt renderer state even once its PTY is
        // healthy. Throw that terminal away and acquire its replacement BEFORE
        // spawning, so startup output has a listener.
        disposeTerminal(a.ptyId);
        acquireTerminal(a.ptyId);
        updateAgent(a.id, { terminalGeneration: (a.terminalGeneration ?? 0) + 1, status: 'idle', action: 'recreating terminal…' });
      } else {
        resetTerminal(a.ptyId);
      }
      const [exe, ...args] = tokenizeCommand(spawn.command);
      const res = await window.cth.spawnPty({
        id: a.ptyId, cwd: a.cwd, command: exe, args, provider,
        cols: spawn.cols, rows: spawn.rows, hive: spawn.hive,
        resume: spawn.resume, requireResume: spawn.requireResume
      });
      if (!res.ok) throw new Error(res.error ?? 'Restart failed.');
      if (resumeWasRefused(kind, res)) throw new Error('Resume was refused; no replacement session was accepted.');
      updateAgent(a.id, restartPatch({
        kind, agent: a, provider, model, effort,
        config, bossName: boss, cols: 100, rows: 30
      }, (a.provider ?? 'claude') as AgentProvider));
    } catch (error) {
      setErrors((e) => ({ ...e, [a.id]: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">Roster</h2>
      <div className="rounded-lg border">
        {sortAgentsForList(agents).map((a, i) => {
          const u = usage[a.id];
          const chip = billedChip(u);
          const level = breakers[a.id]?.level;
          return (
            <div key={a.id}>
              {i > 0 && <Separator />}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <button type="button" onClick={() => onSelect(a.id)} className="font-medium hover:underline">
                  {a.name}
                </button>
                {/* An asleep agent used to read `idle` here while the rail said
                    `asleep`, with Continue disabled and no reason given. */}
                <Badge variant={a.sleeping ? 'outline' : statusTone(a.status)} className="h-5 px-1.5 text-[10px] font-normal">
                  {a.sleeping ? 'asleep' : a.status}
                </Badge>
                {level && level !== 'healthy' && (
                  <Badge variant={level === 'stopped' ? 'destructive' : 'secondary'} className="h-5 px-1.5 text-[10px] font-normal">
                    breaker: {level}
                  </Badge>
                )}
                <span className="flex-1" />
                {chip && <span className="font-mono text-[11px] text-muted-foreground">{chip}</span>}
                {!!rate[a.id] && <span className="font-mono text-[11px] text-muted-foreground">{formatTokens(rate[a.id])}/min</span>}
                <CapField value={caps[a.id]} onSet={(v) => setCap(a.id, v)} />
                {a.sleeping ? (
                  <WakeButton agent={a} size="xs" />
                ) : (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="xs" variant="outline" disabled={busy === a.id || !a.ptyId} onClick={() => void restart(a, 'continue')}>
                          <RotateCw /> Continue
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-sm">
                        Restart &amp; Continue — a fresh process that reattaches this agent’s conversation. The escape hatch for a garbled terminal. Fails loudly rather than starting a blank session.
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="xs" variant="ghost" disabled={busy === a.id || !a.ptyId} onClick={() => void restart(a, 'fresh')}>
                          <RotateCcw /> Restart
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-sm">
                        Plain restart — same engine, NO conversation carried over. The only way to start an agent clean without killing it and hiring it back.
                      </TooltipContent>
                    </Tooltip>
                  </>
                )}
              </div>

              {/* The engine, editable. This row was three words of static text
                  (`provider · model · effort`), so changing any of them meant
                  Edit-agent — and effort was not even offered there for an agent
                  already running. A flag is a SPAWN argument, so each picker
                  says when it lands. */}
              <EngineRow
                agent={a}
                busy={busy === a.id}
                disabled={!config || !a.ptyId}
                onRestart={(over, kind) => void restart(a, kind, over)}
              />
              {errors[a.id] && <p className="px-3 pb-2 text-xs text-destructive">{errors[a.id]}</p>}
            </div>
          );
        })}
        {agents.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Nobody on the floor yet.</p>}
      </div>
    </section>
  );
}

/**
 * Engine picker for one roster row: provider · model · effort.
 *
 * Every one of these is a SPAWN argument — the flags are baked into the command
 * that started the process — so nothing here can change a running agent on its
 * own. Each picker therefore states what it costs:
 *  - a model change on the same engine RESUMES (keep the conversation, swap the
 *    model), which is `model-change`;
 *  - a provider change cannot resume — a conversation does not cross engines —
 *    so it is a fresh session, and the row says so before you pick;
 *  - effort is recorded and applied on the next restart, with the restart
 *    offered inline, because re-spawning under the user is not this control's
 *    decision to make.
 */
function EngineRow({ agent, busy, disabled, onRestart }: {
  agent: Agent;
  busy: boolean;
  disabled: boolean;
  onRestart: (over: { model?: string; provider?: AgentProvider; effort?: string }, kind: RestartKind) => void;
}) {
  const provider = (agent.provider ?? 'claude') as AgentProvider;
  const models = modelsForProvider(provider);
  const levels = effortLevelsFor(provider);
  const effortReason = effortUnsupportedReason(provider);
  // A level recorded under a different engine must not look active under this one.
  const currentEffort = isValidEffort(provider, agent.effort) ? agent.effort! : '';
  // The recorded command is what a revive replays, so "pending" is exactly: the
  // level we would spawn with differs from the one in that command.
  const spawnedEffort = (agent.command ?? '').match(/--effort\s+(\S+)/)?.[1] ?? '';
  const effortPending = !!agent.ptyId && currentEffort !== spawnedEffort;
  const setAgentEffort = useStore((s) => s.updateAgent);

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 pb-2 text-xs">
      <Select
        value={provider}
        disabled={busy || disabled}
        onValueChange={(v) => onRestart({ provider: v as AgentProvider }, 'fresh')}
      >
        <SelectTrigger size="sm" className="h-7 w-36" aria-label={`Engine for ${agent.name}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {AGENT_PROVIDER_PRESETS.map((preset) => (
            <SelectItem key={preset.id} value={preset.id}>{preset.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={agent.model ?? ''}
        disabled={busy || disabled || models.length === 0}
        onValueChange={(v) => onRestart({ model: v || undefined }, 'model-change')}
      >
        <SelectTrigger size="sm" className="h-7 w-52" aria-label={`Model for ${agent.name}`}>
          <SelectValue placeholder={`${providerPreset(provider).label} default`} />
        </SelectTrigger>
        <SelectContent>
          {models.map((m) => (
            <SelectItem key={m.label} value={m.id ?? ''}>{m.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-muted-foreground">effort</span>
      <Select
        value={currentEffort || 'default'}
        disabled={busy || disabled || !levels}
        onValueChange={(v) => setAgentEffort(agent.id, { effort: v === 'default' ? undefined : v })}
      >
        <SelectTrigger size="sm" className="h-7 w-40" aria-label={`Reasoning effort for ${agent.name}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">engine default</SelectItem>
          {(levels ?? []).map((level) => <SelectItem key={level} value={level}>{level}</SelectItem>)}
        </SelectContent>
      </Select>

      {!levels ? (
        <span className="text-muted-foreground">{effortReason}</span>
      ) : effortPending ? (
        <>
          <span>applies on next restart</span>
          <Button size="xs" variant="outline" disabled={busy || disabled} onClick={() => onRestart({}, 'continue')}>
            Restart now
          </Button>
        </>
      ) : (
        <span className="text-muted-foreground">
          {currentEffort ? `running at ${currentEffort}` : 'the engine picks'}
        </span>
      )}
    </div>
  );
}

/* ── Previous session ──────────────────────────────────────────────────── */

/**
 * Last session's team, restorable.
 *
 * `store.restorableAgents` was rendered NOWHERE in this UI — and it is not the
 * archived list, it is the roster the app had when it last quit. So after every
 * restart the whole team was simply unreachable here: no restore-all, no
 * per-agent restore, not even a list of who was there.
 *
 * Restore goes through `respawnAgent` / `restoreTeam`, the same functions the
 * pixel strip calls, so a restored agent re-enters its own worktree and resumes
 * its own CLI session — an id-preserving respawn, which is what reattaches its
 * memory, its inbox and its registry entry.
 */
function PreviousSession() {
  const restorable = useStore((s) => s.restorableAgents);
  const removeRestorableAgent = useStore((s) => s.removeRestorableAgent);
  const addAgent = useStore((s) => s.addAgent);
  const [config, setConfig] = useState<Awaited<ReturnType<typeof window.cth.getConfig>> | null>(null);
  const { restoring, autoRestoring, restoreNote, restoreTeam } = useRestoreTeam(config);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    window.cth.getConfig().then(setConfig).catch(() => { /* a restore can still run without it */ });
  }, []);

  /** One agent back, without touching the rest of the list. */
  const restoreOne = async (a: Agent) => {
    setBusy(a.id);
    setErrors((e) => { const { [a.id]: _drop, ...rest } = e; return rest; });
    const out = await respawnAgent(a, config);
    if (out.agent) { addAgent(out.agent); removeRestorableAgent(a.id); }
    // A live PTY with this id means the agent is not missing at all — retire the
    // row rather than reporting a phantom failure.
    else if (out.alreadyLive) removeRestorableAgent(a.id);
    else setErrors((e) => ({ ...e, [a.id]: out.error ?? 'Restore failed.' }));
    setBusy(null);
  };

  if (restorable.length === 0 && !restoring) return null;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h2 className="flex items-center gap-1.5 text-base font-semibold"><History className="size-4" /> Previous session</h2>
        <p className="text-xs text-muted-foreground">
          {autoRestoring
            ? 'Restoring your team…'
            : 'Respawned under their original ids, so memory and inboxes reattach.'}
        </p>
        <span className="flex-1" />
        {restorable.length > 0 && (
          <Button size="sm" disabled={restoring} onClick={() => void restoreTeam()}>
            <RotateCw /> {restoring ? 'Restoring…' : `Restore all (${restorable.length})`}
          </Button>
        )}
      </div>
      {restoreNote && <p className="text-xs text-muted-foreground">{restoreNote}</p>}
      <div className="rounded-lg border">
        {restorable.map((a, i) => (
          <div key={a.id}>
            {i > 0 && <Separator />}
            <div className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="font-medium">{a.name}</span>
              <span className="truncate text-xs text-muted-foreground">{a.description || a.project}</span>
              <span className="flex-1" />
              <Button size="xs" variant="outline" disabled={restoring || busy === a.id} onClick={() => void restoreOne(a)}>
                <RotateCw /> Restore
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Dismiss ${a.name}`}
                    disabled={restoring}
                    onClick={() => removeRestorableAgent(a.id)}
                  >
                    <X />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Dismiss {a.name} — drop it from the restore list for good.</TooltipContent>
              </Tooltip>
            </div>
            {errors[a.id] && <p className="px-3 pb-2 text-xs text-destructive">{errors[a.id]}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Per-agent token ceiling. Empty means no cap — and no cap means NO meter,
 *  never a bar drawn against a number nobody chose. */
function CapField({ value, onSet }: { value?: number; onSet: (tokens: number | undefined) => void }) {
  const [draft, setDraft] = useState(value ? String(value) : '');
  useEffect(() => { setDraft(value ? String(value) : ''); }, [value]);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={() => onSet(draft ? Number(draft) : undefined)}
          placeholder="no cap"
          inputMode="numeric"
          className="h-7 w-24 text-right font-mono text-[11px]"
        />
      </TooltipTrigger>
      <TooltipContent>Total tokens this agent may spend before the circuit breaker pauses it.</TooltipContent>
    </Tooltip>
  );
}

/* ── Archived ──────────────────────────────────────────────────────────── */

function ArchivedSection() {
  const archived = useStore((s) => s.archivedAgents);
  const removeArchivedAgent = useStore((s) => s.removeArchivedAgent);
  const addAgent = useStore((s) => s.addAgent);
  const boss = useStore((s) => s.bossName);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  /** Bring one back. A restore always starts a FRESH session — the process is
   *  gone, and demanding a resume that cannot happen would only refuse to
   *  rehire someone the user asked for. */
  const restore = async (a: Agent) => {
    setBusy(a.id);
    setErrors((e) => { const { [a.id]: _drop, ...rest } = e; return rest; });
    try {
      const config = await window.cth.getConfig();
      const provider = (a.provider ?? 'claude') as AgentProvider;
      const ptyId = a.ptyId ?? `pty-${a.id}`;
      const spawn = buildRestartSpawn({
        kind: 'model-change', agent: { ...a, ptyId }, provider, model: a.model,
        effort: undefined, config, bossName: boss, cols: 100, rows: 30
      });
      const [exe, ...args] = tokenizeCommand(spawn.command);
      const res = await window.cth.spawnPty({
        id: ptyId, cwd: a.cwd, command: exe, args, provider,
        cols: spawn.cols, rows: spawn.rows, hive: spawn.hive
      });
      if (!res.ok) throw new Error(res.error ?? 'Restore failed.');
      addAgent({ ...a, ptyId, status: 'idle', action: 'restoring…' });
      removeArchivedAgent(a.id);
    } catch (error) {
      setErrors((e) => ({ ...e, [a.id]: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(null);
    }
  };

  if (archived.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center gap-1 text-base font-semibold">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          Archived <span className="text-muted-foreground">{archived.length}</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 rounded-lg border">
          {archived.map((a, i) => (
            <div key={a.id}>
              {i > 0 && <Separator />}
              <div className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="font-medium">{a.name}</span>
                <span className="truncate text-xs text-muted-foreground">{a.description || a.project}</span>
                <span className="flex-1" />
                <Button size="xs" variant="outline" disabled={busy === a.id} onClick={() => void restore(a)}>
                  <RotateCw /> Restore
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => removeArchivedAgent(a.id)}
                >
                  <Trash2 /> Forget
                </Button>
              </div>
              {errors[a.id] && <p className="px-3 pb-2 text-xs text-destructive">{errors[a.id]}</p>}
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
