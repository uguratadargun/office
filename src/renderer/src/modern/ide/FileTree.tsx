import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, File, Folder } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * Lazy directory tree. A rebuild rather than a reuse of
 * `components/FileTree.tsx`: that file is 200 lines of inline `--cth-*` styles
 * around ~40 lines of loading, and the loading is the only part worth keeping —
 * so the `listDir` walk and the hide-list are carried over verbatim and the
 * chrome is not.
 */
interface Node {
  rel: string;
  name: string;
  isDir: boolean;
  expanded: boolean;
  children?: Node[];
  error?: string;
}

/** Same list the pixel tree hides — directories nobody browses to and that make
 *  the first expand take seconds. */
const HIDDEN = [/^\.git$/, /^node_modules$/, /^out$/, /^dist$/];

export interface FileTreeProps {
  root: string;
  activeRel?: string;
  onOpenFile: (rel: string) => void;
}

export function FileTree({ root, activeRel, onOpenFile }: FileTreeProps) {
  const [tree, setTree] = useState<Node>({ rel: '', name: '', isDir: true, expanded: true });

  const load = useCallback(async (rel: string): Promise<Partial<Node>> => {
    const res = await window.cth.listDir(root, rel);
    if (!res.ok) return { error: res.error };
    return {
      children: res.entries
        .filter((e) => !HIDDEN.some((re) => re.test(e.name)))
        .map((e) => ({
          rel: rel ? `${rel}/${e.name}` : e.name,
          name: e.name,
          isDir: e.isDir,
          expanded: false
        }))
        // Directories first, then case-insensitive by name — the order every
        // file browser uses, and `listDir` does not promise one.
        .sort((a, b) =>
          a.isDir === b.isDir ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : a.isDir ? -1 : 1
        )
    };
  }, [root]);

  useEffect(() => {
    let cancelled = false;
    setTree({ rel: '', name: '', isDir: true, expanded: true });
    void load('').then((patch) => { if (!cancelled) setTree((t) => ({ ...t, ...patch })); });
    return () => { cancelled = true; };
  }, [load]);

  /** Rewrite one node in place, addressed by its rel path. */
  const patch = useCallback((rel: string, next: Partial<Node>) => {
    setTree((t) => {
      const walk = (n: Node): Node => {
        if (n.rel === rel) return { ...n, ...next };
        if (!n.children) return n;
        return { ...n, children: n.children.map(walk) };
      };
      return walk(t);
    });
  }, []);

  const toggle = useCallback(async (node: Node) => {
    if (!node.isDir) { onOpenFile(node.rel); return; }
    if (node.expanded) { patch(node.rel, { expanded: false }); return; }
    patch(node.rel, { expanded: true });
    // Load once: an already-loaded directory keeps its children (and its own
    // expanded descendants) across collapse/expand.
    if (!node.children) patch(node.rel, await load(node.rel));
  }, [load, onOpenFile, patch]);

  return (
    <div className="py-1 text-sm">
      {tree.error && <p className="px-3 py-2 text-xs text-destructive">{tree.error}</p>}
      <Rows nodes={tree.children ?? []} depth={0} activeRel={activeRel} onToggle={toggle} />
    </div>
  );
}

function Rows({
  nodes, depth, activeRel, onToggle
}: { nodes: Node[]; depth: number; activeRel?: string; onToggle: (n: Node) => void }) {
  return (
    <>
      {nodes.map((n) => (
        <div key={n.rel}>
          <button
            type="button"
            onClick={() => onToggle(n)}
            title={n.rel}
            className={cn(
              'flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left outline-none',
              'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
              activeRel === n.rel && 'bg-selected font-medium'
            )}
            // Indent is per-depth and unbounded, so it is the one thing here a
            // utility class cannot express.
            style={{ paddingLeft: 8 + depth * 12 }}
          >
            {n.isDir
              ? (n.expanded ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                            : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />)
              : <span className="w-3.5 shrink-0" />}
            {n.isDir
              ? <Folder className="size-3.5 shrink-0 text-muted-foreground" />
              : <File className="size-3.5 shrink-0 text-muted-foreground" />}
            <span className="truncate">{n.name}</span>
          </button>
          {n.isDir && n.expanded && (
            n.error
              ? <p className="py-1 text-xs text-destructive" style={{ paddingLeft: 20 + depth * 12 }}>{n.error}</p>
              : <Rows nodes={n.children ?? []} depth={depth + 1} activeRel={activeRel} onToggle={onToggle} />
          )}
        </div>
      ))}
    </>
  );
}
