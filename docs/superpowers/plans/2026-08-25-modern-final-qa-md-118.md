# MD-118 — Modern UI final packaged QA, part 1

**Areas:** IDE · Issues & PRs · Settings · Messages · Triggers/Voice · Tasks · Ask Me · Integrations.
Agents and Floor are part 2 (someone else — they are my own MD-114).

**Base:** main `24342037` (1084 tests). Main moved to `4b39d37f` (MD-116) while this ran — see Issues. Packaged build (`npm run build`), launched with
`env -u ELECTRON_RENDERER_URL` + `playwright-core`'s `_electron.launch` on a scratch profile.
Slack, Telegram and webhooks OFF; `autoMode:false`, `missions:[]`, `notifications:false`;
`ui.mode` seeded to `modern`. Both themes driven through the shell's own topbar toggle — never by
stamping `data-cth-theme` (asserted `document.documentElement` after each flip).

**Severity:** S1 = blocks making modern the default (a capability the human loses, or a destructive
action made easier). S2 = notable degradation, ship-blocking for a power user. S3 = polish.

**Screenshots:** `$AGENT_DIR/artifacts/md-118/` (16, light + dark).

## Verdict

**ready for default: YES — no S1, no blockers.**
Two findings, both S2/S3, both in the IDE, neither a lost capability.

---

## Method, and what it is worth

Fixtures, because these views are all data-driven and an empty one proves nothing:

| Fixture | For |
|---|---|
| `tasks.json`: 7 cards across all four columns — unassigned, blocked, archived, a dependency chain, two open `humanQA` asks (one Telegram-mirrored), one answered ask, one `result` | Tasks, Ask Me |
| Shallow `sharkdp/fd` clone registered in `registeredRepos` (10+ open issues, 61 open PRs, labels, linked PRs) — Pam's trick; this repo has no open issues or PRs of its own | Issues & PRs |
| That same clone dirtied on purpose: a 141-line append to `src/main.rs`, a deleted `CONTRIBUTING.md`, an untracked file | IDE (a diff big enough to tear) |
| An agent seeded with `cwd` = the clone | IDE (the IDE follows the SELECTION — see S3 below) |
| `inbox/`, `inbox/.done/` and `outbox/` messages on that agent, one conversation | Messages |

**Caveat, stated because it changed a fixture under me:** the scratch hive spawns a REAL god
(the god bootstrap is unconditional — `autoMode:false` does not stop it). Mid-run it read the
board and my seeded `outbox` message and rewrote `tasks.json`: MD-201 moved `doing → done` and
gained a `result` I never wrote. That is the orchestrator doing its job, not a defect, and the
board re-rendered it live — which is itself a pass for the Tasks poll. But anyone reusing this
recipe should expect a live agent editing their fixture, and should not read a task-state change
as a UI bug. Everything I report below was re-read after that mutation.

**Uncaught errors:** every run registered `pageerror` and `console.error` listeners for its whole
life. Across five sessions covering every area in both themes: **0 and 0.** The per-run counts are
in `errors.json`, `ide-errors.json`, `rest-errors.json`, `full-errors.json`, `probe-errors.json`.

---

## IDE — PASS, with one S2 and one S3

MD-110 (the diff tear / dispose error) is the headline, so it got the hardest run:

| Exercise | Result |
|---|---|
| Open a 141-line-changed file as a side-by-side diff | 3 Monaco panes mount, header reads `main.rs (diff)` |
| Scroll the diff 18 × 800px down, then back up | no torn or blank rows; **0 errors** |
| Swap between two files 10 times | Monaco pane count stays at 3 — no leak; **0 errors** |
| Close every open tab | **0 errors** — specifically no `TextModel got disposed before DiffEditorWidget model got reset` |
| Navigate away to Tasks and back, ×3 (`ViewBoundary` unmounts the whole view) | tabs and buffers survive; **0 errors** |

`createDiffSession` owning the teardown order is holding. Changes / History / Compare / Search
rails all populate against a real repo (History resolves the tip commit and author; Compare offers
base/head with a swap; Search offers regex + case).

### S2 — the Changes rail prints raw `git` stderr when the workspace is not a repo

**Repro:** select Michael (or open the IDE on a fresh install, where god is the only agent) → IDE.
The Changes rail shows, in destructive red:

```
fatal: not a git repository (or any of the parent directories): .git
```

**Why it matters, and why it is not just my fixture:** god's `cwd` is the harness home, and a
harness home is not a git repository — on this very machine `/Users/ugur/HarnessAgents` has no
`.git` (only `hive/` does). So this is the DEFAULT state of the IDE for anyone who has not
selected a different agent, including every first run.

**The parity half:** the pixel IDE asks first —
`src/renderer/src/ide/IdePanel.tsx:340` `const repo = await window.cth.gitIsRepo(root); if (!repo) { setStatus(null); return; }` — so it never renders an error for this case at all.
`modern/ide/GitRail.tsx:117` goes straight to `gitStatus` and renders `state.error` verbatim
(`:130`). `gitIsRepo` is listed in `modern/ide/SPEC.md` as required IPC for this rail and is not
called anywhere in `modern/ide/`.

**Fix shape (not applied — QA card):** call `gitIsRepo` before `gitStatus` and render a plain
"this folder isn't a git repository" empty state. Shot: `02-ide-nonrepo-raw-git-error.png`.

### S3 — "(assumed)" is shown even when the agent was chosen explicitly

`pickTarget` (`IdeView.tsx:45`) marks anything past `pinnedId` as `inferred`, and `pinnedId` is
only set by "Open IDE" on an agent. Reaching the IDE from the nav rail — the ordinary route — is
therefore *always* "assumed", even immediately after clicking that agent in the roster. The word
exists to stop you trusting the wrong directory ("Never assert a name we had to guess at"), and a
warning that never varies stops carrying information. Selecting the agent in Agents and then
opening the IDE should count as naming it.

---

## Issues & PRs — PASS

MD-111's chip actions are live and correct against 10 issues / 61 PRs.

| Checked | Result |
|---|---|
| Issue rows: number, title, labels, `Assign` | parity |
| Linked-PR chips on an issue, with state (`ready`, `changes requested`, `draft`) and CI dot | present; an issue with three linked PRs renders three chips |
| `Review` on a chip, gated on the PR still being open (`canReview`) | present — chips for merged/closed PRs correctly show no `Review` |
| `→Michael` (Report) beside each chip | present on both the issue chips and the PR rows |
| Repo picker label, basename first (`repoLabel`) | `fd — /private/tmp/…` — the trigger truncates at the END, so the identifying half survives, which is the whole point of MD-111 |
| `Assigned to me` filter, search box, `Showing the first 10 — narrow it with the search box` cap note | parity |
| PRs tab count badge | `61` |

**The PR watcher is a 60 s poll** — `githubPRs()` returns `{prs:[], error:null}` for up to a minute
after a repo is registered, which is indistinguishable from a real empty. I waited it out before
judging (Pam's note; it cost me one run to re-learn).

Review itself was known-broken at my base and is not exercised or reported, per the card.
**It stopped being broken while this QA was running:** MD-116 merged to main as `4b39d37f`, after
`24342037`. Local PR review is therefore untested by anyone as of this document — it needs a pass,
on both the PR row and the issue chip (MD-111 generalised the control, and Pam's note records that
generalising a control means re-checking where its ERROR lands, not just its button).

## Settings — PASS

All seven sections render and populate: General, Agents & Models, Autonomy & Budgets, Connections,
Voice, Memory & Knowledge, Prerequisites.

- **Prerequisites** (MD-102) probes live and reports honestly: `uv`, `git`, `Node.js`, MemPalace
  (`palace initialised`) all `ready` with resolved paths; `Grok · xAI` and `Antigravity · Gemini`
  `not set up`. It takes several seconds — `toolsStatus` shells out to many binaries — so its nav
  click needs a long timeout when scripted.
- **Voice** (MD-102): both keys are write-only with the right copy ("Stored in the secret broker,
  never read back"), and the honest `No key yet — voice stays disabled.` under the OpenAI row.
- **Autonomy & Budgets**: every threshold says what blank means ("Blank means no ceiling — and no
  meter, since a meter needs a limit to measure against") — the no-cap-no-meter invariant holds in
  the copy, not just the code.
- **Blur-save + re-seed (MD-64):** changed the boss name, blurred, navigated to Tasks, came back —
  it read back as the new value, not the stale default. The one-row-two-edits rule is holding.

## Messages — PASS

The seeded conversation renders as one thread: 3 messages, each with `from → to`, its `act`
(`inform` / `request` / `done`), a relative timestamp, the body, and a Send box. A message in
`inbox/.done/` is included and counted. The thread takes its title from its FIRST message, which
happens to be the archived one — correct for "a conversation is named by how it started", noted
only so the next reader is not surprised.

## Triggers / Voice — PASS

Schedules list with an on/off count (`1 of 2 on`), interval chip, `→ Michael`, `fired 17m ago ·
next in 43m`, and the full prompt. `Add a schedule` opens an inline editor (Label / Goes to /
Every / Prompt / Add / Cancel). Context, Webhooks and History sections all present with honest
`none` empty states.

**Pam's MD-100 S2 is fixed:** the voice mic's disabled tooltip now works —
`VoiceStatus.tsx` wraps the disabled Button in a `<span className="inline-flex">`, with a comment
explaining that `disabled` sets `pointer-events: none` and eats the hover. The one state whose
reason you need ("no OpenAI key yet") explains itself again.

## Tasks — PASS

Four columns with counts; toolbar `6 tasks`, chips `Unassigned` / `Blocked` / `Asks me 2` /
`Archived 1`, the `1 unassigned → Michael` action, and SPEC §6's `New work? Dispatch it to Michael
on the Floor` line (an S3 I filed in MD-92 — now present). Cards carry assignee badges and the
`Asks you` marker. The detail sheet shows status, assignee, created-at, Description, Result, the
status select, Assign, `Michael writes this board`, and Close. The archived / blocked / asks-me
chips all filter.

The `Asks you` badge is `outline` with `border-destructive/40 text-destructive` — I went looking
for a DESIGN-MODERN palette violation and found the opposite: a comment at `TaskCard.tsx:85`
explaining exactly why it is an outline and not a filled destructive pill ("an open ask is a call
to action, not a failure"). Not a finding.

## Ask Me — PASS

Two open asks, each with its card title, assignee, the question, a `Respond & unblock` box and the
`⌘↵ to send` hint; the Telegram-mirrored ask carries its `Telegram` badge. The answered ask and the
archived card are correctly absent. I typed into the box and did not send — sending mutates the
shared board.

## Integrations — PASS

Slack / Telegram / Webhooks / Custom REST each show `disabled` with the SPECIFIC reason rather
than a bare off state ("0 allowed senders · proactive posting off · no bot token — nothing can be
posted back"), and each row links to where it is edited. Provider Doctor states plainly what it
does and does not do before you run it.

## Themes

Every one of the ten nav areas was screenshotted in dark after flipping the real topbar toggle,
and `data-cth-theme=dark` was asserted on each. No unreadable text, no unstyled surface, no
light-palette leak in Monaco (`modern/ide/monaco-tokens.css` is doing its job — the diff is dark
in dark). 0 errors in dark. The toggle returned to light cleanly.

---

## Summary

| Area | Verdict |
|---|---|
| IDE | PASS — 1×S2 (raw git stderr on a non-repo workspace), 1×S3 ("(assumed)" always shown) |
| Issues & PRs | PASS |
| Settings | PASS |
| Messages | PASS |
| Triggers / Voice | PASS |
| Tasks | PASS |
| Ask Me | PASS |
| Integrations | PASS |

**ready for default: yes — blockers: none.**
