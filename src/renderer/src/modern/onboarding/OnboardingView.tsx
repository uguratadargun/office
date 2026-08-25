import { useEffect, useState } from 'react';
import {
  Sparkles, Users, Brain, Terminal, ShieldCheck, Boxes,
  FolderOpen, Trash2, Plus, ArrowLeft, ArrowRight, Check
} from 'lucide-react';
import { AGENT_PROVIDER_PRESETS, modelsForProvider, type AgentProvider, type HarnessConfig } from '@/store/config';
import { canReceiveInbox, providerPreset } from '@shared/agentProvider';
import { bossName } from '@shared/bossName';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';
import { Progress } from '../components/ui/progress';
import { Alert, AlertDescription } from '../components/ui/alert';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '../components/ui/select';
import { cn } from '../lib/cn';

/**
 * First-run setup, ported from the pixel wizard.
 *
 * The behaviour is deliberately identical — the same seven steps, the same one
 * config write at the end, the same guards — because this screen is the only
 * thing between a fresh install and a working hive, and a subtle difference
 * between the two UIs here means one of them cannot finish setup.
 *
 * Three of those guards are not obvious and are the reason this is a port
 * rather than a rewrite:
 *   1. `audience` is chosen first and swaps the copy register on every later
 *      step (`plain`), so the wizard speaks to whoever is reading it;
 *   2. the permission toggles apply IMMEDIATELY via their own IPC and are NOT
 *      part of the final write — and `setLoginItem` is reconciled to the value
 *      the OS returns, never to what we asked for;
 *   3. a whitespace-only home is not a folder: it is rejected and the wizard
 *      bounces back to that step rather than failing at the end.
 */

type Audience = 'technical' | 'non-technical';
type Step = 'persona' | 'welcome' | 'home' | 'orchestrator' | 'repos' | 'permissions';

const STEPS: Step[] = ['persona', 'welcome', 'home', 'orchestrator', 'repos', 'permissions'];
/** The four numbered steps; persona and welcome are intro screens. */
const NUMBERED: Step[] = ['home', 'orchestrator', 'repos', 'permissions'];

const FEATURES = (boss: string) => [
  { icon: Boxes, label: 'Ten engines, one office', desc: 'Claude Code, Codex, Grok, Kimi, Antigravity, Qwen, OpenCode, Crush, pi and Copilot — live agents on one floor.', plain: 'Ten AI assistants — Claude, Codex, Gemini, Grok and more — working side by side in one shared office.' },
  { icon: Users, label: `${boss} is your clone`, desc: 'Your clone runs the floor: triages requests, routes tasks, escalates only what needs you.', plain: `Your clone, ${boss}, takes your requests, hands work to the right agent, and only interrupts you when it matters.` },
  { icon: Brain, label: 'Long-term memory', desc: 'Each agent keeps notes, mined into a shared, searchable memory palace.', plain: "Agents remember what they've done, so they don't start from scratch every time." },
  { icon: Terminal, label: 'Command center', desc: 'Terminal, floor, memory, activity, tasks and triggers in one control surface.', plain: "One dashboard to watch the work, the agents' memory, tasks and triggers." },
  { icon: ShieldCheck, label: 'Guardrails', desc: 'Per-agent token budgets, a steer → constrain → stop circuit breaker, and human approvals.', plain: 'Spending limits and safety stops keep agents in check — and they can ask you before big actions.' },
  { icon: Sparkles, label: 'Ready-made hires', desc: 'Grab a pre-configured agent from the gallery and spawn it in one click.', plain: 'Hire a ready-made agent from the gallery in one click — no setup needed.' }
];

const PROVIDER_BLURB: Partial<Record<AgentProvider, string>> = {
  claude: 'Claude Code — Anthropic',
  codex: 'Codex — OpenAI',
  antigravity: 'Antigravity — Google Gemini',
  qwen: 'Qwen — runs a local Qwen model on your machine'
};

export function OnboardingView({ onComplete }: { onComplete: (config: HarnessConfig) => void }) {
  const [step, setStep] = useState<Step>('persona');
  const [audience, setAudience] = useState<Audience | undefined>();
  const plain = audience === 'non-technical';

  // `~/HarnessAgents` literally, not an expanded path: the renderer has no
  // `process` (contextIsolation), and main expands the tilde at both the
  // config-write boundary and ensureHarnessHome's mkdir.
  const [home, setHome] = useState('~/HarnessAgents');
  const [repos, setRepos] = useState<string[]>([]);
  const [autoMode, setAutoMode] = useState(true);
  const [shareStats, setShareStats] = useState(true);
  const [godProvider, setGodProvider] = useState<AgentProvider>('claude');
  const [godModel, setGodModel] = useState<string | undefined>(
    providerPreset('claude').recommendedOrchestratorModel
  );
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  // Applied immediately through their own IPC — never part of finish().
  const [strongKeepalive, setStrongKeepalive] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [openAtLogin, setOpenAtLogin] = useState(false);

  const boss = bossName(null);
  const idx = STEPS.indexOf(step);
  const numberedIdx = NUMBERED.indexOf(step);

  const pickFolder = async (onPick: (path: string) => void) => {
    setError(undefined);
    const res = await window.cth.chooseFolder();
    if (res.ok) onPick(res.path);
    else if (res.error !== 'cancelled') setError(res.error);
  };

  const finish = async () => {
    setBusy(true);
    setError(undefined);
    const harnessHome = home.trim(); // whitespace-only is not a folder
    if (!harnessHome) {
      setError('Pick a home folder first.');
      setBusy(false);
      setStep('home');
      return;
    }
    const ensure = await window.cth.ensureHarnessHome(harnessHome);
    if (!ensure.ok) {
      setError(ensure.error ?? 'Could not create the home folder.');
      setBusy(false);
      return;
    }
    // ONE write, with the same trimmed value we just created — not the raw field.
    const next = await window.cth.updateConfig({
      onboardingComplete: true,
      audience: audience ?? 'technical',
      harnessHome,
      registeredRepos: repos,
      autoMode,
      godProvider,
      godModel,
      telemetryEnabled: shareStats
    });
    setBusy(false);
    onComplete(next);
  };

  const canAdvance = step !== 'persona' || !!audience;

  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 px-6 py-10">
        <header className="flex flex-col gap-2">
          {numberedIdx >= 0 && (
            <>
              <Progress value={((numberedIdx + 1) / NUMBERED.length) * 100} className="h-1" />
              <p className="text-xs text-muted-foreground">
                Step {numberedIdx + 1} of {NUMBERED.length}
              </p>
            </>
          )}
          <h1 className="text-xl font-semibold tracking-tight">{title(step, plain, boss)}</h1>
        </header>

        <div className="flex flex-1 flex-col gap-5">
          {step === 'persona' && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">
                So the rest of this reads the way you want it to — you can change it later in Settings.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <PickCard
                  selected={audience === 'technical'}
                  title="I write software"
                  desc="Repos, CLIs and models by name."
                  onClick={() => setAudience('technical')}
                />
                <PickCard
                  selected={audience === 'non-technical'}
                  title="Explain things simply"
                  desc="Plain English, no jargon."
                  onClick={() => setAudience('non-technical')}
                />
              </div>
            </>
          )}

          {step === 'welcome' && (
            <div className="grid gap-3 sm:grid-cols-2">
              {FEATURES(boss).map((f) => {
                const Icon = f.icon;
                return (
                  <div key={f.label} className="flex flex-col gap-1.5 rounded-lg border p-3">
                    <div className="flex items-center gap-2">
                      <Icon className="size-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{f.label}</span>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {plain ? f.plain : f.desc}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {step === 'home' && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {plain
                  ? 'Office needs one folder of its own. It keeps your assistants, what they remember, and the shared to-do board there.'
                  : 'One folder for the hive: agents, their memory files, the task ledger and the shared board.'}
              </p>
              <div className="flex flex-col gap-2">
                <Label htmlFor="ob-home" className="text-sm">Home folder</Label>
                <div className="flex gap-2">
                  <Input
                    id="ob-home"
                    value={home}
                    onChange={(e) => setHome(e.target.value)}
                    spellCheck={false}
                    className="font-mono text-xs"
                  />
                  <Button variant="outline" onClick={() => void pickFolder(setHome)}>
                    <FolderOpen /> Choose
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Created if it does not exist. The default is fine for most people.
                </p>
              </div>
            </>
          )}

          {step === 'orchestrator' && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {plain
                  ? `${boss} is your clone. He reads your requests, breaks them into tasks and hands them to the right agent. He runs the floor; you still run him.`
                  : `${boss} is your clone — he triages requests, assigns tasks and manages the team, escalating only what needs you. Give him a longer-context, higher-capability model.`}
              </p>
              <div className="flex flex-col gap-2">
                {/* Only engines that can drain an inbox: an orchestrator on a
                    terminal-only engine would silently stop orchestrating. */}
                {AGENT_PROVIDER_PRESETS.filter((p) => canReceiveInbox(p.id)).map((p) => (
                  <PickCard
                    key={p.id}
                    selected={godProvider === p.id}
                    title={p.label}
                    desc={PROVIDER_BLURB[p.id] ?? p.label}
                    onClick={() => {
                      setGodProvider(p.id);
                      setGodModel(providerPreset(p.id).recommendedOrchestratorModel);
                    }}
                  />
                ))}
              </div>
              <div className="flex flex-col gap-2">
                <Label className="text-sm">Model</Label>
                <Select
                  value={godModel ?? ''}
                  onValueChange={(v) => setGodModel(v === '' ? undefined : v)}
                >
                  <SelectTrigger className="w-full" aria-label="Orchestrator model">
                    <SelectValue placeholder="CLI default" />
                  </SelectTrigger>
                  <SelectContent>
                    {modelsForProvider(godProvider).map((m) => (
                      <SelectItem key={m.id ?? 'cli-default'} value={m.id ?? ''}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {step === 'repos' && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {plain
                  ? 'Add your projects. A project is just a folder — code, documents, notes, anything you want agents to work with. Optional; you can add more later.'
                  : 'Add the repos agents should work in. Each folder becomes a project on the floor and several agents can share one. Optional; you can add more later.'}
              </p>
              <div className="flex flex-col gap-1">
                {repos.length === 0 && (
                  <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                    {plain ? 'No projects yet.' : 'No repos yet.'}
                  </p>
                )}
                {repos.map((r) => (
                  <div key={r} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={r}>{r}</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${r}`}
                      onClick={() => setRepos(repos.filter((x) => x !== r))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void pickFolder((p) => setRepos((cur) => cur.includes(p) ? cur : [...cur, p]))}
                >
                  <Plus /> {plain ? 'Add a project' : 'Add a repo'}
                </Button>
              </div>
            </>
          )}

          {step === 'permissions' && (
            <>
              <div className="flex flex-col gap-3">
                <h2 className="text-sm font-medium">How much can agents do on their own?</h2>
                <PickCard
                  selected={autoMode}
                  title={plain ? 'Let them work' : 'Autonomous'}
                  desc={plain
                    ? 'Agents get on with the job without asking permission for each step.'
                    : 'Agents run with their engine’s bypass-permissions flag. Fastest, and what the guardrails are for.'}
                  onClick={() => setAutoMode(true)}
                />
                <PickCard
                  selected={!autoMode}
                  title={plain ? 'Ask me first' : 'Ask first'}
                  desc={plain
                    ? 'Agents stop and check with you before doing anything significant.'
                    : 'Each engine’s default approval prompts stay on.'}
                  onClick={() => setAutoMode(false)}
                />
              </div>

              <div className="flex flex-col gap-3 border-t pt-4">
                <h2 className="text-sm font-medium">Reliability</h2>
                <CheckRow
                  id="ob-notifications"
                  label="Desktop notifications"
                  help="A banner when an agent needs you or a long run finishes."
                  checked={notifications}
                  onChange={async (v) => {
                    setNotifications(v); // optimistic
                    try { await window.cth.setNotifications(v); }
                    catch { setNotifications(!v); }
                  }}
                />
                <CheckRow
                  id="ob-login"
                  label="Open Office at login"
                  help="So scheduled work keeps running after a restart."
                  checked={openAtLogin}
                  onChange={async (v) => {
                    setOpenAtLogin(v);
                    // Reconcile to what the OS actually did, not to what we asked.
                    try { setOpenAtLogin(await window.cth.setLoginItem(v)); }
                    catch { setOpenAtLogin(!v); }
                  }}
                />
                <CheckRow
                  id="ob-keepawake"
                  label="Keep this Mac awake while agents run"
                  help="Scheduled missions fire on time while you are away. Costs battery — best on AC."
                  checked={strongKeepalive}
                  onChange={async (v) => {
                    setStrongKeepalive(v);
                    try {
                      const saved = await window.cth.updateConfig({ strongKeepalive: v });
                      setStrongKeepalive(saved.strongKeepalive === true);
                    } catch { setStrongKeepalive(!v); }
                  }}
                />
                {/* Subordinate to the keep-awake row above — indented to the
                    checkbox's text column so it reads as that row's footnote
                    rather than as another setting. */}
                <Button
                  variant="link"
                  size="sm"
                  className="-mt-2 ml-7 h-auto justify-start p-0 text-xs font-normal text-muted-foreground"
                  onClick={() => void window.cth.openExternal('x-apple.systempreferences:com.apple.preference.battery')}
                >
                  Open macOS energy settings
                </Button>
                <CheckRow
                  id="ob-stats"
                  label="Share anonymous usage stats"
                  help="No prompts, no code — just which features get used. Turn it off and nothing is ever sent."
                  checked={shareStats}
                  onChange={setShareStats}
                />
              </div>
            </>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t pt-4">
          {idx > 0 && (
            <Button variant="ghost" disabled={busy} onClick={() => setStep(STEPS[idx - 1])}>
              <ArrowLeft /> Back
            </Button>
          )}
          <div className="ml-auto">
            {step === 'permissions' ? (
              <Button disabled={busy} onClick={() => void finish()}>
                {busy ? 'Setting up…' : <><Check /> Finish setup</>}
              </Button>
            ) : (
              <Button
                disabled={!canAdvance || busy}
                onClick={() => {
                  // The home step is the one that can be empty in a way that
                  // only fails much later, so it is checked on the way out.
                  if (step === 'home' && !home.trim()) { setError('Pick a home folder first.'); return; }
                  setError(undefined);
                  setStep(STEPS[idx + 1]);
                }}
              >
                {step === 'welcome' ? 'Set it up' : 'Next'} <ArrowRight />
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

function title(step: Step, plain: boolean, boss: string): string {
  switch (step) {
    case 'persona': return 'Welcome to Office';
    case 'welcome': return 'Meet your office';
    case 'home': return plain ? 'A home for the app' : 'Harness home';
    case 'orchestrator': return plain ? 'Your clone' : `Your clone’s engine`;
    case 'repos': return plain ? 'Your projects' : 'Your repos';
    case 'permissions': return `Permissions — and how much ${boss} may do alone`;
  }
}

/** A large click target that is a choice, not a control — so it is a button
 *  with selected state rather than a hand-rolled radio. */
function PickCard({
  selected,
  title,
  desc,
  onClick
}: {
  selected: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary bg-selected' : 'hover:bg-accent'
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {selected && <Check className="size-3.5" />}
        {title}
      </span>
      <span className="text-xs leading-relaxed text-muted-foreground">{desc}</span>
    </button>
  );
}

/** Checkbox, not Switch: these are staged decisions on a setup form, and
 *  DESIGN-MODERN.md reserves Switch for controls that take effect instantly. */
function CheckRow({
  id,
  label,
  help,
  checked,
  onChange
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{help}</p>
      </div>
    </div>
  );
}
