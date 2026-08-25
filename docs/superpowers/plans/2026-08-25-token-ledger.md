# Token ledger — where the fleet's tokens actually go (MD-61)

Measured 2026-08-25 from `~/HarnessAgents/hive/cost-ledger.jsonl` (47,583 rows,
2026-08-21 13:21 → 2026-08-25 11:16) and from the agents' own Claude Code
transcripts (`~/.claude/projects/**/*.jsonl`, which carry per-request `usage`).
Scripts used are throwaway; every number below is reproducible from those two
sources.

---

## 0. First: the ledger cannot be summed

`cost-ledger.jsonl` rows are **cumulative snapshots**, one per agent per ~30s
breaker beat — not per-turn deltas. `src/main/db.ts:45` says so. Summing the
column gives 108 billion tokens for two days; the real figure is 89 million.

> Anything that reports fleet spend must diff consecutive rows per `session_id`
> and sum the POSITIVE deltas. A dashboard that sums the raw column is off by
> ~1200×.

**Real spend, delta-accounted:**

| window | billed tokens | USD | cache_read | fresh input | output |
|---|---|---|---|---|---|
| lifetime (4d) | 492,302,199 | $456.14 | 98.3% | 0.04% | 0.4% |
| last 2 days | 89,521,809 | $95.75 | 97.7% | 0.05% | 0.4% |

Per agent, last 2 days: god $53.66, jim $16.35, ryan $10.60, orcun $9.12,
andy $6.03.

**Blind spot:** `munder-developer-mt2szzlu` has **zero** rows in the cost ledger,
yet its transcripts show 532M billed tokens — the largest single figure on the
floor. `runBreakerBeat` only appends a row when `usageProvider.getAgentUsage(id)`
returns a live OTLP `sessionId`; an agent whose collector export never lands is
invisible to both the ledger and the breaker. This is the MD-7 fleet blind spot
in a second place.

---

## 1. The shape of the bill: 98% of every token is re-reading context

Per-API-request, from the transcripts:

| agent | requests | cache_read | cache_create | fresh in | out | median context/request |
|---|---|---|---|---|---|---|
| god | 1,626 | 97.6% | 1.8% | 0.01% | 0.5% | **133,487** |
| orcun | 866 | 98.3% | 1.2% | 0.00% | 0.5% | 135,789 |
| jim | 909 | 98.5% | 1.1% | 0.00% | 0.5% | 166,269 |

Cache hit ratio is already **98.2–98.9%**. Prompt-cache ordering is therefore
*not* a lever — it is as good as it gets.

**The law that matters instead:** every request re-reads the entire context, so a
byte written into the transcript is billed again by *every request after it*.
Saving S tokens at request *i* saves `S × (requests remaining in the session)`.
That is why "don't send it at all" is the only change that compounds, and why
trimming prose in a one-off prompt is not worth doing.

**The fixed prefix** (context of the first request of a session) is **~41–44k
tokens** and is near-identical for every agent — system prompt + tool schemas +
skills + CLAUDE.md + the hive protocol. Against god's 1,626 requests that prefix
alone is ~70M tokens (28% of his spend). Our own contribution to it (PROTOCOL.md
+ the god paragraph in `hive.ts`) is ~7 KB ≈ 1.8k tokens; the rest is Claude
Code's own, which we do not control.

---

## 2. Spend by CAUSE

Attributing every assistant request to the user prompt that triggered it:

| agent | cause | prompts | requests | billed | share | reqs/prompt |
|---|---|---|---|---|---|---|
| god | inbox-nudge wakeup | 133 | 1,016 | 165.5M | **67.3%** | 7.6 |
| god | card / human work | 68 | 616 | 80.6M | 32.7% | 9.1 |
| jim | inbox-nudge wakeup | 18 | 877 | 147.0M | 95.7% | 48.7 |
| jim | card / human work | 3 | 39 | 6.6M | 4.3% | 13.0 |
| dev | inbox-nudge wakeup | 45 | 1,445 | 459.7M | 86.4% | 32.1 |
| dev | card / human work | 49 | 508 | 72.6M | 13.6% | 10.4 |

**Read this carefully: "inbox-nudge wakeup" is not waste.** For a worker it is
how a card arrives — jim spends 48.7 requests per nudge because he is doing the
card. The waste is the *cheap* wakeups:

| agent | nudge wakeups | median reqs | wakeups doing ≤3 requests | cost of those |
|---|---|---|---|---|
| god | 133 | 5 | **54 (41%)** | **20,506,008 tokens** |
| jim | 18 | 45 | 1 (6%) | 714,909 |
| dev | 45 | 21 | 0 (0%) | 0 |

Only god has this problem, and the reason is in the mail log: of 359 hive
messages, **76 are `scheduler → god` standups and 48 are god replying to
`scheduler`** — 35% of all hive mail is the scheduler talking to itself. Each
beat wakes god for a full turn against a 133k-token context so he can read
"quiet, nothing changed" and answer "acknowledged".

Workers are **not** standup-prompted: `armHeartbeat` targets god only. Answering
the card's question directly — no, idle agents are not being prompted.

---

## 3. What fills the 133k

god's context material across his last 6 sessions:

| what | bytes | ≈tokens | count |
|---|---|---|---|
| `tool_use` input: **Bash** | 830,909 | 207k | 769 calls (**1,080 bytes each**) |
| assistant text | 181,346 | 45k | 399 |
| tool results: Bash | 789,365 | 197k | 769 |
| Write/Edit/Read inputs | 22,449 | 5k | 21 |
| thinking | 1,954 | 0.5k | 448 |

god's **own Bash commands are the single largest filler** — he writes dispatches
and reports as long inline heredoc/python one-liners, averaging over a kilobyte
each, and every one of them is re-read by every later request in the session.
That is behaviour, not harness, so it is a note for god rather than a patch here.

Things that are NOT the problem, checked and dismissed:

- **`tasks.json` (100 KB, 91% closed cards)** — god does not `cat` it; no single
  100 KB tool result appears anywhere in his transcripts. Rotating it would have
  been an invented win.
- **`board.md` (52 KB)** — the heartbeat digest only injects its first 10 lines.
- **`memory.md`** — already capped at 6 KB by the standing order; the archives it
  replaced were 20–48 KB, i.e. 5–12k tokens per task per agent.
- **The heartbeat digest itself** — already delta-based (`fleetDelta`), not a
  full fleet re-read.

---

## 4. Fixes shipped, with numbers

### A. A heartbeat beat with no news is not sent (`src/main/index.ts`)
`beatIsNoop(actionable, delta)` — skip the beat when the floor is quiet, no agent
moved since the last beat, and god has no actionable mail. The backoff still
runs, so the next beat fires normally and any real change re-arms it at once.
The first beat after a restart (null delta, no baseline) is always sent.

**Measured saving: 20.5M tokens over the 4-day window ≈ 5M tokens/day ≈ 8.3% of
god's total spend.** (54 suppressed wakeups × ~380k billed tokens each.)

### B. A queued inbox nudge is dropped if the inbox drained first (`useHive.ts`)
The nudge is queued when mail lands but typed only once the terminal is free, and
the Stop hook usually drains the inbox in between. Re-checked at typing time; an
empty inbox drops the nudge. A *failed* inbox read still delivers — an error is
not an empty inbox.

**Projected saving: the residual of the same 41% class that fix A does not cover
(worker-sent mail rather than scheduler beats) — 1–2M tokens/day fleet-wide**,
and it is the only gate that survives an app restart clearing `nudged.current`.

### C. The LIVE ROSTER is injected only when it changed (`src/main/hooks.ts`)
It went in on *every* god prompt, ~250 tokens, and each copy stays in the
transcript to be re-billed by every later request. Now injected on SessionStart
and thereafter only when the floor actually differs.

The trap this nearly walked into: the roster header carries `snapshot 12s ago`,
which ticks on every prompt. Comparing the raw strings would answer "changed"
every time and leave a gate that looks implemented and does nothing. The
comparison runs on the roster body (`rosterFingerprint`), and that is the case
with a test on it.

**Projected saving: ~250 tokens × 214 injections × the requests remaining after
each ≈ 30–45M tokens over the ledger window for god (12–18% of his spend).**
Projected, not measured — the compounding factor is an average over request
positions.

---

## 5. Not shipped — needs a decision

**Auto-compaction is OFF** (`src/main/config.ts:109`, "Shipped DISABLED (v0.3.4
founder decision): scheduled compaction is opt-in"). It shows: god's context runs
to a p90 of 265k and a max of **395k tokens per request**. Every request in that
tail costs 3× the median one, and the tail is where sessions spend most of their
requests.

Turning scheduled compaction on for the fleet is the largest single lever left —
plausibly 20–30% of total spend — but it is a founder default and it trades
context for money, so it is god's call, not mine.

Two smaller ones, also flagged rather than done:

- **god replies to `scheduler` 48 times.** There is no `agents/scheduler`
  directory; those replies go nowhere. A protocol line ("never reply to
  heartbeat/scheduler/breaker mail") costs one sentence and saves 48 turns of
  output.
- **god's 1,080-byte average Bash command** (§3). Writing dispatches to a file
  and sending the path, or simply shorter bodies, would cut the largest single
  filler of his context.
