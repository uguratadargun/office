import { useCallback, useEffect, useRef, useState } from 'react';
import { PixelPanel } from './PixelPanel';
import { PixelButton } from './PixelButton';
import { PixelBadge } from './PixelBadge';
import { Icon } from './Icon';
import { useDestructive } from './ui/DestructiveAction';
import { useStore } from '@/store/store';

export type { HumanQA, HiveTask } from '@/store/taskLedger';
import { type HiveTask, type HumanQA, matchesQuery, parseTasks, openQuestion, waitsOnHuman } from '@/store/taskLedger';
import { MICHAEL_DECIDES, answerTask, assignTasks } from '@/store/taskActions';
export { parseTasks, openQuestion, waitsOnHuman };

type Status = HiveTask['status'];

const COLUMNS: { key: Status; label: string; accent: string }[] = [
  { key: 'todo',    label: 'TODO',    accent: 'var(--cth-sky)' },
  { key: 'doing',   label: 'DOING',   accent: 'var(--cth-lemon)' },
  { key: 'blocked', label: 'BLOCKED', accent: 'var(--cth-coral)' },
  { key: 'done',    label: 'DONE',    accent: 'var(--cth-mint)' }
];

const POLL_MS = 5000;


/**
 * Task kanban over hive/tasks.json — a READ surface. Polls every 5s; cards
 * carry just the title and open the app-wide detail overlay on click. The god
 * is the ledger's writer: new work enters via the dispatch box (mailed to the
 * god), never by the human inserting cards the orchestrator never heard about.
 */
export function TasksKanban() {
  const agents = useStore((s) => s.agents);
  const [tasks, setTasks] = useState<HiveTask[]>([]);
  // Detail view: cards show just the title — clicking one opens the full
  // breakdown as an APP-WIDE overlay over the office floor (see
  // TaskDetailOverlay) — the content grows (contracts, deps, human Q&A), so it
  // gets the big stage instead of the narrow side panel.
  const openTaskDetail = useStore((s) => s.openTaskDetail);
  // Archived cards are hidden by default — the DONE column is append-only and
  // would otherwise grow until the board is unreadable. The filter is the only
  // way back to them (and to the unarchive button).
  const [showArchived, setShowArchived] = useState(false);
  // 38 of the board's 42 cards are done, so DONE is a wall you scroll rather
  // than a column you read. One box over the whole board, not per-column: the
  // card you are hunting is as often in doing or blocked as in done.
  const [query, setQuery] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try { setTasks(parseTasks(await window.cth.hiveTasks())); } catch { /* keep last good */ }
  }, []);

  // Dismiss a card off the board (human-initiated). The kanban is otherwise the
  // god's to write, but a person can clear a card they no longer want tracked.
  // Main removes the named id from its latest on-disk ledger, so a webhook or
  // god card added since this renderer's last poll cannot be lost.
  const dismissTask = useCallback(async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id)); // optimistic
    try {
      const result = await window.cth.hiveDeleteTask(id);
      if (!result.ok) void refresh();
    } catch { /* keep last good; the next poll re-syncs from disk */ }
  }, [refresh]);

  // Archive/unarchive a card. Same optimistic-then-resync shape as dismiss:
  // main patches the named id against its latest on-disk ledger, so a card
  // added since this renderer's last poll cannot be lost.
  const setArchived = useCallback(async (id: string, archived: boolean) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, archived: archived || undefined } : t)));
    try {
      const result = await window.cth.hivePatchTask(id, { archived });
      if (!result.ok) void refresh();
    } catch { /* keep last good; the next poll re-syncs from disk */ }
  }, [refresh]);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [refresh]);

  const restorableAgents = useStore((s) => s.restorableAgents);
  /** Resolve an assignee id to a display name — falls back to the restorable
   *  roster so a done card keeps its author's name even after that worker's
   *  terminal is gone, then to the raw id. */
  const nameFor = (id?: string): string | undefined =>
    id
      ? (agents.find((a) => a.id === id)?.name
        ?? restorableAgents.find((a) => a.id === id)?.name
        ?? id)
      : undefined;

  const archivedCount = tasks.filter((t) => t.archived).length;
  const onBoard = tasks.filter((t) => !!t.archived === showArchived);
  const visible = onBoard.filter((t) => matchesQuery(t, nameFor(t.assignee), query));
  const hidden = onBoard.length - visible.length;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--cth-paper-200)', position: 'relative' }}>
      {/* Toolbar — read-only: the god is the ledger's writer. New work enters
          through the dispatch box (which mails the god), not by the human
          inserting cards the orchestrator never heard about. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', flexShrink: 0,
        borderBottom: '1px solid var(--cth-ink-300)'
      }}>
        <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 9, color: 'var(--cth-ink-500)' }}>
          {visible.length} task{visible.length === 1 ? '' : 's'}
          {/* Say what the box is holding back, so a filtered board is never
              mistaken for an empty one. */}
          {hidden > 0 && <span style={{ color: 'var(--cth-ink-300)' }}> · {hidden} hidden</span>}
        </span>
        <button
          onClick={() => setShowArchived((v) => !v)}
          title={showArchived ? 'back to the live board' : 'show archived cards instead'}
          aria-pressed={showArchived}
          style={{
            padding: '2px 7px 1px', border: 'none', cursor: 'pointer',
            background: showArchived ? 'var(--cth-lemon)' : 'var(--cth-cream-200)',
            boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
            fontFamily: 'var(--cth-font-display)', fontSize: 9, color: 'var(--cth-ink-900)'
          }}
        >ARCHIVED{archivedCount ? ` (${archivedCount})` : ''}</button>
        {/* Kept: it is the toolbar's only answer to "how do I add a card", on a
            board that is deliberately read-only. */}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--cth-ink-300)' }}>
          new work? dispatch it to Michael (monitor tab)
        </span>
        {/* type=search for the platform's own clear affordance — no second
            button to build, and Escape empties it. */}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="filter by title or who"
          aria-label="filter tasks by title or assignee"
          style={{
            width: 180, flexShrink: 0, padding: '3px 6px', border: 'none',
            background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
            fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)', outline: 'none'
          }}
        />
      </div>

      {/* Columns */}
      <div style={{
        flex: 1, minHeight: 0, display: 'flex', gap: 8, padding: 10, overflowX: 'auto'
      }}>
        {COLUMNS.map((col) => {
          const cards = visible.filter((t) => t.status === col.key);
          return (
            <div key={col.key} style={{
              flex: '1 1 0', minWidth: 170, display: 'flex', flexDirection: 'column',
              background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px 4px',
                background: col.accent, boxShadow: 'inset 0 -1px 0 var(--cth-ink-900)',
                fontFamily: 'var(--cth-font-display)', fontSize: 9, color: 'var(--cth-ink-900)'
              }}>
                {col.label}
                <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: 'var(--cth-font-ui)' }}>{cards.length}</span>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {cards.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--cth-ink-300)', textAlign: 'center', padding: '8px 0' }}>—</div>
                )}
                {cards.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    accent={col.accent}
                    assigneeName={nameFor(t.assignee)}
                    onOpen={() => openTaskDetail(t.id)}
                    onDismiss={() => dismissTask(t.id)}
                    onToggleArchive={() => setArchived(t.id, !t.archived)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────
// Deliberately minimal — a colored status edge, the title, a whisper of an
// assignee. Everything else (the full contract, deps, controls) lives in the
// detail view a click away: a kanban card can carry a title at most.

function TaskCard({ task, accent, assigneeName, onOpen, onDismiss, onToggleArchive }: {
  task: HiveTask;
  accent: string;
  assigneeName?: string;
  onOpen: () => void;
  onDismiss: () => void;
  onToggleArchive: () => void;
}) {
  // Not `waitsOnHuman` (which is blocked-only): a card can be moved to done with
  // the human's questions still open — MD-2 in the live ledger has three — and
  // then the ask appears NOWHERE. The board is where you would look.
  const ask = openQuestion(task);
  const dismiss = useDestructive({ onRun: onDismiss });
  return (
    <div style={{ position: 'relative', display: 'flex', opacity: task.archived ? 0.65 : 1 }}>
      <button
        onClick={onOpen}
        title={task.title}
        style={{
          flex: 1, minWidth: 0,
          display: 'flex', alignItems: 'stretch', gap: 0, padding: 0,
          border: 'none', cursor: 'pointer', textAlign: 'left',
          background: 'var(--cth-paper-100)',
          boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)'
        }}
      >
        <span style={{ width: 4, flexShrink: 0, background: accent, boxShadow: 'inset -1px 0 0 var(--cth-ink-700)' }} />
        <span style={{ flex: 1, minWidth: 0, padding: '6px 34px 6px 7px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{
            fontFamily: 'var(--cth-font-ui)', fontSize: 12, lineHeight: '16px',
            color: 'var(--cth-ink-900)',
            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden'
          }}>{task.title}</span>
          {assigneeName && (
            <span style={{ fontSize: 10, color: 'var(--cth-ink-500)', fontFamily: 'var(--cth-font-display)' }}>
              {assigneeName.toUpperCase()}
            </span>
          )}
          {/* The question itself, not a bare "?" whose only explanation was a
              hover tooltip. If the board is asking you something, the board
              should say what. */}
          {ask && (
            <span style={{
              marginTop: 2, padding: '3px 5px',
              background: 'var(--cth-lilac-light)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
              fontSize: 11, lineHeight: '15px', color: 'var(--cth-ink-900)',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
            }}>
              <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 8, marginRight: 4 }}>ASKS YOU</span>
              {ask.q}
            </span>
          )}
        </span>
      </button>
      {/* Archive/unarchive — sibling button (not nested) so it never triggers
          onOpen. Archiving keeps the card in the ledger; only ✕ deletes it. */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleArchive(); }}
        title={task.archived ? 'unarchive this task (back onto the board)' : 'archive this task (kept in the ledger, off the board)'}
        aria-label={task.archived ? 'unarchive task' : 'archive task'}
        style={{
          position: 'absolute', top: 0, right: 16, width: 16, height: 16, padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
          border: 'none', cursor: 'pointer', background: 'transparent',
          color: 'var(--cth-ink-500)', fontFamily: 'var(--cth-font-ui)', fontSize: 11
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--cth-ink-900)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--cth-ink-500)'; }}
      >{task.archived ? '⤺' : '▤'}</button>
      {/* Dismiss — sibling button (not nested) so it never triggers onOpen.
          ARMS first: it sits 16px from the archive glyph, both unlabelled 16x16,
          and only one of them is reversible. A mis-aimed click used to delete a
          card outright with no confirm and no undo. */}
      <button
        onClick={(e) => { e.stopPropagation(); dismiss.press(); }}
        title={dismiss.phase === 'armed'
          ? 'click again to delete this card permanently'
          : 'dismiss this task (removes it from the board)'}
        aria-label={dismiss.phase === 'armed' ? 'confirm delete task' : 'dismiss task'}
        style={{
          position: 'absolute', top: 0, right: 0, height: 16, padding: dismiss.phase === 'armed' ? '0 4px' : 0,
          width: dismiss.phase === 'armed' ? 'auto' : 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
          border: 'none', cursor: 'pointer',
          background: dismiss.phase === 'armed' ? 'var(--cth-coral)' : 'transparent',
          color: dismiss.phase === 'armed' ? 'var(--cth-ink-900)' : 'var(--cth-ink-500)',
          fontFamily: dismiss.phase === 'armed' ? 'var(--cth-font-display)' : 'var(--cth-font-ui)',
          fontSize: dismiss.phase === 'armed' ? 8 : 12
        }}
        onMouseEnter={(e) => { if (dismiss.phase !== 'armed') e.currentTarget.style.color = 'var(--cth-coral)'; }}
        onMouseLeave={(e) => { if (dismiss.phase !== 'armed') e.currentTarget.style.color = 'var(--cth-ink-500)'; }}
      >{dismiss.phase === 'armed' ? 'DELETE?' : '✕'}</button>
    </div>
  );
}

// ─── Detail view ─────────────────────────────────────────────────────────────
// The full breakdown of one task: status, assignee, priority, the complete
// description (the god writes 4-part dispatch contracts in there — preserved
// line by line), dependencies resolved to their titles, the human Q&A trail,
// and the move/assign controls that used to crowd every card. Rendered as an
// APP-WIDE overlay (over the office floor) — this content grows, so it gets
// the big stage instead of the narrow side panel. Exported for App's
// TaskDetailOverlay; opened via the store's openTaskDetail from anywhere.

export function TaskDetail({ task, all, assigneeName, onMove, onAssigned, onAnswered, onClose }: {
  task: HiveTask;
  all: HiveTask[];
  assigneeName?: string;
  onMove: (s: Status) => void;
  /** Cards that actually changed hands — repaint rather than wait out the poll. */
  onAssigned: (ids: string[], assignee: string) => void;
  /** The card's Q&A after the human answered here, so the overlay repaints
   *  without waiting out its 5s poll. */
  onAnswered: (qa: HumanQA[]) => void;
  onClose: () => void;
}) {
  // ─── Dialog semantics, delegated to the platform ───────────────────────────
  // A window-level Escape listener got the key working, but Escape is only one
  // item on the list: focus still sat on the card BEHIND this overlay, so Tab
  // walked the office floor instead of the dialog, the background was never
  // inert, and a screen reader was told nothing about a modal being open.
  // showModal() is that whole list in one call — role + aria-modal implied,
  // focus moved in and restored to the opener, a focus trap, background inert,
  // and Escape — none of which we then have to keep correct by hand.
  const dialogRef = useRef<HTMLDialogElement>(null);
  /** Set while WE close the element on unmount, so the resulting `close` event
   *  doesn't call onClose again on a component already going away. */
  const unmountingRef = useRef(false);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;

  useEffect(() => {
    const el = dialogRef.current;
    if (!el || el.open) return;
    // A NATIVE listener, not React's onClose prop: React 18 does not dispatch
    // cancel/close for <dialog>, so the prop typechecks and silently never
    // fires — Escape would shut the element while React still thought it open,
    // and re-opening the same card would then do nothing.
    const onNativeClose = (): void => { if (!unmountingRef.current) onCloseRef.current(); };
    el.addEventListener('close', onNativeClose);
    el.showModal();
    return () => {
      unmountingRef.current = true;
      el.removeEventListener('close', onNativeClose);
      if (el.open) el.close();
    };
  }, []);

  const col = COLUMNS.find((c) => c.key === task.status) ?? COLUMNS[0];
  // Belt + suspenders: parseTasks normalizes these, but the ledger is a
  // hand-written file — never trust a card's shape at the point of use.
  const deps = (task.dependsOn ?? [])
    .map((id) => all.find((t) => t.id === id))
    .filter((t): t is HiveTask => !!t);
  const created = new Date(task.createdAt);
  const closed = task.closedAt ? new Date(task.closedAt) : null;
  const open = openQuestion(task);
  return (
    <dialog
      ref={dialogRef}
      aria-label={`Task: ${task.title}`}
      // A click landing on the dialog element itself is a backdrop click — the
      // panel below stops propagation, so nothing inside it reaches here.
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, width: '100vw', maxWidth: '100vw',
        height: '100vh', maxHeight: '100vh',
        margin: 0, padding: 24, border: 'none',
        // The scrim token, not the rgba literal that predated it.
        background: 'var(--cth-overlay)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box'
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: 720, maxWidth: '94vw', maxHeight: '90vh', display: 'flex' }}>
        <PixelPanel variant="dialog" title="TASK" noPadding style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: 0 }}>
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, overflowY: 'auto' }}>
            {/* Title under a status-colored bar */}
            <div style={{ borderLeft: `4px solid ${col.accent}`, paddingLeft: 8 }}>
              <div style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 15, lineHeight: '20px', color: 'var(--cth-ink-900)' }}>
                {task.title}
              </div>
            </div>

            {/* Fact row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                fontFamily: 'var(--cth-font-display)', fontSize: 8, padding: '2px 6px 1px',
                background: col.accent, color: 'var(--cth-ink-900)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
              }}>{col.label}</span>
              {assigneeName
                ? <PixelBadge status="working" label={assigneeName} />
                : <span style={{ fontSize: 11, color: 'var(--cth-ink-300)' }}>unassigned</span>}
              <PriorityDots level={Math.max(1, Math.min(5, task.priority))} />
              {task.origin && (
                <span title={task.origin} style={{
                  minWidth: 0, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontSize: 11, color: 'var(--cth-ink-500)'
                }}>from {task.origin}</span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--cth-ink-500)', fontFamily: 'var(--cth-font-display)' }}>
                {isNaN(created.getTime()) ? '' : created.toLocaleString()}
                {closed && !isNaN(closed.getTime()) ? ` → ${closed.toLocaleString()}` : ''}
              </span>
            </div>

            {/* The contract — preserved line by line */}
            <div style={{
              padding: 10, background: 'var(--cth-paper-100)',
              boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
              fontFamily: 'var(--cth-font-mono)', fontSize: 12, lineHeight: '18px',
              color: 'var(--cth-ink-900)', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
            }}>
              {task.description?.trim() || <span style={{ color: 'var(--cth-ink-300)' }}>(no description on this card)</span>}
            </div>

            {/* What the assignee reported back. Present on every real card and,
                until this change, rendered nowhere — so a finished task's whole
                outcome was written to the ledger and never seen. */}
            {task.result && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 8, color: 'var(--cth-ink-500)' }}>
                  RESULT
                </div>
                <div style={{
                  padding: 10, background: 'var(--cth-mint-light)',
                  boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
                  fontFamily: 'var(--cth-font-mono)', fontSize: 12, lineHeight: '18px',
                  color: 'var(--cth-ink-900)', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
                }}>{task.result}</div>
              </div>
            )}

            {/* The human Q&A trail — every decision documented on the card. The
                one still-open entry gets a box to answer it in; older unanswered
                ones were superseded and say so. */}
            {(task.humanQA?.length ?? 0) > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 8, color: 'var(--cth-ink-500)' }}>
                  HUMAN Q&A
                </div>
                {task.humanQA!.map((e, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{
                      padding: '5px 7px', background: 'var(--cth-lilac-light)',
                      boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
                      fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-900)', whiteSpace: 'pre-wrap'
                    }}>
                      <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 8, marginRight: 6 }}>Q</span>
                      {e.q}
                    </div>
                    {e.a ? (
                      <div style={{
                        padding: '5px 7px', background: 'var(--cth-mint-light)',
                        boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
                        fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-900)', whiteSpace: 'pre-wrap'
                      }}>
                        <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 8, marginRight: 6 }}>A</span>
                        {e.a}
                      </div>
                    ) : e === open ? (
                      // The board knew what was needed and sent you to another
                      // tab to type it. Answer it where you are reading it.
                      <AnswerBox task={task} onAnswered={onAnswered} />
                    ) : (
                      <div style={{ fontSize: 11, color: 'var(--cth-ink-300)', fontFamily: 'var(--cth-font-display)' }}>
                        NO ANSWER — SUPERSEDED BY A LATER ASK
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Dependencies, resolved to titles */}
            {deps.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 8, color: 'var(--cth-ink-500)' }}>
                  DEPENDS ON
                </div>
                {deps.map((d) => {
                  const dc = COLUMNS.find((c) => c.key === d.status) ?? COLUMNS[0];
                  return (
                    <div key={d.id} style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px',
                      background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
                      fontSize: 12, color: 'var(--cth-ink-700)'
                    }}>
                      <span style={{ width: 8, height: 8, background: dc.accent, boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <select
                value={task.status}
                onChange={(e) => onMove(e.target.value as Status)}
                style={{
                  flex: 1, padding: '4px 6px', background: 'var(--cth-paper-100)', border: 'none',
                  boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', fontFamily: 'var(--cth-font-ui)',
                  fontSize: 12, color: 'var(--cth-ink-900)', cursor: 'pointer'
                }}
              >
                {COLUMNS.map((c) => (<option key={c.key} value={c.key}>{c.label.toLowerCase()}</option>))}
              </select>
              <AssignControl tasks={[task]} onAssigned={onAssigned} />
              <PixelButton variant="ghost" size="sm" onClick={onClose}>close</PixelButton>
            </div>
          </div>
        </PixelPanel>
      </div>
    </dialog>
  );
}

/**
 * Hand cards to someone. The only place in the app that assigns.
 *
 * "Michael decides" is the empty option, exactly as the Monitor dispatch box
 * spells it, and it writes NO assignee — picking the owner is the thing being
 * delegated, so the god gets the list and does it. A named agent gets the
 * assignee written and a request mailed to them; the god is told separately so
 * it does not re-dispatch work that already has an owner. All of that lives in
 * assignTasks(); this is the picker in front of it.
 *
 * No arming step: the count and the target are IN the button ("assign 7 to
 * Jim"), which is the thing a confirm dialog would have told you, one click
 * earlier. Assignment is also not destructive — it is re-assignable.
 */
function AssignControl({ tasks, onAssigned }: {
  tasks: HiveTask[];
  onAssigned: (ids: string[], assignee: string) => void;
}) {
  const agents = useStore((s) => s.agents);
  const [to, setTo] = useState<string>(MICHAEL_DECIDES);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const target = agents.find((a) => a.id === to);
  const n = tasks.length;

  const run = async () => {
    if (!n || busy) return;
    setBusy(true); setNote('');
    try {
      const { assigned, failed } = await assignTasks(tasks, to, target?.name ?? 'Michael');
      // A partial bulk is reported, never hidden — the board would otherwise show
      // owners for cards the ledger never accepted.
      if (failed.length) setNote(`${assigned.length} assigned, ${failed.length} refused`);
      else setNote(to === MICHAEL_DECIDES ? 'sent to Michael' : `assigned to ${target?.name ?? to}`);
      // Only the cards the ledger actually took. "Michael decides" writes no
      // assignee at all, so it repaints nothing — showing an owner the file does
      // not have is the lie this whole card set out to remove.
      if (assigned.length) onAssigned(assigned, to);
    } catch {
      setNote('could not send — nothing changed');
    }
    setBusy(false);
    setTimeout(() => setNote(''), 4000);
  };

  return (
    <>
      <select
        value={to}
        onChange={(e) => setTo(e.target.value)}
        aria-label="assign to"
        style={{
          padding: '4px 6px', background: 'var(--cth-paper-100)', border: 'none',
          boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', fontFamily: 'var(--cth-font-ui)',
          fontSize: 12, color: 'var(--cth-ink-900)', cursor: 'pointer', minWidth: 0
        }}
      >
        <option value={MICHAEL_DECIDES}>Michael decides</option>
        {agents.filter((a) => !a.isGod).map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>
      <PixelButton variant="secondary" size="sm" onClick={() => void run()} disabled={!n || busy}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
          <Icon name="arrow-right" />
          {busy ? 'sending…' : `assign${n > 1 ? ` ${n}` : ''}${target ? ` to ${target.name}` : ''}`}
        </span>
      </PixelButton>
      {note && (
        <span style={{ fontSize: 11, fontFamily: 'var(--cth-font-mono)', color: 'var(--cth-ink-500)' }}>{note}</span>
      )}
    </>
  );
}

/** Answer the card's open ask without leaving the card.
 *
 *  The draft lives in the SAME store slice ASK ME uses, keyed by task id, so a
 *  half-typed answer survives closing the overlay, switching tabs, and being
 *  finished on the other board. Both surfaces go through answerTask(), so the
 *  card write and the mail to the god cannot come apart. */
function AnswerBox({ task, onAnswered }: { task: HiveTask; onAnswered: (qa: HumanQA[]) => void }) {
  const draft = useStore((s) => s.answerDrafts[task.id] ?? '');
  const setAnswerDraft = useStore((s) => s.setAnswerDraft);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    if (!draft.trim() || sending) return;
    setSending(true); setError('');
    try {
      const qa = await answerTask(task, draft);
      // null = the ledger refused, so nothing was mailed either. Say so and keep
      // the draft rather than clearing a box whose contents went nowhere.
      if (qa) { onAnswered(qa); setAnswerDraft(task.id, ''); }
      else setError('the card changed underneath — nothing was sent, try again');
    } catch {
      setError('could not send — nothing was saved, try again');
    }
    setSending(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <textarea
        value={draft}
        onChange={(e) => setAnswerDraft(task.id, e.target.value)}
        // Cmd/Ctrl+Enter sends; plain Enter stays a newline, because an answer
        // is prose and often several lines. Same contract as the dispatch box.
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
        }}
        rows={3}
        placeholder="Answer this, or say what you did about it…"
        aria-label="your answer"
        style={{
          width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: 'none', resize: 'vertical',
          background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
          fontFamily: 'var(--cth-font-mono)', fontSize: 12, lineHeight: '17px',
          color: 'var(--cth-ink-900)', outline: 'none'
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <PixelButton variant="primary" size="sm" onClick={() => void send()} disabled={!draft.trim() || sending}>
          {sending ? 'sending…' : 'send answer'}
        </PixelButton>
        <span style={{
          fontSize: 11, fontFamily: 'var(--cth-font-mono)',
          color: error ? 'var(--cth-coral)' : 'var(--cth-ink-300)'
        }}>
          {error || 'goes on the card and to Michael, who unblocks it'}
        </span>
      </div>
    </div>
  );
}

function PriorityDots({ level }: { level: number }) {
  // 1 = lowest, 5 = highest. Warmer fill as priority climbs.
  const color = level >= 4 ? 'var(--cth-coral)' : level === 3 ? 'var(--cth-lemon)' : 'var(--cth-mint)';
  return (
    <span title={`Priority ${level}/5`} style={{ display: 'inline-flex', gap: 1, flexShrink: 0, marginTop: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{
          width: 4, height: 8,
          background: i <= level ? color : 'var(--cth-cream-200)',
          boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
        }} />
      ))}
    </span>
  );
}
