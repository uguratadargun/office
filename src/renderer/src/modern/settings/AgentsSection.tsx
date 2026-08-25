import { AGENT_MODELS } from '@/store/config';
import { DEFAULT_IDLE_HIBERNATE_MINUTES } from '@shared/hibernate';
import { Group, SectionHeader } from './Row';
import { TextRow, SelectRow } from './fields';
import { numOrUndefined, numText, type ConfigApi } from './useConfig';

/** `undefined` = no --model flag, i.e. whatever the CLI itself defaults to. The
 *  select needs a real string for that, and '' is the one value no model id can
 *  collide with. */
const CLI_DEFAULT = '';

export function AgentsSection({ api }: { api: ConfigApi }) {
  const { config, save } = api;
  if (!config) return null;

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader title="Agents & Models" blurb="What new agents run on, and when they stop." />

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
      </Group>
    </div>
  );
}
