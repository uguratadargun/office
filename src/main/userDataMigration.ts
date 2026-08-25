/**
 * Adopting the pre-rename profile.
 *
 * Electron names userData after the app, so renaming Munder Difflin -> Office
 * moves the directory that holds EVERYTHING the user has: config.json,
 * harness.db, the hero, the knowledge graph, integration secrets. Without this,
 * the rename would greet every existing user with a factory-fresh app.
 *
 * Pure on purpose (no electron, no fs) — main/index.ts supplies the probes.
 */

export interface DirProbe {
  exists: (path: string) => boolean;
  /** True for a missing dir too: "nothing worth keeping in there". */
  isEmpty: (path: string) => boolean;
}

/** What Electron called the userData dir before the rename — the packaged app
 *  used productName, `electron-vite dev` the package.json `name`. */
export const LEGACY_USER_DATA_NAMES = ['Munder Difflin', 'munder-difflin'] as const;

/**
 * The legacy directory to adopt, or null to leave the disk alone.
 *
 * Returns null the moment the new dir holds anything, so a profile that has
 * already been used — or migrated once — is never clobbered by a stale one.
 */
export function planUserDataMigration(
  current: string,
  legacy: readonly string[],
  probe: DirProbe
): string | null {
  if (probe.exists(current) && !probe.isEmpty(current)) return null;
  for (const dir of legacy) {
    if (dir !== current && probe.exists(dir) && !probe.isEmpty(dir)) return dir;
  }
  return null;
}
