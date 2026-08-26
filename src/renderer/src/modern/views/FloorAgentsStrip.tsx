import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useStore } from '@/store/store';
import { Badge } from '../components/ui/badge';
import { IconButton } from '../components/IconButton';
import { cn } from '../lib/cn';
import { readStripOpen, stripRows, writeStripOpen } from './floorStrip';

/**
 * The roster, under the stage (MD-126).
 *
 * The human's ask was "in the Floor section, under the animated characters, add
 * the agents so I can see them from there" — the scene shows WHERE everyone is
 * and animates beautifully, and answers "who is on this floor and what are they
 * doing" only if you can read a speech bubble and recognise a sprite. This is
 * that same roster in words, in the rail's order and the rail's vocabulary.
 *
 * THE STAGE KEEPS ITS HEIGHT. The strip is one row, `shrink-0` next to a
 * `flex-1` stage, capped at `max-h-24` and scrolling sideways rather than
 * wrapping to a second line — a floor of fifteen agents must not push the
 * animation the strip exists to sit under off the bottom of the screen. And it
 * collapses to its header, remembered, so the floor can go back to stage-only.
 *
 * Selection is the SAME selection (MD-95): clicking a card calls `select`, which
 * is what the scene's own character click calls, so picking here opens the same
 * inspector, moves the Agents view to the same agent, and is cleared by the same
 * Esc and the same carpet click. There is one selection in this app.
 */
export function FloorAgentsStrip() {
  const agents = useStore((s) => s.agents);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);

  // Read the stored preference AFTER mount, not in the initialiser: the value
  // is per-machine and the initialiser runs during render, which is where a
  // throwing storage accessor would take the whole floor down with it. `true`
  // until proven otherwise matches the default in `readStripOpen`.
  const [open, setOpen] = useState(true);
  useEffect(() => { setOpen(readStripOpen(window.localStorage)); }, []);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      writeStripOpen(next, window.localStorage);
      return next;
    });
  };

  const rows = stripRows(agents);

  return (
    <div className="shrink-0">
      <div className="flex h-7 items-center gap-2 px-1">
        <span className="text-xs font-medium">Agents</span>
        <span className="text-xs text-muted-foreground">{rows.length}</span>
        <span className="flex-1" />
        <IconButton
          label={open ? 'Hide agents' : 'Show agents'}
          size="icon-xs"
          onClick={toggle}
        >
          {open ? <ChevronDown /> : <ChevronUp />}
        </IconButton>
      </div>

      {open && (
        rows.length === 0
          ? <p className="px-1 pb-1 text-xs text-muted-foreground">Nobody on the floor yet.</p>
          : (
            /* One row, scrolled sideways. `overflow-x-auto` needs the track to
               be allowed to overflow, which is what `min-w-0` on the flex chain
               above buys — without it the row grows the column instead and the
               stage loses the height. */
            <div className="max-h-24 min-w-0 overflow-x-auto overflow-y-hidden">
              <div className="flex w-max gap-2 p-1">
                {rows.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => select(r.id)}
                    title={r.full || r.name}
                    aria-pressed={r.id === selectedId}
                    className={cn(
                      'flex w-44 shrink-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                      r.id === selectedId
                        ? 'border-ring bg-selected hover:bg-selected-hover'
                        : 'border-transparent hover:bg-accent'
                    )}
                  >
                    {/* An initial, not the pixel portrait: `scene/office/**` art
                        is a hard boundary and DESIGN-MODERN.md has one
                        accent-free palette, so the character and its colour stay
                        on the stage where they belong. */}
                    <span
                      aria-hidden
                      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
                    >
                      {r.initial}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex min-w-0 items-center gap-1">
                        <span className="truncate text-xs font-medium">{r.name}</span>
                        <Badge variant={r.badge.tone} className="h-4 shrink-0 px-1 text-xs font-normal">
                          {r.badge.label}
                        </Badge>
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {r.subtitle || '—'}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )
      )}
    </div>
  );
}
