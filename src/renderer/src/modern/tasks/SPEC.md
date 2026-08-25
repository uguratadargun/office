# MD-86 · modern/tasks — Kanban + task detail (SPEC, phase 1)

Source of truth read: `components/TasksKanban.tsx` (830 ln), `components/TaskDetailOverlay.tsx`,
`store/taskLedger.ts`, `store/taskActions.ts`. **No behaviour is invented here** — this is the
pixel board's feature list restated for the modern shell. Pixel UI stays untouched.

## Data / IPC / store (reuse verbatim — no main-process change needed)
| Call | Use |
|---|---|
| `window.cth.hiveTasks()` → `parseTasks(raw)` | poll `hive/tasks.json` every `TASK_POLL_MS` (5000). NEVER feed raw ledger entries to the detail — `parseTasks` normalizes `dependsOn`/`priority`/`humanQA`. |
| `window.cth.hivePatchTask(id, {status\|archived})` | move column, archive/unarchive. Optimistic then `refresh()` on `!ok`. |
| `window.cth.hiveDeleteTask(id)` | dismiss card off board (two-press arm/confirm, `useDestructive`). |
| `taskActions.assignTasks(tasks, to, name)` / `MICHAEL_DECIDES` | the app's ONLY assign path. Empty string = "Michael decides" (writes no assignee). |
| `taskActions.nudge(task)` | ask the owner for a status. |
| `taskActions.answerTask(task, text)` → `HumanQA[] \| null` | writes the answer on the card **and** mails the god. `null` = ledger refused → keep the draft. |
| `taskLedger`: `openQuestion`, `waitsOnHuman`, `matchesChips`, `matchesQuery`, `badgeCounts`, `COLUMNS`-equivalent, `BoardChip` | pure — import, don't re-derive. |
| store: `bossName`, `agents`, `restorableAgents`, `openTaskDetail/closeTaskDetail/taskDetailId`, `answerDrafts/setAnswerDraft` | drafts must live in the store — the view unmounts on tab switch. |
| pure selection: `EMPTY_SELECTION`, `nextSelection`, `pruneSelection` | multi-select incl. shift-range over the VISIBLE order. |

`nameFor(id)` = `agents` → `restorableAgents` → raw id (a done card keeps its author's name after
the worker's terminal is gone).

## Features that must survive
1. **Four columns** todo / doing / blocked / done, each with a count. Status accent is a *token*
   in modern (`--m-status-*`), not the pixel `--cth-*` hue.
2. **Toolbar**: `N tasks · M hidden`; chips `UNASSIGNED` / `BLOCKED` / `MINE (n)` (MINE = open ask,
   any status, counted over the whole board not the filtered view); `ARCHIVED (n)` toggle (archived
   hidden by default — DONE is append-only); `N unassigned → {boss}` bulk hand-over with its
   transient result note; search box (`type=search`, title **or** assignee).
3. **Card**: title only (+ priority dots, assignee badge, open-ask marker), click → detail;
   hover actions nudge / archive / dismiss(arm→confirm); checkbox select, shift = range.
4. **Bulk bar** while selection non-empty: `N SELECTED`, assign control, clear.
5. **Detail sheet**: title under status accent, fact row (status, assignee, priority 1-5, `from
   {origin}`, created → closed), description (pre-wrap mono), **RESULT**, **HUMAN Q&A** history
   (Q / A pairs; the one open entry gets an inline answer box; older unanswered = "superseded"),
   **DEPENDS ON** resolved to titles + status dot, status `Select`, assign control, close.
6. **Read-only board**: no card creation. Keep the line "new work? dispatch it to {boss}".
7. **No drag in the parity build** — the pixel board has none; status changes via the detail's
   status select. God's call (25 Aug): once parity is done, if native HTML5 drag between columns
   costs **<50 lines**, add it as the LAST commit; otherwise leave it out.
8. Selection is **pruned every poll** — cards get filtered/archived/deleted under it.
9. Detail stays app-wide: `openTaskDetail(id)` from anywhere opens the same sheet, with its own 5s poll.

## Screen (text wireframe)
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 12 tasks · 3 hidden   [unassigned][blocked][mine 2][archived 38]  4 → Michael │  ← 40px bar, hairline bottom
│                                    new work? dispatch it to Michael  [search] │
├───────────────┬───────────────┬───────────────┬──────────────────────────────┤
│ Todo      4   │ Doing     2   │ Blocked   1   │ Done                    5    │  ← col head: 12px caps, count muted
│ ┌───────────┐ │ ┌───────────┐ │ ┌───────────┐ │ ┌──────────────────────────┐ │
│ │▎MD-90 …   │ │ │▎MD-84 …   │ │ │▎MD-77 …   │ │ │▎MD-82 …                  │ │  ← Card: 1px border, r8,
│ │ ◆◆◇ ⬤Jim  │ │ │ ◆◆◆ ⬤Orcun│ │ │ ⚠ asks you│ │ │ ✓ Ryan                   │ │    hover → actions right
│ └───────────┘ │ └───────────┘ │ └───────────┘ │ └──────────────────────────┘ │
└───────────────┴───────────────┴───────────────┴──────────────────────────────┘
│ 2 selected   [Assign to ▾] [Assign]                                  [Clear]  │  ← only while selected
└──────────────────────────────────────────────────────────────────────────────┘

Detail = right-side Sheet (640px) — a modal Dialog re-creates the pixel <dialog>
focus-trap work for no gain and blocks reading the board behind it:
  ▎MD-86  modern UI — Tasks kanban + Ask Me board          [status ▾] [assign ▾]
  Doing · Ryan · ◆◆◆◇◇ · from slack:#hive · 25 Aug 11:25
  ── Description ────────────────────────  (mono, pre-wrap, scroll)
  ── Result ─────────────────────────────  (present when set)
  ── Human Q&A ──────────────────────────  Q/A stack, open one → inline answer box
  ── Depends on ─────────────────────────  ● title, ● title
```

## Components (all from `modern/components/ui`, `npx shadcn add` if missing)
`Card`, `Badge`, `Button`, `Input`, `Select`, `Textarea`, `ScrollArea`, `Sheet`, `Checkbox`,
`Toggle`/`ToggleGroup` (chips), `Tooltip`, `Separator`. Nav entry via MD-84's registry file only.

## Risks
- `parseTasks` REBUILDS each humanQA entry field-by-field; any field it drops is wiped by the 5s
  re-parse (`tgMessageId`, `fromMessageId`). Do not add card fields in this area.
- MD-83 is **merged** (main `53f70e5c`): `openQuestion`/`waitsOnHuman` are now `@shared/humanQa`
  re-exports through `taskLedger`. Import them from `@/store/taskLedger`, never re-derive.
- Detail sheet confirmed as a shadcn `Sheet`, not a modal `Dialog` (god, 25 Aug).
