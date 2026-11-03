import {
  buildCodexMcpConfigOverrides,
  CodexMcpConfigError,
} from './codex-mcp-config';
import type {
  CodexJsonValue,
  CodexMcpSecrets,
  CodexMcpServer,
} from './codex-runtime.types';

const SECRET = 'sk-SECRET-123';

/** Array.isArray cannot narrow a readonly JSON array, so the table needs its own guard. */
function isTable(
  value: CodexJsonValue | undefined,
): value is { readonly [key: string]: CodexJsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serverTable(
  overrides: Record<string, CodexJsonValue>,
  name: string,
): { readonly [key: string]: CodexJsonValue } {
  const value = overrides[`mcp_servers.${name}`];
  if (!isTable(value)) {
    throw new Error(`Expected a table for server ${name}`);
  }
  return value;
}

function caughtError(run: () => unknown): CodexMcpConfigError {
  try {
    run();
  } catch (error) {
    if (error instanceof CodexMcpConfigError) return error;
    throw error;
  }
  throw new Error('Expected buildCodexMcpConfigOverrides to throw');
}

/** No sentinel secret may reach an error message or its JSON form. */
function assertSanitized(error: CodexMcpConfigError): void {
  expect(error.message).not.toContain(SECRET);
  expect(JSON.stringify(error)).not.toContain(SECRET);
}

describe('buildCodexMcpConfigOverrides', () => {
  it('builds a stdio table with resolved, sorted env values and a tool timeout', () => {
    const overrides = buildCodexMcpConfigOverrides(
      [
        {
          name: 'local',
          transport: 'stdio',
          command: 'server',
          args: ['--flag'],
          envReferences: { TOKEN: 'vault:token', API_KEY: 'vault:key' },
          toolTimeoutSec: 30,
        },
      ],
      new Map([['vault:token', 'token-value'], ['vault:key', 'key-value']]),
    );
    const table = serverTable(overrides, 'local');
    expect(table).toEqual({
      command: 'server',
      args: ['--flag'],
      env: { API_KEY: 'key-value', TOKEN: 'token-value' },
      tool_timeout_sec: 30,
    });
    expect(Object.keys(table['env'] ?? {})).toEqual(['API_KEY', 'TOKEN']);
  });

  it('omits env when a stdio server declares no references', () => {
    const overrides = buildCodexMcpConfigOverrides([
      {
        name: 'local',
        transport: 'stdio',
        command: 'server',
        args: [],
        envReferences: {},
      },
    ]);
    expect(overrides).toEqual({
      'mcp_servers.local': { command: 'server', args: [] },
    });
  });

  it('builds an http table with resolved, sorted headers and a tool timeout', () => {
    const overrides = buildCodexMcpConfigOverrides(
      [
        {
          name: 'remote',
          transport: 'http',
          url: 'https://example.com/mcp',
          headerReferences: {
            'X-Client': 'vault:client',
            'X-Api-Key': 'vault:key',
          },
          toolTimeoutSec: 960,
        },
      ],
      new Map([['vault:client', 'client-value'], ['vault:key', 'key-value']]),
    );
    const table = serverTable(overrides, 'remote');
    expect(table).toEqual({
      url: 'https://example.com/mcp',
      http_headers: {
        'X-Api-Key': 'key-value',
        'X-Client': 'client-value',
      },
      tool_timeout_sec: 960,
    });
    expect(Object.keys(table['http_headers'] ?? {})).toEqual([
      'X-Api-Key',
      'X-Client',
    ]);
  });

  it('emits the same table keys for sse as for http', () => {
    const overrides = buildCodexMcpConfigOverrides(
      [
        {
          name: 'smithery',
          transport: 'sse',
          url: 'https://example.com/sse',
          headerReferences: { 'X-Api-Key': 'vault:key' },
          toolTimeoutSec: 60,
        },
      ],
      new Map([['vault:key', 'key-value']]),
    );
    expect(Object.keys(serverTable(overrides, 'smithery'))).toEqual([
      'url',
      'http_headers',
      'tool_timeout_sec',
    ]);
  });

  it('replaces only the synced ptah entry with a whole-table value', () => {
    const overrides = buildCodexMcpConfigOverrides([
      {
        name: 'ptah',
        transport: 'http',
        url: 'http://localhost:4823/session/tab-1/workspace/D%3A%5Cws',
        headerReferences: {},
        toolTimeoutSec: 960,
      },
    ]);
    expect(overrides).toEqual({
      'mcp_servers.ptah': {
        url: 'http://localhost:4823/session/tab-1/workspace/D%3A%5Cws',
        tool_timeout_sec: 960,
      },
    });
    expect(Object.hasOwn(overrides, 'mcp_servers')).toBe(false);
    expect(Object.keys(overrides)).toEqual(['mcp_servers.ptah']);
  });

  it('keeps the given server order across the emitted keys', () => {
    const overrides = buildCodexMcpConfigOverrides([
      {
        name: 'zulu',
        transport: 'stdio',
        command: 'server',
        args: [],
        envReferences: {},
      },
      {
        name: 'alpha',
        transport: 'http',
        url: 'https://example.com/mcp',
        headerReferences: {},
      },
    ]);
    expect(Object.keys(overrides)).toEqual([
      'mcp_servers.zulu',
      'mcp_servers.alpha',
    ]);
  });

  it('resolves the full url with its secret query through urlReference', () => {
    const url = `https://example.com/mcp?token=${SECRET}`;
    const overrides = buildCodexMcpConfigOverrides(
      [
        {
          name: 'remote',
          transport: 'http',
          url: 'https://example.com/mcp',
          urlReference: 'vault:url',
          headerReferences: {},
        },
      ],
      new Map([['vault:url', url]]),
    );
    expect(overrides).toEqual({
      'mcp_servers.remote': { url },
    });
  });

  it('rejects a resolved url outside the configured scheme, origin or path', () => {
    for (const resolved of [
      `https://other.example.com/mcp?token=${SECRET}`,
      `https://example.com/other?token=${SECRET}`,
      `ftp://example.com/mcp?token=${SECRET}`,
      `token=${SECRET}`,
    ]) {
      const error = caughtError(() =>
        buildCodexMcpConfigOverrides(
          [
            {
              name: 'remote',
              transport: 'http',
              url: 'https://example.com/mcp',
              urlReference: 'vault:url',
              headerReferences: {},
            },
          ],
          new Map([['vault:url', resolved]]),
        ),
      );
      expect(error.code).toBe('invalid-reference-value');
      expect(error.serverName).toBe('remote');
      expect(error.message).toBe(
        'Codex MCP server "remote" has an invalid url reference value',
      );
      assertSanitized(error);
    }
  });

  it('adds a Bearer Authorization header for authReference', () => {
    const overrides = buildCodexMcpConfigOverrides(
      [
        {
          name: 'remote',
          transport: 'http',
          url: 'https://example.com/mcp',
          headerReferences: { 'X-Api-Key': 'vault:key' },
          authReference: 'oauth:account',
        },
      ],
      new Map([['vault:key', 'key-value'], ['oauth:account', SECRET]]),
    );
    expect(overrides).toEqual({
      'mcp_servers.remote': {
        url: 'https://example.com/mcp',
        http_headers: {
          Authorization: `Bearer ${SECRET}`,
          'X-Api-Key': 'key-value',
        },
      },
    });
    const headers = serverTable(overrides, 'remote')['http_headers'] ?? {};
    expect(Object.keys(headers)).toEqual(['Authorization', 'X-Api-Key']);
  });

  it('rejects a duplicate Authorization header', () => {
    for (const header of ['Authorization', 'authorization', 'AUTHORIZATION']) {
      const error = caughtError(() =>
        buildCodexMcpConfigOverrides(
          [
            {
              name: 'remote',
              transport: 'http',
              url: 'https://example.com/mcp',
              headerReferences: { [header]: 'vault:auth' },
              authReference: 'oauth:account',
            },
          ],
          new Map([['vault:auth', SECRET], ['oauth:account', SECRET]]),
        ),
      );
      expect(error.code).toBe('duplicate-authorization');
      expect(error.serverName).toBe('remote');
      expect(error.message).toBe(
        'Codex MCP server "remote" has both an auth reference and an Authorization header reference',
      );
      assertSanitized(error);
    }
  });

  it('rejects unresolved and empty references without leaking resolved secrets', () => {
    const secrets: CodexMcpSecrets = new Map([
      ['vault:resolved', SECRET],
      ['vault:empty', ''],
    ]);
    const servers: readonly CodexMcpServer[] = [
      {
        name: 'local',
        transport: 'stdio',
        command: 'server',
        args: [],
        envReferences: { RESOLVED: 'vault:resolved', TOKEN: 'vault:missing' },
      },
      {
        name: 'headers',
        transport: 'http',
        url: 'https://example.com/mcp',
        headerReferences: {
          'X-Empty': 'vault:empty',
          'X-Resolved': 'vault:resolved',
        },
      },
      {
        name: 'auth',
        transport: 'http',
        url: 'https://example.com/mcp',
        headerReferences: { 'X-Resolved': 'vault:resolved' },
        authReference: 'oauth:missing',
      },
      {
        name: 'url',
        transport: 'http',
        url: 'https://example.com/mcp',
        urlReference: 'vault:missing',
        headerReferences: {},
      },
    ];
    for (const server of servers) {
      const error = caughtError(() =>
        buildCodexMcpConfigOverrides([server], secrets),
      );
      expect(error.code).toBe('unresolved-reference');
      expect(error.serverName).toBe(server.name);
      expect(error.message).toBe(
        `Codex MCP server "${server.name}" has an unresolved secret reference`,
      );
      assertSanitized(error);
    }
  });

  it('rejects an unsafe server name without echoing it', () => {
    for (const name of ['two words', 'ptah.server', 'bad/name', 'name\ttab']) {
      const error = caughtError(() =>
        buildCodexMcpConfigOverrides([
          {
            name,
            transport: 'stdio',
            command: 'server',
            args: [],
            envReferences: { TOKEN: 'vault:token' },
          },
        ]),
      );
      expect(error.code).toBe('invalid-server-name');
      expect(error.serverName).toBe(name);
      expect(error.message).toBe(
        'Codex MCP server name is not a safe config key',
      );
      expect(error.message).not.toContain(name);
      assertSanitized(error);
    }
  });
});