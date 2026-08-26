import { AGENT_MODELS } from '@/store/config';
import { DEFAULT_IDLE_HIBERNATE_MINUTES } from '@shared/hibernate';
import { DEFAULT_MAX_CODING_WORKERS } from '@shared/codingWorkers';
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

export function AgentsSection({ api }: { api: ConfigApi }) {
  const { config, save } = api;
  if (!config) return null;

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader title="Agents & Models" blurb="What the boss and new agents run on, what they may reach, and when they stop." />

      <Group title="Orchestrator">
        <OrchestratorRows api={api} />
      </Group>

      <Group title="Defaults">
        <SelectRow
          id="set-model"
          label="Default agent model"
          help="Used by every newly spawned agent that does not pick its own."
          value={config.defaultModel ?? CLI_DEFAULT}
          choices={[
            { value: CLI_DEFAULT, label: 'CLI default' },
            ...AGENT_MODELS.filter((m) => m.id).map((m) => ({ value: m.id as string, label: m.label }))
          ]}
          onChange={(v) => save({ defaultModel: v === CLI_DEFAULT ? undefined : v })}
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
