import { useEffect, useState } from 'react';
import { Brain } from 'lucide-react';
import { CONDENSE_VERIFIED } from '@shared/condense';
import { navigate } from '../navigation';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Group, SectionHeader } from './Row';
import { TextRow, ToggleRow, SelectRow, ActionRow } from './fields';
import { numOrUndefined, type ConfigApi } from './useConfig';

/** Defaults mirror `src/main/config.ts` so the boxes show what the scheduler
 *  will actually use, not blanks that read as "off". */
const D = {
  intervalMs: 1_800_000,
  bytePct: 50,
  sections: 50,
  keep: 12,
  minBytes: 16_384
};

export function MemorySection({ api }: { api: ConfigApi }) {
  const { config, save } = api;
  const [docs, setDocs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const kgEnabled = !!config?.knowledgeGraph?.enabled;
  useEffect(() => {
    if (!kgEnabled) { setDocs(null); return; }
    let cancelled = false;
    window.cth.kgStatus()
      .then((s) => { if (!cancelled) setDocs(s.docCount); })
      .catch(() => { /* status unavailable — the count just stays blank */ });
    return () => { cancelled = true; };
  }, [kgEnabled]);

  if (!config) return null;
  const on = config.reflectEnabled !== false;

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader title="Memory & Knowledge" blurb="What agents remember between sessions, and what they can look up." />

      <Group title="Semantic memory">
        {/* The settings are here; what they produce is a whole view away, and
            until MD-138 the modern UI had no route to it at all. */}
        <ActionRow
          id="set-memory-open"
          label="Agent memory"
          help="Read what each agent has written down, search it, and see who has been talking to whom."
        >
          <Button variant="outline" size="sm" onClick={() => navigate('memory')}>
            <Brain /> Open Memory
          </Button>
        </ActionRow>
        <ToggleRow
          id="set-semantic"
          label="Cross-session recall"
          help="Agents search a shared memory palace built from everyone's notes, instead of starting each task cold."
          checked={!!config.semanticMemory}
          onChange={(v) => save({ semanticMemory: v })}
        />
      </Group>

      <Group title="Knowledge Graph" description="A local, multimodal index of documents you add — agents query it as context.">
        <ToggleRow
          id="set-kg"
          label="Enterprise knowledge base"
          checked={kgEnabled}
          onChange={(v) => save({ knowledgeGraph: { ...(config.knowledgeGraph ?? {}), enabled: v } })}
        />
        {kgEnabled && (
          <ActionRow id="set-kg-docs" label="Indexed documents" help="Add files and Office extracts, chunks and embeds them. Browse opens Memory › Knowledge.">
            <div className="flex items-center gap-2">
              {docs !== null && (
                <Badge variant="secondary" className="font-normal">
                  {docs} {docs === 1 ? 'document' : 'documents'}
                </Badge>
              )}
              {/* Adding was the only knowledge operation modern had; the list,
                  the search and the remove live in Memory › Knowledge (MD-157). */}
              <Button variant="ghost" size="sm" onClick={() => navigate('memory', { section: 'knowledge' })}>
                Browse
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await window.cth.kgAddFiles();
                    const s = await window.cth.kgStatus();
                    setDocs(s.docCount);
                  } catch { /* the dialog was cancelled, or ingest failed */ }
                  finally { setBusy(false); }
                }}
              >
                {busy ? 'Adding…' : 'Add files'}
              </Button>
            </div>
          </ActionRow>
        )}
      </Group>

      <Group
        title="Memory condenser"
        description="Rewrites long agent memory files so they keep fitting in context. It edits what agents remember, which is why it has an off switch and visible thresholds."
      >
        <ToggleRow
          id="set-reflect-on"
          label="Condense agent memory"
          checked={on}
          onChange={(v) => save({ reflectEnabled: v })}
        />
        {/* Minutes and kilobytes on screen, milliseconds and bytes on disk. A
            30-minute cadence typed as 1800000 is a setting nobody checks. */}
        <TextRow
          id="set-reflect-interval"
          label="Scan every"
          help="Minutes between sweeps of the agents' memory files."
          type="number"
          disabled={!on}
          value={String(Math.round((config.reflectIntervalMs ?? D.intervalMs) / 60_000))}
          onCommit={(v) => {
            const m = numOrUndefined(v);
            return m === undefined ? undefined : save({ reflectIntervalMs: m * 60_000 });
          }}
        />
        <TextRow
          id="set-reflect-bytepct"
          label="Condense above"
          help="Percent of the 128 KB budget a file must exceed before it is condensed."
          type="number"
          disabled={!on}
          value={String(config.reflectByteTriggerPct ?? D.bytePct)}
          onCommit={(v) => {
            const n = numOrUndefined(v);
            return n === undefined ? undefined : save({ reflectByteTriggerPct: n });
          }}
        />
        <TextRow
          id="set-reflect-sections"
          label="Or above section count"
          help="…or when the file has more than this many headings and is over the size floor."
          type="number"
          disabled={!on}
          value={String(config.reflectSectionTrigger ?? D.sections)}
          onCommit={(v) => {
            const n = numOrUndefined(v);
            return n === undefined ? undefined : save({ reflectSectionTrigger: n });
          }}
        />
        <TextRow
          id="set-reflect-keep"
          label="Keep newest sections verbatim"
          help="How many recent sections survive a condense untouched."
          type="number"
          disabled={!on}
          value={String(config.reflectRecentKeep ?? D.keep)}
          onCommit={(v) => {
            const n = numOrUndefined(v);
            return n === undefined ? undefined : save({ reflectRecentKeep: n });
          }}
        />
        <TextRow
          id="set-reflect-min"
          label="Never condense below"
          help="Kilobytes. Also the size floor for the section trigger above."
          type="number"
          disabled={!on}
          value={String(Math.round((config.reflectMinBytes ?? D.minBytes) / 1024))}
          onCommit={(v) => {
            const kb = numOrUndefined(v);
            return kb === undefined ? undefined : save({ reflectMinBytes: kb * 1024 });
          }}
        />
        <SelectRow
          id="set-reflect-engine"
          label="Fallback condense engine"
          help="Used only for agents whose own engine has no verified one-shot form. Every other agent condenses with its own."
          disabled={!on}
          value={config.reflectCondenseProvider ?? 'claude'}
          choices={CONDENSE_VERIFIED.map((p) => ({ value: p, label: p }))}
          onChange={(v) => save({ reflectCondenseProvider: v })}
        />
      </Group>
    </div>
  );
}
