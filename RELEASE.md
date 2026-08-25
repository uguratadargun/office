# Office v0.4.5

**A local hive of Claude Code, Antigravity, Codex, Grok & Copilot agents that run themselves** — messaging,
routing, and remembering, coordinated by your clone, Michael, who you talk to. Local-first and open source.

### → [**munderdiffl.in**](https://munderdiffl.in/) — see it in action, then grab a build below

---

---

## What's new in 0.4.5

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

> **This build is not code-signed.** See **First launch** below before you open it.
>
> The supporters wall on the site is **frozen** — it was rebuilt hourly from the upstream
> project's Razorpay account, and this fork takes no payments. The page stays; nothing
> updates it.

---

## Still new in 0.4.4 — *Windows agents can talk to each other*

**If you use Windows, this is the release that makes the app work.** Agents could never
message each other there — they started, looked completely healthy, and quietly ignored one
another forever. That's fixed.

It's also the release that fixes the first five minutes. Setup could not be finished, and on a
brand-new install the parts that carry messages between agents never started until you quit and
reopened the app.

### Windows

- **Your agents can talk to each other.** This never worked before. If you tried the app on
  Windows and your team just sat there, that was this bug — not you.
- Setup no longer runs off the edge of the screen.

### The first five minutes

- **Setup finishes.** Accepting the suggested folder used to fail outright, and the folder box
  was empty even though the text above promised a suggestion. Both fixed.
- **It tells you what's missing straight away**, instead of walking you through four steps and
  then sending you back to the first one.
- **A fresh install works immediately.** Messages between agents, live status on the cards, and
  "Restart & Continue" all used to stay dead until you restarted the app. Nothing said so.

### New things

- **Skills** — see every skill your agents can use, browse 227 more, and install or remove them
  in a click.
- **Prerequisites** — one page in Settings that says which supporting tools you have, which you
  don't, and what each one is for. A button asks Michael to set up whatever is missing.
- **Release notes you'll actually read** — like this one. Updates can now bring a designed page
  instead of a version number in the corner.
- **A card at the top of Settings** with your version, plan, and a way to reopen these notes.

### Dark mode

**Rebuilt.** Every button, box and input is drawn with a one-pixel border, and in dark mode
those borders were effectively invisible — so the whole app read as flat grey shapes. The
colours are re-tuned and checked for readability rather than picked by eye. Backgrounds are
softer, text is a warm off-white instead of glaring white, and the selected tab is legible again.

### Everything else

Copy from a terminal comes back clean, with accents and dashes intact. Dictation pastes what you
just said. Images and screenshots open in the IDE. Michael sits first on the dock again and it's
obvious which agent you're looking at. Task cards stop going missing. Idle agents stop being told
to compact every hour. Grok 4.6 is selectable. The office stops drawing itself when nobody's
looking at it.

<details>
<summary><strong>For the nerds</strong> — what actually happened, in detail</summary>

**Windows: two separate bugs, one symptom.**
The hive protocol reaches an agent as a command-line argument: multi-line, paren-heavy, ~6.1k
characters. A `.cmd` cannot be handed to `CreateProcess`, so any non-`.exe` target was spawned as
`cmd.exe /d /s /c "<one pre-escaped string>"`. cmd.exe treats CR/LF as a statement separator
before quoting is considered, so the argument was truncated at its first newline — taking the
block that names `inbox/` and `outbox/` with it. Escaping cannot fix this: cmd.exe has no
backslash escape, every `"` toggles quote state, and no escape exists for a newline. The fix
decodes the npm shim to its interpreter and script and spawns that with an argv **array**, so
node-pty's MSDN/CRT escaping hands the whole prompt to `CreateProcess` (ceiling 32767, not 8191).

The first fix still missed OpenCode. `opencode-ai`'s `bin` is `./bin/opencode.exe` — a compiled
binary, not a JS script — so npm writes an *interpreter-less* shim (`"%dp0%\..\opencode-ai\bin\opencode.exe" %*`).
The resolver only modelled "interpreter + script" and returned null, falling straight back to the
truncating path for **every** Windows OpenCode install. Diagnosed on macOS by generating the exact
shim with npm's own `cmd-shim` package; the resolver now handles direct-executable shims, and the
previously silent fallback logs which target it could not decode.

**First-run bootstrap.** `bootstrapHiveServices()` runs once at app-ready and opens with
`if (!hive.enabled()) return` — and a fresh install has `harnessHome: null` at that moment.
Onboarding then sets it through `config:update`, which did not re-bootstrap. The message router
(`hive.startRouter()`, the poll loop draining `outbox/` → `inbox/`), the hook server, the
telemetry collector and the mission scheduler all stayed dead for the entire session. `changeHome`
had always handled this by relaunching; onboarding does not relaunch. It now bootstraps on the
`null → set` transition. A second source also records the live session id, so "Restart & Continue"
has a resume key even when a hook never lands.

**Onboarding.** The folder field read `window.process.env.HOME`, which is always `undefined`
under `contextIsolation: true` with only `cth` bridged — so the "suggested" default could never
appear. It now suggests `~/HarnessAgents` literally, which `normalizeHiveHome`/`expandTilde`
already expand at both the config-write boundary and `ensureHarnessHome`'s mkdir. The overlay
also centres with `margin: auto` rather than `align-items: center`, because a centred flex item
that overflows is clipped at the top and unreachable by scrolling.

**Dark mode.** Text always measured fine (11–14:1). `ink-300` measured **1.73–2.09:1** — and it is
the structural token, used 187 times, 93 of those as `inset 0 0 0 1px`. Below ~3:1 a one-pixel
line is not perceivable. It is now 3.4–4.0:1, the ground sits at luminance 0.009–0.020 rather than
near-black, and text is 0.71 rather than 0.84. The selected Command Center tab was painting
`ink-900` (near-white in dark) on a light accent fill at 1.55–1.87:1; a new `--cth-on-accent`
token is dark in both themes and takes it to 7.0–8.5:1. The xterm palette re-states these values
because xterm takes literals, so it moved with them.

**Release drops.** A release body may carry an authored HTML page between a pair of
`drop` HTML comments. It renders inside a sandboxed iframe with its own
`default-src 'none'` CSP, so an authored page can be laid out freely and still cannot
reach the app. A release with no such block falls back to the generated digest.

## Still new in 0.4.3 — *Michael is the logo*

**The mark is a face now.** Munder Difflin has always been an office you watch people work in,
and the icon was a pair of script initials on a gradient. It's Michael — your clone — drawn in
the app's own pixel art, on the brand yellow, looking straight back at you.

- **One mark, everywhere.** The dock icon on macOS, Windows and Linux, the site favicon and
  header, the in-app toolbar, and the README all render the same portrait. No variant is a
  redrawing of another.
- **The SVG is the source of truth.** The mark is authored as pure vector — every pixel of the
  sprite is a rect, with no fonts, no gradients and no filters — and every raster in `build/`
  and `docs/` is generated from it by [`tools/make-logo.cjs`](https://github.com/uguratadargun/office/blob/main/tools/make-logo.cjs).
  The old icon depended on the Lobster webfont being installed to render correctly.
- **Icons are native at every size.** A real multi-resolution `.icns` (16→1024, with the macOS
  drop shadow) and a `.ico` carrying six sizes, plus a 32px favicon and a 180px apple-touch-icon,
  so nothing is a downscale of a 512px image any more.
- **Brighter call-to-action buttons.** The download button took its fill from the same token as
  accent *text*, which has to stay dark enough to read on a white page — so on the light theme
  it came out brown. Fills now have their own token and start at what used to be the hover colour.

> [!NOTE]
> **Appearance only.** No functional change in this release: the update carries the new icon into
> your dock, and nothing else moves.

---

## Still new in 0.4.2 — *Anonymous usage stats, done in the open*

Munder Difflin now sends a **small set of anonymous usage events** (app opened, agent spawned,
feature used) so we can tell whether features are actually used. It is built the way an
open-source project should build it:

- **[TELEMETRY.md](https://github.com/uguratadargun/office/blob/main/TELEMETRY.md) is the
  complete contract.** Every event and property is listed there, and the code enforces that list
  as a hard allowlist — anything not in the table cannot be sent. No prompts, no transcripts, no
  file paths, no repo names, no identifiers. Events are PostHog *anonymous events* (no person
  profile, no identity), keyed by a random UUID you can delete.
- **Opt-out, three ways.** Uncheck it during onboarding, flip **Settings → General → Anonymous
  usage stats**, or set the standard `DO_NOT_TRACK` env var.
- **Forks send nothing.** The analytics key is injected only in release CI — building from
  source produces a build where the analytics module is a complete no-op.

---

## Still new in 0.4.1 — *The app says what the site says*

**Michael is your clone.** The website has been describing Munder Difflin as a clone of you that
works around the clock — the app still called it a "GOD agent." Now they match.

- **Your clone, not the GOD agent.** Michael is described as your clone throughout onboarding,
  and his card on the floor carries a **BOSS** tag — he's the boss of the agents, you're still
  the boss of him.
- **Onboarding was rewritten.** It opens on what you actually get ("a clone of you, working
  24/7") instead of a feature list, and the engine card no longer advertises three engines when
  ten ship — Claude Code, Codex, Grok, Kimi, Antigravity, Qwen, OpenCode, Crush, pi and Copilot
  are all named.

> [!NOTE]
> **This release changes wording only.** The `god` agent id, the hive folder layout, and message
> routing are untouched, so existing hives, memory, and running agents carry over exactly as they
> are. Nothing to migrate.

---

> [!NOTE]
> **Auto-update carries you here from v0.3.7 or later.** If you are still on v0.3.5 or v0.3.6,
> those builds shipped the broken updater and need one manual install — grab the download below,
> once.

---

## Previously

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

This release carries community work. Every one of these landed in v0.4.4:

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
| Universal (Apple Silicon + Intel) | [`Office-0.4.5-mac-universal.dmg`](https://github.com/uguratadargun/office/releases/latest/download/Office-0.4.5-mac-universal.dmg) |

### 🪟 Windows
| Build | File |
|---|---|
| Installer (x64) — *recommended* | [`Office-0.4.5-win-x64-setup.exe`](https://github.com/uguratadargun/office/releases/latest/download/Office-0.4.5-win-x64-setup.exe) |
| Portable (x64, no install) | [`Office-0.4.5-win-x64-portable.exe`](https://github.com/uguratadargun/office/releases/latest/download/Office-0.4.5-win-x64-portable.exe) |

### 🐧 Linux
| Build | File |
|---|---|
| AppImage (x86_64) | [`Office-0.4.5-linux-x86_64.AppImage`](https://github.com/uguratadargun/office/releases/latest/download/Office-0.4.5-linux-x86_64.AppImage) |

### 📦 Source
[Source code (zip)](https://github.com/uguratadargun/office/archive/refs/tags/v0.4.5.zip) ·
[Source code (tar.gz)](https://github.com/uguratadargun/office/archive/refs/tags/v0.4.5.tar.gz)

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
