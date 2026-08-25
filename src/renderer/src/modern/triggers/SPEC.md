# MD-91 · modern/triggers + modern/realtime (SPEC, phase 1)

Source read: `components/triggers/{TriggersTab,SchedulesSection,ContextSection,WebhooksSection,TriggerHistoryTab,JsonEditor,api,ui}.tsx`
(1892 ln) and `realtime/{session,costStore,CostHud,DevicePicker,CompletionToast}.tsx` + `components/RealtimeMichaelToggle.tsx`.
**No behaviour is invented.** Pixel UI untouched; `triggers/ui.tsx` (the 389-ln mini design system) is *not deleted* —
it still serves the pixel tab — it is simply not used here. Two nav rows: **Triggers**, **Voice**.

## Data / IPC / store — reuse verbatim, no main-process change
| Call | Use |
|---|---|
| `window.cth.listMissions()` / `saveMissions(list)` / `onMissionsUpdated(cb)` | schedules: load, optimistic write-through, refresh on scheduler beat. Delete = save the list without it. |
| `triggers/api.ts`: `getContextTrigger` / `setContextTrigger` | context rules, deep-filled; write debounced 400 ms so typing ≠ one write per key. |
| `triggers/api.ts`: `listWebhooks` `saveWebhooks` `deleteWebhook` `webhooksStatus` `generateWebhookSecret` `newWebhook` | webhooks. `saveWebhooks` returns main's **canonical** list (it refuses to enable a secretless endpoint) — adopt the reply, never assume. Status polled 5 s. |
| `window.cth.{listTriggerHistory,onTriggerHistoryUpdated,decideTriggerHistory,clearTriggerHistory}` | history. Read lazily off `window.cth` (same narrow local surface as the pixel tab). |
| `window.cth.copyToClipboard(text)` | copy URL / secret. |
| store: `webhookTriggers` / `setWebhookTriggers` (shared mirror with Settings → Connections), `bossName`, `agents`, `hasOpenAiKey` | mirror-then-persist: keystrokes update the mirror only, discrete acts persist. |
| `@shared/triggers`: `TRIGGER_MODES`, `DEFAULT_*`, types | contract; `@shared/agentOrder.sortAgentsForList` for the target picker. |
| `realtime/session.useRealtimeMichael()` → `{status,error,muted,model,expiresAt,deviceId,outputDeviceId,connect,disconnect,setDeviceId,setOutputDeviceId}` | the voice loop is a module singleton — call the hook, never re-implement. |
| `realtime/costStore.useRealtimeCost()` → `{usd,inputTokens,outputTokens,capUsd,overCap,startedTs,setCap}` · `@shared/realtimePricing.formatUsd` | cost meter + cap. |
| `window.cth.onRealtimeCompletion(cb)` | completion events → `toast()` (sonner), replacing the pixel `CompletionToast` overlay. |

## Features that must survive
**Triggers** — one scrolling page, four `Collapsible` `Card`s (Schedules open by default), each with a live summary `Badge`.
1. **Schedules**: row per mission — interval chip (`♥ beat` for `kind:'heartbeat'`), label, `→ target · fired Nm ago · next in Nm`, `Switch` enable. Expand → label `Input`, target `Select` (everyone / boss / non-god agents, hibernated sunk), interval picker, prompt `Textarea`, save (disabled unless dirty, "saved" for 1.3 s), delete. Closed rows show the first line of the prompt in mono. Add form for new schedules.
2. **Context**: two rules, `Compact` and `Clear`, each `Switch` + expand → interval picker (clamped 1 m…24 h — main clamps, so never offer weekly), context bar `%` + meter, big-window bar, message `Textarea`. Clear carries a permanent caution that goes `destructive` only once armed.
3. **Webhooks**: row per endpoint — name, `mode · reachable|no URL yet|server offline`, `Switch`. Expand → name, POST-to URL + copy, masked secret + show/copy, trust `Select` (+ its blurb), JSON schema editor (lazy CodeMirror, save refuses invalid JSON), delete behind `AlertDialog`. Add mints a secret and starts **disabled**.
4. **History**: flat ledger folded into exchanges by `correlationId`, pending first then newest-first; card shows source/peer/title, kind + decision `Badge`s, every message body (clamped 320 chars / 8 lines with "show all"), approve / reject on a `pending` inbound (optimistic), tail line when unanswered, `clear history` behind `AlertDialog`.

**Voice** — one page. Mic `Button` (connect/disconnect) with the five states off/connecting/listening/responding/working, disabled with a reason when `hasOpenAiKey` is false; status dot + `error`; model + token expiry; mic & speaker `Select`s (speaker hidden when `setSinkId` is absent, "names appear after you grant mic access" hint); cost card: live `$`, in/out tokens, cap `Input` with `Progress`, `destructive` at ≥100 % and muted-warn at ≥80 %.

## Screen (text wireframe)
```
TRIGGERS                                             VOICE
┌──────────────────────────────────────────────┐     ┌──────────────────────────────────┐
│ Everything that can start work without you.  │     │  ◉  Talk to Michael    [ Talk ]  │
│ ┌ Schedules            3 of 5 on      ⌄ ────┐│     │  listening · gpt-realtime-2      │
│ │ [1h] nightly sweep      ● on   → Michael  ││     ├──────────────────────────────────┤
│ │      fired 12m ago · next in 48m          ││     │ Devices                          │
│ │ ┌ prompt preview, mono, one line ────────┐││     │  Microphone [ System default ▾]  │
│ │ [+ add a schedule]                        ││     │  Speaker    [ System default ▾]  │
│ ├ Context              compact       ⌄ ────┤│     ├──────────────────────────────────┤
│ ├ Webhooks             2 · live      ⌄ ────┤│     │ Session cost      $0.42 / $5.00  │
│ └ History              1 waiting     ⌄ ────┘│     │ ▓▓▓▓░░░░░░░  8.4k in · 2.1k out  │
└──────────────────────────────────────────────┘     └──────────────────────────────────┘
```

## Components (only from `modern/components/ui`, nothing added)
`Card` `Collapsible` `Badge` `Button` `Switch` `Input` `Textarea` `Label` `Select` `Separator`
`ScrollArea` `Alert` `AlertDialog` `Progress` `Tooltip` `Skeleton` · `toast()` from sonner · `lucide-react`.

## Risks / decisions
- `JsonEditor` (CodeMirror) is **not migratable** (plan B4). A modern copy is made under `modern/triggers/` themed off
  `--background/--foreground/--border` instead of `--cth-*`, still lazy-loaded (~1.2 MB).
- Webhook list lives in the **store**, shared with pixel Settings → Connections. Do not keep a second local copy.
- `org` history source has no transport — the section switcher stays hidden, exactly as in pixel.
- The pixel `CompletionToast` overlay is replaced by `toast()`; both must never mount together (they can't — one UI at a time).
- No main-process change. No `shadcn add`. Only the two new rows in `modern/nav.ts` are touched outside these folders.
