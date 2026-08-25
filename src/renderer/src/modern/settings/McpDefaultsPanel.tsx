import { MCP_CATALOG, MCP_WIRED_PROVIDERS, type McpTier } from '@shared/mcpCatalog';
import { AGENT_PROVIDER_PRESETS } from '@shared/agentProvider';
import type { HarnessConfig } from '@/store/config';
import { Switch } from '../components/ui/switch';
import { Label } from '../components/ui/label';
import type { ConfigApi } from './useConfig';

/**
 * Which MCP servers every new agent is born with.
 *
 * `mcpDefaults` had no modern reader or writer at all (MD-93 S2), so consent
 * given once in the pixel UI could not be reviewed or withdrawn from here.
 *
 * The tiers are the whole point and are kept in their pixel order: read-only
 * servers ship ON because they cannot reach past the workspace; anything that
 * WRITES, or that needs a credential, ships OFF and stays off until someone
 * turns it on deliberately. A flat alphabetical list would let a write-capable
 * server sit next to a harmless one with nothing marking the difference.
 */
const TIER_ORDER: McpTier[] = ['safe-readonly', 'write', 'secret'];
const TIER_LABEL: Record<McpTier, string> = {
  'safe-readonly': 'Safe & read-only',
  write: 'Write access',
  secret: 'Needs a secret'
};
const TIER_NOTE: Record<McpTier, string> = {
  'safe-readonly': 'Read data only, need no secrets, scoped to the agent workspace. On for every new agent.',
  write: 'Can change things beyond the workspace. Off by default — turn one on only after reading what it does.',
  secret: 'Need an API key or credentials of their own. Off by default.'
};

/** Engine names for the wired-for line, straight off the presets so a newly
 *  wired provider needs no second edit here. */
const WIRED_LABELS = MCP_WIRED_PROVIDERS
  .map((id) => AGENT_PROVIDER_PRESETS.find((p) => p.id === id)?.label ?? id)
  .join(', ');

export function McpDefaultsPanel({ api }: { api: ConfigApi }) {
  const config = api.config as HarnessConfig | null;
  if (!config) return null;

  const enabledFor = (id: string): boolean =>
    config.mcpDefaults?.[id]?.enabled ?? MCP_CATALOG.find((e) => e.id === id)?.defaultEnabled ?? false;

  const toggle = (id: string, next: boolean) =>
    api.save({ mcpDefaults: { ...(config.mcpDefaults ?? {}), [id]: { enabled: next } } });

  return (
    <div className="flex w-full flex-col gap-4">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Wired for {WIRED_LABELS}. Other engines ignore this list.
      </p>
      {TIER_ORDER.map((tier) => {
        const rows = MCP_CATALOG.filter((e) => e.tier === tier);
        if (rows.length === 0) return null;
        return (
          <div key={tier} className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">{TIER_LABEL[tier]}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">{TIER_NOTE[tier]}</p>
            <div className="flex flex-col divide-y divide-border/60 rounded-lg border">
              {rows.map((e) => (
                <div key={e.id} className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Label htmlFor={`mcp-${e.id}`} className="text-sm font-medium">{e.label}</Label>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{e.description}</p>
                  </div>
                  <Switch
                    id={`mcp-${e.id}`}
                    checked={enabledFor(e.id)}
                    onCheckedChange={(v: boolean) => void toggle(e.id, v)}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
