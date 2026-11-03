/**
 * Recognise a Codex run that never started because Codex rejected its
 * `--config` overrides, and name the overrides a retry may keep
 * (TASK_2026_597, component 2 failure path, AS15).
 *
 * ## What a rejection looks like (fixtures, bundled codex-cli 0.155.1)
 *
 * Captured offline from Git Bash with a scratch `CODEX_HOME` and no model
 * call; stored verbatim under `__fixtures__/` (only the local user name in the
 * temp path is normalised):
 *
 * | Command | Exit | stderr headline |
 * | --- | --- | --- |
 * | `exec --experimental-json -c 'model_auto_compact_token_limit="x"'` | 1 | `Error loading config.toml: invalid type: string "x", expected i64` |
 * | `exec --experimental-json -c 'mcp_servers={"ghost"={enabled=false}}'` | 1 | `Error loading config.toml: invalid transport` |
 * | `exec --experimental-json -c 'agents.enabled'` | 1 | `Error parsing -c overrides: Invalid override (missing '='): agents.enabled` |
 * | `features list -c 'model_auto_compact_token_limit="x"'` | 1 | `Error: failed to load bootstrap configuration` |
 *
 * Each one exits before Codex writes a single JSON event, so nothing reached a
 * model and one retry is idempotent. An override with an unknown KEY
 * (`-c totally_unknown_key=1`) is accepted silently (exit 0), so it is not a
 * rejection (AS5). The plan's AS15 pattern did not match the
 * `failed to load bootstrap configuration` or `Error parsing -c overrides`
 * shapes; both are added below.
 *
 * The native lane uses the named-key filter and essential-entry reduction
 * below when App Server rejects lane configuration.
 */

/** The builder's single user-server entry: `mcp_servers={"a"={enabled=false}}`. */
const USER_SERVERS_ENTRY_PREFIX = 'mcp_servers={';

/**
 * Overrides a retry after a rejection keeps: Ptah's own MCP server, the role,
 * the approval policy, web search, the reasoning effort (a validated enum) and
 * the `mcp_servers={...}` entry that disables the user's own servers. Every
 * budget and prefix key goes.
 */
const ESSENTIAL_ENTRY_PREFIXES: readonly string[] = [
  'model_reasoning_effort=',
  USER_SERVERS_ENTRY_PREFIX,
  'mcp_servers.ptah.',
  'developer_instructions=',
  'approval_policy=',
  'web_search=',
];

/**
 * The key Codex names under its headline, e.g. `in \`mcp_servers.ghost\``
 * (every captured `Error loading config.toml` fixture carries one).
 */
const NAMED_KEY_PATTERN = /\bin `([^`\n]+)`/;

/**
 * Whether the rejection names one of the user's MCP servers
 * (`in \`mcp_servers.<name>\`` with a name other than `ptah`): then the
 * entry that disables them is the cause (an unloaded server, AS16) and the
 * retry has to drop it.
 */
export function codexRejectionNamesUserServer(stderr: string): boolean {
  const key = NAMED_KEY_PATTERN.exec(stderr)?.[1];
  return (
    key !== undefined &&
    key.startsWith('mcp_servers.') &&
    !key.startsWith('mcp_servers.ptah.') &&
    key !== 'mcp_servers.ptah'
  );
}

/**
 * `entries` reduced to the essential keys for a retry after `stderr`, order
 * kept. The user-server entry stays, so the user's own MCP servers stay off,
 * unless `stderr` names a user server as the cause.
 */
export function essentialCodexConfigEntries(
  entries: readonly string[],
  stderr: string,
): string[] {
  const dropUserServers = codexRejectionNamesUserServer(stderr);
  return entries.filter(
    (entry) =>
      ESSENTIAL_ENTRY_PREFIXES.some((prefix) => entry.startsWith(prefix)) &&
      !(dropUserServers && entry.startsWith(USER_SERVERS_ENTRY_PREFIX)),
  );
}
