/**
 * `SmitheryConnectionsClient` specs (TASK_2026_375 B2.2).
 *
 * Every fixture in this file is the shape published in the Smithery API
 * reference, read 2026-09-03:
 *   docs/api-reference/namespaces/get-users-namespaces-or-search-namespaces
 *   docs/api-reference/connect/list-connections
 *   docs/api-reference/connect/get-connection
 *   docs/api-reference/connect/create-or-update-connection
 *   docs/api-reference/connect/delete-connection
 *
 * The one shape worth naming: `Connection.status` is an OBJECT
 * (`{ state, setupUrl?, message? }`), not the bare string the task context
 * table suggested. The client flattens it, so a change of nesting upstream
 * lands here and nowhere else.
 */

import {
  SmitheryConnectionsClient,
  toSmitheryConnectionStatus,
  isPtahManagedConnection,
  buildPtahConnectionMetadata,
  type SmitheryFetchLike,
} from './smithery-connections.client';
import { SmitheryApiError, SmitheryKeyMissingError } from './smithery-errors';

interface RecordedCall {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function makeFetch(
  route: (url: string, method: string) => { status?: number; body?: unknown },
): { impl: SmitheryFetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl: SmitheryFetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, headers: init?.headers, body: init?.body });
    const { status = 200, body = {} } = route(url, method);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: async () => body,
    };
  };
  return { impl, calls };
}

const build = (
  route: (url: string, method: string) => { status?: number; body?: unknown },
  apiKey: string | null = 'sk-test-key',
) => {
  const { impl, calls } = makeFetch(route);
  const client = new SmitheryConnectionsClient({
    getApiKey: async () => apiKey,
    fetchImpl: impl,
  });
  return { client, calls };
};

// The documented `GET /connect/{ns}` connection object, verbatim in shape.
const HUBSPOT_CONNECTION = {
  connectionId: 'hubspot',
  name: 'HubSpot',
  transport: 'http',
  mcpUrl: null,
  metadata: { managedBy: 'ptah', server: 'hubspot' },
  iconUrl: 'https://smithery.ai/icons/hubspot.png',
  createdAt: '2026-09-03T10:00:00.000Z',
  status: {
    state: 'auth_required',
    setupUrl: 'https://auth.smithery.ai/setup/one-time-token',
  },
  serverInfo: { name: 'hubspot', version: '1.2.0', title: 'HubSpot' },
};

describe('SmitheryConnectionsClient — namespaces', () => {
  it('reads the documented { namespaces: [{ name }], pagination } shape', async () => {
    const { client, calls } = build(() => ({
      body: {
        namespaces: [{ name: 'abdallah' }, { name: 'team-ptah' }],
        pagination: {
          currentPage: 1,
          pageSize: 50,
          totalPages: 1,
          totalCount: 2,
        },
      },
    }));

    await expect(client.listNamespaces()).resolves.toEqual([
      'abdallah',
      'team-ptah',
    ]);
    expect(calls[0].url).toBe('https://api.smithery.ai/namespaces');
    expect(calls[0].headers?.['Authorization']).toBe('Bearer sk-test-key');
  });

  it('returns an empty list rather than throwing on a body it cannot read', async () => {
    const { client } = build(() => ({ body: { namespaces: 'not-an-array' } }));
    await expect(client.listNamespaces()).resolves.toEqual([]);
  });

  it('throws SmitheryKeyMissingError before any request when no key is set', async () => {
    const { client, calls } = build(() => ({ body: {} }), null);
    await expect(client.listNamespaces()).rejects.toBeInstanceOf(
      SmitheryKeyMissingError,
    );
    expect(calls).toHaveLength(0);
  });

  it('throws SmitheryApiError carrying the status on 401', async () => {
    const { client } = build(() => ({
      status: 401,
      body: { error: 'unauthorized', message: 'Invalid API key' },
    }));

    await expect(client.listNamespaces()).rejects.toMatchObject({
      name: 'SmitheryApiError',
      status: 401,
    });
  });
});

describe('SmitheryConnectionsClient — listConnections', () => {
  it('reads the documented { connections, nextCursor } shape and flattens status', async () => {
    const { client, calls } = build(() => ({
      body: {
        connections: [
          HUBSPOT_CONNECTION,
          {
            connectionId: 'sentry',
            name: 'Sentry',
            transport: 'http',
            mcpUrl: 'https://mcp.sentry.dev/mcp',
            metadata: null,
            iconUrl: null,
            createdAt: '2026-08-01T00:00:00.000Z',
            status: { state: 'connected' },
            serverInfo: { name: 'sentry', version: '0.9.0' },
          },
        ],
        nextCursor: null,
      },
    }));

    const connections = await client.listConnections('abdallah');

    expect(calls[0].url).toBe('https://api.smithery.ai/connect/abdallah');
    expect(connections).toHaveLength(2);
    expect(connections[0]).toMatchObject({
      connectionId: 'hubspot',
      name: 'HubSpot',
      status: 'auth_required',
      setupUrl: 'https://auth.smithery.ai/setup/one-time-token',
      server: 'hubspot',
      iconUrl: 'https://smithery.ai/icons/hubspot.png',
      createdAt: '2026-09-03T10:00:00.000Z',
    });
    expect(connections[1]).toMatchObject({
      connectionId: 'sentry',
      status: 'connected',
      server: 'sentry',
      mcpUrl: 'https://mcp.sentry.dev/mcp',
    });
    expect(connections[1].setupUrl).toBeUndefined();
  });

  it('percent-encodes a namespace with a slash', async () => {
    const { client, calls } = build(() => ({ body: { connections: [] } }));
    await client.listConnections('org/team');
    expect(calls[0].url).toBe('https://api.smithery.ai/connect/org%2Fteam');
  });

  it('takes serverInfo.name as the server when the connection has no Ptah metadata', async () => {
    const { client } = build(() => ({
      body: {
        connections: [
          {
            connectionId: 'made-elsewhere',
            name: 'Made elsewhere',
            metadata: { userId: 'someone' },
            status: { state: 'connected' },
            serverInfo: { name: 'exa', version: '1.0.0' },
          },
        ],
      },
    }));

    const [connection] = await client.listConnections('ns');
    expect(connection.server).toBe('exa');
    expect(isPtahManagedConnection(connection)).toBe(false);
  });
});

describe('SmitheryConnectionsClient — getConnection', () => {
  it('reads the documented single-connection shape', async () => {
    const { client, calls } = build(() => ({ body: HUBSPOT_CONNECTION }));

    const connection = await client.getConnection('abdallah', 'hubspot');

    expect(calls[0].url).toBe(
      'https://api.smithery.ai/connect/abdallah/hubspot',
    );
    expect(connection?.status).toBe('auth_required');
    expect(connection?.setupUrl).toBe(
      'https://auth.smithery.ai/setup/one-time-token',
    );
  });

  it('reports the error state message from { state: "error", message }', async () => {
    const { client } = build(() => ({
      body: {
        connectionId: 'broken',
        name: 'Broken',
        status: { state: 'error', message: 'upstream refused the token' },
      },
    }));

    const connection = await client.getConnection('ns', 'broken');
    expect(connection?.status).toBe('error');
    expect(connection?.statusMessage).toBe('upstream refused the token');
  });

  it('returns null on 404 rather than throwing', async () => {
    const { client } = build(() => ({
      status: 404,
      body: { error: 'not_found', message: 'Connection not found' },
    }));
    await expect(client.getConnection('ns', 'gone')).resolves.toBeNull();
  });
});

describe('SmitheryConnectionsClient — upsertConnection', () => {
  it('PUTs { server, name, metadata } and stamps managedBy: ptah', async () => {
    const { client, calls } = build(() => ({
      status: 201,
      body: HUBSPOT_CONNECTION,
    }));

    const connection = await client.upsertConnection('abdallah', 'hubspot', {
      server: 'hubspot',
      name: 'HubSpot',
      metadata: buildPtahConnectionMetadata('hubspot'),
    });

    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toBe(
      'https://api.smithery.ai/connect/abdallah/hubspot',
    );
    expect(calls[0].headers?.['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
      server: 'hubspot',
      name: 'HubSpot',
      metadata: { managedBy: 'ptah', server: 'hubspot' },
    });
    expect(connection.status).toBe('auth_required');
    expect(connection.setupUrl).toBe(
      'https://auth.smithery.ai/setup/one-time-token',
    );
  });

  it('defaults the metadata to the Ptah marker when the caller sends none', async () => {
    const { client, calls } = build(() => ({ body: HUBSPOT_CONNECTION }));
    await client.upsertConnection('ns', 'hubspot', { server: 'hubspot' });
    expect(JSON.parse(calls[0].body ?? '{}').metadata).toEqual({
      managedBy: 'ptah',
      server: 'hubspot',
    });
  });

  it('treats 200 as an update, same as 201 for a create', async () => {
    const { client } = build(() => ({
      status: 200,
      body: { ...HUBSPOT_CONNECTION, status: { state: 'connected' } },
    }));
    const connection = await client.upsertConnection('ns', 'hubspot', {
      server: 'hubspot',
    });
    expect(connection.status).toBe('connected');
  });

  it('throws SmitheryApiError with the API message on 409', async () => {
    const { client } = build(() => ({
      status: 409,
      body: { error: 'conflict', message: 'URL mismatch' },
    }));

    await expect(
      client.upsertConnection('ns', 'hubspot', { server: 'hubspot' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      client.upsertConnection('ns', 'hubspot', { server: 'hubspot' }),
    ).rejects.toThrow(/URL mismatch/);
  });
});

describe('SmitheryConnectionsClient — deleteConnection', () => {
  it('DELETEs the connection path', async () => {
    const { client, calls } = build(() => ({ body: { success: true } }));
    await client.deleteConnection('abdallah', 'hubspot');
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toBe(
      'https://api.smithery.ai/connect/abdallah/hubspot',
    );
  });

  it('does not throw when the connection is already gone (404)', async () => {
    const { client } = build(() => ({
      status: 404,
      body: { error: 'not_found', message: 'Connection not found' },
    }));
    await expect(
      client.deleteConnection('ns', 'gone'),
    ).resolves.toBeUndefined();
  });
});

describe('SmitheryConnectionsClient — secrecy', () => {
  it('never puts the API key in a URL and never logs it', async () => {
    const logged: unknown[] = [];
    const { impl, calls } = makeFetch(() => ({ body: { namespaces: [] } }));
    const client = new SmitheryConnectionsClient({
      getApiKey: async () => 'sk-LEAKME',
      fetchImpl: impl,
      logger: {
        warn: (m, c) => logged.push([m, c]),
        debug: (m, c) => logged.push([m, c]),
      },
    });

    await client.listNamespaces();

    expect(calls[0].url).not.toContain('sk-LEAKME');
    expect(JSON.stringify(logged)).not.toContain('sk-LEAKME');
  });

  it('never logs a setupUrl', async () => {
    const logged: unknown[] = [];
    const { impl } = makeFetch(() => ({
      body: { connections: [HUBSPOT_CONNECTION] },
    }));
    const client = new SmitheryConnectionsClient({
      getApiKey: async () => 'k',
      fetchImpl: impl,
      logger: {
        warn: (m, c) => logged.push([m, c]),
        debug: (m, c) => logged.push([m, c]),
      },
    });

    await client.listConnections('ns');
    expect(JSON.stringify(logged)).not.toContain('one-time-token');
  });
});

describe('toSmitheryConnectionStatus', () => {
  it.each([
    ['connected', 'connected'],
    ['disconnected', 'disconnected'],
    ['auth_required', 'auth_required'],
    ['input_required', 'input_required'],
    ['error', 'error'],
  ])('maps the documented state %s through unchanged', (state, expected) => {
    expect(toSmitheryConnectionStatus(state)).toBe(expected);
  });

  it('maps an absent state to unknown', () => {
    expect(toSmitheryConnectionStatus(undefined)).toBe('unknown');
  });

  it('maps a state Smithery adds after this build to unknown', () => {
    expect(toSmitheryConnectionStatus('rate_limited')).toBe('unknown');
  });
});

describe('SmitheryApiError', () => {
  it('carries the status and keeps its name across a prototype loss', () => {
    const error = new SmitheryApiError(500, 'boom');
    expect(error.status).toBe(500);
    expect(error.name).toBe('SmitheryApiError');
    expect(error).toBeInstanceOf(Error);
  });
});
