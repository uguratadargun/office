# MD-90 — Monitor / Event log / Notifications (modern UI)

Read-only prep spec. Build lands under `src/renderer/src/modern/monitor/` only; the pixel
UI (`components/CommandCenterPanel.tsx`, `ActivityTab.tsx`, `UpdateToast.tsx`,
`realtime/CompletionToast.tsx`) is untouched. Store/IPC reused verbatim — **no main-process
changes needed**.

## Scope (from the pixel implementation)

| Feature | Pixel source | Data it reads |
|---|---|---|
| Fleet usage/cost table | `CommandCenterPanel.tsx` FloorTab "AGENTS" telemetry rows + summary band (L720–990) | `useFleetTelemetry()` → `samples` (in/out/cacheRead/cacheCreation/usd/model), `spark`, `rate`, `lastTool` |
| Cost/provenance readout | `UsageReadout.tsx` / `UsageChip` | `useFleetUsage()` → `window.cth.fleetUsage()` (`ResolvedUsage`, 8 s poll); `@shared/usageFormat` (`formatTokens`, `formatUsd`, `capProgress`, `usageSourceNote`, `USAGE_SOURCE_LABEL`) |
| Budget meter — **only when a budget is set** | `capProgress()` returning null (UsageReadout L60–88) | `window.cth.getConfig()` → `costCapTokens` (floor), `agentTokenCaps[id]` (per-agent); write via `window.cth.updateConfig({ agentTokenCaps })` |
| Breaker states | FloorTab `breakers[a.id]`, `armed` = `constrained \| stopped` | `useFleetTelemetry().breakers` (`control:breakerState` + `telemetrySnapshot` backfill) |
| Per-thread (per-agent session) usage | ctx-window row (L805–840) + `ToolWaterfall.tsx` | `agent.contextTokens` / `agent.contextLimit` from the store; `useAgentSpans(agentId)` for the tool-span waterfall |
| Event log, filterable | `ActivityTab.tsx` | `window.cth.hiveLogQuery({search,kind,agent,offset,limit})` → `EventPage`; `describeEvent`/`eventAgents` from `@shared/eventLog`; `window.cth.hiveBoard()`; `relSince`; 3 s poll **paused** while filtered or scrolled back |
| Log click-through | `ActivityTab.jump` | `useStore().select(id)`, `requestCommandCenterTab('tasks')` |
| Update notification | `UpdateToast.tsx` + `UpdateBadge.tsx` | `onUpdateStatus` (`downloaded` \| `available-manual`), `updateRestartAndInstall`, `updateOpenRelease`, `summarizeReleaseNotes`, `extractDropHtml`; star-ask localStorage flag shown at most once ever |
| Completion notification | `realtime/CompletionToast.tsx` | `onRealtimeCompletion` — stack, 9 s auto-dismiss, max 4 |

Not mine: dispatch box, roster identity/model pickers, restart controls, issues/PRs,
directories, archived section (other MD cards).

## Screens

Nav registry (MD-84) contributes two entries: **Monitor** and **Activity**.

```
MONITOR                                                    [budget: 1M ▾]
┌───────────────────────────────────────────────────────────────────────┐
│ Σ 4.2M tokens   $18.40   inputs 3.1M (cache 71%)   1,240 tok/min      │  Card, stat row
├───────────────────────────────────────────────────────────────────────┤
│ [only when a cap is set] ▇▇▇▇▇▇▇▁▁▁  4.2M / 8M · 52%                  │  Progress
└───────────────────────────────────────────────────────────────────────┘
┌ Table (hairline rows, 13px, mono numerals, right-aligned) ────────────┐
│ Agent      Status   Tokens   Cost   Rate    Ctx      Budget   Last tool│
│ ● Michael  running   1.2M   $5.10   410/m  ▇▇▁ 38%  ▇▇▇ 61%   Bash    │
│ ⚠ Pam      stopped   980k   $4.02     0/m  ▇▇▇ 91%  ▇▇▇ 99%   Read    │  ⚠ = breaker
└───────────────────────────────────────────────────────────────────────┘
  Row click → Sheet: per-thread detail (ctx gauge, in/out/cached split,
  source badge, cap editor, tool-span waterfall).
```

```
ACTIVITY
[ search the event log............ ] [all kinds ▾] [everyone ▾]   live ●
── 2m  ● spawn    Michael spawned pam-mt310mbm                        →
── 5m  ● message  Pam → god: MD-90 done                               →
   ▸ expand row → raw JSON in a mono block
[load more]   60 of 412 events · live updates paused
BOARD  ▸ collapsible mono pre
```

Toasts: one `<Toaster />` (shadcn **sonner**) mounted by the modern shell; update +
completion events call `toast()` — no bespoke fixed-position stacks.

## Primitives (shadcn, from `modern/components/ui`)

`card`, `table`, `progress`, `badge`, `input`, `select`, `button`, `sheet`, `separator`,
`scroll-area`, `tooltip`, `skeleton`, `collapsible`, `sonner`. Any missing one is added via
`npx shadcn add`, never hand-rolled. Sparkline stays a tiny local SVG (no chart lib).

## Rules carried over from the pixel UI (do not regress)

1. No cap set ⇒ **no meter**, an honest "no token budget set" line — never an invented denominator.
2. Never print `$0` for an unpriced model; always show the usage **source** so "no signal" ≠ "no spend".
3. Cumulative budget spend and context-window headroom are two different meters — keep them distinct and labelled.
4. Sparkline only when the agent is actually burning tokens.
5. Event-log polling pauses while the user is filtering or has paged back.
6. Truncated scans say so; the star ask is shown at most once ever.
7. Colours from `--cth-*`/modern tokens only; light + dark both checked.
