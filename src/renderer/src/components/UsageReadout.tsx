/**
 * What an agent has actually spent — the read side of the usage seam.
 *
 * `telemetry:usage` and `hive:agentUsage` were implemented and consumed by
 * nothing, and `agentTokenCaps` had no UI at all, so the budgets were
 * enforceable but not observable: the breaker could stop an agent for a number
 * the user was never shown.
 *
 * Two rules this component exists to keep. It never prints $0 for a cost it does
 * not know — see usageFormat.ts for the three distinct outcomes. And it always
 * says WHERE the number came from, because "no signal" and "no spend" look
 * identical otherwise, and one of them means the meter is lying.
 */
import type { ResolvedUsage } from '../../../preload';
import { formatTokens, formatUsd, capProgress, usageSourceNote, USAGE_SOURCE_LABEL } from '@shared/usageFormat';

export interface UsageReadoutProps {
  usage: ResolvedUsage | undefined;
  /** This agent's own token ceiling, if the user set one. Wins over the floor. */
  agentCap?: number;
  /** The floor-wide token budget, used when the agent has no cap of its own. */
  floorCap?: number;
  accent: string;
}

/** Full readout: tokens in/out/cached, cost, provenance, and cap progress. */
export function UsageReadout({ usage, agentCap, floorCap, accent }: UsageReadoutProps) {
  const u = usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, usd: null, source: 'none' as const, model: null, lastActivityMs: null };
  const cap = capProgress(u.totalTokens, agentCap, floorCap);
  const cached = u.cacheReadTokens + u.cacheWriteTokens;

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        padding: '5px 8px', flexShrink: 0,
        background: 'var(--cth-cream-100)',
        borderBottom: '1px solid var(--cth-ink-300)'
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 11 }}>
        <Stat label="in" value={formatTokens(u.inputTokens)} />
        <Stat label="out" value={formatTokens(u.outputTokens)} />
        <Stat label="cached" value={formatTokens(cached)} />
        <span
          title={u.usd === null && u.source !== 'none'
            ? 'Tokens are measured, but this model has no row in the price table — so the cost is unpriced rather than zero.'
            : undefined}
          style={{
            fontFamily: 'var(--cth-font-display)', fontSize: 10, letterSpacing: 0.3,
            color: u.source === 'none' || u.usd === null ? 'var(--cth-ink-500)' : 'var(--cth-ink-900)'
          }}
        >{formatUsd(u)}</span>
        <span
          title={usageSourceNote(u)}
          style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--cth-ink-500)', cursor: 'help' }}
        >{USAGE_SOURCE_LABEL[u.source]}</span>
      </div>

      {cap ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div
            title={`${cap.label} tokens${agentCap ? ' (this agent’s own cap)' : ' (floor budget)'}`}
            style={{
              flex: 1, height: 6, background: 'var(--cth-cream-300)',
              boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
            }}
          >
            <div style={{
              width: `${cap.pct}%`, height: '100%',
              background: cap.over ? 'var(--cth-coral)' : `var(--cth-${accent})`
            }} />
          </div>
          <span style={{
            fontSize: 10, color: cap.over ? 'var(--cth-coral)' : 'var(--cth-ink-500)',
            whiteSpace: 'nowrap'
          }}>{cap.label}{cap.over ? ' · over' : ''}</span>
        </div>
      ) : (
        // No cap is a real state, not an empty bar: an invented denominator would
        // make an unbudgeted agent look like it was approaching a limit.
        <span style={{ fontSize: 10, color: 'var(--cth-ink-500)' }}>
          no token budget set — Settings sets a floor budget, or a per-agent cap
        </span>
      )}
    </div>
  );
}

/** Compact one-liner for the roster card: total tokens, cost, and the cap bar. */
export function UsageChip({ usage, agentCap, floorCap }: Omit<UsageReadoutProps, 'accent'>) {
  if (!usage || usage.source === 'none') return null;
  const cap = capProgress(usage.totalTokens, agentCap, floorCap);
  return (
    <span
      title={`${formatTokens(usage.totalTokens)} tokens · ${formatUsd(usage)} · ${USAGE_SOURCE_LABEL[usage.source]}${cap ? `\n${cap.label} of the token budget` : ''}`}
      style={{
        display: 'inline-flex', gap: 4, alignItems: 'baseline', minWidth: 0,
        fontSize: 10, color: cap?.over ? 'var(--cth-coral)' : 'var(--cth-ink-500)'
      }}
    >
      <span>{formatTokens(usage.totalTokens)}</span>
      <span style={{ opacity: 0.7 }}>{formatUsd(usage)}</span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'baseline' }}>
      <span style={{
        fontFamily: 'var(--cth-font-display)', fontSize: 8, letterSpacing: 0.4,
        textTransform: 'uppercase', color: 'var(--cth-ink-500)'
      }}>{label}</span>
      <span style={{ color: 'var(--cth-ink-900)' }}>{value}</span>
    </span>
  );
}
