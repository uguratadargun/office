/**
 * Default MCP server catalog (Workstream 3). A dependency-free, importable-by-both
 * (main + renderer) registry of the MCP servers Office can wire into each
 * agent's per-session `settings.json`. Keep it free of electron/UI/node imports.
 *
 * Tiers gate consent:
 *   - 'safe-readonly' → no secret, no destructive write OUTSIDE the agent cwd; shipped
 *                       ON by default (`defaultEnabled:true`). `filesystem`/`git` are
 *                       scoped to the agent cwd at merge time (never whole-disk).
 *   - 'write'         → can mutate state beyond the workspace; OFF by default,
 *                       consent-gated.
 *   - 'secret'        → needs an API key / token / connection string; OFF by default,
 *                       consent-gated.
 *
 * The actual merge (catalog ∩ enabled, cwd-scoping of filesystem/git, id namespacing,
 * non-fatal resolution) is Workstream 3's `buildDefaultMcpServers`/`hookSettings`
 * job — this module only declares the entries, their tiers, and the seed defaults.
 *
 * NOTE: several reference servers ship as Python (uvx) rather than npm (npx). The
 * time / fetch / git commands were checked against the upstream monorepo's own
 * inventory and are correct as written. What stays flagged `// TODO-verify` is the
 * keyed tier, where the open question is not a transport but WHICH third-party
 * product the user has (which database, which mail provider, which search API) —
 * unanswerable from here, so those ship off and consent-gated. Workstream 3 makes a
 * server that fails to resolve non-fatal to the agent.
 */

export type McpTier = 'safe-readonly' | 'write' | 'secret';

export interface McpCatalogEntry {
  /** Stable catalog id (also the consent key in `config.mcpDefaults`). The merge
   *  step namespaces the written server id (e.g. `munder-<id>`) to avoid clobbering
   *  a user's own `~/.claude` MCP server of the same name. */
  id: string;
  /** Human label for the consent UI. */
  label: string;
  /** One-line description for the consent UI / hire import preview. */
  description: string;
  /** The MCP stdio server launch spec. `filesystem`/`git` carry a placeholder cwd
   *  arg that Workstream 3 replaces with the agent cwd at merge time. */
  spec: {
    command: string;
    args: string[];
    /** Required env (e.g. an API token). Present only on write/secret entries; the
     *  value is supplied via consent, never hard-coded here. */
    env?: Record<string, string>;
  };
  tier: McpTier;
  /** Seed for `config.mcpDefaults[id].enabled`. Always === (tier === 'safe-readonly'). */
  defaultEnabled: boolean;
}

/** The default MCP bundle. Safe/read-only servers are ON; anything that writes
 *  beyond the workspace or needs a secret is OFF until the user consents. */
export const MCP_CATALOG: McpCatalogEntry[] = [
  // ─── Safe, read-only, no-secret — shipped ON ──────────────────────────────
  {
    id: 'sequential-thinking',
    label: 'Sequential Thinking',
    description: 'Structured step-by-step reasoning scratchpad. No I/O, no secrets.',
    spec: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] },
    tier: 'safe-readonly',
    defaultEnabled: true
  },
  {
    id: 'time',
    label: 'Time',
    description: 'Current time and timezone conversions.',
    // Python, not npm — verified against the upstream monorepo's own inventory
    // (modelcontextprotocol/servers CLAUDE.md: `time/ Py mcp-server-time`).
    spec: { command: 'uvx', args: ['mcp-server-time'] },
    tier: 'safe-readonly',
    defaultEnabled: true
  },
  {
    id: 'fetch',
    label: 'Fetch',
    description: 'Fetch a URL and return its content as markdown (read-only HTTP GET).',
    // Python, not npm (upstream inventory: `fetch/ Py mcp-server-fetch`).
    spec: { command: 'uvx', args: ['mcp-server-fetch'] },
    tier: 'safe-readonly',
    defaultEnabled: true
  },
  {
    id: 'context7',
    label: 'Context7 Docs',
    description: 'Up-to-date library/framework documentation lookups.',
    spec: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
    tier: 'safe-readonly',
    defaultEnabled: true
  },
  {
    id: 'filesystem',
    label: 'Filesystem (cwd)',
    description: 'Read/edit files within the agent workspace only (scoped to cwd at spawn).',
    // The trailing arg is the allowed root — Workstream 3 replaces this placeholder
    // with the agent cwd at merge time so it is NEVER whole-disk.
    spec: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '<cwd>'] },
    tier: 'safe-readonly',
    defaultEnabled: true
  },
  {
    id: 'git',
    label: 'Git (cwd)',
    description: 'Inspect git status/log/diff for the workspace repo (scoped to cwd at spawn).',
    // Python, not npm (upstream inventory: `git/ Py mcp-server-git`); `--repository
    // <cwd>` is substituted at merge time.
    spec: { command: 'uvx', args: ['mcp-server-git', '--repository', '<cwd>'] },
    tier: 'safe-readonly',
    defaultEnabled: true
  },

  // ─── Write / secret — shipped OFF, consent-gated ──────────────────────────
  {
    id: 'github-token',
    label: 'GitHub',
    description: 'Read/write GitHub issues, PRs, and repos. Requires a personal access token.',
    spec: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' }
    },
    tier: 'secret',
    defaultEnabled: false
  },
  {
    id: 'db',
    label: 'Database',
    description: 'Query a SQL database. Requires a connection string.',
    // TODO-verify exact server package for the user's DB engine (Postgres assumed).
    // Unlike the uvx entries above this is not a fact that can be looked up — it is a
    // guess about which database the user runs, and it stays flagged until asked.
    spec: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres'],
      env: { DATABASE_URL: '' }
    },
    tier: 'secret',
    defaultEnabled: false
  },
  {
    id: 'email-calendar',
    label: 'Email & Calendar',
    description: 'Read/send mail and read/write calendar events. Requires account credentials.',
    // TODO-verify provider package (Gmail/Google Calendar assumed).
    spec: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-gsuite'], env: { GOOGLE_OAUTH_TOKEN: '' } },
    tier: 'secret',
    defaultEnabled: false
  },
  {
    id: 'search-with-key',
    label: 'Web Search',
    description: 'Keyed web search. Requires a search-provider API key.',
    // TODO-verify provider package (Brave Search assumed).
    spec: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'], env: { BRAVE_API_KEY: '' } },
    tier: 'secret',
    defaultEnabled: false
  }
];

/** Look up a catalog entry by id. */
export function mcpCatalogEntry(id: string): McpCatalogEntry | undefined {
  return MCP_CATALOG.find((e) => e.id === id);
}

/** Whether an id is a known safe-readonly server (the only tier a hire manifest may
 *  request without surfacing for human consent — Workstream 3 validation). */
export function isSafeReadonlyMcp(id: string): boolean {
  return mcpCatalogEntry(id)?.tier === 'safe-readonly';
}

/** Seed for `DEFAULTS.mcpDefaults` — derived from the catalog so the two never
 *  drift (safe-readonly ON, write/secret OFF). */
export function defaultMcpDefaults(): Record<string, { enabled: boolean }> {
  const out: Record<string, { enabled: boolean }> = {};
  for (const e of MCP_CATALOG) out[e.id] = { enabled: e.defaultEnabled };
  return out;
}

/* ── The merge, and the per-engine config shapes it is rendered into ────────
 *
 * The consent map above used to reach exactly one engine. `buildMcpServers`
 * lived privately in hive.ts and was called only on the Claude spawn path, so
 * for the other ten engines every toggle in Settings was decoration: the user
 * consented, and nothing anywhere read the consent. It is pure — (cwd, consent)
 * in, server map out — so it belongs here next to the catalog it merges, where
 * each engine's spawn path can render it into whatever config file that CLI
 * actually reads.
 */

/** One resolved stdio server, in the neutral shape every renderer below starts from. */
export interface McpServerSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export type McpDefaultsMap = { [id: string]: { enabled: boolean } } | undefined;

/**
 * Build the per-agent server map from the catalog: a server is included only when
 * it is enabled (catalog ∩ consent), `filesystem`/`git` are scoped to the agent cwd
 * rather than the whole disk, and every id is namespaced `munder-<id>` so a server
 * of the same name in the user's own config is never clobbered. A write/secret
 * server rides in ONLY on an explicit `enabled:true` — never on a default — so a
 * hand-edited or partial config cannot silently arm a keyed server.
 */
export function buildMcpServers(cwd: string, cfg: McpDefaultsMap): Record<string, McpServerSpec> {
  const out: Record<string, McpServerSpec> = {};
  for (const e of MCP_CATALOG) {
    const consented = cfg?.[e.id]?.enabled;
    const enabled = consented ?? e.defaultEnabled;
    if (!enabled) continue;
    if (e.tier !== 'safe-readonly' && consented !== true) continue;
    out[`munder-${e.id}`] = {
      command: e.spec.command,
      args: e.spec.args.map((a) => (a === '<cwd>' ? cwd : a)),
      ...(e.spec.env ? { env: e.spec.env } : {})
    };
  }
  return out;
}

/**
 * Render the map as Codex `[mcp_servers.<id>]` tables, appended to the per-agent
 * CODEX_HOME/config.toml we already write for lifecycle hooks. Field names are
 * Codex's own (`command` / `args` / `env`, stdio transport — codex-rs
 * config/src/mcp_types.rs). Returns '' for an empty map so a floor with every
 * server switched off leaves the file byte-identical to before.
 *
 * Values go through JSON.stringify: a TOML basic string takes the same escapes
 * JSON does for everything reachable here, and an agent cwd is user-chosen — it
 * can hold a quote or a backslash, and a raw one would corrupt the whole file,
 * not just its own line.
 */
export function codexMcpToml(servers: Record<string, McpServerSpec>): string {
  const ids = Object.keys(servers);
  if (!ids.length) return '';
  let toml = '\n# --- munder-hive default MCP servers (auto-generated; do not edit) ---\n';
  for (const id of ids) {
    const s = servers[id];
    toml += `\n[mcp_servers.${id}]\ncommand = ${JSON.stringify(s.command)}\n`;
    toml += `args = [${s.args.map((a) => JSON.stringify(a)).join(', ')}]\n`;
    if (s.env && Object.keys(s.env).length) {
      const pairs = Object.entries(s.env).map(([k, v]) => `${k} = ${JSON.stringify(v)}`);
      toml += `env = { ${pairs.join(', ')} }\n`;
    }
  }
  return toml;
}

/**
 * Render the map for OpenCode's `mcp` config key, which takes ONE `command` array
 * (argv, not command + args) and calls the env block `environment`
 * (packages/core/src/v1/config/mcp.ts). Written into the per-agent
 * OPENCODE_CONFIG_CONTENT the spawn path already builds, so the user's own
 * opencode.json is never touched.
 */
export function openCodeMcp(
  servers: Record<string, McpServerSpec>
): Record<string, { type: 'local'; command: string[]; enabled: true; environment?: Record<string, string> }> {
  const out: Record<string, { type: 'local'; command: string[]; enabled: true; environment?: Record<string, string> }> = {};
  for (const [id, s] of Object.entries(servers)) {
    out[id] = { type: 'local', command: [s.command, ...s.args], enabled: true, ...(s.env ? { environment: s.env } : {}) };
  }
  return out;
}

/**
 * Render the map for Crush's `mcp` config key (charmbracelet/crush). Crush is the
 * closest of the four to the neutral shape — `command` and `args` stay separate and
 * the env block really is called `env` — but two things are its own and neither is
 * guessable from Claude's or OpenCode's shape:
 *
 *  - `type` is REQUIRED (schema.json: MCPConfig.required = ["type"]). A server
 *    written without it is rejected even though the field's own default is 'stdio'.
 *  - the on/off flag is `disabled`, NOT `enabled` — OpenCode's `enabled: true` written
 *    here would be an unknown key, and MCPConfig is `additionalProperties: false`.
 *
 * So this emits `type` and omits the flag entirely: every server in the map is one the
 * consent gate already let through, and the schema default (`disabled: false`) is
 * exactly what we want.
 */
export function crushMcp(
  servers: Record<string, McpServerSpec>
): Record<string, { type: 'stdio'; command: string; args: string[]; env?: Record<string, string> }> {
  const out: Record<string, { type: 'stdio'; command: string; args: string[]; env?: Record<string, string> }> = {};
  for (const [id, s] of Object.entries(servers)) {
    out[id] = { type: 'stdio', command: s.command, args: s.args, ...(s.env ? { env: s.env } : {}) };
  }
  return out;
}

/** The engines whose spawn path actually writes the consented servers into a config
 *  the CLI reads. Everything else ignores the toggles, and the consent UI says so
 *  rather than implying a floor-wide guarantee it cannot make. Grow this list and
 *  the wiring together — never one without the other. */
export const MCP_WIRED_PROVIDERS: readonly string[] = ['claude', 'codex', 'opencode', 'crush'];
