import type { HarnessConfig } from '@/store/config';
import { Group, SectionHeader } from './Row';
import { TextRow, ToggleRow } from './fields';
import { numOrUndefined, numText, type ConfigApi } from './useConfig';

/**
 * `circuitBreaker` is ONE object key, not five. Every control here therefore
 * patches the WHOLE object, spread over what is already stored — the config
 * carries fields this form does not show, and sending a fresh object would
 * silently drop them.
 */
export function AutonomySection({ api }: { api: ConfigApi }) {
  const { config, save } = api;
  if (!config) return null;
  const brk = config.circuitBreaker ?? {};
  const patchBreaker = (patch: Partial<NonNullable<HarnessConfig['circuitBreaker']>>) =>
    save({ circuitBreaker: { ...brk, ...patch } });

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader
        title="Autonomy & Budgets"
        blurb="How far agents may go on their own, and what stops them when something runs away."
      />

      <Group title="Autonomy">
        <ToggleRow
          id="set-automode"
          label="Work autonomously"
          help="On, agents act without asking for each permission. Off, they stop and ask first."
          checked={!!config.autoMode}
          onChange={(v) => save({ autoMode: v })}
        />
        <TextRow
          id="set-budget"
          label="Floor token budget"
          help="Total tokens across every active agent. Blank means no ceiling — and no meter, since a meter needs a limit to measure against."
          type="number"
          value={numText(config.costCapTokens)}
          placeholder="no limit"
          onCommit={(v) => save({ costCapTokens: numOrUndefined(v) })}
        />
      </Group>

      <Group
        title="Circuit breaker"
        description="Watches for the three ways a run goes wrong on its own: burning tokens, repeating one tool, and erroring in a loop."
      >
        <ToggleRow
          id="set-breaker-on"
          label="Circuit breaker"
          help="Off, none of the thresholds below are checked."
          checked={brk.enabled !== false}
          onChange={(v) => patchBreaker({ enabled: v })}
        />
        <TextRow
          id="set-breaker-velocity"
          label="Token velocity"
          help="Trips above this many tokens per minute. Blank leaves velocity unchecked."
          type="number"
          disabled={brk.enabled === false}
          value={numText(brk.tokenVelocityPerMin)}
          placeholder="unchecked"
          onCommit={(v) => patchBreaker({ tokenVelocityPerMin: numOrUndefined(v) })}
        />
        <TextRow
          id="set-breaker-repeat"
          label="Repeated-tool limit"
          help="Trips when one tool is called this many times in a row."
          type="number"
          disabled={brk.enabled === false}
          value={numText(brk.repeatedToolLimit)}
          placeholder="unchecked"
          onCommit={(v) => patchBreaker({ repeatedToolLimit: numOrUndefined(v) })}
        />
        <TextRow
          id="set-breaker-storm"
          label="Error-storm limit"
          help="Trips after this many consecutive errors."
          type="number"
          disabled={brk.enabled === false}
          value={numText(brk.errorStormLimit)}
          placeholder="unchecked"
          onCommit={(v) => patchBreaker({ errorStormLimit: numOrUndefined(v) })}
        />
        <ToggleRow
          id="set-breaker-hardstop"
          label="Hard stop"
          help="On, a tripped breaker kills the run. Off, it steers the agent and lets it continue."
          disabled={brk.enabled === false}
          checked={!!brk.hardStop}
          onChange={(v) => patchBreaker({ hardStop: v })}
        />
      </Group>
    </div>
  );
}
