/**
 * What the Memory view SAYS, kept out of the component that says it.
 *
 * The pixel Memory tab (`CommandCenterPanel.tsx`, "Memory tab") is four
 * sections of raw `<Pre>` over five existing IPC channels; nothing about it is
 * testable because every decision is inline JSX. The modern view answers the
 * same questions, but the answers — which agents can be picked, how big a
 * memory file is and when it last moved, what MemPalace's status actually means
 * to a human, and which agent a search hit belongs to — live here as pure
 * functions so `test/modern-memory.test.cjs` can pin them.
 *
 * No new IPC: `hiveMemory`, `memoryStatus`, `searchMemory`, `textSearch`,
 * `memoryWakeUp`, `mineNow`, `reflectNow`/`reflectStatus` and the root-confined
 * `listDir` all exist already.
 */
import { relSince } from '@shared/relTime';
import { formatBytes } from '@shared/reflectSummary';
import { MEMORY_SOFT_CAP_BYTES } from '@shared/memoryWrite';

/** The fields of a store `Agent` this view needs. Re-declared loosely so the
 *  model stays testable without the store (the codebase's local-declare rule). */
export interface MemoryAgent {
  id: string;
  name: string;
  cwd?: string | null;
  isGod?: boolean;
  ptyId?: string | null;
  archived?: boolean;
}

export interface MemoryPickerOption {
  id: string;
  name: string;
  /** Second line of the row: basename-first workspace, or the agent id. */
  label: string;
  isGod: boolean;
  /** Only when it is NOT the ordinary state — 'asleep' / 'archived'. */
  presence?: string;
}

/**
 * The agent picker, deliberately NOT `idePickerOptions`.
 *
 * That list drops any agent without a `cwd`, because pointing a file tree at
 * nothing is not renderable. Memory is the opposite case: `memory.md` lives in
 * `<hive>/agents/<id>/`, not in the workspace, so an agent with no cwd — and an
 * ARCHIVED agent, whose notes are the only thing left of it — still has a
 * memory file worth reading. Dropping them would hide exactly the history
 * someone opens this view to find.
 *
 * Basename-first labels (MD-125/129) for the same reason as the IDE: the
 * trigger truncates at the end, so a raw worktree path loses the half that
 * identifies it. God sorts first; everyone else keeps roster order.
 */
export function memoryPickerOptions<A extends MemoryAgent>(agents: readonly A[]): MemoryPickerOption[] {
  const usable = agents.filter((a) => !!a.id);
  const rank = (a: A) => (a.isGod ? 0 : 1);
  return [...usable]
    .sort((x, y) => rank(x) - rank(y))
    .map((a) => {
      const cwd = a.cwd ?? '';
      const base = cwd.split('/').filter(Boolean).pop() ?? '';
      return {
        id: a.id,
        name: a.name,
        label: !cwd ? a.id : base && base !== cwd ? `${base} — ${cwd}` : cwd,
        isGod: !!a.isGod,
        presence: a.archived ? 'archived' : a.ptyId ? undefined : 'asleep'
      };
    });
}

/** Which agent a deep link (`navigate('memory', { anchor: id })`) means, or the
 *  fallback when the anchor names an agent that is no longer on the roster —
 *  the same staleness `isSection` guards against in Settings. */
export function anchorAgentId(
  anchor: string | undefined,
  agents: readonly MemoryAgent[],
  fallback: string
): string {
  if (!anchor) return fallback;
  return agents.some((a) => a.id === anchor) ? anchor : fallback;
}

export interface MemoryFileMeta {
  bytes: number;
  /** "12.4 KB" — the unit the condenser's thresholds are also stated in. */
  sizeLabel: string;
  /** "3h ago", or null when nothing on disk told us. */
  modifiedLabel: string | null;
  empty: boolean;
  /** Past the hive's soft cap — a warning tone, never a block (MD-140). */
  overSoftCap: boolean;
}

/**
 * Size and age of the memory file on screen.
 *
 * `hiveMemory` returns the TEXT and nothing else, so the size is measured from
 * the string in UTF-8 bytes — not `.length`, which counts UTF-16 units and
 * would under-report every file with an em-dash in it against a condenser
 * threshold that is stated in bytes. The mtime has no channel of its own; the
 * caller gets it from the root-confined `listDir` on the agent's hive folder
 * and passes it in, so a failed or unavailable listing simply means no age is
 * claimed rather than a wrong one.
 */
export function memoryFileMeta(text: string, mtimeMs?: number | null, now: number = Date.now()): MemoryFileMeta {
  const bytes = new TextEncoder().encode(text).length;
  return {
    bytes,
    sizeLabel: formatBytes(bytes),
    overSoftCap: bytes > MEMORY_SOFT_CAP_BYTES,
    modifiedLabel: typeof mtimeMs === 'number' && Number.isFinite(mtimeMs) && mtimeMs > 0
      ? relSince(mtimeMs, now)
      : null,
    empty: text.trim().length === 0
  };
}

/** `MemoryStatus` as the preload declares it — re-declared for the same reason
 *  the rest of the renderer re-declares main's shapes. */
export interface PalaceStatus {
  available: boolean;
  enabled: boolean;
  active: boolean;
  initialized: boolean;
  palacePath: string | null;
  model: string;
  bin: string | null;
}

export interface PalaceLine {
  label: string;
  tone: 'default' | 'secondary' | 'destructive' | 'outline';
  /** One sentence saying what that means, and where to change it. */
  detail: string;
  /** Whether semantic search can be expected to answer at all. */
  searchable: boolean;
}

/**
 * MemPalace's five booleans, read as one sentence.
 *
 * The order matters: `active` is `available && enabled && have a home`, so
 * checking it first would report "off" for a machine that simply has no
 * mempalace binary — a different problem with a different fix. Each state names
 * the ONE thing that would change it, which is the difference between a status
 * badge and a shrug.
 */
export function palaceLine(status: PalaceStatus | null): PalaceLine {
  if (!status) {
    return { label: 'unknown', tone: 'outline', detail: 'Could not read MemPalace status.', searchable: false };
  }
  if (!status.available) {
    return {
      label: 'not installed',
      tone: 'outline',
      detail: 'The mempalace CLI is not on PATH — install it from Settings › Prerequisites to turn on semantic search.',
      searchable: false
    };
  }
  if (!status.enabled) {
    return {
      label: 'off',
      tone: 'secondary',
      detail: 'Cross-session recall is off — turn it on in Settings › Memory & Knowledge. Memory files below still work.',
      searchable: false
    };
  }
  if (!status.active) {
    return {
      label: 'no hive home',
      tone: 'destructive',
      detail: 'Installed and enabled, but there is no harness home to keep a palace in.',
      searchable: false
    };
  }
  if (!status.initialized) {
    return {
      label: 'building',
      tone: 'secondary',
      detail: 'The palace directory does not exist yet — it is created on the first mine. “Mine now” builds it.',
      searchable: true
    };
  }
  return {
    label: 'active',
    tone: 'default',
    detail: status.palacePath ?? 'Indexed and searchable.',
    searchable: true
  };
}

/** Which agent a text-search hit came from. `hive:textSearch` labels its
 *  targets `board.md`, `tasks.json` and `<agentId>/memory.md` — only the last
 *  belongs to somebody, and only that one is worth making clickable. */
export function hitAgentId(source: string): string | null {
  const m = /^([^/]+)\/memory\.md$/.exec(source.trim());
  return m ? m[1] : null;
}
