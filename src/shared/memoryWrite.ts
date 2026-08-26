/**
 * Hand-editing an agent's `memory.md` (MD-140) — the one shape all three
 * processes agree on, and the sentence the refusal turns into.
 *
 * `memory.md` has other writers: the agent itself, and the condenser on its own
 * timer. So a write is a CONDITIONAL write — it carries the mtime the editor
 * loaded, and main refuses if the file has moved since. That refusal is only
 * useful if the person reading it can tell it apart from a failure, which is
 * why every reason has its own sentence here rather than a generic "could not
 * save" at the call site.
 *
 * Lives in `shared/` because main produces the value, preload passes it through
 * and the renderer renders it — the three would otherwise re-declare it three
 * times and drift.
 */

export type MemoryWriteFailure = 'stale' | 'io' | 'badid' | 'nohome' | 'readonly';

export type MemoryWriteResult =
  | { ok: true; mtime: number }
  /** `mtime` is the file's CURRENT stamp when we could read it — the editor
   *  adopts it on reload, so the next save is checked against the truth. */
  | { ok: false; reason: MemoryWriteFailure; mtime: number | null };

/**
 * The soft cap this hive's agents are asked to keep their memory under.
 *
 * A convention, not a limit: nothing in the app enforces it (the condenser's
 * own numbers are the 128 KB context budget and its 16 KB floor, both in
 * Settings). The editor colours the byte count above it and says why — a file
 * that keeps growing is one the condenser will eventually rewrite unattended,
 * and the human editing it by hand should know that before it happens.
 */
export const MEMORY_SOFT_CAP_BYTES = 6 * 1024;

/** What went wrong, and what to do about it. One sentence, no jargon. */
export function memoryWriteMessage(reason: MemoryWriteFailure): string {
  switch (reason) {
    case 'stale':
      return 'memory.md changed since you opened it — reload before saving, or your edit would overwrite what the agent (or the condenser) just wrote.';
    case 'readonly':
      return 'Another instance owns this workspace, so this window cannot write to it.';
    case 'badid':
      return 'That agent id does not name a folder in this hive.';
    case 'nohome':
      return 'There is no harness home to write into.';
    case 'io':
    default:
      return 'The file could not be written. Nothing was changed.';
  }
}

/** Where an agent's memory file lives, as a (root, rel) pair for the sandboxed
 *  `listDir`/`readFile` bridge. `hive.root()` is `<harnessHome>/hive` and
 *  `agentDir(id)` is `<root>/agents/<id>` (src/main/hive.ts). */
export function memoryDir(harnessHome: string | null | undefined, agentId: string): string | null {
  if (!harnessHome || !agentId) return null;
  return `${harnessHome.replace(/\/+$/, '')}/hive/agents/${agentId}`;
}

export const MEMORY_FILE = 'memory.md';

export interface EditState {
  /** The draft differs from what was loaded. */
  dirty: boolean;
  canEdit: boolean;
  canSave: boolean;
  /** Why editing is unavailable, or null when it is. */
  blocked: string | null;
}

/**
 * Whether this file may be edited by hand, and whether the draft may be saved.
 *
 * Two things can take editing away, and they are NOT the same thing to say:
 *
 *  - the window does not own the workspace (MD-139) — another instance's agents
 *    are the ones writing these files, so this one must not;
 *  - we never got the file's mtime. The save is conditional ON that stamp, so
 *    without it the write would either be refused by main or, worse, land
 *    unchecked. An editor that cannot promise the guard should not open.
 *
 * A saved-but-unchanged draft is not saveable either: re-writing identical
 * bytes moves the mtime, which invalidates every other reader's stale check for
 * nothing.
 */
export function editState(o: {
  original: string;
  draft: string;
  owner: boolean;
  mtimeKnown: boolean;
  busy: boolean;
}): EditState {
  const blocked = !o.owner
    ? memoryWriteMessage('readonly')
    : !o.mtimeKnown
      ? 'memory.md’s timestamp could not be read, so a save could overwrite a change you cannot see. Reload the view first.'
      : null;
  const dirty = o.draft !== o.original;
  return { dirty, canEdit: blocked === null, canSave: blocked === null && dirty && !o.busy, blocked };
}
