# Office v0.4.4

**A local hive of Claude Code, Antigravity, Codex, Grok & Copilot agents that run themselves** — messaging,
routing, and remembering, coordinated by your clone, Michael, who you talk to. Local-first and open source.

### → [**munderdiffl.in**](https://munderdiffl.in/) — see it in action, then grab a build below

---

---

## What's new in 0.4.4

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

**Release drops.** A release body may carry an authored HTML page between `<!-- drop -->
<style>
  html, body { height: 100%; }
  body { overflow: hidden; }
  .stage { height: 100%; }
  .pg { position: absolute; opacity: 0; pointer-events: none; }

  .page { display: none; height: 100%; flex-direction: column;
          padding: clamp(24px, 4vw, 46px); }
  #pg1:checked ~ .stage .p1,
  #pg2:checked ~ .stage .p2,
  #pg3:checked ~ .stage .p3,
  #pg4:checked ~ .stage .p4,
  #pg5:checked ~ .stage .p5,
  #pg6:checked ~ .stage .p6 { display: flex; animation: rise .34s cubic-bezier(.2,.7,.3,1) both; }
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

  .content { flex: 1; min-height: 0; overflow-y: auto; }
  .center { display: flex; flex-direction: column; justify-content: center; }
  .nav { flex-shrink: 0; display: flex; align-items: center; gap: 12px;
         padding-top: 16px; margin-top: 12px; border-top: 1px solid var(--line); }
  .dots { display: flex; gap: 7px; flex: 1; }
  .dot { width: 7px; height: 7px; border-radius: 999px; background: rgba(20,19,26,.16);
         cursor: pointer; transition: background .2s, transform .2s; }
  .dot:hover { background: rgba(20,19,26,.34); }
  .dot.on { background: var(--accent); transform: scale(1.25); }
  .btn { cursor: pointer; border-radius: 999px; font-size: 13.5px; font-weight: 600;
         padding: 9px 18px; border: 1px solid var(--line); color: var(--ink-soft);
         user-select: none; transition: background .16s, color .16s; }
  .btn:hover { background: rgba(20,19,26,.04); }
  .btn.primary { background: var(--ink); border-color: var(--ink); color: #FBFAF8; }
  .btn.primary:hover { background: #2a2733; }

  .kicker { font-size: 11.5px; font-weight: 700; letter-spacing: .14em;
            text-transform: uppercase; color: var(--accent); margin: 0 0 14px; }
  h1 { font-size: clamp(1.8rem, 4.4vw, 2.7rem); }
  .lede { margin-bottom: 1.4em; }
  .big { font-size: clamp(3.2rem, 10vw, 5.4rem); line-height: .92; letter-spacing: -.045em;
         font-weight: 700; margin: 0 0 .1em;
         background: linear-gradient(135deg, #14131A 20%, #1B7F5A 115%);
         -webkit-background-clip: text; background-clip: text; color: transparent; }
  .stat { display: flex; gap: 24px; flex-wrap: wrap; margin-top: 24px;
          padding-top: 18px; border-top: 1px solid var(--line); }
  .stat b { display: block; font-size: 1.5rem; letter-spacing: -.03em; font-weight: 680; }
  .stat span { font-size: 12px; color: var(--ink-soft); }

  .tag { display: inline-block; font-size: 10.5px; font-weight: 700; letter-spacing: .1em;
         text-transform: uppercase; color: var(--accent);
         background: rgba(27,127,90,.09); padding: 4px 9px; border-radius: 999px; }
  .quote { border-left: 2px solid var(--accent); padding-left: 15px; margin: 18px 0 0;
           color: var(--ink-soft); font-size: 14.5px; }
  .rows { list-style: none; padding: 0; margin: 0; }
  .rows li { display: grid; grid-template-columns: 96px 1fr; gap: 12px; align-items: baseline;
             padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 13.5px; }
  .rows i { font-style: normal; font-size: 10px; font-weight: 700; letter-spacing: .09em;
            text-transform: uppercase; color: var(--ink-soft); }
  .rows b { font-weight: 620; }
  .rows p { margin: 1px 0 0; color: var(--ink-soft); font-size: 12.5px; }
  .card { border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px; }
  .card h2 { margin: 10px 0 .2em; font-size: 1.15rem; }
  .card p { margin: 0; color: var(--ink-soft); font-size: 13.5px; }
  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
  /* 16:10, not 4:3 — the taller ratio pushed the second row past the fold, and a
     drop page that scrolls cuts a sentence in half at the boundary. */
  .split .placeholder { aspect-ratio: 16 / 10; }
</style>

<input class="pg" type="radio" name="pg" id="pg1" checked>
<input class="pg" type="radio" name="pg" id="pg2">
<input class="pg" type="radio" name="pg" id="pg3">
<input class="pg" type="radio" name="pg" id="pg4">
<input class="pg" type="radio" name="pg" id="pg5">
<input class="pg" type="radio" name="pg" id="pg6">

<div class="stage">

  <section class="page p1">
    <div class="content center">
      <p class="kicker">Office</p>
      <h1 class="big">0.4.4</h1>
      <p class="lede" style="font-size:clamp(1.05rem,2.1vw,1.3rem);margin-top:.5em">
        The release where Windows finally joined the floor — and the first run
        stopped quietly failing.
      </p>
      <div class="stat">
        <div><b>27</b><span>fixes</span></div>
        <div><b>4</b><span>new surfaces</span></div>
        <div><b>1</b><span>platform unbroken</span></div>
      </div>
    </div>
    <div class="nav">
      <div class="dots">
        <label class="dot on" for="pg1"></label><label class="dot" for="pg2"></label>
        <label class="dot" for="pg3"></label><label class="dot" for="pg4"></label>
        <label class="dot" for="pg5"></label><label class="dot" for="pg6"></label>
      </div>
      <label class="btn primary" for="pg2">Start &rarr;</label>
    </div>
  </section>

  <section class="page p2">
    <div class="content">
      <p class="kicker">The headline</p>
      <h1>Agents can talk to each other on Windows.</h1>
      <p class="lede">Roughly half of all downloads run on Windows, where
      agent-to-agent messaging had never worked at all.</p>
      <div class="placeholder" data-label="Two agents messaging" style="aspect-ratio:24/9"></div>
      <p class="quote">Every agent booted, rendered, and looked completely healthy.
      None of them had been told they had an inbox.</p>
      <p style="margin-top:16px;color:var(--ink-soft);font-size:14px">Any CLI that is
      not an .exe was launched through cmd.exe, which cuts a multi-line argument at
      its first newline — taking the protocol block with it. Spawns now launch the
      real interpreter with an argument array, so the whole prompt survives.</p>
    </div>
    <div class="nav">
      <div class="dots">
        <label class="dot" for="pg1"></label><label class="dot on" for="pg2"></label>
        <label class="dot" for="pg3"></label><label class="dot" for="pg4"></label>
        <label class="dot" for="pg5"></label><label class="dot" for="pg6"></label>
      </div>
      <label class="btn" for="pg1">&larr; Back</label>
      <label class="btn primary" for="pg3">Next &rarr;</label>
    </div>
  </section>

  <section class="page p3">
    <div class="content">
      <p class="kicker">The first five minutes</p>
      <h1>Setup finishes. The floor wakes up.</h1>
      <p class="lede">Four separate bugs sat on the very first thing a new user does.</p>
      <ul class="rows">
        <li><i>Wizard</i><div><b>The suggested folder works</b>
          <p>Accepting ~/HarnessAgents stored a literal tilde and died on ENOENT.
          It now resolves to a real path — and the field actually suggests it.</p></div></li>
        <li><i>Wizard</i><div><b>It tells you at step one</b>
          <p>An empty folder used to walk you through all four steps before bouncing
          you back. The panel no longer overflows a short screen either.</p></div></li>
        <li><i>Hive</i><div><b>Services start at setup, not next launch</b>
          <p>On a fresh install the message router, hooks and telemetry stayed dead
          until you restarted — so mail never moved and agents never reported.</p></div></li>
        <li><i>Agents</i><div><b>Restart &amp; Continue has something to resume</b>
          <p>The live session id is recorded from a second source, so continuing
          works even when a hook never lands.</p></div></li>
      </ul>
    </div>
    <div class="nav">
      <div class="dots">
        <label class="dot" for="pg1"></label><label class="dot" for="pg2"></label>
        <label class="dot on" for="pg3"></label><label class="dot" for="pg4"></label>
        <label class="dot" for="pg5"></label><label class="dot" for="pg6"></label>
      </div>
      <label class="btn" for="pg2">&larr; Back</label>
      <label class="btn primary" for="pg4">Next &rarr;</label>
    </div>
  </section>

  <section class="page p4">
    <div class="content">
      <p class="kicker">New</p>
      <h1>Four things that were not here before.</h1>
      <div class="split">
        <div class="card">
          <span class="tag">Skills</span>
          <h2>Every skill your agents can use</h2>
          <p>What is installed across Claude Code, OpenCode and Codex — and a
          browsable catalog of 227 more, with search, filters, install and
          uninstall.</p>
        </div>
        <div class="card">
          <span class="tag">Prerequisites</span>
          <h2>Whether you actually have the tools</h2>
          <p>MemPalace, uv, git and every agent engine, with live status and where
          each one sits on disk. One button asks Michael to fill in the gaps.</p>
        </div>
        <div class="card">
          <span class="tag">Release drops</span>
          <h2>This page</h2>
          <p>Update notes used to be three clipped bullets in the corner. A release
          can now carry its own designed page, and you are reading the first one.</p>
        </div>
        <div class="card">
          <span class="tag">Dark mode</span>
          <h2>Rebuilt for reading</h2>
          <p>Every control border measured under 2:1 against its background, so the
          edges defining them were invisible. Re-tuned and measured, not eyeballed.</p>
        </div>
      </div>
    <div class="nav">
      <div class="dots">
        <label class="dot" for="pg1"></label><label class="dot" for="pg2"></label>
        <label class="dot" for="pg3"></label><label class="dot on" for="pg4"></label>
        <label class="dot" for="pg5"></label><label class="dot" for="pg6"></label>
      </div>
      <label class="btn" for="pg3">&larr; Back</label>
      <label class="btn primary" for="pg5">Next &rarr;</label>
    </div>
  </section>

  <section class="page p5">
    <div class="content">
      <p class="kicker">Everything else</p>
      <h1>The rest of the list.</h1>
      <ul class="rows">
        <li><i>Terminal</i><div><b>Copy comes back clean</b>
          <p>The quote rail is stripped and terminals run in UTF-8, so an em dash
          survives the trip to another app.</p></div></li>
        <li><i>Terminal</i><div><b>Dictation pastes what you just said</b></div></li>
        <li><i>IDE</i><div><b>Images open as images</b>
          <p>PNG, SVG and embedded screenshots render. The title names the agent.</p></div></li>
        <li><i>Agents</i><div><b>Restart &amp; Continue revives a dead agent</b></div></li>
        <li><i>Agents</i><div><b>Grok 4.6 in the model picker</b></div></li>
        <li><i>Agents</i><div><b>OpenCode runs the model you actually have</b></div></li>
        <li><i>Board</i><div><b>Task cards stop going missing</b></div></li>
        <li><i>Hive</i><div><b>A wake nudge survives an odd message id</b></div></li>
        <li><i>Hive</i><div><b>Compact fires once, not every hour</b></div></li>
        <li><i>Hive</i><div><b>The cost ledger is out of your git history</b></div></li>
        <li><i>Office</i><div><b>The floor stops rendering when nobody is looking</b></div></li>
        <li><i>Layout</i><div><b>Michael sits first on the dock again</b></div></li>
      </ul>
    </div>
    <div class="nav">
      <div class="dots">
        <label class="dot" for="pg1"></label><label class="dot" for="pg2"></label>
        <label class="dot" for="pg3"></label><label class="dot" for="pg4"></label>
        <label class="dot on" for="pg5"></label><label class="dot" for="pg6"></label>
      </div>
      <label class="btn" for="pg4">&larr; Back</label>
      <label class="btn primary" for="pg6">Next &rarr;</label>
    </div>
  </section>

  <section class="page p6">
    <div class="content center">
      <p class="kicker">One last thing</p>
      <h1 style="font-size:clamp(1.9rem,4.6vw,2.9rem)">Thank you for running this
      on your own machine.</h1>
      <p class="lede" style="margin-top:.4em">Every agent here starts on your
      hardware, in your folders, under your keys. Nothing about that changes.</p>
      <p class="quote">If it has been useful, a star is the entire marketing budget.
      The button is just below this page.</p>
    </div>
    <div class="nav">
      <div class="dots">
        <label class="dot" for="pg1"></label><label class="dot" for="pg2"></label>
        <label class="dot" for="pg3"></label><label class="dot" for="pg4"></label>
        <label class="dot" for="pg5"></label><label class="dot on" for="pg6"></label>
      </div>
      <label class="btn" for="pg5">&larr; Back</label>
      <label class="btn" for="pg1">Start over</label>
    </div>
  </section>

</div>
<!-- /drop -->

## Still new in 0.4.3 — *Michael is the logo*

**The mark is a face now.** Munder Difflin has always been an office you watch people work in,
and the icon was a pair of script initials on a gradient. It's Michael — your clone — drawn in
the app's own pixel art, on the brand yellow, looking straight back at you.

- **One mark, everywhere.** The dock icon on macOS, Windows and Linux, the site favicon and
  header, the in-app toolbar, and the README all render the same portrait. No variant is a
  redrawing of another.
- **The SVG is the source of truth.** The mark is authored as pure vector — every pixel of the
  sprite is a rect, with no fonts, no gradients and no filters — and every raster in `build/`
  and `docs/` is generated from it by [`tools/make-logo.cjs`](https://github.com/chaitanyagiri/munder-difflin/blob/main/tools/make-logo.cjs).
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

- **[TELEMETRY.md](https://github.com/chaitanyagiri/munder-difflin/blob/main/TELEMETRY.md) is the
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

Full history in the [CHANGELOG](https://github.com/chaitanyagiri/munder-difflin/blob/main/CHANGELOG.md).


---

## Thanks

This release carries community work. Every one of these landed in v0.4.4:

| | | |
|---|---|---|
| [#129](https://github.com/chaitanyagiri/munder-difflin/pull/129) | [@gts-47](https://github.com/gts-47) | "Restart & Continue" now works on an agent that already died |
| [#130](https://github.com/chaitanyagiri/munder-difflin/pull/130) | [@gts-47](https://github.com/gts-47) | one odd message id no longer silences an agent's wake nudge |
| [#131](https://github.com/chaitanyagiri/munder-difflin/pull/131) | [@gts-47](https://github.com/gts-47) | dictation pastes what you just said, not the clipboard's previous text |
| [#132](https://github.com/chaitanyagiri/munder-difflin/pull/132) | [@gts-47](https://github.com/gts-47) | a root cwd no longer resolves to the projects directory itself |
| [#133](https://github.com/chaitanyagiri/munder-difflin/pull/133) | [@gts-47](https://github.com/gts-47) | a frozen context reading no longer re-fires `/compact` forever |
| [#134](https://github.com/chaitanyagiri/munder-difflin/pull/134) | [@gts-47](https://github.com/gts-47) | the office floor stops rendering when nobody is looking at it |
| [#143](https://github.com/chaitanyagiri/munder-difflin/pull/143) | [@gts-47](https://github.com/gts-47) | Grok 4.6 in the model picker |
| [#144](https://github.com/chaitanyagiri/munder-difflin/pull/144) | [@gts-47](https://github.com/gts-47) | the cost ledger stays out of the hive's git history |
| [#142](https://github.com/chaitanyagiri/munder-difflin/pull/142) | [@baziyer](https://github.com/baziyer) | renderer task-ledger lost updates — mutations are atomic now |
| [#137](https://github.com/chaitanyagiri/munder-difflin/pull/137) | [@chaitanyagiri](https://github.com/chaitanyagiri) | the CLI's quote rail is stripped from copied selections |

Eight of the fixes above are [@gts-47](https://github.com/gts-47)'s. Thank you.

## ⤓ Downloads

Latest builds for every platform. The macOS build is **universal** — one DMG that runs on both
Apple Silicon and Intel.

### 🍎 macOS
| Build | File |
|---|---|
| Universal (Apple Silicon + Intel) | [`Office-0.4.4-mac-universal.dmg`](https://github.com/chaitanyagiri/munder-difflin/releases/latest/download/Office-0.4.4-mac-universal.dmg) |

### 🪟 Windows
| Build | File |
|---|---|
| Installer (x64) — *recommended* | [`Office-0.4.4-win-x64-setup.exe`](https://github.com/chaitanyagiri/munder-difflin/releases/latest/download/Office-0.4.4-win-x64-setup.exe) |
| Portable (x64, no install) | [`Office-0.4.4-win-x64-portable.exe`](https://github.com/chaitanyagiri/munder-difflin/releases/latest/download/Office-0.4.4-win-x64-portable.exe) |

### 🐧 Linux
| Build | File |
|---|---|
| AppImage (x86_64) | [`Office-0.4.4-linux-x86_64.AppImage`](https://github.com/chaitanyagiri/munder-difflin/releases/latest/download/Office-0.4.4-linux-x86_64.AppImage) |

### 📦 Source
[Source code (zip)](https://github.com/chaitanyagiri/munder-difflin/archive/refs/tags/v0.4.4.zip) ·
[Source code (tar.gz)](https://github.com/chaitanyagiri/munder-difflin/archive/refs/tags/v0.4.4.tar.gz)

> **Verify your download:** [`SHA256SUMS.txt`](https://github.com/chaitanyagiri/munder-difflin/releases/latest/download/SHA256SUMS.txt) — then `shasum -a 256 -c SHA256SUMS.txt` (macOS/Linux) or `Get-FileHash` (Windows).

> The filenames above carry a version number, so they only resolve while this is the
> latest release. If a link 404s you are reading an old release page — grab the current
> build from the [**releases page**](https://github.com/chaitanyagiri/munder-difflin/releases/latest),
> which is always right.

---

## First launch

- **macOS** — the build is **signed with a Developer ID** (hardened runtime). If macOS
  still shows an "unidentified developer" warning on first open, right-click the app →
  **Open** → **Open** once. After that, the first time agents touch a folder you'll get a
  single macOS privacy prompt for Documents/Desktop/Downloads — allow it once and the
  grant sticks (it covers the `claude` agents the app spawns), because the grant is bound
  to the app's stable signature.
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
git clone https://github.com/chaitanyagiri/munder-difflin.git
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

Full notes in the [CHANGELOG](https://github.com/chaitanyagiri/munder-difflin/blob/main/CHANGELOG.md).

---

## Links
[Website](https://munderdiffl.in/) ·
[Repo](https://github.com/chaitanyagiri/munder-difflin) ·
[Issues](https://github.com/chaitanyagiri/munder-difflin/issues) ·
[Contribute](https://github.com/chaitanyagiri/munder-difflin/blob/main/CONTRIBUTING.md) ·
[Become a patron](https://razorpay.me/@munderdifflinfund)

MIT-licensed. An affectionate parody — not affiliated with NBC's *The Office* or Dunder Mifflin.
