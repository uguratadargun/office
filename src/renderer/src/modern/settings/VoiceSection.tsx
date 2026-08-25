import { useEffect, useState } from 'react';
import { bossName } from '@shared/bossName';
import { useStore } from '@/store/store';
import { Group, SectionHeader } from './Row';
import { TextRow, ToggleRow, SelectRow } from './fields';
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
  const boss = bossName(config.bossName);

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
