/**
 * The JSON dialect shared by four of the five MCP config files, plus the
 * content hash that gives an MCP entry an identity the manifest can own.
 *
 * Carried over from `mcp-config-io.utils.ts` (cli-agent-runtime, deleted in
 * TASK_2026_278 Batch 2). The behaviour is unchanged — same root keys, same
 * `type`-field rule, same transport inference — because these files are read by
 * tools Ptah does not control and any "improvement" here is a compatibility
 * break somewhere else.
 */

import { createHash } from 'crypto';
import type { McpServerConfig } from '@ptah-extension/shared';

/** The key a config file uses for a remote server's endpoint. */
export const DEFAULT_URL_KEY = 'url';

/**
 * Antigravity's key for the same value. Documented by the CLI itself, in
 * `~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/mcp_servers.md`:
 * stdio entries are `{command, args, env}` like everywhere else, but a remote
 * entry is `{ "serverUrl": "https://..." }` and `url` is not read at all.
 */
export const ANTIGRAVITY_URL_KEY = 'serverUrl';

/**
 * How an entry's fields are spelled.
 *
 * `standard` covers Claude, Cursor, VS Code and Antigravity: a transport is
 * `stdio`/`http`/`sse`, a command is a string with separate `args`, and the
 * environment is `env`.
 *
 * `opencode` is a genuinely different dialect rather than one more key rename,
 * which is why it earns a name instead of a third option flag. Verified against
 * the published schema (https://opencode.ai/config.json, `McpLocalConfig` /
 * `McpRemoteConfig`, both `additionalProperties: false`):
 *
 * - the transport discriminant is `remote` or `local`, and it is REQUIRED;
 * - a local server's `command` is a single ARRAY holding the executable and its
 *   arguments — there is no `args` key at all;
 * - the environment is `environment`, not `env`.
 *
 * Writing standard spellings into `opencode.json` produces an entry that fails
 * the schema on three counts at once, so the dialect is not optional polish.
 */
export type McpJsonDialect = 'standard' | 'opencode';

/**
 * Serialize a transport config into the shape a config file expects.
 *
 * `includeType` is per-target and not cosmetic: VS Code uses `type` to pick a
 * transport, while Claude, Cursor and Copilot infer it from the presence of
 * `command` versus `url` and treat an unexpected key as a schema error.
 * OpenCode ignores the flag — its `type` is mandatory (see
 * {@link McpJsonDialect}).
 *
 * `urlKey` is the second per-target divergence: Antigravity spells the remote
 * endpoint `serverUrl`. Writing `url` there produces an entry `agy` parses
 * without an endpoint and silently never connects.
 *
 * `enabled` is deliberately never emitted. It defaults to true in every dialect
 * that has it, and writing it would put a key in the file that `hashMcpConfig`
 * does not model — the entry would then read back differently from how it was
 * written and be rewritten on every pass.
 */
export function configToJson(
  config: McpServerConfig,
  includeType: boolean,
  urlKey: string = DEFAULT_URL_KEY,
  dialect: McpJsonDialect = 'standard',
): Record<string, unknown> {
  const json: Record<string, unknown> = {};
  const opencode = dialect === 'opencode';
  const envKey = opencode ? 'environment' : 'env';

  if (opencode) {
    json['type'] = config.type === 'stdio' ? 'local' : 'remote';
  } else if (includeType) {
    json['type'] = config.type;
  }

  switch (config.type) {
    case 'stdio':
      json['command'] = opencode
        ? [config.command, ...(config.args ?? [])]
        : config.command;
      if (
        !opencode &&
        config.args !== undefined &&
        config.args.length > 0
      ) {
        json['args'] = config.args;
      }
      break;
    case 'http':
    case 'sse':
      json[urlKey] = config.url;
      if (
        config.headers !== undefined &&
        Object.keys(config.headers).length > 0
      ) {
        json['headers'] = config.headers;
      }
      break;
  }

  if (config.env !== undefined && Object.keys(config.env).length > 0) {
    json[envKey] = config.env;
  }
  return json;
}

/**
 * Parse a raw config-file entry back into a transport config.
 *
 * Both endpoint spellings are accepted unconditionally rather than per-target.
 * No config file uses both keys, the reader is the same for every dialect, and
 * a facet that could read only its OWN spelling would report a hand-written
 * Antigravity server as an endpoint-less entry.
 */
export function jsonToConfig(raw: Record<string, unknown>): McpServerConfig {
  const declaredType = raw['type'];
  const type =
    typeof declaredType === 'string'
      ? normalizeDeclaredType(declaredType, raw)
      : inferTransportType(raw);
  // OpenCode spells it `environment`; every other dialect spells it `env`.
  // Accepted unconditionally for the same reason both URL keys are: one reader
  // serves every dialect, and no config file uses both spellings.
  const env = asStringRecord(raw['env'] ?? raw['environment']);

  if (type === 'stdio') {
    const command = readCommand(raw);
    return {
      type: 'stdio',
      command: command.command,
      ...(command.args === undefined ? {} : { args: command.args }),
      ...(env === undefined ? {} : { env }),
    };
  }

  const headers = asStringRecord(raw['headers']);
  return {
    type: type === 'sse' ? 'sse' : 'http',
    url: readUrl(raw) ?? '',
    ...(headers === undefined ? {} : { headers }),
    ...(env === undefined ? {} : { env }),
  };
}

/**
 * Map a declared discriminant onto this module's vocabulary.
 *
 * OpenCode's `local`/`remote` are the same two transports under different
 * names. `remote` has to fall through to {@link inferTransportType} rather than
 * becoming `http` outright: a `/sse` endpoint installed as `sse` would
 * otherwise read back as `http`, hash differently from the config it was
 * written from, and be rewritten on every single pass — the same trap
 * documented on Antigravity's `serverUrl` below.
 */
function normalizeDeclaredType(
  declared: string,
  raw: Record<string, unknown>,
): string {
  if (declared === 'local') return 'stdio';
  if (declared === 'remote') return inferTransportType(raw);
  return declared;
}

/**
 * A stdio entry's executable and arguments, from either spelling.
 *
 * OpenCode packs both into one `command` array and has no `args` key; every
 * other dialect uses a `command` string beside an `args` array. An empty array
 * yields an empty command, matching the missing-key behaviour.
 */
function readCommand(raw: Record<string, unknown>): {
  command: string;
  args?: string[];
} {
  const command = raw['command'];
  if (Array.isArray(command)) {
    const parts = command.filter((a): a is string => typeof a === 'string');
    return {
      command: parts[0] ?? '',
      ...(parts.length > 1 ? { args: parts.slice(1) } : {}),
    };
  }

  const args = raw['args'];
  return {
    command: typeof command === 'string' ? command : '',
    ...(Array.isArray(args)
      ? { args: args.filter((a): a is string => typeof a === 'string') }
      : {}),
  };
}

/** The endpoint under whichever key this dialect spells it. */
function readUrl(raw: Record<string, unknown>): string | undefined {
  const direct = raw[DEFAULT_URL_KEY];
  if (typeof direct === 'string') return direct;
  const antigravity = raw[ANTIGRAVITY_URL_KEY];
  return typeof antigravity === 'string' ? antigravity : undefined;
}

/**
 * The transport rule is deliberately the SAME for both endpoint spellings.
 *
 * Antigravity documents `serverUrl` as its SSE transport, but classifying every
 * `serverUrl` as `sse` would make a server installed as `http` read back as a
 * different config, hash differently, and be rewritten on every single pass —
 * the exact drift `hashMcpConfig` exists to prevent. The URL decides, as it
 * already does for Claude, Cursor and Copilot.
 */
function inferTransportType(raw: Record<string, unknown>): string {
  if (typeof raw['command'] === 'string') return 'stdio';
  const url = readUrl(raw);
  if (url !== undefined && url.includes('/sse')) return 'sse';
  return 'http';
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') out[key] = item;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Content hash of one MCP entry.
 *
 * Keys are sorted at every level so two configs that differ only in property
 * order hash the same; otherwise a reconcile would rewrite the config file on
 * every pass and the "cheap no-op" promise would be false for MCP alone.
 */
export function hashMcpConfig(config: McpServerConfig): string {
  return createHash('sha256').update(stableStringify(config)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const pairs = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${pairs.join(',')}}`;
}
