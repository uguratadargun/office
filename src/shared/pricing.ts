/**
 * Model prices, in USD per MILLION tokens.
 *
 * One file, hand-editable, no network — prices change and this is meant to be
 * edited in a PR, not fetched at runtime. A model that is not listed prices as
 * `null`, which every caller must render as "unknown". Never fall back to 0: a
 * $0 reading is indistinguishable from a free model, and it is exactly what made
 * the cost cap decorative for 7 of 11 providers.
 */
export interface ModelPrice {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M cached-input (read) tokens. Defaults to `input` when omitted. */
  cacheRead?: number;
  /** USD per 1M cache-write tokens. Defaults to `input` when omitted. */
  cacheWrite?: number;
}

/** Keys are matched case-insensitively, longest-prefix-first, so a dated slug
 *  (`gpt-5-codex-2026-01-01`) prices off its family entry without a new row. */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // ── Anthropic ──
  'claude-opus-5':      { input: 5,    output: 25,   cacheRead: 0.5,   cacheWrite: 6.25 },
  'claude-sonnet-5':    { input: 3,    output: 15,   cacheRead: 0.3,   cacheWrite: 3.75 },
  'claude-fable-5':     { input: 3,    output: 15,   cacheRead: 0.3,   cacheWrite: 3.75 },
  'claude-haiku-4-5':   { input: 1,    output: 5,    cacheRead: 0.1,   cacheWrite: 1.25 },
  'claude-opus-4':      { input: 15,   output: 75,   cacheRead: 1.5,   cacheWrite: 18.75 },
  'claude-sonnet-4':    { input: 3,    output: 15,   cacheRead: 0.3,   cacheWrite: 3.75 },
  // ── OpenAI / Codex ──
  'gpt-5-codex':        { input: 1.25, output: 10,   cacheRead: 0.125 },
  'gpt-5':              { input: 1.25, output: 10,   cacheRead: 0.125 },
  'o4-mini':            { input: 1.1,  output: 4.4,  cacheRead: 0.275 },
  // ── Google ──
  'gemini-3-pro':       { input: 1.25, output: 10,   cacheRead: 0.31 },
  'gemini-3-flash':     { input: 0.3,  output: 2.5,  cacheRead: 0.075 },
  'gemini-2.5-pro':     { input: 1.25, output: 10,   cacheRead: 0.31 },
  'gemini-2.5-flash':   { input: 0.3,  output: 2.5,  cacheRead: 0.075 }
};

/** Tokens as every parser reports them. */
export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** The price row for a model id, or null when we do not know the model.
 *  Longest key first so `gemini-3-flash` wins over a hypothetical `gemini-3`. */
export function priceFor(model: string | undefined): ModelPrice | null {
  if (!model) return null;
  const m = model.toLowerCase();
  const key = Object.keys(MODEL_PRICES)
    .filter((k) => m.includes(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? MODEL_PRICES[key] : null;
}

/** Cost in USD, or null when the model is unknown — the caller must show
 *  "unknown", not "$0". A locally-hosted model has no price row either, and
 *  reporting $0 for it would be a guess dressed as a measurement. */
export function priceUsd(model: string | undefined, t: TokenCounts): number | null {
  const p = priceFor(model);
  if (!p) return null;
  const per = (tokens: number, rate: number): number => (tokens / 1_000_000) * rate;
  return (
    per(t.inputTokens, p.input) +
    per(t.outputTokens, p.output) +
    per(t.cacheReadTokens, p.cacheRead ?? p.input) +
    per(t.cacheWriteTokens, p.cacheWrite ?? p.input)
  );
}
