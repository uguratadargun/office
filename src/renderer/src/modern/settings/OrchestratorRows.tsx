import { AGENT_PROVIDER_PRESETS, modelsForProvider, type AgentProvider } from '@/store/config';
import { canReceiveInbox, providerPreset } from '@shared/agentProvider';
import { SelectRow } from './fields';
import type { ConfigApi } from './useConfig';

/**
 * Which engine the orchestrator runs on, after first run.
 *
 * `settings/index.ts` excluded `godProvider`/`godModel` on the grounds that they
 * are "chosen in the orchestrator engine picker (onboarding + Monitor)". MD-93
 * checked: onboarding has one, Monitor has none — neither identifier appears
 * anywhere under `modern/monitor/`. So after the wizard the orchestrator's
 * engine was unreachable, and switching it meant a factory reset.
 *
 * The provider list is filtered by `canReceiveInbox` for the same reason the
 * wizard filters it: an orchestrator on a terminal-only engine cannot drain its
 * inbox, so it would stop orchestrating without ever reporting a fault.
 *
 * Changing the engine RESETS the model to that engine's recommended
 * orchestrator model. Carrying the old id across would leave the picker showing
 * a model the new CLI has never heard of.
 */
export function OrchestratorRows({ api }: { api: ConfigApi }) {
  const { config, save } = api;
  if (!config) return null;

  const provider = (config.godProvider ?? 'claude') as AgentProvider;
  const model = config.godModel ?? '';

  /**
   * A saved model the current engine's list does not contain still has to be
   * VISIBLE. `godModel` is a free string on disk — set by an older build, by a
   * hand-edited config, or by an engine whose catalogue has since changed — and
   * a Select whose value matches no item renders an empty box. The user would
   * then be told nothing about what the boss is actually running, and the
   * blank would look like "no model chosen".
   */
  const known = modelsForProvider(provider).map((m) => ({ value: m.id ?? '', label: m.label }));
  const modelChoices = known.some((c) => c.value === model)
    ? known
    : [{ value: model, label: `${model} — saved, not in this engine's list` }, ...known];

  return (
    <>
      <SelectRow
        id="set-godprovider"
        label="Orchestrator engine"
        help="What the boss himself runs on. Only engines that can receive an inbox are offered — one that cannot would stop orchestrating without saying so."
        value={provider}
        choices={AGENT_PROVIDER_PRESETS.filter((p) => canReceiveInbox(p.id)).map((p) => ({
          value: p.id, label: p.label
        }))}
        onChange={(v) => save({
          godProvider: v as AgentProvider,
          godModel: providerPreset(v as AgentProvider).recommendedOrchestratorModel
        })}
      />
      <SelectRow
        id="set-godmodel"
        label="Orchestrator model"
        help="Give the boss a longer-context, higher-capability model than the workers — he triages everything."
        value={model}
        choices={modelChoices}
        onChange={(v) => save({ godModel: v === '' ? undefined : v })}
      />
    </>
  );
}
