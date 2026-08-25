import { useEffect, useState } from 'react';
import { PROVIDER_KEY_BACKENDS } from '@shared/providerKeys';
import { useStore } from '@/store/store';
import type { AgentProvider, HarnessConfig } from '@/store/config';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import type { ConfigApi } from './useConfig';

/**
 * BYOK engine credentials and endpoints — the panel MD-93 found had zero callers
 * anywhere under `modern/`.
 *
 * The consequence was not cosmetic: onboarding offers ten orchestrator engines,
 * and a modern-only install could authenticate none of them. `providerKeySet`,
 * `providerKeyHas` and `providerKeyClear` were unreachable, so Codex, Grok,
 * Kimi, Antigravity, OpenCode, Crush, Pi and Qwen had no way to receive a key
 * and no way to be pointed at a local endpoint.
 *
 * Two stores, by what the datum IS — the same split the pixel panel makes:
 *   - API keys go to the secret broker over `providerKey:*`, keyed by the
 *     BACKEND model-provider. WRITE-ONLY: only a presence boolean ever comes
 *     back, so a field can say "set" and never show the value.
 *   - Base URL and default model are ordinary config (`providerBaseUrls`,
 *     `providerDefaultModels`), keyed by CLI engine.
 *
 * The backend table is imported from `@shared/providerKeys`, which main
 * validates against too — it used to be a copy in each UI with a comment asking
 * the next editor to keep them in sync, and a row main rejects as "unknown
 * backend" is indistinguishable from a save that worked.
 */

/** CLI engines that take a per-engine local base URL + default model. */
const CLIS: Array<{ id: AgentProvider; label: string; hint: string }> = [
  { id: 'opencode', label: 'OpenCode', hint: 'http://localhost:11434/v1 (Ollama) — injected as a local provider' },
  { id: 'crush', label: 'Crush', hint: 'OpenAI-compatible endpoint — used as the proxy upstream' },
  { id: 'pi', label: 'Pi', hint: 'local models are file-based (models.json); base URL reserved' },
  { id: 'qwen', label: 'Qwen', hint: 'OpenAI-compatible endpoint — used as the proxy upstream' }
];

export function AiEnginesPanel({ api }: { api: ConfigApi }) {
  const config = api.config as HarnessConfig | null;
  const setHasOpenAiKey = useStore((s) => s.setHasOpenAiKey);
  const [hasKey, setHasKey] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});

  // Presence only — the plaintext is never fetched, here or anywhere.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const out: Record<string, boolean> = {};
      for (const b of PROVIDER_KEY_BACKENDS) {
        try { out[b.id] = await window.cth.providerKeyHas(b.id); } catch { out[b.id] = false; }
      }
      if (alive) setHasKey(out);
    })();
    return () => { alive = false; };
  }, []);

  if (!config) return null;

  const flash = (backend: string, msg: string) => {
    setNote((s) => ({ ...s, [backend]: msg }));
    window.setTimeout(() => setNote((s) => ({ ...s, [backend]: '' })), 2000);
  };

  const saveKey = async (backend: string) => {
    const key = (draft[backend] ?? '').trim();
    if (!key) return;
    try {
      const r = await window.cth.providerKeySet({ backend, key });
      if (!r.ok) { flash(backend, r.error ?? 'Could not save.'); return; }
      setHasKey((s) => ({ ...s, [backend]: true }));
      setDraft((s) => ({ ...s, [backend]: '' }));
      flash(backend, 'Saved.');
      // apikey:openai is the SAME slot Voice mints its Realtime token from, so
      // the mic's gate has to move with it or it stays disabled until relaunch.
      if (backend === 'openai') setHasOpenAiKey(true);
    } catch (e) {
      flash(backend, e instanceof Error ? e.message : String(e));
    }
  };

  const clearKey = async (backend: string) => {
    try {
      await window.cth.providerKeyClear(backend);
      setHasKey((s) => ({ ...s, [backend]: false }));
      flash(backend, 'Cleared.');
      if (backend === 'openai') setHasOpenAiKey(false);
    } catch { flash(backend, 'Could not clear.'); }
  };

  /** A blank box CLEARS the entry rather than storing '' — an empty string as a
   *  base URL would be spliced into a request as a valid-looking origin. */
  const saveEndpoint = async (
    field: 'providerBaseUrls' | 'providerDefaultModels',
    id: AgentProvider,
    value: string
  ) => {
    const current = { ...(config[field] ?? {}) } as Partial<Record<AgentProvider, string>>;
    const trimmed = value.trim();
    if (trimmed) current[id] = trimmed; else delete current[id];
    await api.save({ [field]: current } as Partial<HarnessConfig>);
  };

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-col divide-y divide-border/60 rounded-lg border">
        {PROVIDER_KEY_BACKENDS.map((b) => (
          <div key={b.id} className="flex flex-col gap-1.5 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Label htmlFor={`key-${b.id}`} className="text-sm font-medium">{b.label}</Label>
              <Badge variant={hasKey[b.id] ? 'secondary' : 'outline'}>
                {hasKey[b.id] ? 'set' : 'not set'}
              </Badge>
              <span className="ml-auto font-mono text-xs text-muted-foreground">{b.envVar}</span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                id={`key-${b.id}`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs"
                value={draft[b.id] ?? ''}
                placeholder={hasKey[b.id] ? 'stored — paste a new one to replace it' : `paste the ${b.label} key`}
                onChange={(e) => setDraft((s) => ({ ...s, [b.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') void saveKey(b.id); }}
              />
              <Button size="sm" variant="outline" disabled={!(draft[b.id] ?? '').trim()} onClick={() => void saveKey(b.id)}>
                Save
              </Button>
              {hasKey[b.id] && (
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void clearKey(b.id)}>
                  Clear
                </Button>
              )}
            </div>
            <span aria-live="polite" className="min-h-4 text-xs text-muted-foreground">{note[b.id] ?? ''}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Local endpoints</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Point an engine at your own server. Blank uses the engine&apos;s own default.
        </p>
      </div>
      <div className="flex flex-col divide-y divide-border/60 rounded-lg border">
        {CLIS.map((c) => (
          <div key={c.id} className="flex flex-col gap-2 px-3 py-2.5">
            <span className="text-sm font-medium">{c.label}</span>
            <EndpointField
              label="Base URL"
              hint={c.hint}
              value={config.providerBaseUrls?.[c.id] ?? ''}
              onCommit={(v) => saveEndpoint('providerBaseUrls', c.id, v)}
            />
            <EndpointField
              label="Default model"
              value={config.providerDefaultModels?.[c.id] ?? ''}
              onCommit={(v) => saveEndpoint('providerDefaultModels', c.id, v)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Saves on blur and on Enter, and re-seeds from the saved value only while the
 * box is unfocused — the MD-64 shape. Without the focus guard a save elsewhere
 * yanks what you are typing; without the re-seed the box shows a stale value
 * after any other write.
 */
function EndpointField({
  label, hint, value, onCommit
}: {
  label: string;
  hint?: string;
  value: string;
  onCommit: (next: string) => void | Promise<unknown>;
}) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(value); }, [value, focused]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
        <Input
          value={text}
          spellCheck={false}
          className="font-mono text-xs"
          aria-label={label}
          onFocus={() => setFocused(true)}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => { setFocused(false); if (text !== value) void onCommit(text); }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
      </div>
      {hint && <p className="pl-30 text-xs leading-4 text-muted-foreground">{hint}</p>}
    </div>
  );
}
