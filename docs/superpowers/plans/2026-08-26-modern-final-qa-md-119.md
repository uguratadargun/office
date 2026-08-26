# MD-119 — Modern UI final QA, part 2: Agents · Floor · parked & archived states

Read-only QA against main `9d850245` (1053 tests). Packaged build (`rm -rf out && npm run build`),
launched with `env -u ELECTRON_RENDERER_URL npx electron . --user-data-dir=<scratch>` on a scratch
profile whose `harnessHome` is a scratch hive — Slack, Telegram, webhooks, realtime voice, freeflow,
notifications and telemetry all off, `autoMode: false`, `idleHibernateMinutes: 600` so nothing
hibernates underneath the QA. `ui.mode` seeded to `modern`. Both themes were driven with the shell's
own topbar toggle, never by stamping `data-cth-theme`. The real
`/Users/ugur/HarnessAgents/roster.json` and the running app were never touched.

The fixture is a scratch roster shaped like the real one, with every agent's `command` (and the
config's `defaultCommand`) replaced by `bash -lc 'while true; do sleep 5; done'` — a REAL pty with a
real pid, and no CLI billed. That is what makes the MD-114b check honest: the process is genuinely
alive until a `kill -9` from a shell, which is the state the card has to notice. States covered:
live, idle, deliberately hibernated (`sleeping: true`), the MD-114 zombie (no `ptyId`,
`sleeping: false`, `status: 'working'`), a card claiming a dead `ptyId`, archived (2), restorable (3,
with a `cwd` that does not exist so the auto-restore FAILS and the list stays on screen), an agent
whose `cwd` is gone so Wake fails, and an unread inbox message on the parked agent.

Source of truth: the pixel components named per row, `src/renderer/src/modern/agents/SPEC.md`,
`src/shared/agentPresence.ts` and `docs/DESIGN-MODERN.md`.

**Severity:** S1 = blocks making modern the default (a capability the human loses, or a destructive
action made easier). S2 = notable degradation, ship-blocking for a power user. S3 = polish.

Screenshots: `$AGENT_DIR/artifacts/md-119/` (light + dark).

**Verdict: Agents/Floor ready for default — YES. No S1. One S2 (F1) worth fixing with the flip.**

## Findings

| # | Sev | What | Where |
|---|---|---|---|
| F1 | **S2** | A processless agent's floor bubble reads **“reconnecting…” forever** | `store/store.ts:489` |
| F2 | S3 | Selecting a processless row is nearly invisible — `opacity-60` composites the selection fill down to the hover fill | `modern/agents/AgentList.tsx` |
| F3 | S3 | Three disabled engine controls per processless row, with no way to learn why | `modern/agents/AgentsOverview.tsx` `EngineRow` |
| F4 | S3 | The floor stage letterboxes with **pure black** — over half the frame, in light theme | `modern/views/FloorView.tsx` + `scene/office` |
| F5 | S3 | The restore-failure note repeats a full absolute path per agent | `modern/agents/AgentsOverview.tsx` |

### F1 — S2 — the floor says “reconnecting…” about an agent that is not reconnecting

`loadPersistedAgents` stamps `action: 'reconnecting…'` on EVERY agent at boot, on the assumption that
the PTY stream is about to repopulate it. Nothing clears it for an agent that never gets a process.
`OfficeFloor.tsx:159` renders `agent.action` as the speech bubble, so every asleep/parked character
stands at its desk saying it is reconnecting — permanently, and five at once on the fixture floor.

This is the MD-114 defect exactly ("the UI was describing a state the agent was not in"), one surface
further down. MD-114 fixed the RAIL by making `rowSubtitle` fall back to `project` for a processless
agent, which is why the rail reads honestly (`Dwight · hive`) two inches from a character insisting
it is reconnecting. `presenceCopy` already owns the vocabulary for this and the floor does not use it.

Repro: seed a roster with any agent that has no `ptyId`, boot, open Floor (`42-floor-carpet-cleared-light.png`
— five “reconnecting…” bubbles above five agents the rail calls `asleep`). Also visible in
`30-floor-light.png` and `41-floor-picked-light.png`.

Not modern-only: the action is written in the shared store and rendered by the shared scene, so the
pixel floor says it too. Fixing it in `loadPersistedAgents` (or by having the scene ask
`agentPresence`) covers both.

### F2 — S3 — a selected asleep row reads as a merely hovered one

`AgentRow` applies `isProcessless(agent) && 'opacity-60'` to the whole button, so the ladder MD-108
set is multiplied by 0.6 before it reaches the eye. Measured off the running app:

| | light | dark |
|---|---|---|
| rest | `#ffffff` (transparent) | `#131316` (transparent) |
| hover, awake | `rgb(237,237,239)` | `rgb(41,41,46)` |
| selected, awake | `rgb(218,218,222)` + ring | `rgb(56,56,62)` + ring |
| **selected, asleep** (composited at 0.6) | **`rgb(233)`** | **`rgb(41)`** |

So a selected asleep row lands 4/255 from the awake hover fill in light, and exactly on it in dark.
The `border-ring` still marks the selection (it composites to ~`rgb(90)` in dark), so nothing is
lost — but the fill, which is the ladder's loud half, is gone at the moment it matters. After MD-114
most of a real roster can be processless, so this is the common row, not the edge case.

Worth noting for whoever fixes it: `test/modern-theme-contrast.test.cjs` ("the ladder is applied at
full strength") greps class strings, so it passes on this — the halving happens at composite time,
not in the classes. Fading the row's *content* rather than the row would keep both.

### F3 — S3 — 18 dead controls with no explanation

`EngineRow` is `disabled={!config || !a.ptyId}`, so every processless agent's Engine, Model and
Reasoning-effort selects render greyed. Verified on the running app: all three report
`disabled: true`, `title: null`, no tooltip wrapper. Six asleep agents is eighteen of them.

The gating is right — a flag is a spawn argument and there is nothing to spawn into. The problem is
that it is unexplained, and it is unexplained *asymmetrically*: `Continue` and `Restart` both carry
tooltips saying what they do, and both are swapped out for `Wake` when the agent is processless, so
the controls that could speak leave and only the mute ones stay. This is god's standing rule from
`god-disabled-trigger-rule` (a disabled control is `pointer-events: none`, so it needs a wrapping
`<span>` as the trigger) — one tooltip on the row, "engine changes land on the next spawn — wake it
first", closes it. `33-restorable-overview-light.png`, `34-restorable-overview-dark.png`.

### F4 — S3 — the floor's black letterbox

`OfficeFloor` keeps the scene's aspect ratio and fills the width, so the leftover height is painted
pure black. With the inspector open the canvas is 706×818 and the office art is ~450px tall: roughly
250px of black above and below, over half the frame, and the largest single element on a light page
(`30-floor-light.png`, `41-floor-picked-light.png`). With the inspector closed the bands shrink to
~35px and it reads fine (`42-floor-carpet-cleared-light.png`), so this only bites in the state the
Floor is actually used in — one picked agent.

`scene/office/**` is a hard boundary in both design systems and its palette is not up for
negotiation, but the *frame* is modern's: letting the wrapper letterbox in `--card` rather than
black, or centring the stage in a shorter box, is a change outside the scene.

### F5 — S3 — the restore-failure note is five lines of path

A failed `Restore all (3)` prints `3 failed — Stanley: cwd does not exist: /private/tmp/…; Phyllis:
cwd does not exist: /private/tmp/…; Oscar: cwd does not exist: /private/tmp/…` — the same sentence
three times, each with a full absolute path, wrapping to five lines above the rows. That the note
exists at all is the fix MD-92 asked for (a restore can never look inert) and the reason is genuinely
useful; it is the repetition that is worth trimming, since each row already has its own error slot
directly underneath it. `33-restorable-overview-light.png`.

## Agents

| Check | Pixel / spec | Modern | Sev | Note |
|---|---|---|---|---|
| Rail: name · boss · status · action-or-repo · gauge · billed chip · ✎ typing · ✻ note | `AgentCard.tsx` | parity | — | `10-agents-light.png` |
| Order: god pinned, then live, then idle, then processless | `agentsModel.agentListRank` (MD-106/114) | parity | — | Verified live: killing Toby's pty moved him from the idle tier to the bottom without touching the others |
| One status word/tone everywhere (rail · roster table · detail header) | `statusBadge` (MD-100/114) | parity | — | `asleep` + `outline` for both processless states, in all three places |
| Processless row drops the stale `action` for the repo | `rowSubtitle` (MD-114) | parity | — | Dwight is seeded `status: working · action: writing the migration`; the rail reads `hive` |
| Detail pane names WHICH processless state, with a control | `presenceCopy` (MD-114) | parity | — | “Parked — no process” `11-dwight-parked-light.png` vs “Asleep” `12-pam-asleep-light.png`, each with Wake |
| **Wake** respawns under the same id | `wakeSleepingAgent` | parity | — | Toby: pane → live terminal, `pty-toby-blocked` reused, Pause/Halt/Steer back (`15-toby-woken-light.png`) |
| **Wake failure stays on screen, with the reason** | MD-114 | parity | — | `could not wake — cwd does not exist: …` (`50-wake-failure-light.png`) |
| **MD-114b: a pty that dies while the window is open** | `scanDeadPtys`, `MIN_PARK_AGE_MS` | parity | — | `kill -9` from a shell → card parked in ~18s (worker) and ~20s (the boss), re-ranked, terminal pane swapped to Parked+Wake (`13-`→`14-toby-parked-after-kill-light.png`, `51-boss-parked-light.png`) |
| Floor chip `N working` counts only live agents | MD-114 | parity | — | Two live-and-busy agents out of nine read `2 working`; see the caveat below |
| Archive = two-press arm + countdown | `useDestructive` / `AgentDetailPanel.tsx:66` | parity | — | `archive Kevin · 4s`, aria `Confirm — archive Kevin` (`16-archive-armed-light.png`) |
| Archiving a PROCESSLESS agent actually archives it | `endSessionAndArchive` (MD-112) | parity | — | Kevin was asleep (no `ptyId`) and left the roster on confirm (`17-after-archive-light.png`) |
| Archived: collapsible, count, Restore, Forget, per-row errors | `FloorTab` | parity | — | `19-archived-open-light.png` |
| **Restore brings the agent back AWAKE** | `restoredRecord` (MD-113) | parity | — | Archived-while-asleep Kevin returns `idle` on a live pty with Pause/Halt/Steer — not “asleep + Wake” (`20-kevin-restored-light.png`) |
| Restorable: rail footer, Restore all (N), per-agent Restore, Dismiss ✕, outcome note | `AgentStrip.tsx:255-337` | parity | — | Was the MD-92 S1; now complete, and the failure note names every agent and reason (`33-`/`34-restorable-overview-*.png`). See F5 |
| Roster table: provider · model · effort EDITABLE, Continue, Restart, cap | pixel `FloorTab` | parity | — | Four MD-92 S2/S3 gaps closed at once; `Wake` replaces the two restart buttons for a processless agent (`33-restorable-overview-light.png`). See F3 |
| Add Agent: Identity · Workspace · Engine · Briefing, **Import hire file** | `AddAgentModal.tsx:357` | parity | — | MD-92 S2 closed (`45-add-agent-dark.png`) |
| Private note, inline edit | `AgentStrip.tsx:169-217` | parity | — | MD-92 S2 closed — “Add a private note about this agent” in the detail header, ✻ + tooltip on the rail |
| Detail: Messages (inbox/outbox thread, reply box) | `ThreadsPanel` | parity | — | The parked agent's unread message is readable and answerable (`46-messages-dark.png`) |
| Dispatch: always to the boss, agent as a suggestion, sticky on failure | `agentsModel.dispatchBody` | parity | — | `sent to Michael`; a real message file landed in the god's inbox (`47-dispatch-dark.png`) |
| Boss name throughout | `@shared/bossName` | parity | — | `bossName: 'Michael'` reaches the dispatch header, the suggestion select, the outcome line and the topbar |
| Rail: hover / selected / focus ladder | MD-108 | degraded | S3 | Awake rows are a clean three-step ladder in both themes; processless rows are not — F2 |

**Caveat on the `N working` chip.** The exclusion of a *stale-working* agent could not be staged at
boot: `loadPersistedAgents` resets every agent to `status: 'idle'`, so a roster seeded
`working`-with-no-pty never reaches the chip as `working`. What is verified is the live half — the
chip tracked exactly the agents with a running process across three boots, and never counted the six
processless ones. The in-session case, which is the one MD-114 was filed about, is covered by the
MD-114b kill test above: the moment the pty went, the card left the live tier.

## Floor

| Check | Pixel / spec | Modern | Sev | Note |
|---|---|---|---|---|
| The Pixi scene mounts as-is, framed by the modern chrome | DESIGN.md §3.10 | parity | — | Nothing inside `scene/office/**` is restyled |
| Clicking a character opens THAT agent in the inspector | `store.select(id)` | parity | — | `43-floor-character-picked-light.png` |
| One selection app-wide — pick on the Floor, the Agents view is already there, and back | `FloorView` | parity | — | Verified in both directions |
| Esc closes the panel | `FloorView` | parity | — | |
| Clicking the carpet clears the selection | `floorSelection.ts` | parity | — | A real pointerdown/up on empty floor closed the inspector (`42-floor-carpet-cleared-light.png`) |
| Topbar: `N agents` · `N working` · booting | `App.tsx FloorStatus` | parity | — | |
| Character speech bubble | `OfficeFloor.tsx:159` | **wrong** | **S2** | F1 — “reconnecting…” forever for every processless agent |
| Stage fills its frame | — | degraded | S3 | F4 — pure-black letterbox, over half the frame with the inspector open |

## Both themes

Light and dark were captured for the roster, the overview with the restorable and archived sections,
the Floor with an agent picked, the Add-agent dialog, Messages and Dispatch. No token resolved to a
missing value, nothing rendered unstyled, and the topbar toggle drove `data-cth-theme` on `<html>`
with both entries reading back correctly. The only theme-sensitive defect is F2, and it is present in
both — identical fills in dark, 4/255 apart in light.
