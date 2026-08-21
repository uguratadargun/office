import { useState } from 'react';
import type { HarnessConfig } from '@/store/config';
import { MCP_CATALOG, MCP_WIRED_PROVIDERS, type McpTier } from '@shared/mcpCatalog';
import { AGENT_PROVIDER_PRESETS } from '@shared/agentProvider';

export interface McpDefaultsSettingsProps {
  config: HarnessConfig;
}

const TIER_ORDER: McpTier[] = ['safe-readonly', 'write', 'secret'];
const TIER_LABEL: Record<McpTier, string> = {
  'safe-readonly': 'Safe & Read-Only (on by default)',
  'write': 'Write Access (consent required)',
  'secret': 'Requires Secret / API Key (consent required)'
};
const TIER_NOTE: Record<McpTier, string> = {
  'safe-readonly': 'These servers read data only, need no secrets, and are scoped to the agent workspace. They are enabled for every new agent.',
  'write': 'These servers can mutate state beyond the workspace. Off by default — enable only after reviewing.',
  'secret': 'These servers require an API key or credentials. Off by default — add your credentials and enable after consent.'
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--cth-font-display)',
  fontSize: 8,
  lineHeight: '12px',
  color: 'var(--cth-ink-500)',
  textTransform: 'uppercase'
};

/** Engine names for the wired-for line, straight off the presets so a newly wired
 *  provider needs no second edit here. */
const WIRED_LABELS = MCP_WIRED_PROVIDERS
  .map((id) => AGENT_PROVIDER_PRESETS.find((p) => p.id === id)?.label ?? id)
  .join(', ');

export function McpDefaultsSettings({ config }: McpDefaultsSettingsProps) {
  const [note, setNote] = useState('');

  const enabledFor = (id: string): boolean =>
    config.mcpDefaults?.[id]?.enabled ?? MCP_CATALOG.find((e) => e.id === id)?.defaultEnabled ?? false;

  const toggle = async (id: string) => {
    const next = !enabledFor(id);
    try {
      await window.cth.updateConfig({
        mcpDefaults: { ...(config.mcpDefaults ?? {}), [id]: { enabled: next } }
      });
      setNote(`${id}: ${next ? 'enabled' : 'disabled'}`);
      setTimeout(() => setNote(''), 1800);
    } catch {
      setNote('could not save');
      setTimeout(() => setNote(''), 2000);
    }
  };

  const byTier = (tier: McpTier) => MCP_CATALOG.filter((e) => e.tier === tier);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ ...labelStyle, marginBottom: 6 }}>Default MCP servers</div>
        <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
          These servers are merged into each new agent's session settings. Safe servers are on by
          default; write/secret servers are off until you consent. Changes take effect on the next
          agent spawn — running agents are not affected.
        </span>
        {/* These toggles used to be written into exactly one engine's config while
            reading as a floor-wide setting — consent the user gave that nothing
            acted on. Name the engines instead of implying all of them. */}
        <div style={{ fontSize: 11, lineHeight: '16px', color: 'var(--cth-ink-500)', marginTop: 6 }}>
          Wired for <strong style={{ color: 'var(--cth-ink-900)' }}>{WIRED_LABELS}</strong> — each
          gets these servers in its own per-agent config, never your global one. Other engines ignore
          these toggles: they either have no MCP config we can write per agent, or only a global one
          we will not edit on your behalf.
        </div>
      </div>

      {TIER_ORDER.map((tier) => {
        const entries = byTier(tier);
        if (entries.length === 0) return null;
        const isConsent = tier !== 'safe-readonly';
        return (
          <div key={tier} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{
                fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '12px',
                color: isConsent ? '#6E1423' : 'var(--cth-ink-500)',
                textTransform: 'uppercase'
              }}>
                {TIER_LABEL[tier]}
              </span>
              <span style={{ fontSize: 11, lineHeight: '15px', color: 'var(--cth-ink-400, var(--cth-ink-500))' }}>
                {TIER_NOTE[tier]}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {entries.map((entry) => {
                const on = enabledFor(entry.id);
                return (
                  <div
                    key={entry.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 12, padding: '7px 10px',
                      background: 'var(--cth-paper-100)',
                      boxShadow: `inset 0 0 0 1px ${isConsent && on ? '#6E1423' : 'var(--cth-ink-300)'}`
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12, lineHeight: '18px', color: 'var(--cth-ink-900)', fontWeight: 600 }}>
                        {entry.label}
                        <code style={{
                          marginLeft: 6,
                          fontFamily: 'var(--cth-font-mono)',
                          fontSize: 11,
                          color: 'var(--cth-ink-500)',
                          fontWeight: 400
                        }}>{entry.id}</code>
                      </span>
                      <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)', wordBreak: 'break-word' }}>
                        {entry.description}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => { void toggle(entry.id); }}
                      style={{
                        flexShrink: 0,
                        padding: '3px 10px 1px',
                        background: on
                          ? (isConsent ? 'var(--cth-coral-light, #f6d3c4)' : 'var(--cth-lemon)')
                          : 'var(--cth-cream-200)',
                        boxShadow: `inset 0 0 0 1px ${on ? 'var(--cth-ink-900)' : 'var(--cth-ink-700)'}`,
                        border: 'none',
                        fontFamily: 'var(--cth-font-display)',
                        fontSize: 8,
                        lineHeight: '14px',
                        color: 'var(--cth-ink-900)',
                        cursor: 'pointer',
                        textTransform: 'uppercase'
                      }}
                    >
                      {on ? 'on' : 'off'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {note && (
        <span style={{ fontSize: 12, color: 'var(--cth-mint)' }}>{note}</span>
      )}
    </div>
  );
}
