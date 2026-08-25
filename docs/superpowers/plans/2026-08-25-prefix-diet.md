# MD-75 — what is actually in an agent's 43k fixed prefix

Measured on a real fresh worker spawn: Ryan, 2026-08-25,
`~/.claude/projects/-Users-ugur-HarnessAgents-worktrees-ryan-mt30ypdj/ad2d8867-…jsonl`
(97 requests, 8.46 M billed tokens).

## The headline the card was hiding

Request #1: `cache_read 26,368 + cache_creation 17,068 = 43,436` tokens of prefix.

| half | tokens | who owns it |
|---|---|---|
| already-warm shared prefix (Claude Code's base system prompt + tool schemas) | 26,368 | Claude Code. Identical in every session on the machine; hive cannot touch it. |
| session-specific tail | 17,068 | mixed — see below |

**61 % of the prefix is gone before the harness writes a byte.** A `< 15k`
request #2 is not reachable from this repo: the floor is 26.4k.

## Attribution of the 17,068 (chars ÷ 4)

| piece | chars | ~tok | owner |
|---|---|---|---|
| skills listing — 61 installed plugin skills | 16,176 | 4,044 | the user's `~/.claude/plugins` |
| agent-type listing (Agent tool) | 6,119 | 1,530 | Claude Code |
| `ponytail` SessionStart hook | 5,229 | 1,307 | user's global settings |
| `superpowers` SessionStart hook | 3,453 | 863 | user's global settings |
| **hive `--append-system-prompt`** | **2,765** | **691** | **us** |
| deferred-tools notice | 700 | 175 | Claude Code |
| first user turn (`/clear` caveat + inbox nudge) | 553 | 138 | us (nudge = 178 chars) |
| `~/.claude/CLAUDE.md` | 226 | 57 | user |
| auto-memory `MEMORY.md` | 99 | 25 | user |
| hive SessionStart hook (`cth-hook`) | 2 | ~0 | us |
| residual (output style, env block, harness rules, scaffolding) | — | ~8,200 | Claude Code |

Hive owns **~830 of 43,436 tokens — 1.9 %**. The protocol prose the card
suspected was never the cost.

## What this branch actually cuts

| piece | before | after | saved / request |
|---|---|---|---|
| worker `--append-system-prompt` | 2,765 ch (691 t) | 2,324 ch (581 t) | **110 t, always** |
| 12 temporal alias descriptions | 4,220 ch (1,055 t) | 2,242 ch (560 t) | 495 t, *only when the bundle is loaded* — see below |

Both are pinned by `test/token-diet.test.cjs` (MD-75 block); both gates were
verified to fail against the pre-diet text.

## Findings handed back rather than fixed

1. **The bill is session LENGTH, not the prefix.** 97 requests × 43k prefix =
   4.2 M of the 8.46 M; the rest is context growing 43k → 115k. Nothing in this
   repo shortens that — shorter dispatches and earlier `/clear` do. (The
   clear-on-done work already in Unreleased is the right lever.)
2. **`cache_read` bills at 0.1×.** 8.46 M "billed" is not 8.46 M of spend. The
   agent card calling it `tokens` is why it reads as alarming; MD-75 relabels it
   `billed`, but the ledger should show the cache-discounted dollar figure beside
   it.
3. **2,170 t/session of the prefix is the user's own two SessionStart hooks**
   (`ponytail`, `superpowers`), injected into every hive agent. Only the user can
   turn those off (`~/.claude/settings.json`); the hive has no lever.
4. **Cutting the skills listing (4,044 t) means `--disable-slash-commands`**,
   which is all-or-nothing and removes capability — outside this card's
   "no behaviour change" boundary. Not done.
5. **`copyBundledSkills` writes 27 KB per agent that is never loaded.** Claude
   Code discovers `.claude/skills` from the session cwd, and an agent's cwd is
   its project/worktree, not its hive dir — no `--add-dir` is passed. Confirmed
   absent from Ryan's skills listing. Consequence: the ephemeral-worker prompt
   suffix at `src/main/index.ts:5360` tells workers to run `/capabilities`, a
   skill they cannot invoke. Fixing it by adding `--add-dir` would *add* ~1.5 k
   to every prefix, so it is a correctness question, not a diet one.
6. **The LIVE ROSTER block is already god-only and already gated** on the roster
   body changing (`hooks.ts:279-285`, MD-61 gate C). Workers never receive it —
   nothing to do.
