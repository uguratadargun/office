import { useEffect, useState } from 'react';
import { bossName } from '@shared/bossName';
import { useStore } from '@/store/store';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Group, SectionHeader } from './Row';
import { TextRow, ToggleRow, SelectRow, ActionRow } from './fields';
import type { ConfigApi } from './useConfig';

/** Idle auto-disconnect, as durations rather than a millisecond box: the value
 *  is a timeout the user thinks about in minutes, and 0 is a real choice
 *  ("never") rather than an empty field. */
const IDLE_CHOICES = [
  { value: '60000', label: '1 minute' },
  { value: '180000', label: '3 minutes' },
  { value: '300000', label: '5 minutes' },
  { value: '600000', label: '10 minutes' },
  { value: '0', label: 'Never — stay connected' }
];
const DEFAULT_IDLE_MS = 180000;

export function VoiceSection({ api }: { api: ConfigApi }) {
  const { config, reload } = api;
  const setFreeflowEnabled = useStore((s) => s.setFreeflowEnabled);
  const setHasGroqKey = useStore((s) => s.setHasGroqKey);
  const [idle, setIdle] = useState(String(config?.realtimeIdleDisconnectMs ?? DEFAULT_IDLE_MS));
  useEffect(() => {
    setIdle(String(config?.realtimeIdleDisconnectMs ?? DEFAULT_IDLE_MS));
  }, [config?.realtimeIdleDisconnectMs]);

  if (!config) return null;
  const boss = bossName(config);

  /** Free Flow has its own IPC because the key goes to the secret broker, not
   *  to config — and the store mirror is what the dictation button reads, so
   *  both have to move together or the button lies about being available. */
  const setFreeflow = async (patch: { enabled?: boolean; apiKey?: string; model?: string }) => {
    await window.cth.freeflowSetConfig(patch);
    if (patch.enabled !== undefined) setFreeflowEnabled(patch.enabled);
    if (patch.apiKey !== undefined) setHasGroqKey(patch.apiKey.trim().length > 0);
    await reload();
  };

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader title="Voice" blurb={`Dictation into any prompt, and a live voice channel with ${boss}.`} />

      <Group title="Free Flow" description="Hold a key, talk, and your words land in the prompt. Transcription runs on Groq.">
        <ToggleRow
          id="set-freeflow-on"
          label="Free Flow (voice dictation)"
          checked={!!config.freeflowEnabled}
          onChange={(v) => setFreeflow({ enabled: v })}
        />
        <TextRow
          id="set-groqkey"
          label="Groq API key"
          help="Stored in the secret broker, never read back. Free keys at console.groq.com."
          type="password"
          monospace
          value={config.groqApiKey ?? ''}
          placeholder="gsk_…"
          onCommit={(v) => setFreeflow({ apiKey: v.trim() })}
        />
        <TextRow
          id="set-freeflow-model"
          label="Transcription model"
          help="Blank uses the bundled default."
          monospace
          value={config.freeflowModel ?? ''}
          onCommit={(v) => setFreeflow({ model: v.trim() })}
        />
      </Group>

      <Group
        title={`Realtime ${boss}`}
        description="A spoken conversation with the orchestrator. The cost cap stays the runaway guard; this is the politeness one."
      >
        <OpenAiKeyRow boss={boss} />
        <SelectRow
          id="set-realtime-idle"
          label="Idle auto-disconnect"
          help="Hang up after this long with nobody speaking, so an open mic does not bill all afternoon."
          value={idle}
          choices={IDLE_CHOICES}
          onChange={async (v) => {
            setIdle(v);
            await window.cth.updateConfig({ realtimeIdleDisconnectMs: Number(v) });
            await reload();
          }}
        />
      </Group>
    </div>
  );
}


/**
 * The OpenAI key Realtime runs on — MD-94 S1: modern Settings had no field for
 * it anywhere, so the mic was permanently disabled with a reason ("no OpenAI
 * key") pointing at a control that did not exist. A modern-only install could
 * never turn voice on.
 *
 * Write-only, like every other secret here: `providerKeySet` takes the key and
 * nothing ever reads one back, so presence is a boolean from
 * `realtimeHasOpenAiKey()` and the box is always empty on open. Saving mirrors
 * that boolean into the store, which is what the topbar mic reads — otherwise
 * the key saves and the mic stays greyed out until the next launch.
 *
 * It is the SAME broker slot the Agents & Models engine keys write
 * (`apikey:openai`); setting it in either place is enough.
 */
function OpenAiKeyRow({ boss }: { boss: string }) {
  const hasKey = useStore((s) => s.hasOpenAiKey);
  const setHasKey = useStore((s) => s.setHasOpenAiKey);
  const [key, setKey] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.cth.realtimeHasOpenAiKey()
      .then((v) => { if (!cancelled) setHasKey(!!v); })
      .catch(() => { /* treated as "no key" — the row already says so */ });
    return () => { cancelled = true; };
  }, [setHasKey]);

  const save = async () => {
    const value = key.trim();
    if (!value) return;
    setBusy(true);
    try {
      const r = await window.cth.providerKeySet({ backend: 'openai', key: value });
      if (r.ok) { setKey(''); setHasKey(true); setNote('Key saved.'); }
      else setNote(r.error ?? 'Could not save the key.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ActionRow
      id="set-openaikey"
      label="OpenAI API key"
      help={`Talking to ${boss} runs on OpenAI's Realtime API — a different service from the Claude subscription your agents use, so it needs its own key. Encrypted on this machine and never shown again; each session mints a short-lived token from it.`}
    >
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <Input
            type="password"
            value={key}
            spellCheck={false}
            placeholder={hasKey ? 'key saved — paste a new one to replace it' : 'sk-…'}
            className="w-64 font-mono text-[12px]"
            onChange={(e) => { setKey(e.target.value); setNote(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
            aria-label="OpenAI API key"
          />
          <Button size="sm" variant="outline" disabled={busy || !key.trim()} onClick={() => void save()}>
            Save
          </Button>
        </div>
        <span aria-live="polite" className="text-[12px] text-muted-foreground">
          {note || (hasKey ? 'Key saved — voice is ready.' : 'No key yet — voice stays disabled.')}
        </span>
      </div>
    </ActionRow>
  );
}
