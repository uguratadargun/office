# Office v0.5.2

**A local hive of Claude Code, Antigravity, Codex, Grok & Copilot agents that run themselves** — messaging,
routing, and remembering, coordinated by your clone, Michael, who you talk to. Local-first and open source.

### → [**munderdiffl.in**](https://munderdiffl.in/) — see it in action, then grab a build below

---

---

## What's new in 0.5.2

**A bugfix release.** One thing was broken for anyone running the orchestrator on a
non-Claude engine — most visibly the qwen bridge against a local OpenAI-compatible
server — and this build fixes it.

### Fixed

- **The orchestrator no longer wears a model its engine doesn't serve.** The
  shipped default carried a hardcoded `claude-opus-4-8`, and the config merge
  fills in any key the saved file omits — so an orchestrator on a non-Claude
  engine booted as, e.g., `qwen --model claude-opus-4-8`: an id the endpoint
  doesn't serve, a first request that fails, and the CLI's setup/auth screen
  where the floor should be. The default is now unset. The orchestrator runs
  the chosen engine's recommended model, and an engine without one (qwen,
  opencode) runs the model the user actually configured in the CLI's own
  settings — the CLI default. An install that pinned its own orchestrator model
  is untouched.

> **This build is not code-signed.** See **First launch** below before you open it.

---

## Still new in 0.5.1

**An app left running overnight no longer burns tokens.** A night of Office with nothing
running still cost roughly 8 million tokens. Nothing was broken and no agent was working —
it was the harness talking to itself. The orchestrator was the one agent that never slept,
so it held the biggest conversation in the hive open all night, and three timers took turns
writing to it: the hourly standup asked "anything to report?" whether or not there was a
floor to report on, the heartbeat counted the orchestrator's own spend as activity and so
kept waking itself about every seven minutes, and the memory condenser retried a rejected
file on the plain half-hour cadence forever. Agents were also compacted only once their
context was 60% full and at most every two hours, so every turn in between paid for a window
that had been allowed to grow — and every FYI in an inbox bought a full-context wake to be
told there was nothing to do.

All of that is now conditional. The orchestrator parks like everyone else, the timers stay
quiet on a floor where nothing moved, compaction happens early and only when an agent is
genuinely full, mail is batched and only the mail that needs someone wakes them, and every
agent is told to be frugal before it can spend anything.

### Nothing to do means nothing spent

- **The orchestrator can finally go to sleep too.** Every other agent parked itself when it
  went quiet; the boss never did. It now parks once every other session is asleep, its own
  cards are clear and nothing is waiting in its inbox — and wakes the moment real mail
  arrives from an agent or from you. The harness's own beats no longer wake it.
  Settings → Agents & Models → "Sleep the orchestrator after" (default 30 minutes, 0 never
  sleeps it).
- **The timers only fire when there is something to fire about.** The hourly standup runs
  only when a non-god agent is awake, the previous standup has been read, and something
  other than the orchestrator's own spend has moved — and it arrives as a notice rather than
  a question, so it no longer buys a second turn writing an answer nobody reads. The
  heartbeat excludes the orchestrator from the fleet it compares against, which is what it
  was feeding itself on. The memory condenser doubles its wait after each rejection, stands
  down entirely on a floor still for fifteen minutes, and skips retired agents' frozen files.
- **A quiet floor is not compacted on the clock.** The scheduled compaction reaches the
  orchestrator too, so an idle night spent a full turn every cadence summarising a
  conversation nothing had been added to. It now skips unless some agent other than the
  orchestrator has moved since the last one.

### Every turn costs less than it did

- **Agents are compacted far earlier, and it is now a Settings dial.** A turn re-sends the
  whole context it has grown, so a window allowed to reach 60% of 200k — or 40% of a
  million — charges that much on every turn until the next compaction. One compaction is
  cheap; a thousand fat turns are not. The bars are now 25% and 12% (about 50,000 and
  120,000 tokens) on a 30-minute cadence, editable under Settings → Agents & Models →
  Auto-compact. An install still carrying the old numbers is moved onto the new ones on
  first launch; a value you changed yourself is left where you put it.
- **Agents are told to be frugal before they can spend anything.** Every spawned agent now
  carries a short TOKEN DIET block in its system prompt — write scripts to a file instead of
  pasting them into a shell call, read the lines you need instead of whole files, keep
  reports short, don't re-read what you didn't change, batch your commands. A byte an agent
  adds now is paid for again on every turn after it.
- **The floor roster stopped repeating itself.** The live-roster line pushed into the
  orchestrator's context used to carry each agent's token count, cost and "active 6s ago" —
  numbers that changed on literally every turn, so the gate meant to inject it only when the
  floor actually changed never suppressed anything. It is id, name and state now, and goes in
  when an agent joins, leaves, goes idle, gets mail or trips its breaker; the per-agent detail
  stays one read away in `fleet.json`. The seventeen bundled skills also describe themselves
  in one line each instead of a paragraph — 4,163 bytes down to 1,789, in every prompt.
- **Every card starts from a clean conversation.** When a card is signed off and the agent
  has nothing else running, its thread is retired: the next card begins from the harness
  prefix and the agent's own `memory.md` rather than a day of compaction summaries about
  work that is already finished. That tail was never free — the whole context is re-sent on
  every turn. A thread is kept whenever another card is still open, unread mail is waiting,
  or the breaker is holding the agent, and the orchestrator is never cleared. Settings →
  Agents & Models → *Fresh context per card* turns it off.

### The wake-up carries the mail

- **A burst of mail costs one interruption, not one each.** Three rules now stand between
  mail and a wake. A parked agent is woken only by mail that needs it — a request, a query,
  a proposal, a `done` report leaving a card to close, or anything flagged `requires_reply`.
  The scheduler's own beats no longer nudge a floor where nothing has moved. And within a
  window — 60 seconds by default, settable under Settings › Agents & Models › Limits, 0 to
  switch batching off — an agent is nudged once, with the nudge naming how many messages are
  waiting so it does not answer one of three and park again. Held mail is delayed, never
  dropped.
- **The nudge carries the mail itself.** It used to say only "you have mail", so the agent
  answered it by listing its inbox, reading each file and — measured across 97 sessions —
  re-reading its memory before it had learned anything. It now carries each new message's id,
  sender, act and subject plus the body up to 2 KB, pointing at the file when there is more.
  A one-message wake is 784 bytes where the round trip it replaces ran to tens of kilobytes.
- **Acking an FYI no longer wakes anyone.** Of 845 live messages, 125 were replies to
  `inform`s that had asked for none — "got it, thanks", each a wake and a read turn. A short
  reply to a terminal `inform` is now filed straight into the recipient's `inbox/.done`:
  archived, logged, still in the thread, never delivered. A reply that asks for anything, or
  one past 300 characters, is real mail and goes through.
- **`requires_reply` means what it says.** It used to be inferred from the act, which made it
  a second copy of what `act` already stated. It defaults to false now and is a pure opt-in.
- **An FYI no longer buys its own expensive wake.** Waking an agent more than five minutes
  after its last turn re-sends the whole conversation at roughly twelve times the cached
  price. So an `inform` or a `done` arriving while the recipient is mid-turn now waits for
  the turn it is already taking, where the agent's own stop hook reads the inbox for free.
  Anything anyone is actually waiting on — a request, a query, a proposal — interrupts
  immediately, as before. The wait has a hard ceiling of the nudge window plus a minute:
  mail is delayed, never dropped.

### What things cost, and the bookkeeping that keeps them honest

- **What your agents cost is visible in Settings.** Agents & Models shows the default model
  with what the choice actually costs (Opus about 5× Sonnet per token, Haiku about a quarter),
  a default reasoning effort for new hires, and the default token budget for the short-lived
  workers that answer Slack — which ships at 0, meaning nothing stops one on cost. That number
  was configurable and invisible. No default changed; they are on screen and editable now.
- **`hivectl` — the floor's bookkeeping, written down once.** Reading an inbox, sending a
  message, moving a card and integrating a branch were four recipes every agent re-derived
  from the protocol, and the drift showed. `resources/hivectl.cjs` does all four and refuses
  the malformed version of each — an empty `--assignee` is a no-op rather than an unassign,
  and `send` can only ever write to your own outbox. Its `merge` is the integration recipe
  made executable: a scratch worktree off `origin/main`, `merge --no-ff`, automatic resolution
  of exactly the changelog and `package.json`'s test list, then typecheck, the focused suite
  and a build. It never touches the working checkout and it never pushes.
- **Monitor shows how much of your bill is re-sent context.** Every agent row carries a
  cache-miss percentage — the share of its conversation prefix that had to be written again
  because the prompt cache had gone cold — with the day it is for, the write-vs-read split
  and the turn count behind it, and a floor-wide figure in the summary band. On a live floor
  those re-writes were 12% of total spend: not work anyone asked for, just the price of
  waking an agent a few minutes too late. An agent with no readable transcript reads "—",
  never 0%.
- **Monitor can show you what last night cost, and who asked for it.** A total cannot tell a
  working day from a quiet night spent answering timers — which is why the overnight burn
  above took a script run by hand over the transcripts to find. Monitor's fourth tab, Usage,
  opens on **last night** (the 20:00–08:00 stretch that just finished, or the one you are
  still inside) and splits the spend three ways: by hour of the day, so a plateau across the
  small hours is a shape rather than an inference; by what asked for the turn — standup,
  nudge, breaker, spawn, a person; and by how full the context was when the request was
  made. Per agent underneath, ordered by cost. Read-only and derived entirely from
  transcripts already on disk.
- **`hivectl merge --push`.** A merge that passes the gate can publish itself: a
  fast-forward-only push of the merge commit to `origin/main`, then the branch deleted on the
  remote. No `--force` and no `+` refspec, so a non-fast-forward is rejected by the remote
  rather than overwriting someone else's `main`. A failing gate still pushes nothing.

### Fixed

- **Compaction now knows how full an agent really is.** The hook socket the agents report
  their context size over is a Unix socket, and a socket path has a hard 104-byte limit that
  macOS does not report: past it the system quietly binds somewhere else, so nothing ever
  arrived and the app fell back to compacting purely on the clock. A deep enough config
  folder was enough to trigger it. Long paths get a short one now, the log names the socket
  actually opened, and the compaction log says why each agent was interrupted — or why its
  fill could not be judged, so a fleet reporting nothing looks different from a fleet that is
  genuinely full. A reading older than an hour is treated as no reading rather than believed
  forever.
- The roster stopped labelling every healthy agent **"breaker healthy"** — it was comparing
  against a level name the breaker never returns.
- **A passing `hivectl merge` no longer leaves its merge commit unreachable.** The merge is
  made in a scratch worktree removed as soon as the gate goes green, so the commit had no ref
  pointing at it and was one `git gc` from being collected. Each green merge now writes
  `refs/hive/merged/<branch>` at the merge commit before the worktree goes away, and prints
  the ref. A failed gate writes no ref, so nothing can mistake a red merge for a green one.

> **This build is not code-signed.** See **First launch** below before you open it.
>
> The supporters wall on the site is **frozen** — it was rebuilt hourly from the upstream
> project's Razorpay account, and this fork takes no payments. The page stays; nothing
> updates it.

---

## Still new in 0.5.0 — *the modern UI is the default*

**The modern UI is the default.** A fresh install boots the modern shell instead of the
pixel office. The pixel office is still in the same build, one click away under
Settings → Interface, and an install that had already chosen an interface keeps the one it
chose. Both front-ends share the same hive, agents, terminals and settings — switching is a
reload, not a migration.

It is also the release where the modern UI stopped being the smaller half of the app.
Everything you used to go back to the classic office for — memory, knowledge, workers,
skills, hiring, command history, a terminal queue you can rearrange — is here now.

### The modern office is a whole office

- **Memory has a home.** Pick any agent — asleep, archived, or with no workspace left — and
  read its `memory.md`, with its size and when it last changed. Search is two searches kept
  apart: exact text across memories, cards and the ledger, and **MemPalace semantic recall**,
  which says plainly when it is off or still building rather than just returning nothing.
  A graph shows who has been talking to whom.
- **Agent memory can be edited by hand**, in both UIs. A save is refused if the file moved
  underneath you — the agent itself and the condenser write to it too — and offers to reload
  the newer version instead of quietly merging two memories.
- **Workers are visible.** Monitor's third tab lists the short-lived agents spun up to answer
  Slack: how long each has been up, how long since it last did anything, what it has spent,
  and the worktrees left behind. Stopping one arms first and says what that costs.
- **Skills has an area.** Every skill installed for the coding agents on this machine, with
  its publisher, its scope and the exact folder it lives in — so "why did my agent just do
  that?" has an answer here. A second tab browses the catalog and installs from it.
- **Every prompt you have ever submitted** is searchable in a command-history panel, for one
  agent or the whole floor, with re-run, copy, delete and export.
- **The Add-Agent form does everything the classic one could** — and a hire sent to you by
  another agent, or an `office://hire` link, now opens it with the manifest already filled
  in, instead of arriving nowhere.
- **An agent's terminal has a queue again.** Type while an agent is working and the queue
  delivers in order, one at a time, the moment the terminal is genuinely free; each waiting
  message can be reordered, rewritten, sent to the front or dropped. **You can attach files
  and paste screenshots into it.** The Messages tab is gone — opening an agent goes straight
  to its terminal.
- **A queued message that is not moving now says why**: the agent is still working, delivery
  is paused floor-wide, its prompt has unsent text on it, a picker is open — with the seconds
  left where there is a number to give. Both UIs word it the same way.
- Also here: Tasks and Ask Me boards, authentication for every engine the app offers, MCP
  defaults and Prerequisites, a custom REST API and voice, an IDE workspace picker, a cap on
  how many agents may write code at once, and the Floor listing its agents under the stage.

### The questions that need you find you

- **A question asked in a Slack or Telegram thread now also appears on Ask Me.** It used to
  live only in that thread, so something could be pending in the chat and invisible in the
  app. Answering it in the app posts the answer back into the thread it came from, and an
  agent that means to ask can now say so outright rather than hoping to be recognised.
- **Lettered questions are something you click.** "(a) ship it now (b) wait (c) leave the old
  default" becomes a list you pick from, with the letters and the arrow keys as shortcuts, in
  both UIs. The answer that reaches the agent is exactly the letter it always was, and the box
  beside the options still takes an answer of your own.
- **A question mailed to the human reaches the ASK ME board**, not only the orchestrator's
  inbox — which is what puts it on your phone.

### Quitting, cost, and one app per workspace

- **Quitting now finishes.** It could hang: the warning counted terminals the app had opened
  rather than the ones still running, and then waited for an answer with no time limit at all.
  Now it only warns about agents that are genuinely running, and once you have chosen to quit
  the app is gone **within five seconds**, whatever refuses to die, with the button counting
  those seconds down.
- **Two copies of the app can no longer fight over one workspace.** A second Office on the
  same folder used to retire three agents the first one was actively running. Exactly one app
  owns a workspace now; any other window says so at the top and quietly does none of the
  background work rather than doing it wrongly.
- **Hibernated agents survive a restart.** The tidy-up that runs at startup archives agents
  with no terminal open — and a parked agent is processless by design, so a restart archived
  agents that were only asleep and put a finished short-lived worker in their place. Parked is
  not orphaned; the sweep now keeps them.
- **The usage readout billed nearly three times what a session cost.** Claude Code writes one
  transcript line per content block — each repeating the same request's usage — and exports
  its counters cumulatively, so both accounting rungs were over-counting. A request is now
  billed once, and cumulative points by their rise. A card that read `1.3M` above a 75k
  context gauge now reads `billed 1.3M`, with the cache share on hover, so the two numbers
  cannot be mistaken for each other.

### Everything else

Every destructive control arms through one machine, including the two Settings rows that
still kept private timers. The Integrations page's "Settings" hint is a button that lands on
the field it names. Issues and pull requests load twenty at a time and keep loading as you
scroll, and show who they are assigned to. A cancelled pipeline is no longer read as a CI
failure, so nobody is woken for a run that was superseded; a merge request no longer says
"approved" when nobody approved it, and review decisions say who made them. Local PR review
works — it never had. An agent whose process dies is noticed while you are still looking at
it and archived in both UIs, and a woken agent reads its mail without needing a second
message. You can clear a whole column of finished cards, and the classic board can delete a
selection. Every tooltip in the modern UI was rendering off the top of the window; the modern
Floor was half a black slab; long agent names and Windows paths broke the Agents page. All
three are fixed. Removed: the modern UI's unmounted hive-mail reader.

---

## Still new in 0.4.5 — *the app is called Office, and it runs itself while you are away*

**The app is called Office.** Window, dock, menus, and the installers themselves. Links
you have already shared keep working — `munderdifflin://` stays registered forever — and
an existing profile is adopted on first launch, so nobody opens this build to a
factory-fresh app.

It is also the release where the office keeps working while you are not watching it.
Idle agents sleep and wake on their own, an agent's conversation is cleared when its card
is signed off, and the questions that genuinely need you arrive on Telegram instead of
waiting in a window you closed.

### The office runs itself while you are away

- **Idle agents go to sleep**, and wake the moment work arrives. Six idle sessions used
  to hold six live agents open.
- **An agent's conversation is cleared when its card is signed off**, so the next card
  starts on clean context — and its usage readout resets with it, instead of showing a
  whole career's spend as "this conversation".
- **Questions that need you reach you on Telegram**, and your reply answers the agent.
  You can drive the whole office from the bot.
- **Slack works without a public URL** (Socket Mode), and the public URL the bridges do
  open now survives a restart.
- Idle agents occasionally bring Michael a cup of tea.

### Issues, pull requests and reviews are one loop

- Issues and pull requests are **two tabs**, not one crowded screen.
- A watcher polls `gh` / `glab`, so an issue becomes a PR becomes a review without
  anyone babysitting it. **GitLab is at parity** — a red pipeline links the job that
  actually failed.
- **Michael reviews a PR's diff locally** from the Issues tab, and agents can act on a
  pull request rather than being told to go and reply on one.

### You can see what things cost

Per-agent tokens and cost for **every** engine, not just Claude — OpenCode and the rest
report real numbers instead of `$0`. The budget meter is hidden unless you actually set
a budget, and the floor stopped paying for turns that carry no news.

### Control over each agent

Per-agent **reasoning effort** from the Monitor tab. A **"Working on"** line in the
detail panel. **Archived agents can be brought back**, and finished kanban cards can be
archived. Every prompt ever submitted is in a **command history** panel. There is a
**Knowledge Graph browser**, and memory maintenance you can run on demand.

### Settings grew up

Searchable, and it behaves like a real dialog. **Provider Doctor** checks the flags,
model ids and env vars each engine actually needs, and engines that cannot orchestrate
now say why instead of silently not appearing. **The boss has a name you can change.**

### Everything else

One policy for destructive actions, **with undo**, replacing five different answers to
"are you sure?". Sleeping agents come back to the fullscreen view. The context gauge
zeroes on engines whose clear verb is not `/clear`. Blur-saved Advanced settings read
back what you set. MCP servers reach Crush, Codex and OpenCode, not only Claude. Voice
hire spawns the engine you asked for, and Kimi and qwen stop being spawned with flags
they do not have. Two silent data-loss paths on the way out of a form are closed.
Removed: the organisation/teammate messaging UI, which advertised a transport that does
not exist, and three dead IPC clusters.

---

---

> [!NOTE]
> **Auto-update carries you here from v0.3.7 or later.** If you are still on v0.3.5 or v0.3.6,
> those builds shipped the broken updater and need one manual install — grab the download below,
> once.

---

## Previously

- **0.4.4** — *Windows agents can talk to each other*: agents on Windows started, looked
  healthy and quietly ignored one another forever; that, and a first five minutes where setup
  could not be finished and the message carriers did not start until you quit and reopened.
- **0.4.3** — *Michael is the logo*: the mark became a face — one portrait across the dock icon,
  the site favicon, the in-app toolbar and the README, authored as pure vector and generated into
  native multi-resolution icons at every size.
- **0.4.2** — anonymous usage stats, done in the open: a documented event list, opt-out honoured
  (`DO_NOT_TRACK` included), and nothing about your code, prompts or files ever sent.
- **0.4.1** — *the app says what the site says*: Michael is described as your clone throughout,
  onboarding was rewritten around what you actually get, and his card carries a **BOSS** tag.
- **0.4.0** — *the brand grew up*: one yellow "MD" mark across the dock icon, in-app logo, site
  favicon, and munderdiffl.in; the landing page rebuilt around real screenshots and a live
  pixel-floor sim; pricing reframed around **Private Cloud** and **Private Network**.
- **0.3.9** — Settings → General answers "am I up to date?" directly, and removes 0.3.8's
  usage-limit guard that never released held agents.
- **0.3.8** — memory condensation works for the first time; a Triggers hub; one compaction
  schedule instead of two; a readable commit history.
- **0.3.7** — auto-update actually runs: a CommonJS/ESM import bug meant the native updater never
  fired in any packaged build since v0.3.4, and the failure was swallowed by a `catch`.
- **0.3.6** — *a machine with nothing on it can run agents*: Node and npm install themselves
  (verified against the official `SHASUMS256.txt`), hooks stopped dying with exit 127, `~/dev/foo`
  paths resolve, and the office floor rebuilds itself after losing its GPU context.
- **0.3.5** — a **send now** escape hatch for a paused message queue, and a compact Command
  Center header.
- **0.3.4** — talk mode that knows the floor, markdown previews, the IDE git time-machine
  (history + branch compare), redesigned Settings, xAI Grok and Kimi Code, and a single
  delivery gate for every automatic writer. Community work by
  [@gts-47](https://github.com/gts-47) and [@qschmick](https://github.com/qschmick).
- **0.3.3** — the built-in Monaco IDE, and GitHub Copilot CLI as the first community-contributed
  engine ([@anxkhn](https://github.com/anxkhn)).
- **0.3.2** — Realtime Michael: a voice channel to the GOD orchestrator.
- **0.3.1** — three more engines: OpenCode, Crush, and pi.dev.

Full history in the [CHANGELOG](https://github.com/uguratadargun/office/blob/main/CHANGELOG.md).


---

## Thanks

The office carries community work. Every one of these landed in v0.4.4:

| | | |
|---|---|---|
| [#129](https://github.com/uguratadargun/office/pull/129) | [@gts-47](https://github.com/gts-47) | "Restart & Continue" now works on an agent that already died |
| [#130](https://github.com/uguratadargun/office/pull/130) | [@gts-47](https://github.com/gts-47) | one odd message id no longer silences an agent's wake nudge |
| [#131](https://github.com/uguratadargun/office/pull/131) | [@gts-47](https://github.com/gts-47) | dictation pastes what you just said, not the clipboard's previous text |
| [#132](https://github.com/uguratadargun/office/pull/132) | [@gts-47](https://github.com/gts-47) | a root cwd no longer resolves to the projects directory itself |
| [#133](https://github.com/uguratadargun/office/pull/133) | [@gts-47](https://github.com/gts-47) | a frozen context reading no longer re-fires `/compact` forever |
| [#134](https://github.com/uguratadargun/office/pull/134) | [@gts-47](https://github.com/gts-47) | the office floor stops rendering when nobody is looking at it |
| [#143](https://github.com/uguratadargun/office/pull/143) | [@gts-47](https://github.com/gts-47) | Grok 4.6 in the model picker |
| [#144](https://github.com/uguratadargun/office/pull/144) | [@gts-47](https://github.com/gts-47) | the cost ledger stays out of the hive's git history |
| [#142](https://github.com/uguratadargun/office/pull/142) | [@baziyer](https://github.com/baziyer) | renderer task-ledger lost updates — mutations are atomic now |
| [#137](https://github.com/uguratadargun/office/pull/137) | [@chaitanyagiri](https://github.com/chaitanyagiri) | the CLI's quote rail is stripped from copied selections |

Eight of the fixes above are [@gts-47](https://github.com/gts-47)'s. Thank you.

## ⤓ Downloads

Latest builds for every platform. The macOS build is **universal** — one DMG that runs on both
Apple Silicon and Intel.

### 🍎 macOS
| Build | File |
|---|---|
| Universal (Apple Silicon + Intel) | [`Office-0.5.1-mac-universal.dmg`](https://github.com/uguratadargun/office/releases/latest/download/Office-0.5.1-mac-universal.dmg) |

### 🪟 Windows
| Build | File |
|---|---|
| Installer (x64) — *recommended* | [`Office-0.5.1-win-x64-setup.exe`](https://github.com/uguratadargun/office/releases/latest/download/Office-0.5.1-win-x64-setup.exe) |
| Portable (x64, no install) | [`Office-0.5.1-win-x64-portable.exe`](https://github.com/uguratadargun/office/releases/latest/download/Office-0.5.1-win-x64-portable.exe) |

### 🐧 Linux
| Build | File |
|---|---|
| AppImage (x86_64) | [`Office-0.5.1-linux-x86_64.AppImage`](https://github.com/uguratadargun/office/releases/latest/download/Office-0.5.1-linux-x86_64.AppImage) |

### 📦 Source
[Source code (zip)](https://github.com/uguratadargun/office/archive/refs/tags/v0.5.1.zip) ·
[Source code (tar.gz)](https://github.com/uguratadargun/office/archive/refs/tags/v0.5.1.tar.gz)

> **Verify your download:** [`SHA256SUMS.txt`](https://github.com/uguratadargun/office/releases/latest/download/SHA256SUMS.txt) — then `shasum -a 256 -c SHA256SUMS.txt` (macOS/Linux) or `Get-FileHash` (Windows).

> The filenames above carry a version number, so they only resolve while this is the
> latest release. If a link 404s you are reading an old release page — grab the current
> build from the [**releases page**](https://github.com/uguratadargun/office/releases/latest),
> which is always right.

---

## First launch

- **macOS** — this build is **not code-signed**. macOS will refuse it the first time with
  *"Office cannot be opened because the developer cannot be verified"*. Right-click the
  app → **Open** → **Open**, once, and macOS remembers. If it refuses outright, clear the
  quarantine flag: `xattr -d com.apple.quarantine /Applications/Office.app`. The first
  time agents touch a folder you'll also get the macOS privacy prompt for
  Documents/Desktop/Downloads — allow it, and note that without a stable signature macOS
  may ask again after an update. Signing is coming; it needs a paid Apple Developer ID.
- **Windows** — not code-signed yet; SmartScreen may show "Windows protected your PC" →
  **More info** → **Run anyway**.
- **Linux** — make the AppImage executable: `chmod +x Office-*.AppImage`, then run it.

---

## Requirements
- macOS 12+, Windows 10/11, or a modern Linux desktop
- [Claude Code](https://claude.com/claude-code) installed and on your `PATH` (and/or the Antigravity `agy` or OpenAI `codex` CLI for those providers)
- A Claude Code subscription (Office drives your existing `claude` CLI — it doesn't replace it)
- For **Realtime Michael** (voice): your own **OpenAI key with Realtime API access** — without it the **Talk** button stays disabled

---

## 🛠 Build from source
```bash
git clone https://github.com/uguratadargun/office.git
cd munder-difflin
npm install        # rebuilds node-pty for Electron
npm run dev        # launches the app with hot reload
```
Node 18+ and a C/C++ toolchain are required (Xcode CLT on macOS, Build Tools on Windows).
To produce installers yourself: `npm run dist` (current OS), or `dist:mac` / `dist:win` / `dist:linux`.

---

## What's inside
- **The simulation** — every agent is a real `claude` (or `agy` / `codex` / local-provider) pseudo-terminal, visualized as an avatar on a watchable office floor (`node-pty` · `xterm.js` · Pixi.js).
- **Talk to Michael** — a realtime **voice channel to the GOD orchestrator** that reads the hive and acts behind spoken echo-back confirmation, BYOK and main-only.
- **Selectable engines + per-hire capabilities** — each hire (and Michael himself) runs on a pluggable engine, with its own consented skills + MCP catalog.
- **MemPalace** — a markdown-first, semantic memory layer the whole office shares; cross-session recall in ~12ms.
- **GOD orchestrator + hive** — one agent you talk to routes work to specialists and stays autonomous, escalating only critical items (spend, destructive ops, scope) to you natively, through human-in-the-loop prompts. It can also spawn an ephemeral worker straight from Slack and tear it down safely.
- **Plugs into your setup** — your subscription, settings, skills, and MCP servers, plus an integrations registry with a write-only secret broker; `/remote-control` reaches the whole floor from your phone.

Full notes in the [CHANGELOG](https://github.com/uguratadargun/office/blob/main/CHANGELOG.md).

---

## Links
[Website](https://munderdiffl.in/) ·
[Repo](https://github.com/uguratadargun/office) ·
[Issues](https://github.com/uguratadargun/office/issues) ·
[Contribute](https://github.com/uguratadargun/office/blob/main/CONTRIBUTING.md) ·
[Become a patron](https://razorpay.me/@munderdifflinfund)

MIT-licensed. An affectionate parody — not affiliated with NBC's *The Office* or Dunder Mifflin.
