# block/buzz vs Office — is theirs better than ours? (MD-79)

Read-only comparison, 2026-08-25. Office at main `c264c2ab`; buzz at `block/buzz`
default branch, shallow clone (deleted after reading). Every claim below carries
a `file:line` or a number from one side or the other.

**Short answer: they are not competitors.** Buzz is a self-hostable Slack that
agents can join as first-class members; Office is a desktop cockpit that spawns,
supervises and pays for local coding agents. The overlap is one crate wide. The
useful question is not "which wins" but "what have they solved that we haven't",
and there the answer is concrete — see **Worth adopting** at the end.

---

## 1. What buzz is, and who for

"A workspace where humans and agents build together, on a relay you own"
(`README.md:4`). Concretely it is a **Nostr relay**: every message, reaction,
workflow step, review approval and git event is a signed event in one log,
"whether the author is a person or a process" (`README.md:36`). Agents are
members with their own keypairs and channel memberships, "scoped by identity,
not by permission flags" (`README.md:47`). Maturity is in a different league from
ours: **30,595 stars**, Apache-2.0, created 2026-03-06, ~99 contributors, 30 Rust
crates + a Tauri desktop app + mobile + admin-web, and a release roughly every
three days (`desktop-v0.5.11` 2026-08-12 → `desktop-v0.5.18` 2026-08-21). Office
is a single Electron app, pre-first-release, one human and a hive. Comparing
"better" across that gap is comparing a company to a workshop.

## 2. Agent orchestration

Buzz routes by **channel and mention**. `buzz-acp` is a harness that "listens for
@mentions on the relay, prompts your agent, and the agent replies using the Buzz
CLI" (`crates/buzz-acp/README.md:3`), speaking ACP (JSON-RPC over stdio) to any
compliant agent — goose, codex, claude code (`README.md:13`). Work is not
*assigned*; it is *mentioned*, and a per-channel queue decides what the agent
sees: events accumulate per channel and flush as **one batched prompt**, with
`Drop` (default) or `Queue` dedup while a prompt is in flight
(`crates/buzz-acp/src/queue.rs:1-14`), capped at `MAX_PENDING_PER_CHANNEL = 500`
(`:24`). Office is the opposite shape and deliberately so: a card in
`hive/tasks.json` with an `assignee`, a `god` orchestrator that routes it, and an
inbox message per agent (`src/main/hive.ts` `send`/`inbox`). Theirs scales to a
workspace of humans; ours tracks who owes what. Ours also has the thing theirs
does not: a durable, human-editable board. Buzz has no kanban — a channel *is*
the record (`README.md:41`).

## 3. Terminal / PTY and session lifecycle

Both spawn real PTYs, and both learned the same lesson. Buzz's
`desktop/src-tauri/crates/buzz-terminal/src/lifecycle.rs:1-28` signals the process
**group** (`kill(-pgid)`), not the pid, because `portable-pty` calls `setsid()`
and a pid-scoped kill leaks grandchildren; Office reached the identical
conclusion in `src/main/procKill.ts:1-18` ("the pty child is a session leader, so
its process GROUP covers its descendants"). Parity, independently derived. Where
they diverge is session identity: buzz's agent process is stateless by design
("No persistence. No cleverness." — `crates/buzz-agent/README.md:3`) with limits
that are wall-clock and turn-count (`max_turn_duration` 2h default,
`max_turns_per_session`, `context_message_limit` —
`crates/buzz-acp/src/config.rs:29,275,374,380`), and a lazy pool that wakes on
demand with exponential retry (`pool_lifecycle.rs:14-25`, 5s → 300s). Office
carries session state instead — `--resume` keys, MD-59 idle hibernation, MD-66
clear-on-done — which is more machinery but is what makes an agent that
remembers its card possible. **Buzz has nothing equivalent to hibernate or
clear-on-done**; it does not need them, because its agents hold nothing.

## 4. Cost and token accounting

This is the one axis where Office is clearly ahead, and it surprised me. Buzz
tracks usage seriously — `crates/buzz-acp/src/usage.rs` is 3,489 lines and gets
the hard part right, deriving per-turn deltas from cumulative counters and
explicitly marking `delta_reliable: false` on a first turn, a counter decrease or
a session restart (`usage.rs:9-30`) — and publishes it as a signed kind-44200
relay event with `turn_cost_usd` and `cumulative_cost_usd` (`usage.rs:207,228`).
But that is **observability, not control**: I found no spend cap anywhere in
`buzz-acp/src/config.rs`; its safety valves are time and turns, not money.
Office enforces. `src/main/breaker.ts:317-325` trips on a per-agent token cap and
on a floor-wide cost/token cap and escalates steer → constrain → stop, fed by a
durable ledger (`hive/cost-ledger.jsonl`). Worth noting our own cumulative-delta
lesson matches theirs exactly (the MD-61 ledger's "rows are cumulative snapshots,
diff them" and now MD-78's overcount fix) — two independent codebases hitting the
same trap is a signal the trap is real, not a local mistake.

## 5. Integrations

Not comparable, because buzz *is* the chat surface rather than bridging to one.
Grepping their crates + desktop backend: **github 41 files, webhook 20, slack 8,
telegram 0, discord 0** — GitHub is deeply native (they ship `git-sign-nostr` and
`git-credential-nostr` crates so commits are signed with the same keypair as
messages), Slack is peripheral, and there is no Telegram at all. Office bridges
outward instead: Slack with HMAC verification (`src/main/slack.ts:402`), Telegram
with a chat allowlist (`src/main/telegram.ts:244`), webhook triggers, PR review
(`src/main/prReview.ts`), and a loopback secret broker so a worker uses an
integration without ever seeing the credential
(`src/main/integrationBroker.ts:1-24`). For our human — who lives in Slack and
Telegram, not in a relay he would have to host — ours is the right shape.

## 6. UX, packaging, tests

Buzz's desktop is Tauri (Rust) + React; ours is Electron + React + a PIXI office
floor, which is a genuine differentiator they have no answer to — theirs is a
channel list. On engineering hygiene the comparison is not close and it is the
part worth taking seriously: buzz has **156 Playwright e2e specs**
(`desktop/tests/e2e`) across four configs including a dedicated
`test:e2e:release-smoke`, plus **508 files carrying Rust tests**, plus custom
guards wired as npm scripts (`check:file-sizes`, `check:px-text`,
`check:pubkey-truncation`). Office has 775 unit tests in `test:focused` and
**zero GUI or e2e coverage** — the gap MD-71 item 7 already flagged and MD-70 is
currently walking into from the release side.

---

## Verdict (for a small team running Claude agents on an Electron desktop)

1. **Different, not better.** Buzz is a self-hosted workspace where agents are
   members; Office is a cockpit that spawns and pays for agents. Adopting buzz
   would mean running a relay and giving up the floor, the kanban and the breaker.
2. **Buzz is far more mature as a project** (30.6k stars, ~99 contributors,
   releases every ~3 days) — but maturity in a product we would not use is not an
   argument to switch.
3. **Office is ahead on exactly one thing that matters daily: money.** They
   measure spend beautifully and cap nothing; we cap (`breaker.ts:317-325`).
4. **Buzz is ahead on release confidence**: 156 e2e specs and a release-smoke
   suite against our zero. That is our real gap, not our feature set.
5. **Their ACP bet is the one strategic idea to watch.** Speaking a standard
   protocol gets goose/codex/claude-code for free; our `agentProvider.ts` presets
   re-solve that per vendor, by hand.

## Worth adopting

| # | What | Impact | Effort | Where it lands |
|---|---|---|---|---|
| 1 | **A release-smoke e2e suite.** Not their 156 specs — their *shape*: one `test:e2e:release-smoke` script that boots the packaged app and asserts the basics. | 5 | L | New `desktop`-style Playwright config + `package.json` script; unblocks MD-70 and closes MD-71 item 7. |
| 2 | **Environment allowlist for spawned PTYs.** `env_fence.rs:1-18` clears the inherited env wholesale and rebuilds only what a terminal needs, after their own `feat/terminal` branch leaked a signing key through a *denylist*. `src/main/pty.ts:642-643` passes `{ ...process.env }` to every agent. We put no secret there today (checked: `index.ts:5779` exports only a path, and `index.ts:2037` writes a loopback capability handle there, mode `0o600`), so this is hardening, not a live leak — but it makes the next `process.env.X = <token>` harmless instead of fatal. | 3 | M | `src/main/pty.ts:642`; needs care, agents legitimately need some inherited vars. |
| 3 | **Mark unreliable usage deltas instead of dropping them.** `usage.rs:9-30` emits `delta_reliable: false` on a first turn / counter decrease / session restart rather than guessing. Our ledger silently takes positive deltas only, so a counter reset is invisible. | 3 | S | `src/shared/costLedgerDedup.ts` + the ledger row shape in `hive.ts:2106`. |
| 4 | **Wall-clock and turn caps as first-class safety valves.** `config.rs:29,275,380` — a hard 2h per-turn ceiling independent of any token math. Our breaker trips on velocity and no-progress, which both need token movement to fire; an agent wedged producing nothing trips neither. | 3 | S | `src/main/breaker.ts`, alongside the existing arms. |
| 5 | **A sender allowlist is the expected shape, not a nicety.** They ship `BUZZ_ACP_RESPOND_TO_ALLOWLIST` / `BUZZ_ACP_ALLOWED_RESPOND_TO` (`config.rs:472,480`). Independent confirmation of MD-71 item 1 (Slack has none). | — | — | Already in flight as Ryan's `feat/slack-allowlist`; recorded here as corroboration only. |

## Checked and dismissed

- **Their per-channel batched prompt with Drop/Queue dedup** (`queue.rs:1-14`)
  looked adoptable until I read ours: `src/shared/inboxNudge.ts` already enforces
  one-pending-nudge-per-agent, which is their `Drop` mode. Parity, no work.
- **Process-group kill** — we already do it, for the same documented reason
  (`procKill.ts:1-18` vs `lifecycle.rs:1-28`). Parity, independently derived.
- **Nostr identity per agent.** Elegant, and the wrong trade for us: it buys an
  audit trail we get from git and the kanban, at the cost of running a relay.
