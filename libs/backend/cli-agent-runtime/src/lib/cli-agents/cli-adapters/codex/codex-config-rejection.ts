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
 * The SDK reports a non-zero exit as
 * `Codex Exec exited with code <n>: <stderr>` (`@openai/codex-sdk`
 * `dist/index.js`, `CodexExec.run`); the direct runner (S1b) sees the stderr
 * itself. Both call {@link isCodexConfigRejection}.
 */

import { redactSecrets } from '../sdk-error-summary';

/** AS15, adjusted to the captured fixtures. */
const CODEX_CONFIG_REJECTION_PATTERN =
  /(error loading config|failed to load (?:bootstrap )?config(?:uration)?|error parsing -c overrides|invalid override|invalid configuration|unknown (?:config(?:uration)? )?(?:key|field)|failed to (?:parse|deserialize)[^\n]*(?:config|toml)|-c\/--config)/i;

/** The SDK's error text for a `codex exec` child that exited non-zero. */
const SDK_EXEC_EXIT_PATTERN = /^Codex Exec exited with (?:code|signal) [^:]*: /;

/** Longest stderr excerpt a log line may carry. */
const STDERR_EXCERPT_MAX_CHARS = 200;

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

/** Whether `stderr` is Codex refusing its configuration. */
export function isCodexConfigRejection(stderr: string): boolean {
  return CODEX_CONFIG_REJECTION_PATTERN.test(stderr);
}

/**
 * The child's stderr when `errorMessage` is the SDK's non-zero-exit error AND
 * that stderr is a config rejection; otherwise `undefined`.
 */
export function sdkConfigRejectionStderr(
  errorMessage: string,
): string | undefined {
  const exit = SDK_EXEC_EXIT_PATTERN.exec(errorMessage);
  if (exit === null) return undefined;
  const stderr = errorMessage.slice(exit[0].length);
  return isCodexConfigRejection(stderr) ? stderr : undefined;
}

/**
 * A one-line excerpt of a rejection for the log: from the rejection headline
 * on (Codex's own warnings above it are skipped), whitespace collapsed,
 * secrets redacted, at most {@link STDERR_EXCERPT_MAX_CHARS} chars.
 */
export function codexStderrExcerpt(
  stderr: string,
  secrets: readonly string[],
): string {
  const lines = stderr.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    CODEX_CONFIG_REJECTION_PATTERN.test(line),
  );
  const text = lines
    .slice(start === -1 ? 0 : start)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const redacted = redactSecrets(text, secrets);
  return redacted.length > STDERR_EXCERPT_MAX_CHARS
    ? `${redacted.slice(0, STDERR_EXCERPT_MAX_CHARS - 3)}...`
    : redacted;
}

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
