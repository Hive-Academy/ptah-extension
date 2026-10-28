import type {
  CodexJsonValue,
  CodexMcpSecrets,
  CodexMcpServer,
} from './codex-runtime.types';

type HttpMcpServer = Extract<
  CodexMcpServer,
  { readonly transport: 'http' | 'sse' }
>;
type StdioMcpServer = Extract<CodexMcpServer, { readonly transport: 'stdio' }>;

/** Codex applies server names as dotted config keys, so separators are unsafe. */
const safeServerName = /^[A-Za-z0-9_-]+$/;

const problemText = {
  'unresolved-reference': 'has an unresolved secret reference',
  'invalid-reference-value': 'has an invalid url reference value',
  'duplicate-authorization':
    'has both an auth reference and an Authorization header reference',
  'invalid-server-name': 'is not a safe config key',
} as const;

/** The message names the server and the problem only, never a reference or a secret. */
export class CodexMcpConfigError extends Error {
  constructor(
    readonly code:
      | 'unresolved-reference'
      | 'invalid-reference-value'
      | 'duplicate-authorization'
      | 'invalid-server-name',
    readonly serverName: string,
  ) {
    const problem = problemText[code];
    // A name that failed the safe-key check is untrusted; never echo it back.
    super(
      code === 'invalid-server-name'
        ? `Codex MCP server name ${problem}`
        : `Codex MCP server "${serverName}" ${problem}`,
    );
    this.name = 'CodexMcpConfigError';
  }
}

function resolveSecret(
  server: CodexMcpServer,
  secrets: CodexMcpSecrets,
  reference: string,
): string {
  const value = secrets.get(reference);
  if (value === undefined || value === '') {
    throw new CodexMcpConfigError('unresolved-reference', server.name);
  }
  return value;
}

function resolveReferences(
  server: CodexMcpServer,
  secrets: CodexMcpSecrets,
  references: Readonly<Record<string, string>>,
): Map<string, string> {
  const values = new Map<string, string>();
  for (const [key, reference] of Object.entries(references)) {
    values.set(key, resolveSecret(server, secrets, reference));
  }
  return values;
}

function sortedRecord(
  values: ReadonlyMap<string, string>,
): Record<string, string> {
  const record: Record<string, string> = {};
  const sorted = [...values].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  for (const [key, value] of sorted) {
    record[key] = value;
  }
  return record;
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/** The resolved value may extend the profile url only by the secret query. */
function httpUrl(server: HttpMcpServer, secrets: CodexMcpSecrets): string {
  const reference = server.urlReference;
  if (reference === undefined) return server.url;
  const resolved = resolveSecret(server, secrets, reference);
  const parsed = parseUrl(resolved);
  const configured = parseUrl(server.url);
  if (
    parsed === undefined ||
    configured === undefined ||
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.origin !== configured.origin ||
    parsed.pathname !== configured.pathname
  ) {
    throw new CodexMcpConfigError('invalid-reference-value', server.name);
  }
  return resolved;
}

function stdioTable(
  server: StdioMcpServer,
  secrets: CodexMcpSecrets,
): Record<string, CodexJsonValue> {
  const env = resolveReferences(server, secrets, server.envReferences);
  return {
    command: server.command,
    args: [...server.args],
    ...(env.size > 0 ? { env: sortedRecord(env) } : {}),
    ...(server.toolTimeoutSec !== undefined
      ? { tool_timeout_sec: server.toolTimeoutSec }
      : {}),
  };
}

function httpTable(
  server: HttpMcpServer,
  secrets: CodexMcpSecrets,
): Record<string, CodexJsonValue> {
  if (
    server.authReference !== undefined &&
    Object.keys(server.headerReferences).some(
      (header) => header.toLowerCase() === 'authorization',
    )
  ) {
    throw new CodexMcpConfigError('duplicate-authorization', server.name);
  }
  const headers = resolveReferences(server, secrets, server.headerReferences);
  if (server.authReference !== undefined) {
    headers.set(
      'Authorization',
      `Bearer ${resolveSecret(server, secrets, server.authReference)}`,
    );
  }
  return {
    url: httpUrl(server, secrets),
    ...(headers.size > 0 ? { http_headers: sortedRecord(headers) } : {}),
    ...(server.toolTimeoutSec !== undefined
      ? { tool_timeout_sec: server.toolTimeoutSec }
      : {}),
  };
}

/**
 * Pure translation of profile MCP servers into Codex App Server `config`
 * overrides for the thread/start and thread/resume frame: one dotted
 * `mcp_servers.<name>` key per server. A whole-table value replaces only the
 * same-named config.toml entry (for example Ptah's synced `ptah` server) and
 * leaves every other entry untouched, so no top-level `mcp_servers` key is
 * ever emitted. Values taken from `secrets` are written only into this
 * returned object, which the runtime sends only in that frame to the child's
 * stdin; callers must never log it.
 */
export function buildCodexMcpConfigOverrides(
  servers: readonly CodexMcpServer[],
  secrets: CodexMcpSecrets = new Map(),
): Record<string, CodexJsonValue> {
  const overrides: Record<string, CodexJsonValue> = {};
  for (const server of servers) {
    if (!safeServerName.test(server.name)) {
      throw new CodexMcpConfigError('invalid-server-name', server.name);
    }
    overrides[`mcp_servers.${server.name}`] =
      server.transport === 'stdio'
        ? stdioTable(server, secrets)
        : httpTable(server, secrets);
  }
  return overrides;
}