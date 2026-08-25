import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, RotateCw, Send, Trash2 } from 'lucide-react';
import { useStore, type Agent } from '@/store/store';
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

/** The Agents landing screen — what you get with nothing selected: give the
 *  floor work, see every agent's engine and spend at once, and reach the ones
 *  that were archived. */
export function AgentsOverview({ onSelect }: { onSelect: (id: string) => void }) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
        <Dispatch />
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

  const restart = async (a: Agent, kind: RestartKind, model?: string) => {
    if (!a.ptyId || !config) return;
    setBusy(a.id);
    setErrors((e) => { const { [a.id]: _drop, ...rest } = e; return rest; });
    try {
      const provider = (a.provider ?? 'claude') as AgentProvider;
      const spawn = buildRestartSpawn({
        kind, agent: a, provider, model: model ?? a.model, effort: undefined,
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
        kind, agent: a, provider, model: model ?? a.model, effort: undefined,
        config, bossName: boss, cols: 100, rows: 30
      }, provider));
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
                <Badge variant={statusTone(a.status)} className="h-5 px-1.5 text-[10px] font-normal">{a.status}</Badge>
                <span className="truncate text-xs text-muted-foreground">{a.provider ?? 'claude'}{a.model ? ` · ${a.model}` : ''}{a.effort ? ` · ${a.effort}` : ''}</span>
                {level && level !== 'healthy' && (
                  <Badge variant={level === 'stopped' ? 'destructive' : 'secondary'} className="h-5 px-1.5 text-[10px] font-normal">
                    breaker: {level}
                  </Badge>
                )}
                <span className="flex-1" />
                {chip && <span className="font-mono text-[11px] text-muted-foreground">{chip}</span>}
                {!!rate[a.id] && <span className="font-mono text-[11px] text-muted-foreground">{formatTokens(rate[a.id])}/min</span>}
                <CapField value={caps[a.id]} onSet={(v) => setCap(a.id, v)} />
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
              </div>
              {errors[a.id] && <p className="px-3 pb-2 text-xs text-destructive">{errors[a.id]}</p>}
            </div>
          );
        })}
        {agents.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Nobody on the floor yet.</p>}
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
