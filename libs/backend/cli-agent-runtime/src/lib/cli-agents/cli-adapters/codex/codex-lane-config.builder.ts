/**
 * The exact `--config key=value` list for one Codex lane turn
 * (TASK_2026_597, component 1; R3.1, R3.2, R3.5, R4.1, R4.2, R4.4, R9.2, R9.6,
 * R9.7).
 *
 * The output is accepted unchanged as the SDK's `configOverrides` (each entry
 * becomes one raw `--config` argument) and as the direct runner's `--config`
 * arguments. Codex parses each VALUE as TOML, so every string value is written
 * as a TOML basic string here — the SDK's own `config` flattener is bypassed.
 *
 * ## Why user servers are one inline table, not dotted keys
 *
 * Measured on the bundled codex-cli 0.155.1 (`codex -c ... mcp list --json`
 * against a scratch `CODEX_HOME`):
 *
 * - the KEY path of an override is split on every `.` with no TOML quoting:
 *   `mcp_servers."foo".enabled=false` creates a server literally named
 *   `"foo"` and fails the whole config (`invalid transport`);
 * - the VALUE is real TOML, so `mcp_servers={"a.b"={enabled=false}}` disables
 *   a server whose name holds a dot, and it deep-merges with the file layers;
 * - overrides apply in order to one table: a later `mcp_servers={...}`
 *   REPLACES earlier `mcp_servers.ptah.*` overrides, while dotted keys after it
 *   extend it.
 *
 * So the user-server disables are a single `mcp_servers={...}` entry with each
 * name quoted by TOML basic-string rules, emitted BEFORE `mcp_servers.ptah.*`.
 *
 * ## Purity
 *
 * No I/O, no clock, no module state: equal input gives byte-equal output, and
 * two concurrent builds share nothing (R9.7). User server names are read by
 * `codex-user-mcp-servers.ts` and passed in.
 */

import { ptahMcpServerUrl } from '../ptah-mcp-url';

/**
 * Whether resume and `continue()` turns resend the role as
 * `developer_instructions`. `true` until evidence shows Codex keeps it across
 * a resumed thread (AS6); S5 may flip it.
 */
export const CODEX_RESUME_RESENDS_ROLE = true;

/** Codex versions (major.minor prefixes) whose config keys were verified. */
export const CODEX_VERIFIED_VERSIONS: readonly string[] = ['0.155', '0.160'];

/**
 * Per-call timeout for Ptah's MCP tools, in seconds. Long enough for a
 * blocking wait on another lane (R9.2).
 */
export const CODEX_PTAH_TOOL_TIMEOUT_SEC = 960;

/** Ptah's own MCP server key; never disabled by the user-server entry. */
const PTAH_SERVER_NAME = 'ptah';

export type CodexLaneConfigVariant = 'first-turn' | 'resume';

export interface CodexLaneConfigInput {
  /** `first-turn` for a new thread; `resume` for resume and `continue()`. */
  variant: CodexLaneConfigVariant;
  /** `model_auto_compact_token_limit`. Safe integer ≥ 0; 0 omits the key. */
  autoCompactTokens: number;
  /** `tool_output_token_limit`. Safe integer ≥ 0; 0 omits the key. */
  toolOutputTokenLimit: number;
  /** `web_search`: `"live"` when true, `"disabled"` when false. */
  webSearch: boolean;
  /** Resolved effort; emitted as `model_reasoning_effort` when non-empty. */
  reasoningEffort?: string;
  /** Ptah MCP port. Absent or 0: no `mcp_servers.ptah.*` key is emitted. */
  mcpPort?: number;
  /** Lane working directory; scopes the Ptah MCP URL. */
  workingDirectory: string;
  /** Lane agent id; attributes the Ptah MCP URL. */
  agentId?: string;
  /** User MCP server names Codex would load, from `codex-user-mcp-servers`. */
  userMcpServerNames: readonly string[];
  /** Rendered (condensed) role block. Omitted when empty. */
  developerInstructions?: string;
  /** Version of the Codex binary the lane will run, e.g. `0.155.1`. */
  codexVersion?: string;
  /**
   * Overrides {@link CODEX_RESUME_RESENDS_ROLE}. Exists so the spec can prove
   * the `false` case; callers leave it unset.
   */
  resendRoleOnResume?: boolean;
}

export interface CodexLaneConfig {
  /** Ordered `key=value` strings, one per `--config` argument. */
  entries: string[];
  /** Human-readable warnings for the lane log. Never secrets. */
  warnings: string[];
}

export function buildCodexLaneConfig(
  input: CodexLaneConfigInput,
): CodexLaneConfig {
  const entries: string[] = [];
  const warnings: string[] = [];

  const versionWarning = checkCodexVersion(input.codexVersion);
  if (versionWarning !== null) warnings.push(versionWarning);

  entries.push('agents.enabled=false');
  entries.push('features.plugins=false');
  entries.push('features.apps=false');
  entries.push('skills.include_instructions=false');

  const autoCompact = validCount(
    'model_auto_compact_token_limit',
    input.autoCompactTokens,
    warnings,
  );
  if (autoCompact !== null) {
    entries.push(`model_auto_compact_token_limit=${autoCompact}`);
  }
  const toolOutput = validCount(
    'tool_output_token_limit',
    input.toolOutputTokenLimit,
    warnings,
  );
  if (toolOutput !== null) {
    entries.push(`tool_output_token_limit=${toolOutput}`);
  }

  entries.push(
    `web_search=${tomlBasicString(input.webSearch ? 'live' : 'disabled')}`,
  );
  entries.push(`approval_policy=${tomlBasicString('never')}`);

  const effort = input.reasoningEffort?.trim() ?? '';
  if (effort !== '') {
    entries.push(`model_reasoning_effort=${tomlBasicString(effort)}`);
  }

  const userServers = userServerNames(input.userMcpServerNames);
  if (userServers.length > 0) {
    const tables = userServers
      .map((name) => `${tomlBasicString(name)}={enabled=false}`)
      .join(',');
    entries.push(`mcp_servers={${tables}}`);
  }

  // 0 means "no port", as `options.mcpPort` has always been read by the adapter.
  if (input.mcpPort !== undefined && input.mcpPort !== 0) {
    if (isValidPort(input.mcpPort)) {
      const url = ptahMcpServerUrl(
        input.mcpPort,
        input.workingDirectory,
        input.agentId,
      );
      entries.push(
        `mcp_servers.${PTAH_SERVER_NAME}.url=${tomlBasicString(url)}`,
      );
      entries.push(
        `mcp_servers.${PTAH_SERVER_NAME}.tool_timeout_sec=${CODEX_PTAH_TOOL_TIMEOUT_SEC}`,
      );
    } else {
      warnings.push(
        `Ignored invalid Ptah MCP port ${String(input.mcpPort)}; the lane starts without Ptah tools.`,
      );
    }
  }

  const instructions = input.developerInstructions ?? '';
  const resendRole = input.resendRoleOnResume ?? CODEX_RESUME_RESENDS_ROLE;
  if (instructions !== '' && (input.variant === 'first-turn' || resendRole)) {
    entries.push(`developer_instructions=${tomlBasicString(instructions)}`);
  }

  return { entries, warnings };
}

/**
 * A warning when `version` is unknown or outside
 * {@link CODEX_VERIFIED_VERSIONS}, else `null`. The keys are emitted either
 * way; the warning tells the reader of the log why a key might be rejected.
 */
function checkCodexVersion(version: string | undefined): string | null {
  const match = /(\d+)\.(\d+)/.exec(version ?? '');
  if (match === null) {
    return `Codex version unknown; lane config keys were verified on ${CODEX_VERIFIED_VERSIONS.join(', ')} only.`;
  }
  const majorMinor = `${Number(match[1])}.${Number(match[2])}`;
  if (CODEX_VERIFIED_VERSIONS.includes(majorMinor)) return null;
  return `Codex ${version ?? ''} is outside the verified versions (${CODEX_VERIFIED_VERSIONS.join(', ')}); lane config keys may be rejected.`;
}

/**
 * The value to emit for a token-count key, or `null` to omit it. 0 omits
 * silently (the documented "off"); anything that is not a safe integer ≥ 0
 * (at most `Number.MAX_SAFE_INTEGER`) omits with a warning rather than handing Codex a value it would reject.
 */
function validCount(
  key: string,
  value: number,
  warnings: string[],
): number | null {
  // `Number.isSafeInteger`, not `isInteger`: `1e21` is an integer to JS but
  // renders as `1e+21`, which Codex parses as a float and rejects together
  // with the whole config. Every safe integer renders as plain digits.
  if (!Number.isSafeInteger(value) || value < 0) {
    warnings.push(
      `Ignored ${key}=${String(value)}: expected a whole number of 0 or more.`,
    );
    return null;
  }
  return value === 0 ? null : value;
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65_535;
}

/** Distinct, non-empty, sorted, `ptah` excluded — so input order cannot leak. */
function userServerNames(names: readonly string[]): string[] {
  const distinct = new Set<string>();
  for (const name of names) {
    if (name !== '' && name !== PTAH_SERVER_NAME) distinct.add(name);
  }
  return [...distinct].sort(compareCodeUnits);
}

function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * `value` as a TOML basic string (TOML 1.0 §String). Quote and backslash are
 * escaped; so is every control character TOML forbids raw (U+0000-U+001F
 * except via the short escapes, and U+007F). C1 controls and the U+2028 /
 * U+2029 line separators are escaped too, so no invisible line break reaches a
 * command line. A lone surrogate is not a Unicode scalar value, which TOML's
 * `\u` escape cannot express, so it becomes U+FFFD.
 */
function tomlBasicString(value: string): string {
  let out = '"';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0xfffd;
    switch (char) {
      case '"':
        out += '\\"';
        continue;
      case '\\':
        out += '\\\\';
        continue;
      case '\b':
        out += '\\b';
        continue;
      case '\t':
        out += '\\t';
        continue;
      case '\n':
        out += '\\n';
        continue;
      case '\f':
        out += '\\f';
        continue;
      case '\r':
        out += '\\r';
        continue;
    }
    if (code >= 0xd800 && code <= 0xdfff) {
      out += '\\uFFFD';
    } else if (
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029
    ) {
      out += `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`;
    } else {
      out += char;
    }
  }
  return `${out}"`;
}
