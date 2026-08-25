<div align="center">

<img src="./docs/logo.png" alt="Office — agent harness to run an office of your clones" width="340">

# Office

### Agent harness to run an office of your clones

**Free, open source and performant** — a multi-agent harness that works with the
subscriptions you already pay for, on their hourly limits. It turns the terminal coding CLI
you already run into a clone of you, one that keeps working while you're away and
coordinates a whole office of agents on your own machine.

Wraps [Claude Code](https://claude.com/claude-code), Antigravity (Gemini), OpenAI Codex,
**xAI Grok**, **Kimi Code**, **Qwen**, **OpenCode**, **Crush**, **pi.dev**, and
**GitHub Copilot CLI** — with bring-your-own keys and local LLMs.
Agents that message, route, and remember, coordinated by **your clone** (Michael) and
visualized as avatars at work on a shared office floor.

<p>
  <em>Electron · React · TypeScript · Pixi.js · xterm.js · node-pty</em>
</p>

<p>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-F4D35E.svg?style=flat-square&labelColor=6E1423"></a>
  <a href="./CHANGELOG.md"><img alt="Version: 0.4.4" src="https://img.shields.io/badge/version-0.4.4-F4D35E.svg?style=flat-square&labelColor=6E1423"></a>
  <img alt="Status: prototype" src="https://img.shields.io/badge/status-working%20prototype-F4F1EA.svg?style=flat-square&labelColor=6E1423">
  <img alt="Platform: macOS | Windows | Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-F4F1EA.svg?style=flat-square&labelColor=6E1423">
  <a href="./CONTRIBUTING.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-F4D35E.svg?style=flat-square&labelColor=6E1423"></a>
  <a href="https://discord.gg/SEDzP5ZPk5"><img alt="Discord" src="https://img.shields.io/badge/Discord-join%20the%20office-F4D35E.svg?style=flat-square&labelColor=6E1423"></a>
</p>

<br>

<img src="./docs/media/og.png" alt="Office — A hive of agents that message, route, and remember" width="1240">

<br>

<!-- Inline player renders on github.com (raw URL required; relative paths only link). -->
<video src="https://github.com/chaitanyagiri/munder-difflin/raw/main/docs/media/hero.mp4" poster="https://github.com/chaitanyagiri/munder-difflin/raw/main/docs/media/og.png" controls muted loop playsinline width="820">
  <a href="https://github.com/chaitanyagiri/munder-difflin/raw/main/docs/media/hero.mp4">▶ Watch the floor — Office running a hive of Claude Code agents</a>
</video>

</div>

---

> [!NOTE]
> **The world's best agents. The world's worst paper company.**
> Office takes the terminal-agent CLIs you already run — `claude`, `agy`, `codex`, `grok`,
> `kimi`, `qwen`, `opencode`, `crush`, `pi`, and `copilot` — and turns them
> into a self-coordinating team: each agent gets long-term memory, a mailbox, and a desk on a 2D
> office floor — and **your clone** (Michael) routes work between them while you watch. He's the
> boss of the floor; you're still the boss of him.

## Contents

- [What it is](#what-it-is)
- [How it works](#how-it-works)
- [Features](#features)
- [Getting started](#getting-started)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Design system](#design-system)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Telemetry](#telemetry)
- [License](#license)
- [Acknowledgements](#acknowledgements)

## What it is

Office is a desktop app that wraps **real terminal-agent CLIs** as fully-capable agents,
wires them into a **hive mind**, and puts **your clone** in charge — Michael, the one agent *you*
talk to in order to get things done. Under the hood it runs the **fastest memory layer in the
world** so every agent remembers what it learns and recalls it instantly.

- **Every terminal is an agent.** Each `claude`, `agy`, `codex`, `grok`, `kimi`, `qwen`, `opencode`, `crush`, `pi`, `copilot`, or custom session runs as a real
  process in a pseudo-terminal (`node-pty`), byte-for-byte authentic, rendered with xterm.js.
- **Every agent is an avatar.** Sessions appear as characters on a Pixi.js office floor — they walk
  to stations as they work, and envelopes fly desk-to-desk when they message each other.
- **The hive coordinates them.** Agents read their memory and drain a mailbox; the router moves
  messages between inboxes; the GOD agent adjudicates, assigns, and escalates only when it needs you.
- **Memory that's instant.** A markdown-first memory layer with a semantic recall index means agents
  remember across sessions and recall in milliseconds.

## How it works

```
            you ── talk to ──►  ┌─────────────┐
                                │  GOD agent  │  orchestrator / supervisor
                                │ (Michael's  │  roster · routing · adjudication
                                │   office)   │  blackboard · task ledger
                                └──────┬──────┘
                                       │ assigns · routes · escalates
              ┌────────────────────────┼────────────────────────┐
              ▼                         ▼                         ▼
        ┌───────────┐            ┌───────────┐            ┌───────────┐
        │  agent A  │  message   │  agent B  │  message   │  agent C  │
        │ provider  │ ─────────► │ provider  │ ─────────► │ provider  │
        │  + memory │            │  + memory │            │  + memory │
        └───────────┘            └───────────┘            └───────────┘
              └──────── shared hive: memory · mailbox · blackboard · log ───────┘
```

1. **You spawn agents** — each is a normal terminal process (`claude`, `agy`, `codex`, or custom)
   with its own working directory, identity, and provider-specific lifecycle.
2. **Agents collaborate through the hive** — a local git repo of plain files. They write to their own
   `outbox/`; the harness's router delivers into recipients' `inbox/`. No agent ever touches git
   (single-committer design avoids `index.lock` corruption).
3. **The GOD agent runs the floor** — it reads every request, resolves routine ones itself (keeping
   the system fully autonomous), and only escalates *critical* items (spend, destructive ops, scope
   changes) into an approvals queue you act on.
4. **Everything is visible** — you watch avatars move, envelopes fly, and the live terminal stream;
   you can type back into any session, browse its files, and read its git history.

See [`HIVE.md`](./HIVE.md) for the full multi-agent design, [`SPEC.md`](./SPEC.md) for the
terminal/event plane, and [`DESIGN.md`](./DESIGN.md) for the visual system.

## Features

**The floor**
- **Every terminal is a real agent.** Claude Code, Antigravity (Gemini), OpenAI Codex, xAI Grok, Kimi Code, Qwen, OpenCode, Crush, pi.dev, GitHub Copilot CLI, or a custom command — each in its own `node-pty` PTY, rendered with xterm.js.
- **Every agent is an avatar.** A Pixi.js office floor where agents walk to stations, envelopes fly desk to desk, and avatar state reflects real work.
- **A GOD orchestrator you talk to.** It routes tasks, adjudicates traffic, and escalates only what needs a human. Or press **Talk** and run the floor by voice.
- **Per-agent git worktrees.** Optional isolation so parallel agents never collide on branches.

**Memory & coordination**
- **The hive** — per-agent memory, atomic-file mailboxes, a shared blackboard, an append-only event log, single-committer git.
- **Semantic recall** — markdown memory mined into a shared palace, searchable from the UI, with condensation so it doesn't grow forever.
- **Enterprise Knowledge Graph** — your own documents and policies, queryable by any agent.
  The Command Center's **knowledge** tab is the browser for it: every ingested document with its
  source, size and age, keyword search that shows the ranked chunk an agent would actually be handed,
  the full extracted text behind each one, and a two-click remove for anything added by mistake.

**Control & safety**
- **Human gates** — spend, scope, and destructive ops escalate to you. Steer mid-run or stop gracefully.
- **Circuit breaker** — a steer → constrain → stop ladder for agents that loop, storm errors, or blow their budget.
- **Default MCP bundle, per agent** — a consent-tiered catalog (read-only servers on, anything that writes
  beyond the workspace or needs a key off until you say so), written into each agent's own config for
  Claude Code, Codex and OpenCode. Never your global config; `filesystem`/`git` stay scoped to the agent's
  workspace. Settings names the engines it reaches — the others ignore the toggles and say so.
- **Budgets & telemetry** — per-agent token budgets, real cost from transcripts, a durable ledger, OTel spans, and a tool waterfall. Cost is read per engine (Claude, Codex, Gemini) from what that CLI actually writes on disk; an engine we cannot read reports **unknown**, never $0.

**Command Center**
- Kanban tasks with dependencies (archivable), scheduled missions + heartbeat, live fleet monitoring, memory search + on-demand maintenance (wake up · mine · condense), activity log, an issue tracker, and command history.
- **Skills** — what every agent can already do across Claude Code, OpenCode and Codex, plus a browsable catalog of 227 more with search, filters, install and uninstall.
- **Command history** — every prompt you send an agent is recorded locally in SQLite; the *prompts* tab lets you search it, open one in full, copy it, and reuse it. It is your data: export the whole log as JSON, delete a single prompt, or clear it — for one agent or entirely. Nothing leaves the machine.
- **Built-in Monaco IDE** — file tree, editor tabs, save, plus CHANGES · HISTORY · COMPARE git rails with commit graph, diffs, branch compare, and guarded checkout. All fs/git access brokered through main.

**Getting work in and out**
- **Issue → PR → review loop** — assign a GitHub/GitLab issue to Michael; the harness tracks the PR an agent opens for it, routes CI failures and review comments into that agent's inbox, tells Michael when it merges, and gives you a Merge button. Agents can reply on the PR, submit a review, and open issues or PRs themselves — merging stays yours. Opt-in auto-merge hands the decision to your branch protection — never to an agent. GitLab support (`glab`) is implemented but not yet verified against a live instance; CI failures link the failing job, UI-linked issues are picked up, and inline review comments carry their file and line.
- **Slack & webhooks** — message a channel or POST a webhook; Michael can spawn an ephemeral worker, reply in-thread, and tear it down. Slack connects two ways, picked under Settings → Connections → Slack:
  - **Socket Mode** — no public URL at all. The app dials out to Slack over a WebSocket, so no tunnel is opened for Slack and there is nothing to re-paste after a restart. Three steps: (1) Slack app → **Socket Mode** → Enable; (2) **Basic Information → App-Level Tokens** → Generate with the `connections:write` scope; (3) paste the `xapp-…` token into Settings and press Start. Event Subscriptions still needs the `message.channels` / `message.groups` bot events — Slack just stops asking for a Request URL.
  - **Events URL** — the classic Request URL. Set a **Public URL** in Settings so the address survives restarts: paste your own endpoint (cloudflared, ngrok, nginx — no tunnel is started) or name a reserved tunnelmole subdomain. Left blank you get a throwaway tunnel, and the UI says so rather than letting you paste an address that dies on the next launch.

  Both transports run the same event router, so triggering rules, de-duplication and in-thread replies behave identically. Webhooks keep their own public URL either way. Socket Mode shipped with unit/fixture coverage only — its decision logic and envelope handling are tested and its router is the one the Events URL path already uses in production, but the live WebSocket handshake has not been exercised against a real workspace. Events URL is unchanged if you hit trouble.
- **Webhook completion callbacks** — the webhook API was inbound-only, so every integration held a polling loop open to learn something the app already knew. Pass a `callbackUrl` with the work and the completion is POSTed to you instead:

  ```
  POST <tunnel>/<webhookId>      x-md-webhook-secret: <secret>
  {"message": "do X", "callbackUrl": "https://you.example/md-done"}
  ```

  When the card reaches `done` you get one POST carrying `{taskId, status, title, result, correlationId, completedAt}`, signed `x-md-signature: sha256=<hex>` — an HMAC-SHA256 keyed with that webhook's **existing** secret over `` `<x-md-timestamp>.<raw body>` ``. The timestamp is inside the signed material, so a captured delivery cannot be replayed; verify by recomputing over timestamp + `.` + the raw body, compare in constant time, and reject anything older than your own tolerance. Reply `2xx` to acknowledge; we retry four more times (1s, 3s, 9s, 27s) on `5xx`, `408` or `429` and give up on any other `4xx`. Delivery is **at-most-once** — a retry in flight when the app quits is not resumed, and `GET /<webhookId>` remains the durable answer. The URL must be `https`, carry no embedded credentials, and must not resolve to a loopback, private or link-local address; that is checked when you send it *and* again against the address it actually resolves to.

- **Shareable hires + Agent Gallery** — import a role from an `office://hire` link; import only pre-fills the form, a human still spawns it. Browse roles at the [Agent Gallery](https://munderdiffl.in/hires/).
- **BYOK keys + local LLMs** — per-provider keys in a write-only secret broker, plus Ollama / LM Studio / vLLM base URLs. Guides: [open models](https://munderdiffl.in/blog/run-munder-difflin-on-open-models/) · [Mac Mini](https://munderdiffl.in/blog/run-munder-difflin-on-a-mac-mini/).
- **Auto-update** — new releases download in the background; you click restart, and the notes arrive as a designed page rather than a version number.
- **Provider Doctor** — the app hard-codes flags and model ids belonging to each engine's CLI, and those change without telling anyone. One Settings section re-runs those claims against the installed CLIs and shows what is actually true on your machine; anything that can't be checked locally is marked unverified rather than assumed.
- **Prerequisites** — one Settings page showing which supporting tools (uv, git, Node, MemPalace, each agent CLI) you have, what each is for, and a button that asks Michael to install what is missing.

> [!NOTE]
> **Status: v0.4.4 — Windows agents can finally talk to each other.** On Windows, agents were
> never told they could message one another: the protocol reaches them as a multi-line command
> line, and `cmd.exe` cut it at the first newline. They started, looked healthy, and ignored each
> other forever. If you tried Office on Windows and your team just sat there, that was
> this bug. Also fixed: a fresh install now starts its own message router instead of waiting for a
> restart, the setup wizard can be finished, and dark mode is rebuilt for readability. New in this
> release: **Skills**, **Prerequisites**, and release notes that carry their own page.
> **If you're on 0.3.8, update:** that build's usage-limit guard never released the agents it held,
> and it has been removed entirely.
> macOS (signed & notarized), Windows, and Linux builds are on the
> [releases page](https://github.com/chaitanyagiri/munder-difflin/releases/latest).

<div align="right">(<a href="#office">↑ back to top</a>)</div>

## Getting started

### Prerequisites

- **macOS, Windows, or Linux**.
- **Node.js 18+** and npm.
- A **C/C++ toolchain** for `node-pty`'s native addon — on macOS, install Xcode Command Line Tools:
  ```bash
  xcode-select --install
  ```
- At least one supported agent CLI on your `PATH` — **[Claude Code](https://claude.com/claude-code)**
  (`claude`, the default), **Antigravity** (`agy`), **OpenAI Codex** (`codex`), **xAI Grok** (`grok`),
  **Kimi Code** (`kimi`), **Qwen** (`qwen`), **OpenCode** (`opencode`), **Crush** (`crush`),
  **pi.dev** (`pi`), or **GitHub Copilot** (`copilot`). Most missing CLIs self-heal: the harness runs the installer in the
  terminal and continues into the new binary.
- *Optional:* **your own API keys and local LLMs** in **Settings → AI Engines** (Ollama / LM Studio / vLLM).
- *Optional:* the semantic memory index for instant cross-session recall — markdown memory works without it.

### Install & run

```bash
git clone https://github.com/chaitanyagiri/munder-difflin.git
cd munder-difflin
npm install        # postinstall rebuilds node-pty against Electron's ABI
npm run dev        # launches the Electron app with hot reload
```

On first launch you'll go through the onboarding wizard, then land on the floor. Use **Add agent** to
spawn your first session — the GOD agent seats itself in Michael's office automatically.

### Other scripts

```bash
npm run build      # production build via electron-vite
npm run preview    # preview the production build
npm run typecheck  # type-check the node (main/preload) and web (renderer) projects
```

> If `node-pty` fails to load after an Electron upgrade, re-run `npm install` (the `postinstall` hook
> runs `electron-rebuild` against the current Electron ABI).

## Architecture

Two data planes feed one renderer:

```
┌───────────────────────────────────────────────────────────────┐
│                     Electron Renderer (React)                  │
│   ┌──────────────────┐    ┌──────────────────────────────┐    │
│   │ Office Floor      │    │ Terminal + Command Bar       │    │
│   │ (Pixi.js)        │    │ Files + Git tabs (xterm.js)  │    │
│   └─────────▲────────┘    └────────────▲─────────────────┘    │
│             │ avatar state             │ pty bytes / fs / git  │
└─────────────┼──────────────────────────┼───────────────────────┘
              │ IPC (contextBridge: window.cth)
       ┌──────┴──────────┐        ┌──────┴─────────────┐
       │  Event Plane    │        │  Terminal Plane    │
       │  hooks / hive   │        │  node-pty PTYs     │
       │  router + GOD   │        │  + fs + git        │
       └────────▲────────┘        └──────▲─────────────┘
                │ hook payloads          │ stdin / stdout
                └─────────┬──────────────┘
                   ┌──────┴──────────────┐
                   │ claude / agy / codex│
                   └─────────────────────┘
```

- **Terminal plane.** The main process owns a `PtyManager` that spawns each agent as a `node-pty`
  process and streams output over per-id IPC (`pty:data:<id>`). The renderer talks only through a
  typed `window.cth` bridge ([`src/preload/index.ts`](./src/preload/index.ts)), which also exposes
  sandboxed filesystem and git helpers.
- **Hive / event plane.** `hive.ts` is the on-disk multi-agent layer; `hooks.ts` runs the hook
  server that provider bridges POST lifecycle payloads to (`cth-hook` for Claude Code, `agy-hook`
  for Antigravity). `memory.ts` wraps the semantic memory CLI. The router delivers messages, drains
  provider outboxes, the GOD agent adjudicates, and idle/inbox wakeups keep workers draining mail.

## Project structure

```
src/
  main/                      Electron main process (Node)
    index.ts                 window, IPC handlers, quit guard
    pty.ts                   node-pty manager (spawn/write/resize/kill/stream)
    hive.ts                  on-disk multi-agent layer (memory, mailboxes, router)
    hooks.ts                 hook server + provider hook shims (`cth-hook`, `agy-hook`)
    memory.ts                semantic memory layer (CLI wrapper, degrade-to-noop)
    config.ts                harness config persistence + home setup
    transcript.ts            reads ~/.claude/projects/ JSONL transcripts for real token/cost telemetry
    telemetry.ts             live OTel collector + usage/cost feed for observability
    usage.ts / pricing.ts    UsageProvider seam + per-model cost attribution
    breaker.ts / control.ts  cost/runaway circuit breaker (steer/constrain/stop) + HITL gate / steer / stop
    reflect.ts               MemoryReflector — memory condensation
    db.ts                    SQLite durable store (window bounds + history) + durable cost ledger
    github.ts                GitHub issue + CI run ingestion via the gh CLI
    shellEnv.ts              resolve PATH and shell env for child processes
    fs.ts / git.ts           sandboxed filesystem + git bridges
  preload/                   contextBridge → typed window.cth API
  renderer/src/
    App.tsx                  top-level layout + wiring
    design/                  tokens.css / tokens.ts / global.css (design source of truth)
    components/              PixelPanel, AgentDetailPanel, CommandBar, ApprovalsPanel, MemoryPanel, …
    CommandCenterPanel,      Michael's control surface (Terminal/Floor/Memory/Activity/Tasks/Triggers/Handbook tabs)
    ToolWaterfall,           per-agent tool-span waterfall for the observability view
    TasksKanban,             dependency-aware kanban board (Tasks tab; ▤ archives a card off
                             the board without deleting it, ARCHIVED filters to those)
    ThreadsPanel,            hive message conversation viewer (Messages tab)
    MessageQueueComposer,    park messages for a busy agent
    scene/office/            Pixi office floor: OfficeFloor, Character, Camera, cast, pathfinding, …
    store/ · hooks/          zustand store, event loop, PTY parser, typewriter
    assets/                  tilesets, maps, character sheets (see ATTRIBUTION.md)
docs/                        `logo.png`, `banner.png`, landing page (GitHub Pages → munderdiffl.in)
docs/media/                  `og.png` (social previews) + rendered Remotion clips
landing-remotion/            Remotion project that renders the landing page's "how it works" clips
HIVE.md · SPEC.md · DESIGN.md   multi-agent · terminal/event · visual design
docs/message-queue.md        who may type into an agent's terminal, and when
```

<div align="right">(<a href="#office">↑ back to top</a>)</div>

## Design system

The aesthetic is **Animal Crossing × Earthbound × SNES menu UI** — pixel-snapped, chunky, friendly.
[`DESIGN.md`](./DESIGN.md) is canonical; every component derives from its tokens. The Office
brand layers a **Dunder-Mifflin maroon** (`#6E1423`) and **gold** (`#F4D35E`) on top for logo and
chrome. The 15 avatars are the cast of *The Office*, differentiated by hair/skin/shirt recipes.

## Roadmap

Shipped through **v0.4.3** — ten agent engines with BYOK keys and local LLMs, voice orchestration,
the hive (memory · mailboxes · blackboard · event log), Command Center with kanban and schedules,
a built-in Monaco IDE with git rails, integrations registry + secret broker, Slack-spawned workers,
shareable hires and the Agent Gallery, observability and the circuit breaker, durable persistence,
session resume, multi-window floors, and working auto-update.
Full history in [`CHANGELOG.md`](./CHANGELOG.md).

Next up:

- [ ] **More chat integrations** — Telegram and richer chat bridges that pipe a channel into Michael's queue and route replies back out.
- [ ] **More engines & integration templates** — keep growing the engine roster and the integrations registry.
- [ ] **Fuller avatar coverage** — drive the remaining station visits and tool-bubbles entirely from real hook events.
- [ ] **Durable layout & command history** — extend persistence to agent layout and per-session history.

<div align="right">(<a href="#office">↑ back to top</a>)</div>

## Contributing

Contributions are welcome — this is an early prototype with a lot of surface area. Start with
[`CONTRIBUTING.md`](./CONTRIBUTING.md). The short version: fork, `npm install && npm run dev`, keep
`npm run typecheck` green, and **derive any new UI from [`DESIGN.md`](./DESIGN.md) tokens**. Good
first areas: wiring real hook events, the add-agent flow, the config drawer, and cross-platform work.

Questions, bugs, or want to show off your office? Join the Discord: **<https://discord.gg/SEDzP5ZPk5>**. Add your Discord handle to a PR and you'll get the `employee of the month` role when it merges.

## Telemetry

Official builds send a **small set of anonymous usage events** (app opened, agent spawned, feature
used) — never prompts, code, file paths, or agent output. The complete event list, the anonymity
guarantees, and the three ways to opt out (Settings toggle, `DO_NOT_TRACK`, or building from
source — forks compile with no key and send nothing) are documented in
[`TELEMETRY.md`](./TELEMETRY.md).

## License

> [!IMPORTANT]
> **Asset licensing.** The bundled pixel art (tilesets, maps, and the base character sheets the
> Office cast is recolored from) comes from [LimeZu](https://limezu.itch.io/) via
> [`shahar061/the-office`](https://github.com/shahar061/the-office) under the **LimeZu FREE VERSION
> license — non-commercial use only**. The recolored sprites inherit that restriction. See
> [`src/renderer/src/assets/ATTRIBUTION.md`](./src/renderer/src/assets/ATTRIBUTION.md). **To
> commercialize, replace these assets or obtain a paid LimeZu license.**

The **source code** is licensed under the **MIT License** — see [`LICENSE`](./LICENSE). The MIT grant
covers the code only; the non-commercial asset restriction above is carved out in the `LICENSE` scope
note. *Office* is an affectionate parody and is not affiliated with NBC's *The Office* or
Dunder Mifflin.

## Acknowledgements

- [LimeZu](https://limezu.itch.io/) — pixel-art tilesets and character base sheets.
- [`shahar061/the-office`](https://github.com/shahar061/the-office) — office tileset/map vendoring.
- [Pixi.js](https://pixijs.com/) · [xterm.js](https://xtermjs.org/) · [node-pty](https://github.com/microsoft/node-pty) · [electron-vite](https://electron-vite.org/) · [CodeMirror](https://codemirror.net/) — the libraries this is built on.
- [Remotion](https://www.remotion.dev/) — the landing page's animated "how it works" clips (`landing-remotion/`).
- *The Office* (US) — for Munder Difflin, Inc.
