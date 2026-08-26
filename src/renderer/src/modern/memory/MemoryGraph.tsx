import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useStore } from '@/store/store';
// The graph MODEL, not the graph view. `buildGraph`/`forceLayout`/
// `extractTopics` are pure, dependency-free modules (MEMORY_GRAPH_SPEC.md §3–§5)
// whose only imports from the pixel tree are `import type` — erased at build, so
// nothing pixel-shaped ships in this chunk. Reusing them is what makes this the
// SAME graph the pixel tab draws rather than a second, quietly different one;
// the drawing below is entirely modern (shadcn tokens, no `--cth-*`). Moving the
// three modules to `src/shared/` is the tidier home and the next card's job —
// MD-138 is explicitly not allowed to edit the pixel UI's imports.
import { buildGraph, type GraphData, type GraphNode } from '@/components/memoryGraph/buildGraph';
import { forceLayout, type Positions } from '@/components/memoryGraph/forceLayout';
import type { MessageLogEntry } from '@/components/memoryGraph/buildGraph';
import { Button } from '../components/ui/button';
import { IconButton } from '../components/IconButton';

const POLL_MS = 5000;
/** Node radius (max 26) + the label under it, so neither is clipped. */
const LABEL_PADDING = 48;

/**
 * Who talks to whom, and what they have written down about it.
 *
 * Nodes are agents (plus `broadcast`/`human` pseudo-nodes), edges are messages
 * aggregated per pair. With `topics` on, each agent's `memory.md` is read and
 * phrases mentioned by two or more agents become a second node layer — shared
 * knowledge, which is the only kind that says anything about the hive.
 *
 * Differences from the pixel panel, deliberately: no drag-to-pin and no
 * per-act arrow colours. Both are pixel-canvas affordances that cost ~200 lines
 * of pointer bookkeeping here; the click target (open this agent's memory) is
 * the thing the view is actually for, and it stays.
 */
export function MemoryGraph({ godId, onOpenAgent }: { godId: string; onOpenAgent: (id: string) => void }) {
  const agents = useStore((s) => s.agents);

  const [log, setLog] = useState<MessageLogEntry[]>([]);
  const [showTopics, setShowTopics] = useState(false);
  const [memories, setMemories] = useState<Record<string, string>>({});
  const [loadingTopics, setLoadingTopics] = useState(false);

  const refresh = useCallback(async () => {
    try { setLog((await window.cth.hiveLog(200)) as MessageLogEntry[]); } catch { /* the ledger is optional */ }
  }, []);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // Memory files are only read when the topic layer is on: one `hiveMemory` per
  // agent is a real cost to pay for a layer most visits never turn on.
  useEffect(() => {
    if (!showTopics) return;
    const missing = agents.map((a) => a.id).filter((id) => !(id in memories));
    if (missing.length === 0) return;
    setLoadingTopics(true);
    void Promise.all(missing.map((id) => window.cth.hiveMemory(id).then(
      (t) => [id, t ?? ''] as const,
      () => [id, ''] as const
    ))).then((pairs) => {
      setMemories((m) => ({ ...m, ...Object.fromEntries(pairs) }));
      setLoadingTopics(false);
    });
  }, [showTopics, agents, memories]);

  const graph: GraphData = useMemo(
    () => buildGraph(agents, log, { showTopics, memories }),
    [agents, log, showTopics, memories]
  );

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState({ w: 640, h: 440 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0 && r.height > 0) setDims({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-laying out on every 5s poll would make the graph jump while you read it,
  // so the layout is keyed on STRUCTURE (which nodes and edges exist) and the
  // canvas size — a poll that changes neither leaves every node where it was.
  const structKey = useMemo(
    () => graph.nodes.map((n) => n.id).join(',') + '|' + graph.edges.map((e) => e.id).join(','),
    [graph]
  );
  const layout: Positions = useMemo(() => {
    const nodes = graph.nodes.map((n) => ({
      id: n.id,
      gravityBias: n.kind === 'topic' ? 0.6 : n.kind === 'pseudo' ? 1.4 : n.id === godId ? 2.4 : 1
    }));
    const edges = graph.edges.map((e) => ({
      source: e.source,
      target: e.target,
      strength: e.kind === 'topic' ? 0.35 : 0.7 + Math.min(e.weight, 5) * 0.06
    }));
    // `padding` clamps node CENTRES, and each label sits BELOW its node — the
    // default 28 puts a bottom-row label half off the canvas, which is exactly
    // what a floor with no messages yet looks like (nothing but repulsion, so
    // every node ends up against an edge).
    return forceLayout(nodes, edges, { width: dims.w, height: dims.h, padding: LABEL_PADDING });
    // structKey is the graph identity that matters here; the rest is noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structKey, dims.w, dims.h, godId]);

  const [hoverId, setHoverId] = useState<string | null>(null);
  const touches = useCallback(
    (id: string) => graph.edges.some((e) => (e.source === id && e.target === hoverId) || (e.target === id && e.source === hoverId)),
    [graph.edges, hoverId]
  );

  const radius = (n: GraphNode) =>
    n.kind === 'agent' ? Math.min(26, 12 + n.degree * 1.6) : n.kind === 'pseudo' ? 11 : 7;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 flex-wrap items-center gap-2 border-b px-4">
        <Button
          size="sm"
          variant={showTopics ? 'secondary' : 'ghost'}
          aria-pressed={showTopics}
          onClick={() => setShowTopics((v) => !v)}
        >
          Topics
        </Button>
        <IconButton label="Reload the message log" onClick={() => void refresh()}>
          <RefreshCw />
        </IconButton>
        <span className="min-w-0 flex-1" />
        <span className="truncate text-xs text-muted-foreground">
          {showTopics
            ? loadingTopics
              ? 'reading memory…'
              : `${graph.topicShown} of ${graph.topicTotal} shared topics`
            : `${graph.edges.filter((e) => e.kind === 'message').length} conversations`}
        </span>
      </div>

      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden">
        {graph.nodes.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            No agents on the floor yet — the graph draws itself once there is somebody to draw.
          </p>
        ) : (
          <svg width={dims.w} height={dims.h} className="block select-none">
            {graph.edges.map((e) => {
              const a = layout.get(e.source);
              const b = layout.get(e.target);
              if (!a || !b) return null;
              const lit = hoverId === e.source || hoverId === e.target;
              return (
                <line
                  key={e.id}
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={lit ? 'var(--primary)' : 'var(--border)'}
                  strokeWidth={e.kind === 'topic' ? 1 : Math.min(4, 1 + e.weight * 0.4)}
                  strokeDasharray={e.kind === 'topic' ? '3 3' : undefined}
                  opacity={hoverId && !lit ? 0.35 : 1}
                >
                  <title>
                    {e.kind === 'topic'
                      ? `${e.source} wrote about ${e.target}`
                      : `${e.weight} message${e.weight === 1 ? '' : 's'}${e.lastSubject ? ` · latest: ${e.lastSubject}` : ''}`}
                  </title>
                </line>
              );
            })}

            {graph.nodes.map((n) => {
              const p = layout.get(n.id);
              if (!p) return null;
              const r = radius(n);
              const dim = !!hoverId && hoverId !== n.id && !touches(n.id);
              const clickable = n.kind === 'agent';
              return (
                <g
                  key={n.id}
                  onMouseEnter={() => setHoverId(n.id)}
                  onMouseLeave={() => setHoverId((h) => (h === n.id ? null : h))}
                  onClick={clickable ? () => onOpenAgent(n.id) : undefined}
                  className={clickable ? 'cursor-pointer' : undefined}
                  opacity={dim ? 0.4 : 1}
                >
                  <title>
                    {n.kind === 'agent'
                      ? `${n.label} — ${n.degree} conversation${n.degree === 1 ? '' : 's'}. Click to read its memory.`
                      : n.kind === 'topic'
                        ? `${n.label} — written about by ${n.weight} agents`
                        : n.label}
                  </title>
                  <circle
                    cx={p.x} cy={p.y} r={r}
                    fill={n.kind === 'topic' ? 'var(--muted)' : 'var(--card)'}
                    stroke={n.kind === 'agent' && n.isGod ? 'var(--primary)' : 'var(--border)'}
                    strokeWidth={n.kind === 'agent' && n.isGod ? 2.5 : 1.5}
                  />
                  <text
                    // Centred under the node, but never past the edge: a name is
                    // wider than the circle it belongs to.
                    x={Math.max(LABEL_PADDING, Math.min(dims.w - LABEL_PADDING, p.x))}
                    y={p.y + r + 12}
                    textAnchor="middle"
                    fontSize={n.kind === 'topic' ? 10 : 12}
                    fill={n.kind === 'agent' ? 'var(--foreground)' : 'var(--muted-foreground)'}
                  >
                    {n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
