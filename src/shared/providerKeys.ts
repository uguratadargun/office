/**
 * The BYOK backends whose API keys the harness stores, in one place.
 *
 * This table was duplicated: `BACKEND_KEY_ENV` in `src/main/index.ts` decided
 * which backends `providerKey:set` would ACCEPT and which env var each key is
 * injected as, while `components/AiEnginesSettings.tsx` kept its own copy of the
 * same five rows to render them — with a comment asking the next editor to keep
 * the two in sync by hand. Adding a backend in one place and not the other gives
 * either a row whose save is rejected as "unknown backend", or a working backend
 * with no way to enter its key.
 *
 * Renderer-safe: no electron, no node. Both UIs and main import this.
 */

export interface ProviderKeyBackend {
  /** Broker slot id — `apikey:<id>`. Also what `providerKey:*` validates against. */
  id: string;
  label: string;
  /** The env var the key is injected as when an engine spawns. */
  envVar: string;
}

export const PROVIDER_KEY_BACKENDS: ProviderKeyBackend[] = [
  { id: 'anthropic', label: 'Anthropic', envVar: 'ANTHROPIC_API_KEY' },
  { id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY' },
  { id: 'google', label: 'Google · Gemini', envVar: 'GEMINI_API_KEY' },
  { id: 'openrouter', label: 'OpenRouter', envVar: 'OPENROUTER_API_KEY' },
  { id: 'groq', label: 'Groq', envVar: 'GROQ_API_KEY' }
];

/** `{ anthropic: 'ANTHROPIC_API_KEY', … }` — what main injects at spawn. */
export const BACKEND_KEY_ENV: Record<string, string> = Object.fromEntries(
  PROVIDER_KEY_BACKENDS.map((b) => [b.id, b.envVar])
);

export function isKnownBackend(id: unknown): id is string {
  return typeof id === 'string' && id in BACKEND_KEY_ENV;
}
