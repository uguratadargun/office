/**
 * TRIGGERS — every way the God orchestrator gets woken up without a human typing.
 *
 * This module is the single contract shared by main, preload and renderer. Four
 * trigger types live under one roof:
 *
 *   schedules  — recurring dispatched missions (the pre-existing `ScheduledMission`;
 *                still owned by config.missions, surfaced under Triggers)
 *   context    — auto-compaction / auto-clearing of agent terminal context
 *   webhook    — inbound HTTP from arbitrary callers, one entry per endpoint
 *   org        — inbound peer messages from teammates' clone nodes (UI only for now)
 *
 * The webhook and org types both admit an outside party, so both share one
 * `TriggerMode` gate and both write to one `TriggerHistoryEntry` ledger.
 */

/* ────────────────────────────── behaviour gate ───────────────────────────── */

/**
 * How much an external sender is trusted.
 *
 *   strict              — every inbound message waits for the operator's approval.
 *   allow-all           — everything flows straight through: messages, directives
 *                         and communication alike.
 *   communication-only  — informational traffic flows; anything that asks the hive
 *                         to *act* (a directive) waits for approval.
 */
export type TriggerMode = 'strict' | 'allow-all' | 'communication-only';

export const TRIGGER_MODES: { value: TriggerMode; label: string; blurb: string }[] = [
  { value: 'strict', label: 'strict', blurb: 'Ask me before anything reaches the hive.' },
  { value: 'allow-all', label: 'allow all', blurb: 'Messages, directives and communication all flow.' },
  { value: 'communication-only', label: 'communication only', blurb: 'Chatter flows; directives need my approval.' }
];

export const DEFAULT_TRIGGER_MODE: TriggerMode = 'strict';

/**
 * What an inbound message is asking for. A *directive* wants the hive to do work;
 * *communication* is informational (a status question, an FYI, a reply).
 * Senders may declare it; `classifyInboundKind` guesses when they don't.
 */
export type InboundKind = 'directive' | 'communication';

/** Resolve a mode + kind into whether the message may be routed without a human. */
export function isAutoAllowed(mode: TriggerMode, kind: InboundKind): boolean {
  if (mode === 'allow-all') return true;
  if (mode === 'communication-only') return kind === 'communication';
  return false; // strict
}

/**
 * Best-effort guess at intent when the payload doesn't declare `kind`.
 *
 * Deliberately conservative: anything we aren't confident is chatter is treated as
 * a directive, because mis-labelling a directive as communication is what lets
 * unapproved work through in `communication-only` mode. Callers who care should
 * send an explicit `kind`.
 */
export function classifyInboundKind(text: string): InboundKind {
  const t = text.trim().toLowerCase();
  if (!t) return 'communication';
  // A leading question with no imperative reads as someone asking, not tasking.
  const asksOnly = /^(what|how|when|where|who|why|is|are|do|does|did|can|could|status|any)\b/.test(t)
    && t.endsWith('?')
    && !/\b(fix|build|ship|deploy|run|write|create|add|remove|delete|refactor|implement|update|merge|revert)\b/.test(t);
  return asksOnly ? 'communication' : 'directive';
}

/* ──────────────────────────── context trigger ────────────────────────────── */

/**
 * One half of the context trigger (compact, or clear). Both the *message* sent to
 * the agent and the *conditions* that fire it are user-editable — that is the whole
 * point of surfacing this as a trigger rather than leaving it hardcoded.
 *
 * A run fires for an agent when BOTH conditions hold:
 *   - at least `everyMs` has elapsed since the last run, and
 *   - that agent's context is at least `minContextPct` full.
 * `minContextPct` of 0 disables the pressure gate (time alone fires it).
 */
export interface ContextRule {
  enabled: boolean;
  /** Minimum wall-clock gap between runs. */
  everyMs: number;
  /** Percent (0-100) of the context window that must be used before firing. */
  minContextPct: number;
  /**
   * Separate, lower bar for very large context windows (~1M tokens), where a
   * smaller *fraction* is still an enormous absolute amount of text.
   */
  minContextPctLargeWindow: number;
  /**
   * For `compact`: extra focus text appended to the provider's compaction command,
   * on the providers that read trailing text (codex and opencode ignore it, so it
   * is dropped for them rather than typed as stray input).
   *
   * For `clear`: a literal command that OVERRIDES the provider's own clear verb.
   * That override doubles as the escape hatch for providers we deliberately map to
   * nothing — Crush (palette-only), Copilot (print mode), and custom binaries —
   * where the operator knows their CLI and we don't.
   *
   * Empty string = send the provider's bare command.
   */
  message: string;
}

export interface ContextTriggerConfig {
  compact: ContextRule;
  clear: ContextRule;
}

/**
 * The focus text that has always ridden along with `/compact`. Preserved verbatim
 * as the default so upgrading users see no behaviour change beyond the cadence.
 */
export const DEFAULT_COMPACTION_FOCUS =
  'Keep the current task, recent decisions, open questions, and file paths in play. Drop resolved tangents.';

/**
 * The compact defaults from the release that first made the pressure gate real
 * (2h / 60% / 40%). Kept because a stored config that still carries these EXACT
 * three numbers has never been touched by an operator — it is the shipped default
 * sitting on disk — and `migrateCompactRule` may therefore move it forward.
 * Anything else is a decision and is left where it was put.
 */
export const LEGACY_COMPACT_RULE = {
  everyMs: 7_200_000,
  minContextPct: 60,
  minContextPctLargeWindow: 40
} as const;

/**
 * Compact EARLY. The previous defaults (2h / 60% / 40%) were tuned to spare
 * agents interruptions, and they do — but the interruption was never the
 * expensive half. Every turn an agent takes re-sends its whole context, so a
 * window allowed to reach 60% of 200k (or 40% of 1M ≈ 400k tokens) makes every
 * single turn until the next compaction cost that much, and on a plan-based
 * account an overnight run of full-context turns is what actually empties the
 * budget. One compaction is cheap; a thousand fat turns are not.
 *
 * So the bars come down to 25% (≈50k on a 200k window) and 12% (≈120k on a 1M
 * window), and the cadence to 30 minutes, which is short enough that an agent
 * that fills fast is caught in the same working session rather than hours later.
 * The compaction itself is summarising, not discarding — the cost of doing it
 * sooner is a shorter recent-history tail, not lost work.
 *
 * Auto-clear ships DISABLED. `/clear` is destructive — it discards context rather
 * than summarising it, and the codebase already gates the manual verb behind a
 * spoken confirm word. Turning it on is an explicit operator choice.
 */
export const DEFAULT_CONTEXT_TRIGGER: ContextTriggerConfig = {
  compact: {
    enabled: true,
    everyMs: 1_800_000, // 30m — was 2h
    minContextPct: 25, // ≈50k of a 200k window — was 60
    minContextPctLargeWindow: 12, // ≈120k of a 1M window — was 40
    message: DEFAULT_COMPACTION_FOCUS
  },
  clear: {
    enabled: false,
    everyMs: 7_200_000,
    minContextPct: 90,
    minContextPctLargeWindow: 80,
    message: ''
  }
};

/**
 * A window at or above this size counts as "very large" and uses the rule's
 * separate, lower bar: a smaller fraction of 1M is still an enormous amount of
 * text to re-send on every turn.
 */
export const LARGE_CONTEXT_WINDOW = 500_000;

/**
 * How long a context reading stays usable.
 *
 * The status line fires after EVERY response, so a live agent's reading is never
 * more than one turn old. A reading older than this therefore does not mean "the
 * agent has been quiet" so much as "this agent's telemetry path is gone" — a
 * respawn without `--settings`, a provider swap, a resume under another harness.
 * Twice the shipped 30m cadence, so a reading must miss two whole cycles before
 * we stop believing it.
 */
export const CONTEXT_TELEMETRY_STALE_MS = 3_600_000;

/** Why the pressure gate decided the way it did. Carried out to the caller so
 *  the fallback can say, in the log, WHICH fallback it took. */
export type ContextPressureReason =
  /** The rule's bar is 0 — the gate is switched off and cadence alone fires. */
  | 'gate-off'
  /** A fresh reading, at or above the bar. The gate opened on real telemetry. */
  | 'above-bar'
  /** A fresh reading, below the bar. The only reason we ever hold fire. */
  | 'below-bar'
  /** No reading has ever arrived for this agent (most non-Claude providers). */
  | 'no-telemetry'
  /** A reading exists but is older than CONTEXT_TELEMETRY_STALE_MS. */
  | 'stale-telemetry';

/** What the renderer knows about one agent's context, as the gate sees it. */
export interface ContextPressureInput {
  /** Tokens currently in the window, if any reading has arrived. */
  tokens?: number;
  /** The REAL window size, known only from the status line. */
  limit?: number;
  /** When the reading landed (epoch ms). Undefined = provenance unknown, which
   *  is treated exactly like a reading too old to trust. */
  updatedAt?: number;
  /** Model id, used to infer a window when only the token count is known. */
  model?: string;
}

export interface ContextPressureDecision {
  /** Fire the rule's action for this agent? */
  fire: boolean;
  reason: ContextPressureReason;
  /** Fill percentage the decision used, or null when there was no reading. */
  pct: number | null;
  /** The bar that applied (0 when the gate is off). */
  bar: number;
}

/**
 * The context-pressure gate: is this agent full enough to be worth interrupting?
 *
 * FAIL-OPEN when we have no usable reading — and say so out loud. Context
 * telemetry arrives over the Claude status-line/hook path, so most non-Claude
 * providers report nothing at all; failing closed there would silently reinstate
 * the very bug the gate replaces (a fleet that never compacts), only harder to
 * notice. An unmetered agent falls back to time-only firing, which is exactly the
 * old behaviour and no worse.
 *
 * The reason code is the point of this returning an object rather than a boolean.
 * Before MD-167 the fail-open was implicit: an agent whose telemetry never worked
 * and an agent genuinely over its bar produced the same silent `true`, so an
 * install where the hook socket never bound (see hookSockPath) looked identical
 * to one where the gate was doing its job. The caller logs the fallback branches,
 * which is what turns "compaction happens" into "compaction happened BECAUSE".
 *
 * A STALE reading fails open too. Its cost is bounded: the caller's latch skips a
 * repeat compact while the token count is byte-identical, so a quiet agent whose
 * telemetry has dried up is interrupted once, not once per cycle — and the
 * alternative, believing a frozen number forever, is an agent that can never
 * compact again no matter how full it really is.
 */
export function contextPressureDecision(
  input: ContextPressureInput,
  rule: ContextRule,
  now: number
): ContextPressureDecision {
  const large = (input.limit ?? 0) >= LARGE_CONTEXT_WINDOW;
  const bar = large ? rule.minContextPctLargeWindow : rule.minContextPct;
  if (!(bar > 0)) return { fire: true, reason: 'gate-off', pct: null, bar: 0 };

  // The two readings arrive on different paths: the status line delivers real
  // tokens AND the real window size, while the transcript poll backfills tokens
  // only. So an agent can legitimately know its token count without knowing its
  // window — infer the window the same way the poll does rather than throwing a
  // perfectly good token reading away.
  const pct = typeof input.tokens === 'number' && Number.isFinite(input.tokens)
    ? (input.tokens / (input.limit && input.limit > 0
      ? input.limit
      : (/1m/i.test(input.model ?? '') ? 1_000_000 : 200_000))) * 100
    : null;
  if (pct === null) return { fire: true, reason: 'no-telemetry', pct: null, bar };
  if (input.updatedAt === undefined || now - input.updatedAt > CONTEXT_TELEMETRY_STALE_MS) {
    return { fire: true, reason: 'stale-telemetry', pct, bar };
  }
  return pct >= bar
    ? { fire: true, reason: 'above-bar', pct, bar }
    : { fire: false, reason: 'below-bar', pct, bar };
}

/**
 * Move a persisted compact rule onto the current defaults, FIELD BY FIELD.
 *
 * A stored value is migrated only when it still equals the exact number the old
 * default shipped: that is the one reading indistinguishable from "never
 * touched", and it is the whole reason the app's own config carries a 2h/60/40
 * rule that nobody chose. Every other value — including one an operator happened
 * to set to something between the two defaults — is a decision and survives.
 *
 * The ambiguous case is honest and deliberate: an operator who deliberately typed
 * 60 gets moved to 25. There is no bit on disk that separates that from the
 * default, and leaving every install on the expensive cadence to protect the rare
 * hand-typed 60 is the worse trade. Same rule `migrateTriggersV1` already applies
 * to the seeded mission interval.
 */
export function migrateCompactRule(rule: ContextRule): ContextRule {
  const d = DEFAULT_CONTEXT_TRIGGER.compact;
  return {
    ...rule,
    everyMs: rule.everyMs === LEGACY_COMPACT_RULE.everyMs ? d.everyMs : rule.everyMs,
    minContextPct: rule.minContextPct === LEGACY_COMPACT_RULE.minContextPct
      ? d.minContextPct
      : rule.minContextPct,
    minContextPctLargeWindow:
      rule.minContextPctLargeWindow === LEGACY_COMPACT_RULE.minContextPctLargeWindow
        ? d.minContextPctLargeWindow
        : rule.minContextPctLargeWindow
  };
}

/** Did `migrateCompactRule` have anything to do? Lets a caller skip a config
 *  write when every field was already current. */
export function compactRuleNeedsMigration(rule: ContextRule): boolean {
  return rule.everyMs === LEGACY_COMPACT_RULE.everyMs
    || rule.minContextPct === LEGACY_COMPACT_RULE.minContextPct
    || rule.minContextPctLargeWindow === LEGACY_COMPACT_RULE.minContextPctLargeWindow;
}

/* ──────────────────────────── webhook triggers ───────────────────────────── */

/**
 * One inbound endpoint. Several may exist at once; they are multiplexed over a
 * single HTTP server + tunnel and told apart by the `id` in the request path, so
 * adding a webhook costs no extra port and no extra tunnel.
 *
 * `secret` is per-endpoint: revoking one caller never disturbs the others.
 */
export interface WebhookTrigger {
  id: string;
  name: string;
  /** Shared secret the caller echoes in `x-md-webhook-secret`. Never logged. */
  secret: string;
  enabled: boolean;
  mode: TriggerMode;
  /** User-editable JSON Schema (serialised) that inbound bodies are checked against. */
  schema: string;
  createdAt: number;
}

/**
 * The default contract for an inbound POST. Users may edit this per webhook to
 * match whatever the calling system already emits; `message` is the only field the
 * router truly needs.
 */
export const DEFAULT_WEBHOOK_SCHEMA_OBJECT = {
  type: 'object',
  required: ['message'],
  properties: {
    message: { type: 'string', description: 'What you want the orchestrator to know or do.' },
    title: { type: 'string', description: 'Short label for the kanban card.' },
    kind: {
      type: 'string',
      enum: ['directive', 'communication'],
      description: 'directive = asks the hive to act; communication = informational.'
    },
    from: { type: 'string', description: 'Who is sending, for the trigger history.' }
  }
} as const;

export const DEFAULT_WEBHOOK_SCHEMA = JSON.stringify(DEFAULT_WEBHOOK_SCHEMA_OBJECT, null, 2);

/* ────────────────────────── organisation trigger ─────────────────────────── */

/**
 * Peer-to-peer messaging between teammates' installs. Each teammate runs their own
 * Office; setting an org key lets their instance address yours.
 *
 * Persistence only — the transport service does not exist yet and the settings
 * surfaces that used to configure this were removed in 0.4.5, so nothing reads
 * `apiKey`. The shape stays so an existing config file round-trips unharmed.
 */
export interface OrgTriggerConfig {
  apiKey: string;
  enabled: boolean;
  mode: TriggerMode;
}

export const DEFAULT_ORG_TRIGGER: OrgTriggerConfig = {
  apiKey: '',
  enabled: false,
  mode: DEFAULT_TRIGGER_MODE
};

/* ──────────────────────────── trigger history ────────────────────────────── */

/**
 * One line in the ledger. Both directions are recorded so the operator can read a
 * conversation as a conversation: what they sent us, and what we said back.
 * `correlationId` ties our outbound reply to the inbound that prompted it.
 */
export interface TriggerHistoryEntry {
  id: string;
  source: 'webhook' | 'org';
  /** Which webhook (or which peer) — `WebhookTrigger.id` for webhooks. */
  sourceId: string;
  /** Display name at the time of the event, so history survives a rename/delete. */
  sourceName: string;
  direction: 'inbound' | 'outbound';
  /** The other party: who sent it to us, or who we sent it to. */
  peer: string;
  title?: string;
  /** Full message body — never truncated at rest; the UI decides how much to show. */
  body: string;
  kind: InboundKind;
  decision?: 'auto-allowed' | 'pending' | 'approved' | 'rejected';
  correlationId?: string;
  taskId?: string;
  at: number;
}

/** Ledger cap. Oldest entries are dropped past this so the file can't grow forever. */
export const TRIGGER_HISTORY_LIMIT = 500;

/* ───────────────────────── minimal schema validation ─────────────────────── */

/**
 * A deliberately small JSON-Schema subset checker — `type`, `required`,
 * `properties`, `enum`. The project has no validation dependency and inbound
 * webhook bodies do not justify adding one; anything this doesn't understand is
 * ignored rather than treated as a failure, so an exotic user schema degrades to
 * "accept" instead of locking the caller out of their own endpoint.
 */
export function validateAgainstSchema(
  value: unknown,
  schema: unknown
): { ok: true } | { ok: false; error: string } {
  if (!schema || typeof schema !== 'object') return { ok: true };
  const s = schema as Record<string, unknown>;

  const expected = typeof s.type === 'string' ? s.type : undefined;
  if (expected && !matchesType(value, expected)) {
    return { ok: false, error: `expected ${expected}` };
  }

  if (Array.isArray(s.enum) && !s.enum.some((e) => e === value)) {
    return { ok: false, error: `must be one of ${s.enum.map((e) => String(e)).join(', ')}` };
  }

  if (expected === 'object' || (!expected && isPlainObject(value))) {
    if (!isPlainObject(value)) return { ok: false, error: 'expected object' };
    for (const key of Array.isArray(s.required) ? s.required : []) {
      if (typeof key !== 'string') continue;
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined || v === null || v === '') return { ok: false, error: `${key} required` };
    }
    const props = isPlainObject(s.properties) ? s.properties : {};
    for (const [key, sub] of Object.entries(props)) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue; // absent optionals are fine; `required` covers the rest
      const r = validateAgainstSchema(v, sub);
      if (!r.ok) return { ok: false, error: `${key}: ${r.error}` };
    }
  }

  return { ok: true };
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return isPlainObject(value);
    case 'null': return value === null;
    default: return true; // unknown type keyword — don't fail the caller over it
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
