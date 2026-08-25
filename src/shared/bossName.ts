/**
 * The boss / orchestrator's display name — one accessor, one default.
 *
 * The god agent's ID stays `god` forever (it is a routing key: inboxes, message
 * `to` fields and registry.godId all use it). Only the NAME the human sees and
 * the agents are told is configurable, via `config.bossName`.
 *
 * Every surface — main prompts, preload, renderer UI, the office floor — reads
 * the name through here so a rename cannot half-apply. Never inline the literal
 * anywhere else; `test/boss-name.test.cjs` fails the build if you do.
 */

/** Shipped default — the Office-parody boss. The ONLY place this literal lives. */
export const DEFAULT_BOSS_NAME = 'Michael';

/** Shape every config mirror (main HarnessConfig, preload, renderer) satisfies. */
export interface BossNameConfig { bossName?: string }

/** Resolve the configured boss name. Blank/whitespace/unset → the default, so a
 *  user who clears the field gets the boss back rather than a nameless floor. */
export function bossName(config?: BossNameConfig | null): string {
  return config?.bossName?.trim() || DEFAULT_BOSS_NAME;
}
