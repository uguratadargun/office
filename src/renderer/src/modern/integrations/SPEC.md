# modern/integrations — Integrations status (MD-88, phase 1 spec)

Read-only inventory of the pixel implementation. Sources today: `SettingsModal.tsx`
(Slack §, Telegram §, Provider Doctor ~1875–1930, Public URL §), the webhook
endpoint editor (`triggers` tab), and `components/IntegrationsRegistry.tsx` (the
custom-REST registry, 434 lines, its own three-view flow).

**Scope, decided by god:** this page is **STATUS-ONLY**. It answers *is it
connected, and what is wrong* at a glance and **deep-links into modern Settings**
(Andy, MD-87) for every edit. There is ONE editor in the app and it is not here —
no duplicated credential forms, no per-integration editing sheet. My earlier
proposal (editing behind Sheets) is withdrawn.

Consequences that shape the whole page:
- It **writes nothing** except the two lifecycle actions below, so it needs no
  credential inputs, no secret buffers, no dirty state and no save/confirm flow.
- Start / Stop stay here: they are lifecycle, not configuration, and "connected?"
  is the question this page exists to answer.
- Everything a field would have shown becomes a **derived, non-secret summary**
  ("token set", "2 allowed users", "3 endpoints") plus a link reading
  *Configure in Settings →*.
- A **blocking reason** must name the missing field and link straight to it —
  telling someone Slack refuses to start without saying it is the empty allowlist
  is the failure mode this page is supposed to prevent.

## Features to cover

**Slack** — connected badge + live transport (`events` | `socket`), and the
Request URL (Events API only — Socket Mode dials out, so there is nothing to
paste; show the copy affordance only in `events`). Start / Stop. Read-only
summary of what gates it: signing secret set?, bot token set?, app token set?
(Socket Mode), channel, port, proactive posting on/off, and the count of allowed
senders. The allowlist is **required**: blank ⇒ nothing is ingested and start
refuses — surfaced as a named blocking reason linking to that field, never a
silent no-op.

**Telegram** — connected badge + the bot `@username` learned at connect. Start /
Stop. Read-only summary: token set?, allowed chat id set?. The allowlist is
**fail-closed** and stays that way: no chat id ⇒ nothing accepted (MD-83 boundary
— do not touch these semantics). Credentials are WRITE-ONLY over IPC, so the page
renders "set" / "not set" and could not print a token even if asked to.

**Webhooks** — server state, tunnel root, and per-endpoint public URL (`''` until
a tunnel is up → "waiting for tunnel", never a broken link). List endpoints with
enabled state and **copy URL** (copying is reading, so it stays). Creating,
minting a secret, editing and deleting all deep-link to Settings.

**Providers + Provider Doctor** — per-engine installed/version state, then the
Doctor: run / re-run, "last run <ts>" vs "never run", and one row per check
(`status`, `id`, `detail`). **A `mismatch` is the only row that means "go fix
something"** — `not-installed` and `unverifiable` are answers, not faults, and
must not be styled as failures. Keep the closing note that some facts (live model
ids, MCP package names) need a network call this app does not make, so they are
listed unverified rather than assumed correct.

**Custom REST registry** — read-only roll-up only: how many are configured and
how many are **usable**, where `usable === enabled && hasSecret`, and a row per
integration with its kind, enabled state and usability. The template gallery and
the configure-&-test flow stay in Settings. (v1 grants every enabled integration
to ALL workers — there is no per-integration worker scoping, so do not invent a
picker for it.) All data flows through `integrationsClient`, never IPC directly.

## IPC / store / shared used (no main-process change expected)

- Slack: `slackStatus`, `slackStart`, `slackStop` (NOT `slackSetConfig`)
- Telegram: `telegramStatus`, `telegramStart`, `telegramStop` (NOT `telegramSetConfig`)
- Webhooks: `webhooksStatus`, `listWebhooks` (read-only — `saveWebhooks`,
  `deleteWebhook` and `generateWebhookSecret` belong to Settings now)
- Doctor: `doctorRun`, `doctorResults` (nullable — never run yet)
- Config: `getConfig` only — this page never calls `updateConfig`. **Type it from
  `@/store/config`, not from preload:** preload's narrower `HarnessConfig` omits
  `telegramEnabled` / `telegramBotToken` / `telegramChatId`, which the renderer's
  own declaration carries and `getConfig()` really returns. Reading "is the
  Telegram chat id set?" off the preload type would not compile; off the renderer
  type it is exactly what the pixel Settings already does.
- Registry: `@/integrations/registryClient` `integrationsClient` +
  `@shared/integrations` `authTypeNeedsSecret`
- `@shared/providerChecks`: `CheckStatus`, `CheckResult`, `UNVERIFIABLE_FACTS`

Status calls are pull-only (no push channel), so the page polls on mount and on
focus, and re-reads after every start/stop. No new IPC needed.

## Layout (text wireframe)

```
┌ Integrations ────────────────────────────────────────────┐
│  ● Slack        connected · socket               [ Stop ]│  ← ● green/amber/grey
│    2 allowed senders · proactive posting on              │
│    Configure in Settings →                               │
│ ──────────────────────────────────────────────────────── │
│  ○ Telegram     not started                     [ Start ]│
│    ⚠ no allowed chat id — nothing would be accepted      │  ← named blocking reason,
│    Set the allowed chat in Settings →                    │    links to THAT field
│ ──────────────────────────────────────────────────────── │
│  ○ Webhooks     stopped                         [ Start ]│
│    3 endpoints · tunnel: waiting                         │
│      /hook/deploy   waiting for tunnel            [copy] │
│    Manage endpoints in Settings →                        │
│ ──────────────────────────────────────────────────────── │
│  ● Custom REST  2 configured · 1 usable                  │
│    github ✓ usable · jira — enabled, no secret           │
│    Manage in Settings →                                  │
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

No sheets, no forms, no destructive actions on this page. Every "… in Settings →"
is a deep-link that opens modern Settings at that integration's section (Andy,
MD-87) — I need one navigation call from the nav registry that takes a Settings
section id; if MD-84/MD-87 do not expose one, I raise it rather than routing by
hand.
```

One status row per integration, hairline-separated; the dot is the only colour on
the page at rest. Doctor rows are a 3-column mono grid (status · id · detail).

## Resolved by god (was: open questions)

1. **Primitives come from MD-84 — I do not run `npx shadcn add`.** Every agent
   adding its own would collide on `modern/components/ui/*`. Orcun ships the union;
   anything still missing after go is a tiny add requested from Orcun on main.
2. **Status-only + deep-link to modern Settings.** One editor (Andy, MD-87), no
   duplicated forms. Applied throughout this spec.

Remaining dependency, not a question: the deep-link needs a Settings-section
target from MD-84's nav registry / MD-87's Settings. If neither exposes one by
build time I link to Settings' root and say so in the report.
