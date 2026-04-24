/**
 * Unit tests for http-server.handler
 *
 * Uses a real http server on port 0 (OS-assigned) for lifecycle tests — mocking
 * Node's http module is brittle and hides wire-level bugs. For the EACCES
 * retry path we stub tryListen via a synthetic error.
 */

import 'reflect-metadata';

import * as http from 'http';
import type { AddressInfo } from 'net';

import type { Logger } from '@ptah-extension/vscode-core';
import type {
  IStateStorage,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';

import {
  getConfiguredPort,
  startHttpServer,
  stopHttpServer,
} from './http-server.handler';
import type { MCPRequest, MCPResponse } from '../types';

function createLogger(): jest.Mocked<Logger> {
  return {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function createStateStorage(): jest.Mocked<IStateStorage> {
  return {
    get: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
    keys: jest.fn(),
  } as unknown as jest.Mocked<IStateStorage>;
}

function createWorkspaceProvider(
  portValue: number | undefined,
): jest.Mocked<IWorkspaceProvider> {
  return {
    getConfiguration: jest.fn((_section, _key, fallback) =>
      portValue === undefined ? fallback : portValue,
    ),
  } as unknown as jest.Mocked<IWorkspaceProvider>;
}

// Helper: issue an HTTP request against a live server.
async function fetchPath(
  port: number,
  method: string,
  path: string,
  body?: string,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: 'localhost',
        port,
        method,
        path,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: data,
            headers: res.headers,
          }),
        );
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('getConfiguredPort', () => {
  it('returns configured port when present', () => {
    const provider = createWorkspaceProvider(54321);
    expect(getConfiguredPort(provider)).toBe(54321);
  });

  it('falls back to 51820 default when configuration is missing', () => {
    const provider = createWorkspaceProvider(undefined);
    expect(getConfiguredPort(provider)).toBe(51820);
    expect(provider.getConfiguration).toHaveBeenCalledWith(
      'ptah',
      'mcpPort',
      51820,
    );
  });

  it('falls back to 51820 when getConfiguration returns null', () => {
    const provider = {
      getConfiguration: jest.fn(() => null),
    } as unknown as jest.Mocked<IWorkspaceProvider>;
    expect(getConfiguredPort(provider)).toBe(51820);
  });
});

describe('HTTP server lifecycle', () => {
  let logger: jest.Mocked<Logger>;
  let state: jest.Mocked<IStateStorage>;
  let server: http.Server | null = null;

  beforeEach(() => {
    logger = createLogger();
    state = createStateStorage();
    server = null;
  });

  afterEach(async () => {
    if (server) {
      await stopHttpServer(server, state, logger);
      server = null;
    }
  });

  it('starts on an OS-assigned port and records it in state storage', async () => {
    const result = await startHttpServer({
      port: 0,
      logger,
      workspaceState: state,
      onMCPRequest: jest.fn(),
    });
    server = result.server;

    expect(result.port).toBeGreaterThan(0);
    expect(state.update).toHaveBeenCalledWith('ptah.mcp.port', result.port);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(`http://localhost:${result.port}`),
      'CodeExecutionMCP',
    );
  });

  it('clears port state on stop', async () => {
    const result = await startHttpServer({
      port: 0,
      logger,
      workspaceState: state,
      onMCPRequest: jest.fn(),
    });
    await stopHttpServer(result.server, state, logger);
    server = null; // already stopped

    expect(state.update).toHaveBeenCalledWith('ptah.mcp.port', undefined);
    expect(logger.info).toHaveBeenCalledWith(
      'CodeExecutionMCP server stopped',
      'CodeExecutionMCP',
    );
  });

  it('stopHttpServer is a no-op when server is null', async () => {
    await expect(stopHttpServer(null, state, logger)).resolves.toBeUndefined();
    expect(state.update).not.toHaveBeenCalled();
  });

  it('retries with port 0 when configured port is already in use (EADDRINUSE)', async () => {
    // Occupy a port first.
    const occupier = http.createServer();
    await new Promise<void>((resolve) => occupier.listen(0, 'localhost', resolve));
    const occupiedPort = (occupier.address() as AddressInfo).port;

    try {
      const result = await startHttpServer({
        port: occupiedPort,
        logger,
        workspaceState: state,
        onMCPRequest: jest.fn(),
      });
      server = result.server;

      expect(result.port).not.toBe(occupiedPort);
      expect(result.port).toBeGreaterThan(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('unavailable'),
      );
    } finally {
      await new Promise<void>((resolve) => occupier.close(() => resolve()));
    }
  });
});

describe('HTTP request handling', () => {
  let logger: jest.Mocked<Logger>;
  let state: jest.Mocked<IStateStorage>;
  let server: http.Server | null = null;
  let port = 0;
  let onMCPRequest: jest.Mock<Promise<MCPResponse>, [MCPRequest]>;

  beforeEach(async () => {
    logger = createLogger();
    state = createStateStorage();
    onMCPRequest = jest.fn(async (req: MCPRequest) => ({
      jsonrpc: '2.0' as const,
      id: req.id,
      result: { echoed: req.method },
    }));
    const result = await startHttpServer({
      port: 0,
      logger,
      workspaceState: state,
      onMCPRequest,
    });
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    if (server) {
      await stopHttpServer(server, state, logger);
      server = null;
    }
  });

  it('sets CORS headers and handles OPTIONS preflight with 204', async () => {
    const { status, headers } = await fetchPath(port, 'OPTIONS', '/');
    expect(status).toBe(204);
    expect(headers['access-control-allow-origin']).toBe('http://localhost');
    expect(headers['access-control-allow-methods']).toContain('POST');
    expect(headers['access-control-allow-headers']).toContain('Content-Type');
  });

  it('responds 200 with status ok on GET /health', async () => {
    const { status, body } = await fetchPath(port, 'GET', '/health');
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ status: 'ok' });
  });

  it('responds 200 with status ok on GET / root probe', async () => {
    const { status, body } = await fetchPath(port, 'GET', '/');
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ status: 'ok' });
  });

  it('returns 405 Method Not Allowed for non-POST, non-GET methods', async () => {
    const { status, body } = await fetchPath(port, 'PUT', '/');
    expect(status).toBe(405);
    expect(JSON.parse(body)).toEqual({ error: 'Method not allowed' });
  });

  it('routes POST requests through onMCPRequest handler', async () => {
    const { status, body } = await fetchPath(
      port,
      'POST',
      '/',
      JSON.stringify({
        jsonrpc: '2.0',
        id: 42,
        method: 'tools/list',
      }),
    );
    expect(status).toBe(200);
    expect(onMCPRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42, method: 'tools/list' }),
    );
    const parsed = JSON.parse(body) as MCPResponse;
    expect(parsed.id).toBe(42);
    expect(parsed.result).toEqual({ echoed: 'tools/list' });
  });

  it('returns 204 for JSON-RPC notifications (no id field)', async () => {
    const { status, body } = await fetchPath(
      port,
      'POST',
      '/',
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    );
    expect(status).toBe(204);
    expect(body).toBe('');
    expect(onMCPRequest).not.toHaveBeenCalled();
  });

  it('stamps _callerSessionId from /session/{id} URL onto request', async () => {
    await fetchPath(
      port,
      'POST',
      '/session/tab-abc',
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
      }),
    );
    expect(onMCPRequest).toHaveBeenCalledWith(
      expect.objectContaining({ _callerSessionId: 'tab-abc' }),
    );
  });

  it('URL-decodes session IDs with special characters', async () => {
    await fetchPath(
      port,
      'POST',
      '/session/tab%20one',
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
      }),
    );
    expect(onMCPRequest).toHaveBeenCalledWith(
      expect.objectContaining({ _callerSessionId: 'tab one' }),
    );
  });

  it('returns 400 parse error for malformed JSON', async () => {
    const { status, body } = await fetchPath(port, 'POST', '/', '{not json');
    expect(status).toBe(400);
    const parsed = JSON.parse(body) as MCPResponse;
    expect(parsed.error).toBeDefined();
    expect(parsed.error?.code).toBe(-32700);
    expect(parsed.error?.message).toBe('Parse error');
    expect(onMCPRequest).not.toHaveBeenCalled();
  });

  it('does not stamp _callerSessionId when URL path has no /session/ prefix', async () => {
    await fetchPath(
      port,
      'POST',
      '/other/path',
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
      }),
    );
    const call = onMCPRequest.mock.calls[0][0];
    expect(call._callerSessionId).toBeUndefined();
  });
});
