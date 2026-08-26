# MD-86 · modern/askme — Ask Me board (SPEC, phase 1)

Source of truth read: `components/AskMeTab.tsx` (234 ln), `store/taskActions.ts`,
`src/shared/humanQa.ts`, and Jim's `fix/askme-canonical` (MD-83) diff. Pixel UI untouched.

## Canonical source (MD-83, MERGED to main `53f70e5c` — consume, do not re-derive)
"Is the human being asked something?" is decided **once**, in `@shared/humanQa`, and re-exported
through `store/taskLedger`. Import `openQuestion` / `waitsOnHuman` from `@/store/taskLedger`
(thin re-exports of `openAsk` / `waitsOnHuman`) so the rebase onto MD-83 is a no-op.

Two things change under MD-83 and this board must be built for the NEW meaning:
- `waitsOnHuman` no longer requires `status === 'blocked'` — **any** card with an open ask is
  listed, whatever column it sits in (a card can reach `done` with the ask still open).
- Archived cards with an open ask **are** listed here (they have nowhere else to appear);
  `badgeCounts().askMe` matches that filter exactly. Never filter by status in this view.

## Data / IPC / store (reuse verbatim — no main-process change needed)
| Call | Use |
|---|---|
| `window.cth.hiveTasks()` → `parseTasks(raw)`, poll `TASK_POLL_MS` (5000) | the list |
| `taskLedger.waitsOnHuman(t)` | the ONLY filter |
| `taskLedger.openQuestion(t)` | the entry being answered |
| `taskActions.answerTask(task, text)` → `HumanQA[] \| null` | writes the answer onto the card's humanQA entry **and** mails the god (one call — never two copies of "file it AND mail it"). `null` = refused → keep the draft, show retry. |
| `taskActions.dismissAsk(task)` + `withDismissal(task, open, nowIso)` | clear an ask off the board WITHOUT answering: marks `dismissedAt`, question stays on the card (history is never dropped), task stays blocked on the kanban. Optimistic through `withDismissal` so the removed card and the saved card cannot disagree; restore on failure. |
| store `answerDrafts` / `setAnswerDraft` | drafts MUST live in the store — the view unmounts on tab switch and a half-typed answer has to survive it. |
| store `answerChoices` / `setAnswerChoice` | the picked letter, same reason: a click on (b) is unsent input too (MD-142). |
| `@shared/askOptions` — `askOptions(entry)`, `composeAnswer(key, note)`, `chosenOption(entry)` | the lettered options in an ask, and the payload a pick produces. The payload for a plain pick is the LETTER, byte for byte what the human used to type — every agent reads `humanQA[n].a` and must not learn a second vocabulary. `entry.options` (explicit) wins over the parse of `q`; `parseTasks` must preserve it (same trap as `tgMessageId`). |
| store `openTaskDetail(id)`, `agents`, `restorableAgents` | jump to the full card; `nameFor` = agents → restorable → raw id |
| `dependentsTree(id, all)` (local, cycle-safe) | the downstream cascade |

**Telegram-mirrored indicator**: `HumanQA.tgMessageId` (number) is set once the ask has been
mirrored to the chat; `fromMessageId` (MD-83) marks an ask raised from mail. Render a quiet
`Badge` ("mirrored to Telegram") when `tgMessageId` is present — read-only, no write. Neither
field may be dropped: `parseTasks` rebuilds each entry field-by-field and answering writes the
whole array back, so a dropped field re-sends the ask to the chat.

## Features that must survive
1. One card per open ask, newest ledger order. Empty state: "Nothing needs you right now." plus
   the explainer (MD-83 wording: "…whatever column the card is sitting in").
2. Card header: task title (button → `openTaskDetail`), assignee badge, mirrored indicator,
   `✕` dismiss (tooltip: clears the board without answering, history kept).
3. The question, pre-wrap, at reading size — the STEM only when it carries options
   (`askOptions(ask).stem`), because the options are rendered as the list below and printing
   them twice makes one question look like two. `askme/OptionAnswer.tsx` renders the list
   (radiogroup, `ring-2 ring-ring` on the pick, letters + arrows via the pure
   `askme/optionKeys.ts`); it is presentational — `tasks/AnswerBox.tsx` owns the draft, the
   pick and the write, and is the one place both boards get this from. Picking is never
   committing: the textarea stays live for "none of these" or a note, and clicking the pick
   again releases it.
4. Answer `Textarea` (3 rows) + `respond & unblock` button; **Ctrl/Cmd+Enter sends**; disabled
   while empty or sending; "sending…" label.
5. `VIEW n EARLIER ANSWERS` link when the card has answered entries → opens the detail.
6. Cascade: `BLOCKING n DOWNSTREAM TASKS`, first 6 indented with a status dot (blocked = danger,
   else info) + assignee, then `… +n more`.

## Screen (text wireframe)
```
┌─ Ask me ─────────────────────────────────── 2 open ──────────────────────────┐
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ MD-55 Telegram control  ⬤Ryan  ⟨mirrored to Telegram⟩                 ✕ │ │ ← header, muted bg, hairline
│ ├──────────────────────────────────────────────────────────────────────────┤ │
│ │ I need a BotFather token and the chat id before the live E2E can run.    │ │ ← 14px, pre-wrap
│ │ ┌──────────────────────────────────────────────────────────────────────┐ │ │
│ │ │ Your answer — or 'done', with the result…      (⌘↵ to send)          │ │ │ ← Textarea, r8
│ │ └──────────────────────────────────────────────────────────────────────┘ │ │
│ │ [ Respond & unblock ]   view 2 earlier answers                           │ │
│ │                                                                          │ │
│ │ Blocking 3 downstream tasks                                              │ │ ← danger-tinted label
│ │  └ ● MD-58 humanQA mirror        (Ryan)                                  │ │
│ │    └ ● MD-63 appId rename        (Jim)                                   │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│ ┌── next ask … ────────────────────────────────────────────────────────────┐ │
└──────────────────────────────────────────────────────────────────────────────┘
Single scrolling column, max-width ~880px centred — these are prose, not a grid.
```

## Components (all from `modern/components/ui`, `npx shadcn add` if missing)
`Card`, `Badge`, `Button`, `Textarea`, `ScrollArea`, `Tooltip`, `Separator`.
Nav entry via MD-84's registry file only.

## Risks
- Answer/dismiss must go through `taskActions` (never a local write): the Tasks detail sheet
  answers the same asks, and a second copy is one copy away from an answer that is filed and
  never acted on.
- MD-83 has landed; this branch is rebased on it. My files are new, so nothing conflicts.
