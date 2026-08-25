# modern/integrations — Integrations status (MD-88, phase 1 spec)

Read-only inventory of the pixel implementation. Sources today: `SettingsModal.tsx`
(Slack §, Telegram §, Provider Doctor ~1875–1930, Public URL §), the webhook
endpoint editor (`triggers` tab), and `components/IntegrationsRegistry.tsx` (the
custom-REST registry, 434 lines, its own three-view flow).

**Scope call:** the pixel UI scatters these across Settings tabs. The modern UI
gets ONE page — "Integrations" — that answers *is it connected, and what is
wrong* at a glance, with editing behind a per-integration detail sheet. Settings
itself belongs to another agent; this page owns only the status view and the
sheets it opens. Nothing here writes a credential the pixel UI does not already.

## Features to cover

**Slack** — connected badge + live transport (`events` | `socket`), the Request
URL (Events API only — Socket Mode dials out and has nothing to paste), start /
stop, and the settings that gate it: signing secret, bot token, app token
(Socket Mode), channel, port, proactive posting, and the **required** sender
allowlist (blank ⇒ nothing is ingested and start refuses — surface that as a
blocking reason, not a silent no-op).

**Telegram** — connected badge + the bot `@username` learned at connect, start /
stop, bot token + allowed chat id. The allowlist is **fail-closed** and stays
that way: no chat id ⇒ nothing accepted. Credentials are WRITE-ONLY over IPC —
the page must render "set" / "not set", never read a token back.

**Webhooks** — server state, tunnel root, and per-endpoint public URL (`''` until
a tunnel is up — show "waiting for tunnel", not a broken link). List, enable,
copy URL, mint a secret, delete (destructive confirm). Endpoints hot-swap without
a restart, so saving one must not appear to disturb another's URL.

**Providers + Provider Doctor** — per-engine installed/version state, then the
Doctor: run / re-run, "last run <ts>" vs "never run", and one row per check
(`status`, `id`, `detail`). **A `mismatch` is the only row that means "go fix
something"** — `not-installed` and `unverifiable` are answers, not faults, and
must not be styled as failures. Keep the closing note that some facts (live model
ids, MCP package names) need a network call this app does not make, so they are
listed unverified rather than assumed correct.

**Custom REST registry** — the configured list, the template gallery, and
configure-&-test. `usable === enabled && hasSecret` (v1 grants every enabled
integration to all workers; there is no per-integration worker scoping yet, so do
not invent a picker for it). All data flows through `integrationsClient`, never
IPC directly.

## IPC / store / shared used (no main-process change expected)

- Slack: `slackStatus`, `slackStart`, `slackStop`, `slackSetConfig`
- Telegram: `telegramStatus`, `telegramStart`, `telegramStop`, `telegramSetConfig`
- Webhooks: `webhooksStatus`, `listWebhooks`, `saveWebhooks`, `deleteWebhook`,
  `generateWebhookSecret`
- Doctor: `doctorRun`, `doctorResults` (nullable — never run yet)
- Config: `getConfig` / `updateConfig` (public URL, provider fields)
- Registry: `@/integrations/registryClient` `integrationsClient` +
  `@shared/integrations` `authTypeNeedsSecret`
- `@shared/providerChecks`: `CheckStatus`, `CheckResult`, `UNVERIFIABLE_FACTS`

Status calls are pull-only (no push channel), so the page polls on mount and on
focus, and re-reads after every start/stop. No new IPC needed.

## Layout (text wireframe)

```
┌ Integrations ────────────────────────────────────────────┐
│  ● Slack          connected · socket            [Manage] │  ← ● green/amber/grey
│    allowlist: 2 users · proactive posting on             │
│ ──────────────────────────────────────────────────────── │
│  ● Telegram       connected · @office_bot       [Manage] │
│    1 allowed chat · token set                            │
│ ──────────────────────────────────────────────────────── │
│  ○ Webhooks       stopped                       [Manage] │
│    3 endpoints · tunnel: waiting                         │
│ ──────────────────────────────────────────────────────── │
│  ● Custom REST    2 configured, 1 usable        [Manage] │
└──────────────────────────────────────────────────────────┘

┌ Providers ───────────────────── [Run checks] never run ──┐
│  claude    installed 2.1.4                               │
│  codex     not installed                                 │
│ ── Doctor ─────────────────────────────────────────────  │
│  mismatch    claude.effort-flag   --effort not in --help │  ← only row emphasised
│  ok          codex.model-id       matches                │
│  unverifiable mcp.package         needs a network call   │  ← muted, not red
│  Some facts cannot be settled from --help at all…        │
└──────────────────────────────────────────────────────────┘

[Manage] → shadcn Sheet (right, 480px) per integration: status header with
Start/Stop, then its fields (secrets as "set / not set" + Replace), destructive
actions behind a confirm. Custom REST's gallery + configure keeps its own
three-view flow inside the sheet.
```

One status row per integration, hairline-separated; the dot is the only colour on
the page at rest. Doctor rows are a 3-column mono grid (status · id · detail).

## Open questions for MD-84

1. Does `modern/components/ui` already have `sheet`, `badge`, `alert`,
   `switch`, `separator`? If not I add them via `npx shadcn add` — no hand-rolling.
2. Settings owns the same Slack/Telegram fields. Confirm this page may open the
   editing sheets, or whether it must be status-only and deep-link to Settings.
   I have assumed sheets; it is a one-file change either way.
