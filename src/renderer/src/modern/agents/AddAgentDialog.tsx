import { useEffect, useMemo, useState } from 'react';
import { FileUp, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { baseName } from '@shared/pathLabel';
import { useStore } from '@/store/store';
import {
  AGENT_PROVIDER_PRESETS, buildSpawnCommand, effortLevelsFor, modelsForProvider,
  providerPreset, tokenizeCommand, type AgentProvider, type HarnessConfig
} from '@/store/config';
import { OFFICE_CAST, DEFAULT_CHARACTER, type OfficeCharacterName } from '@/scene/office/cast';
import type { AccentColorName } from '@/design/tokens';
import { Button } from '../components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Textarea } from '../components/ui/textarea';

const ACCENTS: AccentColorName[] = ['coral', 'mint', 'sky', 'lemon', 'lilac', 'peach'];

/** Same id shape the pixel modal mints, so an agent hired from either UI looks
 *  identical to the hive, the ledger and the registry. */
function uniqueId(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
}

/**
 * Hire an agent, or edit one that already exists.
 *
 * Four sections rather than a wizard: every field is reachable at any time,
 * because the one that most often needs correcting — the command — is the last
 * one a wizard would show you.
 */
export function AddAgentDialog() {
  const open = useStore((s) => s.addAgentOpen);
  const setOpen = useStore((s) => s.setAddAgentOpen);
  const editId = useStore((s) => s.editAgentId);
  const setEditId = useStore((s) => s.setEditAgentId);
  const agents = useStore((s) => s.agents);
  const addAgent = useStore((s) => s.addAgent);
  const updateAgent = useStore((s) => s.updateAgent);
  const editing = editId ? agents.find((a) => a.id === editId) : undefined;
  const isOpen = open || !!editing;

  const [config, setConfig] = useState<HarnessConfig | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    window.cth.getConfig().then(setConfig).catch(() => setConfig(null));
  }, [isOpen]);

  if (!isOpen || !config) return null;

  const close = () => { setOpen(false); setEditId(null); };
  return (
    <Dialog open onOpenChange={(v) => { if (!v) close(); }}>
      <Form
        key={editing?.id ?? 'new'}
        config={config}
        editing={editing}
        onClose={close}
        onCreated={addAgent}
        onEdited={updateAgent}
      />
    </Dialog>
  );
}

type Editing = ReturnType<typeof useStore.getState>['agents'][number] | undefined;

function Form({ config, editing, onClose, onCreated, onEdited }: {
  config: HarnessConfig;
  editing: Editing;
  onClose: () => void;
  onCreated: (a: Parameters<ReturnType<typeof useStore.getState>['addAgent']>[0]) => void;
  onEdited: (id: string, patch: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [character, setCharacter] = useState<OfficeCharacterName>(
    (OFFICE_CAST.some((m) => m.name === editing?.character) ? editing!.character : DEFAULT_CHARACTER) as OfficeCharacterName
  );
  const [accent, setAccent] = useState<AccentColorName>(
    ACCENTS.includes(editing?.accent as AccentColorName) ? (editing!.accent as AccentColorName) : 'sky'
  );
  const [cwd, setCwd] = useState(editing?.cwd ?? config.registeredRepos?.[0] ?? '');
  const [isolate, setIsolate] = useState(false);
  const [resumeSessionId, setResumeSessionId] = useState('');
  const [provider, setProvider] = useState<AgentProvider>((editing?.provider ?? 'claude') as AgentProvider);
  const [model, setModel] = useState<string | undefined>(editing?.model);
  const [effort, setEffort] = useState<string | undefined>(editing?.effort);
  const [description, setDescription] = useState(editing?.description ?? '');
  const [goal, setGoal] = useState(editing?.goal ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [imported, setImported] = useState<string | null>(null);

  /**
   * Hire manifest → the form. The documented hand-off ("here is a role, hire
   * it") had no entry point in this UI at all, so a manifest could only be
   * imported by switching back to the pixel Add-Agent modal.
   *
   * It fills FIELDS and nothing else: the command is rebuilt locally from the
   * provider preset, so a manifest can never inject the spawn binary, and
   * import never spawns — you still press Add.
   */
  const importHire = async () => {
    setError(undefined);
    const res = await window.cth.importHireFile();
    if (!res.ok || !res.manifest) {
      if (res.error && res.error !== 'cancelled') setError(res.error);
      return;
    }
    const m = res.manifest;
    setName(m.name);
    if (m.character && OFFICE_CAST.some((c) => c.name === m.character)) setCharacter(m.character as OfficeCharacterName);
    if (m.accent && ACCENTS.includes(m.accent as AccentColorName)) setAccent(m.accent as AccentColorName);
    if (m.provider) setProvider(m.provider as AgentProvider);
    setModel(m.model);
    if (m.description) setDescription(m.description);
    setGoal(m.goal ?? '');
    setIsolate(m.isolate ?? false);
    setImported(`${m.name}${m.author ? ` · by ${m.author}` : ''}`);
  };

  const efforts = effortLevelsFor(provider);
  const models = useMemo(() => modelsForProvider(provider), [provider]);
  // Shown, not hidden: the command is what actually runs, and a hire manifest or
  // a provider switch can put something surprising in it.
  const command = useMemo(
    () => buildSpawnCommand(config, model, provider, effort),
    [config, model, provider, effort]
  );

  const pickFolder = async () => {
    const res = await window.cth.chooseFolder();
    if (res.ok) setCwd(res.path);
  };

  const submit = async () => {
    if (!name.trim()) { setError('A name is required.'); return; }
    if (!cwd.trim()) { setError('A working folder is required.'); return; }
    setBusy(true);
    setError(undefined);
    try {
      if (editing) {
        await window.cth.hiveUpdateAgentMeta(editing.id, {
          name: name.trim(), role: description.trim(), cwd: cwd.trim()
        });
        onEdited(editing.id, { name: name.trim(), description: description.trim(), cwd: cwd.trim(), goal, character, accent });
        toast(`${name.trim()} updated`);
        onClose();
        return;
      }
      const id = uniqueId(name.trim());
      const ptyId = `pty-${id}`;
      const [exe, ...args] = tokenizeCommand(command.trim());
      const resuming = !!resumeSessionId.trim();
      const res = await window.cth.spawnPty({
        id: ptyId,
        cwd: cwd.trim(),
        command: exe,
        args,
        provider,
        cols: 100,
        rows: 30,
        // `--resume` needs the real cwd's transcript, so a fresh worktree (which
        // has an empty project dir) and a resume are mutually exclusive.
        isolate: resuming ? false : isolate,
        resumeSessionId: resuming ? resumeSessionId.trim() : undefined,
        hive: { id, name: name.trim(), provider, cwd: cwd.trim(), role: description.trim() || undefined }
      });
      if (!res.ok) { setError(res.error ?? 'Spawn failed.'); return; }
      // Main expands `~` and echoes back the path it really spawned into —
      // record THAT, so this agent's cwd matches the hive registry.
      const realCwd = res.cwd ?? cwd.trim();
      onCreated({
        id, name: name.trim(), character, accent, description: description.trim(),
        // MD-125: `split('/')` finds nothing in `C:\\Users\\…`, so the "short
        // label" written into the roster was the WHOLE path — and `project` is
        // what the rail, the detail subtitle and the floor all show.
        project: baseName(realCwd), tmuxTarget: '', cwd: realCwd, goal,
        status: 'idle', action: 'starting…', progress: 0, ptyId, provider, model, effort,
        command: command.trim()
      } as Parameters<typeof onCreated>[0]);
      if (resuming && res.resumeNotFound) {
        toast(`Session "${resumeSessionId.trim()}" was not found — started a fresh one.`);
      }
      toast(`${name.trim()} is on the floor`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{editing ? `Edit ${editing.name}` : 'Add an agent'}</DialogTitle>
        <DialogDescription>
          {editing
            ? 'Identity and briefing only — the engine is changed by restarting from the roster.'
            : 'Spawns a real process in the folder you pick and registers it with the hive.'}
        </DialogDescription>
      </DialogHeader>

      {!editing && (
        <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {imported ? `Imported ${imported} — review and press Add.` : 'Hiring from a manifest someone sent you?'}
          </span>
          <span className="flex-1" />
          <Button size="xs" variant="outline" onClick={() => void importHire()}>
            <FileUp /> Import hire file
          </Button>
        </div>
      )}

      <Tabs defaultValue="identity">
        <TabsList>
          <TabsTrigger value="identity">Identity</TabsTrigger>
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          <TabsTrigger value="engine" disabled={!!editing}>Engine</TabsTrigger>
          <TabsTrigger value="briefing">Briefing</TabsTrigger>
        </TabsList>

        <TabsContent value="identity" className="flex flex-col gap-4 pt-4">
          <Field label="Name" htmlFor="agent-name">
            <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Character">
              <Picker value={character} onChange={(v) => setCharacter(v as OfficeCharacterName)} options={OFFICE_CAST.map((m) => m.name)} />
            </Field>
            <Field label="Colour">
              <Picker value={accent} onChange={(v) => setAccent(v as AccentColorName)} options={ACCENTS} />
            </Field>
          </div>
        </TabsContent>

        <TabsContent value="workspace" className="flex flex-col gap-4 pt-4">
          <Field label="Folder" htmlFor="agent-cwd">
            <div className="flex gap-2">
              <Input id="agent-cwd" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/path/to/your/project" />
              <Button type="button" variant="outline" onClick={() => void pickFolder()}><FolderOpen /> Browse</Button>
            </div>
          </Field>
          {!!config.registeredRepos?.length && (
            <div className="flex flex-wrap gap-1">
              {config.registeredRepos.map((r) => (
                <Button key={r} size="xs" variant={r === cwd ? 'secondary' : 'ghost'} onClick={() => setCwd(r)}>
                  {baseName(r)}
                </Button>
              ))}
            </div>
          )}
          {!editing && (
            <>
              <label className="flex items-center justify-between gap-4 text-sm">
                <span>
                  Own git worktree
                  <span className="block text-xs text-muted-foreground">Isolates this agent's edits from the rest of the floor.</span>
                </span>
                <Switch checked={isolate} disabled={!!resumeSessionId.trim()} onCheckedChange={setIsolate} />
              </label>
              <Field label="Resume a session" htmlFor="agent-resume">
                <Input
                  id="agent-resume"
                  value={resumeSessionId}
                  onChange={(e) => setResumeSessionId(e.target.value)}
                  placeholder="paste a Claude session id to continue its conversation"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  A resume needs the real folder's transcript, so it turns the worktree off.
                </p>
              </Field>
            </>
          )}
        </TabsContent>

        <TabsContent value="engine" className="flex flex-col gap-4 pt-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Provider">
              <Picker
                value={provider}
                onChange={(v) => { setProvider(v as AgentProvider); setModel(undefined); setEffort(undefined); }}
                options={AGENT_PROVIDER_PRESETS.map((p) => p.id)}
                labels={Object.fromEntries(AGENT_PROVIDER_PRESETS.map((p) => [p.id, p.label]))}
              />
            </Field>
            {providerPreset(provider).supportsModel && (
              <Field label="Model">
                <Picker
                  value={model ?? 'default'}
                  onChange={(v) => setModel(v === 'default' ? undefined : v)}
                  options={models.map((m) => m.id ?? 'default')}
                  labels={Object.fromEntries(models.map((m) => [m.id ?? 'default', m.label]))}
                />
              </Field>
            )}
          </div>
          {efforts && (
            <Field label="Reasoning effort">
              <Picker
                value={effort ?? 'default'}
                onChange={(v) => setEffort(v === 'default' ? undefined : v)}
                options={['default', ...efforts]}
                labels={{ default: 'provider default' }}
              />
            </Field>
          )}
          <Field label="Command">
            <Input readOnly value={command} className="font-mono text-xs" />
            <p className="mt-1 text-xs text-muted-foreground">Built from the choices above. This is what actually runs.</p>
          </Field>
        </TabsContent>

        <TabsContent value="briefing" className="flex flex-col gap-4 pt-4">
          <Field label="What is this agent for?" htmlFor="agent-desc">
            <Input id="agent-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="repo janitor" />
          </Field>
          <Field label="Standing goal" htmlFor="agent-goal">
            <Textarea
              id="agent-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={3}
              placeholder="long-running directive injected on every prompt"
            />
          </Field>
        </TabsContent>
      </Tabs>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={() => void submit()}>
          {editing ? 'Save' : 'Hire'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function Picker({ value, onChange, options, labels }: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  labels?: Record<string, string>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o} value={o}>{labels?.[o] ?? o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
