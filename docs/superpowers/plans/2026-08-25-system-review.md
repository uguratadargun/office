# System review — the ten things to improve next (MD-71)

Read-only analysis at main `63bf590`, 2026-08-25, before the first Office
release. Every item carries a `file:line` or a card id; nothing here is an
opinion without one. No code was changed and no cards were created.

Sources: the repo at `63bf590`, `hive/tasks.json` cards MD-51…MD-70, and
`docs/superpowers/plans/2026-08-25-token-ledger.md` (MD-61).

Impact is 1–5 (5 = can lose money, data, or the human's trust on day one).
Effort is S (< half a day), M (a day or two), L (more).

---

## 1. Slack has no sender allowlist — Telegram does · security · impact 5 · effort S

**Evidence.** `src/main/slack.ts:160-166`: the router's only scope filter is an
**optional** `channelId` (`opts.channelId?.trim() || undefined`). Authentication
is transport-level only — the HMAC at `slack.ts:372` proves the request came from
*Slack*, not from *the owner*. So any workspace member who can @-mention the bot
(or reply in an activated thread) dispatches work to god, and the agents that
work run with approvals off (`src/shared/agentProvider.ts:187`,
`--permission-mode bypassPermissions`). Telegram, shipped later in MD-55, got
this right: `src/main/telegram.ts:244` refuses to poll without an allowed chat id
and filters every update against it.

**Fix.** Give Slack the same gate Telegram already has: a `slackAllowedUserIds`
setting, checked in `_shouldTrigger` next to the existing channel filter.

**What could go wrong.** An empty allowlist must mean *closed*, not *open* —
copying Telegram's "missing allowed chat id ⇒ don't start" is the safe default.
Migration for the existing user: seed the list with their own Slack user id on
first save, or the feature silently stops working after an update.

---

## 2. An agent with no PTY is invisible to both the ledger and the breaker · reliability · impact 5 · effort M

**Evidence.** `src/main/index.ts:1181` — `if (id !== reg.godId && !ptyForAgent(id))
continue;` skips the whole beat for any agent the app does not own a terminal
for. `index.ts:1190` then gates the ledger row on a live OTLP session
(`if (sample?.sessionId)`). Result, measured in the token ledger §0:
`munder-developer-mt2szzlu` has **zero** rows in `cost-ledger.jsonl` while its
transcripts show **532M billed tokens** — the largest single figure on the floor,
and the one number no dashboard or cap can see. The ledger calls this "the MD-7
fleet blind spot in a second place".

**Fix.** Fall back to the transcript sample for spend accounting (keep the live
`sessionId` gate for the *dedup*, not for the *row*), and count PTY-less agents
in the breaker's cost view.

**What could go wrong.** The `sessionId` gate exists for a reason — it stopped
2,417 duplicate rows (`index.ts:1183-1188`). A fallback must key on
transcript position, or the duplicate storm comes back and every delta-accounted
total is wrong.

---

## 3. Scheduled compaction is off — the largest single cost lever left · cost · impact 5 · effort S (but a founder call)

**Evidence.** `src/main/config.ts:109` — "Shipped DISABLED (v0.3.4 founder
decision): scheduled compaction is opt-in". Token ledger §5 measures the
consequence: god's context runs to a **p90 of 265k and a max of 395k tokens per
request**, and since every request re-reads the whole context, each request in
that tail costs ~3× the median one. The ledger's estimate is **20–30% of total
spend**, against a real 2-day bill of $95.75.

**Fix.** Turn scheduled compaction on by default for workers (not god) and
measure one day against the ledger before extending it.

**What could go wrong.** Compaction trades context for money: an agent
compacted mid-card can lose the thread of what it was doing. Workers first
precisely because a lost worker context costs one re-read of a card, while a lost
god context costs the floor's state. This is the human's call, not ours.

---

## 4. Untrusted Slack/Telegram text gets the last word in god's prompt · security · impact 5 · effort M

**Evidence.** `src/main/index.ts:1481-1497`, `buildAutonomousRequestProtocol`:
the protocol (including "PAUSE/ask ONLY for high-severity actions") is
**prepended**, and the function ends with `The user's message starts now: ` — so
arbitrary third-party text is the final instruction in the prompt, the position
with the most influence. Combined with item 1 (no sender allowlist) and
bypassPermissions agents, a crafted Slack message is a direct path to
"ignore the above and…". The same pipeline carries Telegram
(`index.ts:1479-1481`) and GitHub PR/issue bodies reach agents through
`src/main/prReview.ts:123` (`body: pr.body`).

**Fix.** Fence the untrusted span — wrap the message in an explicit delimiter and
move the non-negotiable clauses (never push to a remote, never delete, never
exfiltrate secrets) *after* it, so the trusted rules close the prompt.

**What could go wrong.** Fencing is mitigation, not a boundary — it lowers the
odds, it does not make the input trusted. The real boundary is item 1. Also,
whatever delimiter is picked must be stripped from the user's text or a message
containing it breaks out of its own fence.

---

## 5. Eight test files never run · release hygiene · impact 4 · effort S

**Evidence.** `package.json` `test:focused` registers 72 of the 80 test files in
`test/`. Unregistered, therefore never run by anyone:
`slack.test.cjs`, `breaker.test.cjs`, `webhook-endpoints.test.cjs`,
`agent-provider.test.cjs`, `kg-core.test.cjs`, `realtime-findcard.test.cjs`,
`transcript-usage.test.cjs`, `voice-messages.test.cjs`. Three of those cover the
exact code in items 1, 2 and 4.

**Fix.** Add the eight to `test:focused`, then make the suite the glob rather
than a hand-maintained list so the next file cannot go missing.

**What could go wrong.** Some of the eight may already be failing or slow —
that's the point of running them, but it should be discovered on a branch, not
during a release. Globbing also picks up any future test that needs a network or
a token; those need to opt out explicitly.

---

## 6. Settings re-reads config through a hand-maintained setter list · reliability · impact 4 · effort S

**Evidence.** `src/renderer/src/components/SettingsModal.tsx:676-699`: the mount
effect re-reads `getConfig()` and then calls **18 explicitly named setters**,
while the component seeds 13+ fields from the `config` prop App loaded once at
boot. A setting that is not in that list shows a stale value forever. That is not
hypothetical — it is exactly **MD-64**: "'Sleep idle agents after' saves to
config.json (=1) but reopening Settings shows 10". The list was extended for that
field; the next field will hit the same wall.

**Fix.** Key the modal on the freshly-read config (`key={configVersion}`) so all
state seeds from one live read, instead of a prop-seed plus a partial re-seed.

**What could go wrong.** Remounting discards in-flight edits, so it must key on
*open*, not on every config write — otherwise typing in one field while an
unrelated setting saves would blow the field away mid-keystroke.

---

## 7. No GUI smoke coverage at all · release hygiene · impact 4 · effort L

**Evidence.** `test/` contains no e2e/smoke file, `package.json` has no
Playwright/Spectron dependency and no `test` script beyond `test:focused` — the
whole suite is node unit tests. MD-60 (`538bb29`) refactored the *boot path*
(lazy-loading WebRTC/CodeMirror/webhook chunks, 5.3 → 2.9 MB) and was verified
statically and by build only; nobody has launched the packaged app and watched a
terminal attach. MD-70 is discovering the same gap from the release side.

**Fix.** One Playwright-Electron test that boots the app, spawns one agent, and
asserts a terminal renders — the smallest thing that fails when the boot path
breaks.

**What could go wrong.** Electron e2e is the flakiest kind of test there is; a
suite that cries wolf gets disabled within a week. Keep it to one assertion, and
keep it out of `test:focused` (its own script) so a flake never blocks a merge.

---

## 8. Blur-to-save with no confirmation · UX · impact 3 · effort S

**Evidence.** Four blur-save handlers show no saved hint:
`SettingsModal.tsx:1508` (max turns), `:1519` (sleep idle agents), `:1747`
(reflect fields), `:1863` (public URL). Five *other* save paths in the same file
do set one (`:337`, `:446`, `:754`, `:797`, `:925` — `setBudgetNote('saved')`
etc.), so the inconsistency is within one screen. The field at `:1519` is the one
the human filed **MD-64** about: with no feedback, "did it save?" and "did it save
the wrong value?" look identical.

**Fix.** Reuse the existing note pattern in all four handlers — one `setXNote('saved')`
per handler, same component, no new mechanism.

**What could go wrong.** Nothing structural. The only trap is showing "saved"
before the IPC resolves, which turns a missing signal into a lying one — set it
in the `await`'s success branch, as the five existing ones do.

---

## 9. Most settings are unfindable by search · UX · impact 3 · effort M

**Evidence.** `src/shared/settingsSearch.ts` holds **41** indexed entries against
**187** declared keys in `src/main/config.ts` (some of those are internal, so the
true user-facing ratio is better than 22% — but it is nowhere near complete). The
index is hand-written, which is the same failure mode as item 6, and my MD-27
note already records it: "new settings must be added to `settingsSearch.ts` or
they're unfindable." SettingsModal is 2,738 lines across many tabs; search is the
only way to navigate it.

**Fix.** Add a test that fails when a config key reachable from the UI has no
search entry, so the index cannot silently fall behind again.

**What could go wrong.** There is no enumerable link between a config key and its
UI control (also MD-27), so any such test needs an explicit "not user-facing"
opt-out list — which is one more hand-maintained list, just a much cheaper one to
be wrong about.

---

## 10. `upstream` can be pushed to, and two orphan worktrees never got collected · release hygiene · impact 3 · effort S

**Evidence.** `git remote -v` shows `upstream  git@github.com:chaitanyagiri/munder-difflin.git`
with a **push** URL — a third party's repo, the fork source MD-51 moved us off.
No branch tracks it today, but `git checkout upstream/foo` sets tracking
automatically, and `push.default=current` then pushes there. That is precisely
the class of bug that cost MD-57 a commit and MD-50 a branch (a
`push.default=tracking` branch pushing straight to main, exit 0, silently).
Separately, `git worktree list` shows 8 entries, two of which
(`worker-md8-history`, `worker-md14-theme`, both parked at `88b0c505`) are clean
and integrated yet were never removed — the GC at `src/main/index.ts:5297` only
walks worktrees it holds a ledger entry for.

**Fix.** `git remote set-url --push upstream no_push`, and have the worker GC
also sweep `git worktree list` entries under `<harnessHome>/worktrees/` with no
live agent.

**What could go wrong.** The GC sweep is the dangerous half — a worktree with
uncommitted work must never be force-removed. `worktreeIsGcSafe`
(`src/main/git.ts`, used at `index.ts:5297`) already encodes that check; the
sweep must go through it and not call `removeWorktree` directly, since that runs
`worktree remove --force` (`git.ts:258`).

---

## Do first

1. **Slack sender allowlist (#1)** — one gate, copied from Telegram; today any
   workspace member can drive bypassPermissions agents. Ship before release.
2. **Register the eight orphan tests (#5)** — one line of `package.json`, and it
   is what would catch regressions in #1, #2 and #4.
3. **Close the PTY-less ledger blind spot (#2)** — 532M billed tokens are
   currently invisible to every cap and dashboard we have.
4. **Fence the untrusted span (#4)** and **add the four saved hints (#8)** — both
   are small, and #8 is the thing the human actually complained about (MD-64).
5. **Ask the human about compaction (#3)** — 20–30% of the bill, but it is a
   founder default that trades context for money, so it is their decision, not
   ours.
