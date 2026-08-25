import { bossName, type BossNameConfig } from '@shared/bossName';
import { useStore } from './store';

/**
 * Renaming the boss, all the way down — ONE writer.
 *
 * A rename is three writes, not one, and each surface reads a different one:
 *   1. `config.bossName` — what every fresh read and every spawned prompt uses;
 *   2. the store mirror — what the live UI paints, and which also renames god's
 *      ROSTER entry (`setBossName` does that half);
 *   3. the hive registry + `identity.md` via `hiveUpdateAgentMeta` — what the
 *      agents themselves are told, and what the roster line injected into god's
 *      own context says.
 *
 * The pixel modal did all three inline; modern Settings did only the first
 * (MD-107). So a rename saved in the modern UI left the floor, the roster strip
 * and every agent still calling him Michael, and stayed that way until a cold
 * boot happened to respawn him. Two copies of a three-step write is how one of
 * them ends up with two steps, so there is now one function and both UIs call it.
 *
 * Best-effort by design: the config write is the durable one and is awaited
 * first. If the registry write fails the name is still correct everywhere the
 * user can see, and the next boot's reconcile (`reconcileBossName`) fixes the
 * registry.
 */
export async function applyBossName(raw: string): Promise<void> {
  const resolved = bossName({ bossName: raw });
  // Persist the RAW value: blank is a real choice that means "use the default",
  // and writing the resolved name back would turn a cleared field into a
  // literal "Michael" the user then cannot clear.
  await window.cth.updateConfig({ bossName: raw } as Record<string, unknown>);
  useStore.getState().setBossName(resolved);
  const god = useStore.getState().agents.find((a) => a.isGod);
  if (god) {
    try { await window.cth.hiveUpdateAgentMeta(god.id, { name: resolved }); }
    catch { /* the visible surfaces are already right; boot reconciles the rest */ }
  }
}

/**
 * Make the live roster agree with the saved setting, at boot.
 *
 * The store mirror defaults to `Michael` and the roster is RESTORED from disk,
 * so without this a window opens showing whatever name god was last spawned
 * under — which after a rename in a previous session is the old one. The pixel
 * root seeded the mirror from config on load; the modern root never ran that
 * code at all, which is the other half of why a modern rename looked ignored.
 *
 * Calling `setBossName` is the whole reconcile: it sets the mirror AND renames
 * god's roster entry, persisting the roster when it changes.
 */
export function reconcileBossName(config: BossNameConfig | null | undefined): void {
  useStore.getState().setBossName(bossName(config));
}
