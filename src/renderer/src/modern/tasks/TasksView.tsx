import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useStore } from '@/store/store';
import {
  type BoardChip, type HumanQA,
  matchesChips, matchesQuery, openQuestion
} from '@/store/taskLedger';
import {
  EMPTY_SELECTION, MICHAEL_DECIDES, type Selection,
  assignTasks, nextSelection, pruneSelection
} from '@/store/taskActions';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Input } from '../components/ui/input';
import { ScrollArea } from '../components/ui/scroll-area';
import { cn } from '../lib/cn';
import { TaskCard } from './TaskCard';
import { TaskDetailSheet } from './TaskDetailSheet';
import { AssignControl } from './AssignControl';
import { COLUMNS } from './status';
import { columnSelectState, toggleColumn } from '@/store/taskBulk';
import { DeleteTasksDialog } from './DeleteTasksDialog';
import { SelectionBar } from '../components/SelectionBar';
import { useLedger } from './useLedger';
import { navigate } from '../navigation';

/**
 * The kanban over `hive/tasks.json` — a READ surface. The god is the ledger's
 * writer: new work enters by dispatching to it, never by a human inserting a
 * card the orchestrator never heard about. What a human may do here is narrow
 * (filter), hand over (assign), tidy (archive, dismiss) and answer.
 */

/** Filters the text box cannot express. They narrow, and they compose with it. */
const CHIPS: { key: BoardChip; label: string; hint: string }[] = [
  { key: 'unassigned', label: 'Unassigned', hint: 'Cards with no owner' },
  { key: 'blocked', label: 'Blocked', hint: 'Cards in the blocked column' },
  { key: 'mine', label: 'Asks me', hint: 'Cards with a question waiting on YOU, whatever their status' }
];

export function TasksView() {
  const boss = useStore((s) => s.bossName);
  const taskDetailId = useStore((s) => s.taskDetailId);
  const openTaskDetail = useStore((s) => s.openTaskDetail);
  const closeTaskDetail = useStore((s) => s.closeTaskDetail);
  const { tasks, setTasks, patch, remove, removeMany, nameFor } = useLedger();

  // Archived cards are hidden by default: DONE is append-only and would grow
  // until the board is unreadable. This toggle is the only way back to them.
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [chips, setChips] = useState<BoardChip[]>([]);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  /** Outcome of the toolbar's one-press hand-over. Fire-and-forget with no word
   *  back is how you press a button twice. */
  const [bulkNote, setBulkNote] = useState('');

  const archivedCount = tasks.filter((t) => t.archived).length;
  const onBoard = tasks.filter((t) => !!t.archived === showArchived);
  const visible = onBoard.filter((t) => matchesChips(t, chips) && matchesQuery(t, nameFor(t.assignee), query));
  const hidden = onBoard.length - visible.length;

  // The visible cards in the order they appear on screen — what a shift-click
  // range means. Anything the filter hides is not in it, so a range can never
  // quietly include a card you cannot see.
  // Keyed on CONTENT: `visible` is rebuilt every render and every 5s poll, and an
  // unstable `ordered` would re-prune (and so re-render) the selection forever.
  const orderKey = visible.map((t) => `${t.id}:${t.status}`).join('|');
  const ordered = useMemo(
    () => COLUMNS.flatMap((c) => visible.filter((t) => t.status === c.key).map((t) => t.id)),
    [orderKey] // eslint-disable-line react-hooks/exhaustive-deps -- visible is derived from orderKey
  );
  // Cards are filtered, archived and deleted underneath the selection every 5s.
  // Acting on an id that has gone is how a bulk action half-fails.
  useEffect(() => { setSelection((sel) => pruneSelection(sel, ordered)); }, [ordered]);

  const selected = visible.filter((t) => selection.ids.includes(t.id));
  // Counted over the whole board, not the filtered view: the number on the chip
  // is what is waiting on you, not what the filter happens to show.
  const mineCount = onBoard.filter((t) => !!openQuestion(t)).length;
  const unassignedOpen = onBoard.filter((t) => !t.assignee && t.status !== 'done');
  const detail = tasks.find((t) => t.id === taskDetailId);

  function deleteSelected() {
    const ids = selected.map((t) => t.id);
    const n = ids.length;
    setSelection(EMPTY_SELECTION);
    void removeMany(ids)
      .then((out) => setBulkNote(out.ok
        // `missing` is not a failure: the board polls every 5s and the god
        // archives as it goes, so an id can legitimately have gone between the
        // selection and the press. Saying the real number beats a tidy lie.
        ? `Deleted ${out.deleted.length}${out.missing.length ? ` · ${out.missing.length} had already gone` : ''}`
        : 'Could not delete — the board is unchanged'))
      .catch(() => setBulkNote(`Could not delete ${n} — the board is unchanged`))
      .finally(() => setTimeout(() => setBulkNote(''), 4000));
  }

  function handOver() {
    const n = unassignedOpen.length;
    void assignTasks(unassignedOpen, MICHAEL_DECIDES, boss)
      .then(() => setBulkNote(`Asked ${boss} to assign ${n}`))
      .catch(() => setBulkNote(`Could not reach ${boss} — nothing sent`))
      .finally(() => setTimeout(() => setBulkNote(''), 4000));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <span className="text-sm text-muted-foreground">
          {visible.length} {visible.length === 1 ? 'task' : 'tasks'}
          {/* Say what the filter is holding back, so a narrowed board is never
              mistaken for an empty one. */}
          {hidden > 0 && <span className="text-muted-foreground/70"> · {hidden} hidden</span>}
        </span>

        {CHIPS.map((c) => {
          const on = chips.includes(c.key);
          return (
            <Button
              key={c.key}
              variant={on ? 'secondary' : 'ghost'}
              size="xs"
              aria-pressed={on}
              title={c.hint}
              className={cn('rounded-full', on && 'border border-ring')}
              onClick={() => setChips((prev) => (on ? prev.filter((k) => k !== c.key) : [...prev, c.key]))}
            >
              {c.label}{c.key === 'mine' && mineCount > 0 ? ` ${mineCount}` : ''}
            </Button>
          );
        })}
        <Button
          variant={showArchived ? 'secondary' : 'ghost'}
          size="xs"
          aria-pressed={showArchived}
          title={showArchived ? 'Back to the live board' : 'Show archived cards instead'}
          className={cn('rounded-full', showArchived && 'border border-ring')}
          onClick={() => setShowArchived((v) => !v)}
        >
          Archived{archivedCount ? ` ${archivedCount}` : ''}
        </Button>

        {unassignedOpen.length > 0 && (
          <Button
            variant="outline"
            size="xs"
            onClick={handOver}
            title={`Ask ${boss} to pick an owner for all ${unassignedOpen.length} unassigned open cards`}
          >
            {/* The count is the point: it says how much work one press hands
                over, before it happens. */}
            {unassignedOpen.length} unassigned → {boss}
          </Button>
        )}
        {bulkNote && <span className="text-xs text-muted-foreground">{bulkNote}</span>}

        {/* The board is deliberately read-only — {boss} writes it — so this is
            the toolbar's only answer to "how do I add a card". It was in the
            pixel toolbar (TasksKanban.tsx:216) and SPEC 6 asks for it by name;
            without it the answer only appears inside a card you have to open
            first (MD-92 S3). The Floor is where the dispatch box lives in this
            UI, so it points there, not at a pixel tab that does not exist. */}
        <button
          type="button"
          onClick={() => navigate('floor')}
          className="ml-auto rounded-md px-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          New work? Dispatch it to {boss} on the Floor
        </button>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by title or owner"
            aria-label="Filter tasks by title or assignee"
            className="h-8 w-56 pl-8 text-sm"
          />
        </div>
      </div>

      {/* ── Columns ──────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
        {COLUMNS.map((col) => {
          const cards = visible.filter((t) => t.status === col.key);
          const colIds = cards.map((t) => t.id);
          const colState = columnSelectState(selection, colIds);
          return (
            <section key={col.key} className="flex min-w-56 flex-1 flex-col rounded-lg border bg-sidebar">
              <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
                <span className={cn('size-1.5 rounded-full', col.dot)} aria-hidden />
                <h2 className="text-sm font-medium">{col.label}</h2>
                {/* A partial selection is spelled out — `3/8` — rather than drawn
                    as an indeterminate checkbox. Radix renders the same check
                    glyph for `indeterminate` as for `checked`, and the shadcn
                    wrapper hard-codes that indicator, so a half-selected column
                    would have looked exactly like a fully selected one. That
                    file is generated (`shadcn add` overwrites it), so the fix
                    belongs here, and a count is unambiguous besides. */}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {colState === 'some' ? `${colIds.filter((id) => selection.ids.includes(id)).length}/${cards.length}` : cards.length}
                </span>
                {/* Select-all, per column — the human's actual request ("a select
                    button in the Done section that selects them all"). It takes
                    the cards CURRENTLY VISIBLE in this column: a control under a
                    header reading "Done 3" must never select a fourth card the
                    filter is hiding. Hidden at zero rather than disabled, because
                    an empty column has nothing to explain. */}
                {cards.length > 0 && (
                  <Checkbox
                    className="ml-auto"
                    checked={colState === 'all'}
                    aria-label={colState === 'all'
                      ? `Clear the selection in ${col.label}`
                      : `Select all ${cards.length} cards in ${col.label}`}
                    title={colState === 'all'
                      ? `Clear the selection in ${col.label}`
                      : `Select all ${cards.length} in ${col.label}`}
                    onCheckedChange={() => setSelection((sel) => toggleColumn(sel, colIds))}
                  />
                )}
              </header>
              <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col gap-2 p-2">
                  {cards.length === 0 && (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">Nothing here</p>
                  )}
                  {cards.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      assigneeName={nameFor(t.assignee)}
                      selected={selection.ids.includes(t.id)}
                      onSelect={(shift) => setSelection((sel) => nextSelection(sel, t.id, shift, ordered))}
                      onOpen={() => openTaskDetail(t.id)}
                      onDismiss={() => void remove(t.id)}
                      onToggleArchive={() => void patch(t.id, { archived: !t.archived })}
                    />
                  ))}
                </div>
              </ScrollArea>
            </section>
          );
        })}
      </div>

      {/* ── Bulk bar — costs nothing while nothing is selected ────────────── */}
      <SelectionBar count={selected.length} onClear={() => setSelection(EMPTY_SELECTION)}>
        <AssignControl
          tasks={selected}
          onAssigned={(ids, assignee) => {
            setTasks((prev) => prev.map((t) => (ids.includes(t.id) ? { ...t, assignee } : t)));
            setSelection(EMPTY_SELECTION);
          }}
        />
        <DeleteTasksDialog tasks={selected} onConfirm={deleteSelected} />
      </SelectionBar>

      <TaskDetailSheet
        task={detail}
        all={tasks}
        assigneeName={nameFor(detail?.assignee)}
        onMove={(s) => { if (detail) void patch(detail.id, { status: s }); }}
        onAssigned={(ids, assignee) =>
          setTasks((prev) => prev.map((t) => (ids.includes(t.id) ? { ...t, assignee } : t)))}
        // Repaint on the answer rather than making the human watch a stale card
        // for 5s. taskActions has already written it.
        onAnswered={(qa: HumanQA[]) =>
          setTasks((prev) => prev.map((t) => (t.id === detail?.id ? { ...t, humanQA: qa } : t)))}
        onClose={closeTaskDetail}
      />
    </div>
  );
}
