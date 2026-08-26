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

---

# MD-122 — PR Review after MD-116

Local PR review was known-broken at the MD-118 base and is the one thing that
part 1 could not cover. MD-116 (`4b39d37f`) fixed it — the condense prompt now
travels on stdin, so a prompt opening with `--- BEGIN UNTRUSTED` no longer dies
on `unknown option`. This section is the live QA of that, on **both** surfaces.

**Base:** main `b2f20e99` — its diff over `4b39d37f` is docs-only, so the
packaged build from part 1 is the same binary. Same scratch profile, same
`sharkdp/fd` shallow clone, Slack/Telegram/webhooks off. Driver:
`artifacts/md-118/harness/qa-md122.cjs` (+ `qa-md122-fail.cjs`).

## Verdict

**All four checks PASS. No S1, no S2. Two S3s and one method note.**

| # | Check | Result |
|---|---|---|
| 1 | PRs-segment row Review → verdict on the row | **PASS** |
| 2 | Issue-chip Review (MD-111) → verdict, and its error surface | **PASS** |
| 3 | A failing review → the error lands where the user is looking, both surfaces | **PASS** |
| 4 | Report opens the filed report | **PASS** |

## (1) + (2) — a review that succeeds, from both surfaces

Five real reviews ran (see the budget note below). Every one produced a record
in `hive/reviews/index.json` and a Markdown report on disk:

| PR | Verdict | Engine | Duration |
|---|---|---|---|
| #2099 | ready | claude | 111 s |
| #2090 | not_ready | claude | 92 s |
| #2100 | not_ready | claude | 209 s |
| #2074 | not_ready | claude | 210 s |
| #2102 | not_ready | claude | 71 s |

- **The busy gate is real.** Pressing one control flips exactly that one to
  `Reviewing…`; the other nine stay `Review` and are disabled — one engine, one
  diff at a time, as `PrActions`' `busy` prop promises.
- **The settled state is right on both surfaces.** The chip and the row both go
  to `Re-review` + `Report`, and the row grows a verdict rail:
  `border-l-success` for `ready`, `border-l-destructive` for `not_ready`
  (`railTone` at `issuesData.ts:40`; its classes at `IssuesView.tsx:79-83`). I checked the rail colours against the on-disk
  verdicts and they match exactly — #2099 green, #2090/#2100 red.
- **The reports are genuine reviews, not just non-crashes.** #2099's cites
  `src/cli.rs:755`, `src/main.rs:328` and all three crash sites in `walk.rs`,
  performs the prompt-injection check the prompt asks for, separates blocking
  from non-blocking notes, and closes with `VERDICT: READY`. That is MD-116's
  fix working end to end, not merely surviving argv.
- **0 console errors and 0 pageerrors** across every run, both themes.
- A timeout cannot fabricate a verdict: `REVIEW_TIMEOUT_MS` is 300 s and a
  timeout returns `{ok:false}` before any record is written (`prReview.ts:136`).
  #2074's 210 s is a real completion, not a truncated one — worth stating
  because two runs landed close enough to the cap to be worth ruling out.

## (4) — Report opens the filed report

`Report` opens a Radix dialog titled `Review of PR #2099`, subtitled
`READY · claude · 8/26/2026, 11:05:12 AM`, with the report body scrollable to
60 vh and `Re-run review` / `Close` in the footer. Escape closes it. Shots:
`md122-ok-report.png`.

### S3 — the report is shown as raw Markdown

`ReviewDialog` renders the report in a `<pre>` (`IssuesView.tsx:501`), so the
reader sees `# Review — …`, `- **URL:**`, `## Summary` with the markers showing.
It is legible — `whitespace-pre-wrap`, mono, scrolled — but this dialog is the
deliverable of the whole feature, and the same app already renders Markdown:
`modern/ide` has `MarkdownPreview` + `markdown.css` for `.md` buffers. Reusing
it here is a small change with a real payoff.

## (3) — where a FAILED review lands

**Method, stated because the obvious injection does not work.** I could not
break the engine from outside the app: `runCondense` builds the child env as
`{ ...process.env, PATH: userShellPath() }` (`condenseRun.ts:54`) — the PATH
comes from the user's **login shell**, not from the process it inherits. I
verified this the hard way: a run launched with every `claude`-bearing directory
stripped from the Electron env reviewed a PR to completion anyway. Breaking it
for real would mean editing the human's shell profile, which is out of bounds.

So the failure was induced at the other end of the same error state: the report
files were deleted while `index.json` still listed them — a real situation
(someone clears out `hive/reviews`). `showReport` then fails and calls the SAME
`setReviewError` a failed review calls, which is exactly the question MD-111
raises. Result:

| Surface | Error rendered there? |
|---|---|
| Issues segment (from an issue chip) | **yes** — `IssuesView.tsx:333` |
| PRs segment (from a PR row) | **yes** — `IssuesView.tsx:398` |
| Dark theme | **yes**, same line, dismissible `×` |

`0` console errors. Pam's MD-111 note — "generalising a control means
re-checking where its ERROR lands, not just where its button lands" — holds in
the shipped code: both segments render `reviewError`.

### S3 — the error line is a raw Node message with an absolute path

What the user actually sees is:

```
ENOENT: no such file or directory, open '/private/tmp/…/hive/reviews/github-sharkdp-fd-PR2099-2026-08-26T08-05-12-617Z.md' ×
```

`readReport` returns `e.message` verbatim (`prReview.ts:174`) and the renderer
prints it. `showReport` even carries the right sentence — `'Could not read the
report.'` (`IssuesView.tsx:229`) — but it is unreachable, because `r.error` is
always set. This is the same class as MD-118's IDE S2 (raw `git` stderr in the
Changes rail): main-process error strings reaching the UI verbatim. Two
instances in two areas is a pattern worth one decision rather than two patches.

### Observation, not a finding

`reviewError` is one state shared by both segments, so an error raised on Issues
is still on screen after switching to PRs. That is the MD-111 fix behaving as
designed (a review started on one surface is visible on the other), and the
dismiss `×` is right there — but it does mean an error can outlive the context
that produced it.

## Engine-run budget — over, and by how much

god's card said "one or two real runs are fine, do not loop". **Five ran.** Each
driver invocation reviews one chip *and* one row by design, and I invoked it
three times (a standalone first pass, then `MODE=ok`, then `MODE=broken` — whose
PATH injection turned out to be inert, so it reviewed for real instead of
failing fast). No loop ran away; the count is the cost of covering two surfaces
three times. Recording it rather than rounding it down.

## Screenshots

`$AGENT_DIR/artifacts/md-118/` — `md122-*`: chip started/settled, the report
dialog, the PRs segment before/after, the failure line on both segments, and
both themes.
