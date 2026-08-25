import { useEffect, useState } from 'react';
import { Plus, Trash2, Heart } from 'lucide-react';
import { useStore } from '@/store/store';
import { sortAgentsForList } from '@shared/agentOrder';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { Textarea } from '../components/ui/textarea';
import { Field, IntervalPicker, MonoLine, RowDisclosure, TriggerRow } from './controls';
import { fmtInterval, relTime } from './interval';

/**
 * SCHEDULES — recurring auto-dispatched missions, the oldest trigger type.
 *
 * The list is main's; every act is optimistic and fire-and-forget (`missions:save`
 * keeps only what the renderer sends back, so deleting is "save the list without
 * it"). The prompt is the mission, so it is visible on the closed row and
 * editable on the open one.
 */

/** Mirrors `ScheduledMission` in src/main/config.ts (and preload). Declared here
 *  so this component owns no cross-package import — same as the pixel section. */
interface ScheduledMission {
  id: string;
  label: string;
  intervalMs: number;
  to: string;
  body: string;
  enabled: boolean;
  autoCompact?: boolean;
  lastFiredAt?: number;
  kind?: 'dispatch' | 'heartbeat' | 'compact';
  quietThresholdMs?: number;
}

const DEFAULT_INTERVAL_MS = 3_600_000;

export function SchedulesSection({ onSummary }: { onSummary: (s: string) => void }) {
  const agents = useStore((s) => s.agents);
  const boss = useStore((s) => s.bossName);
  const [missions, setMissions] = useState<ScheduledMission[]>([]);
  const [adding, setAdding] = useState(false);
  const [mLabel, setMLabel] = useState('');
  const [mInterval, setMInterval] = useState(DEFAULT_INTERVAL_MS);
  const [mTo, setMTo] = useState('god');
  const [mBody, setMBody] = useState('');

  useEffect(() => {
    const load = () => { window.cth.listMissions().then(setMissions).catch(() => { /* noop */ }); };
    load();
    // Refresh "last fired" when the scheduler stamps a beat/dispatch.
    return window.cth.onMissionsUpdated(load);
  }, []);

  useEffect(() => {
    const on = missions.filter((m) => m.enabled).length;
    onSummary(missions.length === 0 ? 'none' : `${on} of ${missions.length} on`);
  }, [missions, onSummary]);

  const persist = (next: ScheduledMission[]) => {
    setMissions(next);
    void window.cth.saveMissions(next).catch(() => { /* noop */ });
  };
  const patch = (id: string, fields: Partial<ScheduledMission>) =>
    persist(missions.map((m) => (m.id === id ? { ...m, ...fields } : m)));
  const remove = (id: string) => persist(missions.filter((m) => m.id !== id));

  const add = () => {
    if (!mLabel.trim() || !mBody.trim()) return;
    persist([...missions, {
      id: `m_${Date.now().toString(36)}`,
      label: mLabel.trim(),
      intervalMs: mInterval,
      to: mTo,
      body: mBody.trim(),
      enabled: true
    }]);
    setMLabel(''); setMBody(''); setAdding(false);
  };

  const targetName = (to: string) =>
    to === 'broadcast' ? 'everyone' : to === 'god' ? boss : agents.find((a) => a.id === to)?.name ?? to;

  return (
    <>
      {missions.length === 0 && (
        <p className="text-[13px] text-muted-foreground">
          Nothing is scheduled yet. Add one and it runs on its own clock.
        </p>
      )}
      {missions.map((m) => (
        <MissionRow
          key={m.id}
          mission={m}
          targetName={targetName}
          agents={agents}
          boss={boss}
          onPatch={(fields) => patch(m.id, fields)}
          onDelete={() => remove(m.id)}
        />
      ))}

      {!adding && (
        <div>
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus /> Add a schedule
          </Button>
        </div>
      )}
      {adding && (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <p className="text-[12px] font-medium text-muted-foreground">NEW SCHEDULE</p>
          <Field label="Label">
            <Input value={mLabel} onChange={(e) => setMLabel(e.target.value)} placeholder="What this run is for" className="h-8" />
          </Field>
          <Field label="Goes to">
            <TargetSelect value={mTo} onChange={setMTo} agents={agents} boss={boss} />
          </Field>
          <Field label="Every">
            <IntervalPicker value={mInterval} onChange={setMInterval} />
          </Field>
          <Field label="Prompt">
            <Textarea
              value={mBody}
              onChange={(e) => setMBody(e.target.value)}
              rows={3}
              placeholder="Sent word for word on every run."
              className="font-mono text-[12px]"
            />
          </Field>
          <div className="flex gap-2">
            <Button size="sm" onClick={add} disabled={!mLabel.trim() || !mBody.trim()}>Add</Button>
            <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setMLabel(''); setMBody(''); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

/* ─────────────────────────────── one mission ─────────────────────────────── */

// `sleeping` is carried so this picker can sink hibernated agents to the bottom
// like every other agent list; the parent passes the store's Agent.
interface RosterAgent { id: string; name: string; isGod?: boolean; sleeping?: boolean }

function TargetSelect({ value, onChange, agents, boss }: {
  value: string; onChange: (v: string) => void; agents: RosterAgent[]; boss: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-full" aria-label="Goes to"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="broadcast">everyone</SelectItem>
        <SelectItem value="god">{boss}</SelectItem>
        {sortAgentsForList(agents.filter((a) => !a.isGod)).map((a) => (
          <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MissionRow({ mission, targetName, agents, boss, onPatch, onDelete }: {
  mission: ScheduledMission;
  targetName: (to: string) => string;
  agents: RosterAgent[];
  boss: string;
  onPatch: (fields: Partial<ScheduledMission>) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(mission.label);
  const [to, setTo] = useState(mission.to);
  const [intervalMs, setIntervalMs] = useState(mission.intervalMs);
  const [body, setBody] = useState(mission.body);
  const [saved, setSaved] = useState(false);

  // Seed the draft when the row opens — never on every render, or the scheduler
  // stamping `lastFiredAt` mid-edit would wipe what you are typing.
  useEffect(() => {
    if (!open) return;
    setLabel(mission.label);
    setTo(mission.to);
    setIntervalMs(mission.intervalMs);
    setBody(mission.body);
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const heartbeat = mission.kind === 'heartbeat';
  const dirty = label !== mission.label || to !== mission.to
    || intervalMs !== mission.intervalMs || body !== mission.body;

  const fired = mission.lastFiredAt ? `fired ${relTime(Date.now() - mission.lastFiredAt)}` : 'not yet fired';
  const next = mission.enabled && mission.lastFiredAt
    ? ` · next ${relTime(Date.now() - (mission.lastFiredAt + mission.intervalMs))}`
    : '';

  const save = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    // Fold the trim back into the draft too, or the row reads as still dirty
    // against a label that was only ever going to be stored trimmed.
    setLabel(trimmed);
    onPatch({ label: trimmed, to, intervalMs, body });
    setSaved(true);
    setTimeout(() => setSaved(false), 1300);
  };

  return (
    <TriggerRow
      open={open}
      onOpenChange={setOpen}
      resting={<MonoLine>{mission.body.trim() || 'No prompt set.'}</MonoLine>}
      header={
        <div className="flex items-center gap-2">
          <RowDisclosure open={open} label={mission.label} />
          <Badge variant={mission.enabled ? 'default' : 'secondary'} className="shrink-0 gap-1 font-normal">
            {heartbeat && <Heart className="size-3" />}
            {heartbeat ? 'beat' : fmtInterval(mission.intervalMs)}
          </Badge>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px]">{mission.label}</span>
            <span className="truncate text-[12px] text-muted-foreground">
              → {targetName(mission.to)} · {fired}{next}
            </span>
          </span>
          <Switch
            checked={mission.enabled}
            onCheckedChange={(enabled) => onPatch({ enabled })}
            aria-label={`Enable ${mission.label}`}
          />
        </div>
      }
    >
      <Field label="Label">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-8" />
      </Field>
      <Field label="Goes to">
        <TargetSelect value={to} onChange={setTo} agents={agents} boss={boss} />
      </Field>
      <Field
        label="Every"
        hint={heartbeat ? 'The beat adapts to how quiet the floor is, so this is the ceiling, not the exact gap.' : undefined}
      >
        <IntervalPicker value={intervalMs} onChange={setIntervalMs} />
      </Field>
      <Field label="Prompt">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder="Sent word for word on every run."
          className="font-mono text-[12px]"
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={!dirty || !label.trim()}>
          {saved && !dirty ? 'Saved' : 'Save'}
        </Button>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive">
          <Trash2 /> Delete
        </Button>
      </div>
    </TriggerRow>
  );
}
