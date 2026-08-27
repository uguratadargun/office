import { AGENT_MODELS } from '@/store/config';
import { effortLevelsFor } from '@shared/agentProvider';
import { DEFAULT_IDLE_HIBERNATE_MINUTES, DEFAULT_GOD_IDLE_HIBERNATE_MINUTES } from '@shared/hibernate';
import { DEFAULT_INBOX_NUDGE_DEBOUNCE_SECONDS } from '@shared/inboxNudge';
import { DEFAULT_MAX_CODING_WORKERS } from '@shared/codingWorkers';
import { DEFAULT_CONTEXT_TRIGGER, type ContextRule } from '@shared/triggers';
import { setContextTrigger } from '@/components/triggers/api';
import { Group, SectionHeader } from './Row';
import { TextRow, SelectRow, ActionRow } from './fields';
import { numOrUndefined, numText, type ConfigApi } from './useConfig';
import { AiEnginesPanel } from './AiEnginesPanel';
import { McpDefaultsPanel } from './McpDefaultsPanel';
import { OrchestratorRows } from './OrchestratorRows';

/** `undefined` = no --model flag, i.e. whatever the CLI itself defaults to. The
 *  select needs a real string for that, and '' is the one value no model id can
 *  collide with. */
const CLI_DEFAULT = '';

/** ms ↔ minutes, the unit the field is typed in. Rounded, not floored: a stored
 *  90_000ms reads as 2 rather than 1, which is the number that would be typed
 *  back. */
function everyMinutes(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000));
}

/** A blank or nonsense percent falls back to the default; 0 is a REAL value —
 *  it disables the pressure bar and fires on cadence alone — so it must survive
 *  `numOrUndefined`'s falsy handling. */
function pctOrDefault(typed: string, fallback: number): number {
  const n = Number(typed.trim());
  if (typed.trim() === '' || !Number.isFinite(n) || n < 0) return fallback;
  return Math.min(100, Math.round(n));
}

export function AgentsSection({ api }: { api: ConfigApi }) {
  const { config, save, reload } = api;
  if (!config) return null;

  const compact = config.contextTrigger?.compact ?? DEFAULT_CONTEXT_TRIGGER.compact;
  const clear = config.contextTrigger?.clear ?? DEFAULT_CONTEXT_TRIGGER.clear;
  /**
   * NOT `save()`. Every other row here goes through `updateConfig`, but the
   * context trigger has its own IPC for two reasons this panel needs both of:
   * main CLAMPS the numbers (a zero `everyMs` would arm a runaway timer) and it
   * RE-ARMS the live timers — a cadence written straight into the config file
   * would keep firing on the old rhythm until the next launch, so the row would
   * look saved and do nothing.
   *
   * Both halves are sent every time because `triggers:setContext` replaces the
   * object wholesale; sending compact alone would drop the `/clear` rule.
   */
  const patchCompact = (patch: Partial<ContextRule>): void => {
    setContextTrigger({ clear, compact: { ...compact, ...patch } });
    // …then re-read, because main clamped what it stored and the field must show
    // the number that actually took effect, not the one that was typed.
    setTimeout(() => { void reload(); }, 600);
  };

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader title="Agents & Models" blurb="What the boss and new agents run on, what they may reach, and when they stop." />

      <Group title="Orchestrator">
        <OrchestratorRows api={api} />
      </Group>

      <Group title="Defaults">
        {/* MD-172 — the help line now says what the choice COSTS. The ratio is
            not a guess: `src/main/pricing.ts` lists Opus at 15/75 and Sonnet at
            3/15 USD per million in/out, and Haiku at 0.8/4 — 5x and roughly a
            quarter, on both halves. `test/settings-worker-defaults.test.cjs`
            pins the copy to that table so a price change cannot leave a stale
            number sitting in Settings. */}
        <SelectRow
          id="set-model"
          label="Default agent model"
          help="Used by every newly spawned agent that does not pick its own. Opus costs about 5× Sonnet per token and Haiku about a quarter, so this is the single biggest lever on what a floor of agents spends."
          value={config.defaultModel ?? CLI_DEFAULT}
          choices={[
            { value: CLI_DEFAULT, label: 'CLI default' },
            ...AGENT_MODELS.filter((m) => m.id).map((m) => ({ value: m.id as string, label: m.label }))
          ]}
          onChange={(v) => save({ defaultModel: v === CLI_DEFAULT ? undefined : v })}
        />
        {/* MD-172 — effort was choosable per agent in the hire dialog and nowhere
            else, so a floor-wide preference meant setting it by hand on every
            hire. Levels come from the Claude preset because that is what
            `inferAgentProvider(undefined)` resolves to; an engine with no effort
            flag ignores the value, and `isValidEffort` drops a level that engine
            never accepted rather than splicing it into its command line. */}
        <SelectRow
          id="set-effort"
          label="Default reasoning effort"
          help="How hard a newly spawned agent thinks before it answers, unless it picks its own. Higher levels spend more tokens per turn for the same task. CLI default passes no flag at all; engines without an effort setting ignore this."
          value={config.defaultEffort ?? CLI_DEFAULT}
          choices={[
            { value: CLI_DEFAULT, label: 'CLI default' },
            ...(effortLevelsFor('claude') ?? []).map((e) => ({ value: e, label: e }))
          ]}
          onChange={(v) => save({ defaultEffort: v === CLI_DEFAULT ? undefined : v })}
        />
      </Group>

      <Group title="Limits">
        <TextRow
          id="set-maxturns"
          label="Max turns per run"
          help="Hard ceiling on agent turns. Blank means unlimited."
          type="number"
          value={numText(config.maxTurns)}
          placeholder="unlimited"
          onCommit={(v) => save({ maxTurns: numOrUndefined(v) })}
        />
        <TextRow
          id="set-hibernate"
          label="Sleep idle agents after"
          help={`Minutes an idle agent may sit before its session is shut down and it is parked asleep. 0 never sleeps; blank uses the default of ${DEFAULT_IDLE_HIBERNATE_MINUTES}.`}
          type="number"
          value={numText(config.idleHibernateMinutes)}
          placeholder={String(DEFAULT_IDLE_HIBERNATE_MINUTES)}
          onCommit={(v) => save({ idleHibernateMinutes: numOrUndefined(v) })}
        />
        {/* MD-163 — the unit is the WAKE, not the message. Every nudge is a
            full model turn against the agent's whole context, so three
            dispatches inside a minute should cost one, not three. Held mail is
            never dropped: the nudge that follows the window names the count. */}
        <TextRow
          id="set-nudge-batch"
          label="Batch inbox nudges for"
          help={`Seconds of new inbox mail collapsed into ONE wake, which names how many messages are waiting. Held mail is never dropped — it arrives with the next nudge. 0 nudges per message; blank uses ${DEFAULT_INBOX_NUDGE_DEBOUNCE_SECONDS}.`}
          type="number"
          value={numText(config.inboxNudgeDebounceSeconds)}
          placeholder={String(DEFAULT_INBOX_NUDGE_DEBOUNCE_SECONDS)}
          onCommit={(v) => save({ inboxNudgeDebounceSeconds: numOrUndefined(v) })}
        />
        {/* MD-172 — this number was configurable and invisible, which for a cap is
            the worst pairing: an operator who believed workers were capped had
            no way to find out they were not. The help says the quiet part —
            0 means the breaker never stops one of these on budget. */}
        <TextRow
          id="set-worker-cap"
          label="Default worker token budget"
          help="Total tokens (input + output + cache) one short-lived Slack/webhook worker may spend before it is stopped and its work preserved. A worker spawned with its own budget overrides this. 0 = unlimited — nothing stops a worker on cost."
          type="number"
          value={numText(config.defaultWorkerTokenCap)}
          placeholder="0"
          onCommit={(v) => save({ defaultWorkerTokenCap: numOrUndefined(v) ?? 0 })}
        />
        {/* MD-165 — its own row, because it is its own decision. The orchestrator
            may only park once every other session is asleep, so this number is
            "how long after the floor empties", not "how idle is idle". */}
        <TextRow
          id="set-god-hibernate"
          label="Sleep the orchestrator after"
          help={`Minutes the orchestrator may sit with the whole floor asleep, no card of its own and no mail waiting, before it is parked too. It wakes on real mail — the scheduler's own beats do not wake it. 0 never sleeps it; blank uses ${DEFAULT_GOD_IDLE_HIBERNATE_MINUTES}.`}
          type="number"
          value={numText(config.godIdleHibernateMinutes)}
          placeholder={String(DEFAULT_GOD_IDLE_HIBERNATE_MINUTES)}
          onCommit={(v) => save({ godIdleHibernateMinutes: numOrUndefined(v) })}
        />
        {/* MD-132 — a POLICY, not a limiter, and the help text has to say so.
            Nothing in the app blocks a fourth coder; this number is published
            to the orchestrator (its injected roster line and fleet.json) and it
            does the rationing. Calling it a cap without that sentence would
            promise an enforcement that does not exist. */}
        <TextRow
          id="set-coding-workers"
          label="Max concurrent coding workers"
          help={`How many agents the orchestrator may have writing code at once. This is a policy it follows when handing out work, not a limit the app enforces. Blank uses ${DEFAULT_MAX_CODING_WORKERS}.`}
          type="number"
          value={numText(config.maxCodingWorkers)}
          placeholder={String(DEFAULT_MAX_CODING_WORKERS)}
          onCommit={(v) => save({ maxCodingWorkers: numOrUndefined(v) })}
        />
      </Group>

      {/* MD-162 — auto-compaction's three numbers, in the section the operator
          already opens to tune how agents behave. The full rule (including the
          focus message and the /clear half) still lives in Triggers → Context;
          this is the cost dial, and it belongs next to the other cost dials.
          Every write goes through `patchCompact`, which re-sends BOTH halves —
          `contextTrigger` is replaced wholesale by `writeConfig`'s top-level
          merge, so patching one half alone would drop `clear` off the config. */}
      <Group
        title="Auto-compact"
        description="When a running agent is asked to summarise its own context. Compacting early is what keeps every later turn cheap — an agent left to fill its window re-sends that whole window on every turn until the next compaction."
      >
        <TextRow
          id="set-compact-every"
          label="Compact at most every"
          help={`Minutes between compaction sweeps. Blank uses ${everyMinutes(DEFAULT_CONTEXT_TRIGGER.compact.everyMs)}. A sweep with no agent over its bar does nothing, so a short cadence costs nothing on a quiet floor.`}
          type="number"
          value={numText(everyMinutes(compact.everyMs))}
          placeholder={String(everyMinutes(DEFAULT_CONTEXT_TRIGGER.compact.everyMs))}
          onCommit={(v) => {
            const mins = numOrUndefined(v);
            patchCompact({ everyMs: mins && mins > 0 ? mins * 60_000 : DEFAULT_CONTEXT_TRIGGER.compact.everyMs });
          }}
        />
        <TextRow
          id="set-compact-pct"
          label="Compact once context passes"
          help={`Percent of a normal (~200k) context window that must be used before an agent is interrupted. 0 compacts on the cadence alone. Blank uses ${DEFAULT_CONTEXT_TRIGGER.compact.minContextPct}%.`}
          type="number"
          value={numText(compact.minContextPct)}
          placeholder={String(DEFAULT_CONTEXT_TRIGGER.compact.minContextPct)}
          onCommit={(v) => patchCompact({ minContextPct: pctOrDefault(v, DEFAULT_CONTEXT_TRIGGER.compact.minContextPct) })}
        />
        <TextRow
          id="set-compact-pct-large"
          label="…or, on a 1M window, passes"
          help={`The same bar for very large context windows, where a small fraction is still an enormous amount of text — ${DEFAULT_CONTEXT_TRIGGER.compact.minContextPctLargeWindow}% of 1M is about 120k tokens. Blank uses ${DEFAULT_CONTEXT_TRIGGER.compact.minContextPctLargeWindow}%.`}
          type="number"
          value={numText(compact.minContextPctLargeWindow)}
          placeholder={String(DEFAULT_CONTEXT_TRIGGER.compact.minContextPctLargeWindow)}
          onCommit={(v) => patchCompact({ minContextPctLargeWindow: pctOrDefault(v, DEFAULT_CONTEXT_TRIGGER.compact.minContextPctLargeWindow) })}
        />
      </Group>

      {/* The BYOK panel. Without it no engine but Claude Code and Codex — which
          use their own login — can be authenticated from this UI at all. */}
      <Group
        title="AI engines (BYOK)"
        description="Keys and endpoints for the engines that use your own account. Keys are stored write-only: encrypted on this machine, injected only when an engine spawns, and never shown again."
      >
        <ActionRow
          id="set-provider-keys"
          label="Provider API keys"
          help="One per model provider. Claude Code and Codex sign in their own way and need nothing here."
          stacked
        >
          <AiEnginesPanel api={api} />
        </ActionRow>
      </Group>

      <Group
        title="Tools for new agents"
        description="MCP servers every newly hired agent is born with. Read-only ones are on; anything that writes or needs a credential waits for you."
      >
        <ActionRow id="set-mcp" label="MCP defaults" stacked>
          <McpDefaultsPanel api={api} />
        </ActionRow>
      </Group>
    </div>
  );
}
