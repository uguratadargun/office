/**
 * The one place a spawn command line is built.
 *
 * There used to be two: this logic in the renderer store, and a hand-maintained
 * `PROVIDER_COMMAND` map in realtimeActions.ts for voice hire. The copy drifted —
 * it mapped antigravity to "antigravity" when the binary is `agy`, carried a
 * `gemini` key for a provider id that does not exist, omitted grok and kimi
 * entirely, and applied no --model or auto-mode flag at all. A voice-hired agent
 * therefore launched wrong, or not at all.
 *
 * Shared so both processes ask the same function.
 */
import { providerPreset, inferAgentProvider, isValidEffort, type AgentProvider } from './agentProvider';

/** The two config fields command-building actually reads. */
export interface SpawnCommandConfig {
  defaultCommand: string;
  autoMode: boolean;
}

/** Build the command line to feed into spawnPty, honoring the provider's flags,
 *  autoMode, and an optional per-agent model override. Claude keeps the user's
 *  configured `defaultCommand`; other providers use their preset binary so the
 *  app works without Claude installed. */
export function buildSpawnCommand(
  config: SpawnCommandConfig,
  model?: string,
  provider: AgentProvider = inferAgentProvider(config.defaultCommand),
  effort?: string
): string {
  const preset = providerPreset(provider);
  // Claude keeps the user's configured defaultCommand; custom falls back to it
  // too; every other provider (codex, grok, kimi, agy) uses its preset binary so the app
  // works even without Claude installed.
  const base =
    provider === 'claude'
      ? config.defaultCommand || preset.defaultCommand
      : provider === 'custom'
        ? config.defaultCommand || ''
        : preset.defaultCommand;
  let cmd = base;
  if (preset.supportsModel && model && preset.modelFlag) {
    // Quote model values that contain whitespace (agy labels like
    // "Gemini 3.1 Pro (High)") so the command tokenizer keeps them one arg.
    const m = /\s/.test(model) ? `"${model}"` : model;
    cmd = `${cmd} ${preset.modelFlag} ${m}`;
  }
  // Auto (skip-permissions) mode appends each provider's own flag — Claude's
  // bypassPermissions, Codex's dangerous bypass, Grok's always-approve, Kimi's
  // auto, or agy's skip flag.
  if (config.autoMode && preset.autoFlag) cmd = `${cmd} ${preset.autoFlag}`;
  // Reasoning effort, only for an engine whose --help was observed to offer the
  // flag AND only for a level that engine actually lists. Omitted otherwise, so
  // "default" stays the engine's own default rather than a value we picked.
  if (preset.effortFlag && isValidEffort(provider, effort)) {
    cmd = `${cmd} ${preset.effortFlag} ${effort}`;
  }
  return cmd;
}
