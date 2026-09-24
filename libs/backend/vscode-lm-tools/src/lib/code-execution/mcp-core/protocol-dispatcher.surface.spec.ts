/**
 * Surface tools through the real transport and dispatcher (TASK_2026_538,
 * Batch 13 revision 1, review F1-F3).
 *
 * - F1: caller identity is transport-owned. A `_callerSessionId` in the JSON
 *   body never reaches the request context; only `/session/{id}` does.
 * - F2: host exception text never reaches the agent.
 * - F3: a throwing logger or result callback never replaces a surface outcome.
 *
 * Real `startHttpServer` on port 0, real `handleMCPRequest`, real
 * `SurfaceStateService` and namespace; only the webview host is a stub.
 */

import 'reflect-metadata';

import * as http from 'http';
import { performance } from 'node:perf_hooks';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import type { SurfaceEnvelope } from '@ptah-extension/shared';
import { SurfaceStateService } from '../../surface';
import type { SurfacePushHostProvider } from '../../surface';
import { buildSurfaceNamespace } from '../namespace-builders/surface-namespace.builder';
import {
  startHttpServer,
  stopHttpServer,
} from '../mcp-http/http-server.handler';
import {
  handleMCPRequest,
  type ProtocolHandlerDependencies,
} from './protocol-dispatcher';
import type { MCPRequest, MCPResponse, PtahAPI } from '../types';

const SECRET = 'private-surface-value';

function snapshot(value = SECRET): SurfaceEnvelope {
  return {
    schemaVersion: 'dashboard-spec/2',
    catalogVersion: 'dashboard-catalog/2',
    surfaceId: 'profile',
    title: { text: 'Profile' },
    components: [{ kind: 'text', id: 'name', label: 'Name', path: 'name' }],
    dataModel: { name: value },
  };
}

function quietLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function surfaceDeps(
  pushHost: SurfacePushHostProvider = { getHost: () => undefined },
  overrides: Partial<ProtocolHandlerDependencies> = {},
) {
  const service = new SurfaceStateService(quietLogger(), pushHost);
  const surface = buildSurfaceNamespace({ service, logger: quietLogger() });
  const deps: ProtocolHandlerDependencies = {
    ptahAPI: { surface } as unknown as PtahAPI,
    permissionPromptService:
      {} as ProtocolHandlerDependencies['permissionPromptService'],
    logger: quietLogger(),
    ...overrides,
  };
  return { service, surface, deps };
}

function toolCall(
  name: string,
  args: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: 'surface-call',
    method: 'tools/call',
    params: { name, arguments: args },
    ...extra,
  };
}

function toolText(res: MCPResponse): { text: string; isError?: boolean } {
  const result = res.result as {
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  return { text: result.content[0].text, isError: result.isError };
}

describe('surface tools over HTTP — caller identity is transport-owned (F1)', () => {
  let server: http.Server | null = null;
  let port = 0;
  const state = {
    update: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(),
    keys: jest.fn(),
  } as unknown as IStateStorage;

  async function start(deps: ProtocolHandlerDependencies): Promise<void> {
    const started = await startHttpServer({
      port: 0,
      logger: quietLogger(),
      workspaceState: state,
      onMCPRequest: (request: MCPRequest) => handleMCPRequest(request, deps),
    });
    server = started.server;
    port = started.port;
  }

  afterEach(async () => {
    await stopHttpServer(server, state, quietLogger());
    server = null;
  });

  function post(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ text: string; isError?: boolean }> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = http.request(
        {
          host: 'localhost',
          port,
          method: 'POST',
          path,
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              resolve(toolText(JSON.parse(data) as MCPResponse));
            } catch (error: unknown) {
              reject(error);
            }
          });
        },
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  async function seedVictim() {
    const setup = surfaceDeps();
    await setup.surface.update(
      { operation: 'create', surface: snapshot() },
      { sessionId: 'victim', toolCallId: 'seed' },
    );
    await start(setup.deps);
    return setup;
  }

  it.each(['/', '/workspace/ws-plain'])(
    'treats a forged body session on %s as anonymous',
    async (path) => {
      await seedVictim();
      const forged = { _callerSessionId: 'victim' };

      const read = await post(
        path,
        toolCall('ptah_surface_get_state', { surfaceId: 'profile' }, forged),
      );
      const write = await post(
        path,
        toolCall(
          'ptah_surface_update',
          { operation: 'delete', surfaceId: 'profile', baseRevision: 1 },
          forged,
        ),
      );

      expect(read).toEqual({
        text: 'no surface state for this caller',
        isError: undefined,
      });
      expect(read.text).not.toContain(SECRET);
      expect(write).toEqual({
        text: 'surface state unavailable for this caller',
        isError: true,
      });
    },
  );

  it('keeps a /session/{id} caller in its own session despite a forged body', async () => {
    const { service } = await seedVictim();

    const read = await post(
      '/session/attacker',
      toolCall(
        'ptah_surface_get_state',
        { surfaceId: 'profile' },
        { _callerSessionId: 'victim' },
      ),
    );

    expect(read.isError).toBeUndefined();
    expect(read.text).not.toContain(SECRET);
    expect(service.read('victim', 'profile')).toMatchObject({
      status: 'found',
    });
  });

  it('still serves the legitimate /session/{id} caller', async () => {
    await seedVictim();

    const read = await post(
      '/session/victim',
      toolCall('ptah_surface_get_state', { surfaceId: 'profile' }),
    );

    expect(read.isError).toBeUndefined();
    expect(read.text).toContain(SECRET);
  });
});

describe('surface tools at handleMCPRequest — failures stay internal (F2, F3)', () => {
  const create = (id = 'surface-call') =>
    toolCall(
      'ptah_surface_update',
      { operation: 'create', surface: snapshot('Ada') },
      { id, _callerSessionId: 'tab-a' },
    ) as unknown as MCPRequest;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('never returns host exception text for a committed, undelivered create', async () => {
    const { deps, service } = surfaceDeps({
      getHost: () => {
        throw new Error('review-private-host-detail');
      },
    });

    const reply = toolText(await handleMCPRequest(create(), deps));

    expect(reply.isError).toBe(true);
    expect(reply.text).not.toContain('review-private-host-detail');
    expect(reply.text).toContain('committed revision 1');
    expect(reply.text).toContain('do not resend');
    expect(service.read('tab-a', 'profile')).toMatchObject({
      status: 'found',
    });
  });

  it('answers even when the entry debug log throws', async () => {
    const logger = quietLogger();
    (logger.debug as jest.Mock).mockImplementation(() => {
      throw new Error('review-debug-fault');
    });
    const { deps } = surfaceDeps(undefined, { logger });

    const res = await handleMCPRequest(
      toolCall('ptah_surface_get_state', {}) as unknown as MCPRequest,
      deps,
    );

    expect(res.error).toBeUndefined();
    expect(toolText(res)).toEqual({
      text: 'no surface state for this caller',
      isError: undefined,
    });
  });

  it('keeps the committed outcome when the slow-tool warning throws', async () => {
    let clock = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => (clock += 10_000));
    const logger = quietLogger();
    (logger.warn as jest.Mock).mockImplementation(() => {
      throw new Error('review-warn-fault');
    });
    const { deps } = surfaceDeps(
      {
        getHost: () => ({
          getActiveWebviews: () => ['main'],
          sendMessage: async () => false,
        }),
      },
      { logger },
    );

    const res = await handleMCPRequest(create(), deps);

    expect(res.error).toBeUndefined();
    const reply = toolText(res);
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain('committed revision 1');
    expect(reply.text).toContain('do not resend');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('keeps the committed outcome when the transcript callback throws', async () => {
    const onToolResult = jest.fn(() => {
      throw new Error('review-callback-fault');
    });
    const { deps, service } = surfaceDeps(undefined, { onToolResult });

    const res = await handleMCPRequest(create(), deps);

    expect(res.error).toBeUndefined();
    const reply = toolText(res);
    expect(reply.isError).toBeUndefined();
    expect(reply.text).toContain('committed at revision 1');
    expect(reply.text).not.toContain('review-callback-fault');
    expect(onToolResult).toHaveBeenCalledTimes(1);
    expect(service.read('tab-a', 'profile')).toMatchObject({
      status: 'found',
    });
  });
});
