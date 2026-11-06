/**
 * Unit tests for http-server.handler
 *
 * Uses a real http server on port 0 (OS-assigned) for lifecycle tests — mocking
 * Node's http module is brittle and hides wire-level bugs.
 */

import 'reflect-metadata';

import * as http from 'http';
import type { AddressInfo } from 'net';
import { EventEmitter, getEventListeners } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import type { AgentWaitResult } from '@ptah-extension/cli-agent-runtime';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  NX_ENTRY_CANDIDATES,
  runCheck,
  type CheckProcess,
  type SpawnCheckProcess,
} from '../mcp-core/run-check.tool';
import { runAgentWait } from '../mcp-core/agent-wait.tool';
import {
  AgentWaitArgsSchema,
  RunCheckArgsSchema,
} from '../mcp-core/wait-tools-args.schema';
import type {
  IStateStorage,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';

import {
  getConfiguredPort,
  getMcpPortCandidates,
  startHttpServer,
  stopHttpServer,
} from './http-server.handler';
import { McpCallerTokenRegistry } from './mcp-caller-token-registry';
import {
  MCP_AUTH_REQUIRED_MESSAGE,
  MCP_CALLER_FORBIDDEN_MESSAGE,
  MCP_CONTENT_TYPE_MESSAGE,
  MCP_TOOL_DENIED_MESSAGE,
  type McpHttpAuthInput,
  type McpRequestAuth,
} from '../mcp-core/mcp-caller-auth.types';
import type { MCPRequest, MCPResponse } from '../types';
import { mcpAttachmentObserver } from './mcp-attachment-observer';

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
  headers?: http.OutgoingHttpHeaders,
): Promise<{
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: 'localhost',
        port,
        method,
        path,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
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

describe('getMcpPortCandidates', () => {
  it('returns the configured port and next two valid ports', () => {
    expect(getMcpPortCandidates(51820)).toEqual([51820, 51821, 51822]);
  });

  it('does not overflow the valid TCP port range', () => {
    expect(getMcpPortCandidates(65535)).toEqual([65535]);
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

  it('retries on the next deterministic port when configured port is already in use', async () => {
    // Occupy a port first. An OS-assigned port has room for the next two candidates.
    const occupier = http.createServer();
    await new Promise<void>((resolve) =>
      occupier.listen(0, 'localhost', resolve),
    );
    const occupiedPort = (occupier.address() as AddressInfo).port;

    try {
      const result = await startHttpServer({
        port: occupiedPort,
        logger,
        workspaceState: state,
        onMCPRequest: jest.fn(),
      });
      server = result.server;

      expect(result.port).toBe(occupiedPort + 1);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        `MCP port ${occupiedPort} (EADDRINUSE) unavailable; ` +
          `another running Ptah instance is most likely already listening there. ` +
          `Started on port ${occupiedPort + 1} instead.`,
      );
    } finally {
      await new Promise<void>((resolve) => occupier.close(() => resolve()));
    }
  });

  // TASK_2026_354: every candidate port is attempted against the SAME
  // `http.Server`. The success callback used to be handed to
  // `server.listen(port, host, cb)`, which registers a ONE-TIME 'listening'
  // listener — and "one-time" only consumes it when it fires. A candidate that
  // failed with EADDRINUSE left its listener attached, so the next candidate's
  // single 'listening' event reached both: the started line was logged, and
  // `ptah.mcp.port` written, once per ATTEMPTED port. That is the duplicate
  // pair at tmp/logs/log.log:551-552.
  it('logs the started line exactly once even after a port fallback', async () => {
    const occupier = http.createServer();
    await new Promise<void>((resolve) =>
      occupier.listen(0, 'localhost', resolve),
    );
    const occupiedPort = (occupier.address() as AddressInfo).port;

    try {
      const result = await startHttpServer({
        port: occupiedPort,
        logger,
        workspaceState: state,
        onMCPRequest: jest.fn(),
      });
      server = result.server;

      const startedLines = logger.info.mock.calls.filter(([message]) =>
        String(message).includes('CodeExecutionMCP server started'),
      );
      expect(startedLines).toHaveLength(1);
      expect(startedLines[0][0]).toBe(
        `CodeExecutionMCP server started on http://localhost:${result.port}`,
      );

      // The same leak wrote the port to workspace state twice.
      const portWrites = state.update.mock.calls.filter(
        ([key]) => key === 'ptah.mcp.port',
      );
      expect(portWrites).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve) => occupier.close(() => resolve()));
    }
  });

  it('tries no more than the configured port and next two ports after collisions', async () => {
    const first = http.createServer();
    await new Promise<void>((resolve) => first.listen(0, 'localhost', resolve));
    const basePort = (first.address() as AddressInfo).port;
    const second = http.createServer();
    const third = http.createServer();
    await new Promise<void>((resolve) =>
      second.listen(basePort + 1, 'localhost', resolve),
    );
    await new Promise<void>((resolve) =>
      third.listen(basePort + 2, 'localhost', resolve),
    );

    try {
      await expect(
        startHttpServer({
          port: basePort,
          logger,
          workspaceState: state,
          onMCPRequest: jest.fn(),
        }),
      ).rejects.toMatchObject({ code: 'EADDRINUSE' });
      // One warning per start, naming every port that was refused and the fact
      // that nothing was left to fall back to.
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        `MCP ports ${basePort} (EADDRINUSE), ${basePort + 1} (EADDRINUSE), ` +
          `${basePort + 2} (EADDRINUSE) unavailable; ` +
          `another running Ptah instance is most likely already listening there. ` +
          `No fallback port left - the MCP server did not start.`,
      );
      // The reader gets ASCII: a boot log piped through a legacy Windows
      // console renders typographic punctuation as mojibake.
      const [warning] = logger.warn.mock.calls[0];
      // eslint-disable-next-line no-control-regex
      expect(String(warning)).toMatch(/^[\x00-\x7F]*$/);
    } finally {
      await Promise.all(
        [first, second, third].map(
          (occupier) =>
            new Promise<void>((resolve) => occupier.close(() => resolve())),
        ),
      );
    }
  });
});

describe('HTTP request handling', () => {
  let logger: jest.Mocked<Logger>;
  let state: jest.Mocked<IStateStorage>;
  let server: http.Server | null = null;
  let port = 0;
  let onMCPRequest: jest.Mock<Promise<MCPResponse>, [MCPRequest]>;

  it('records successful initialize by URL agent id and bound port', async () => {
    const waiting = mcpAttachmentObserver.waitFor('lane-a', port, 1000);
    await fetchPath(
      port,
      'POST',
      '/agent/lane-a',
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    );
    expect(await waiting).toMatchObject({
      agentId: 'lane-a',
      port,
      method: 'initialize',
    });
    expect(mcpAttachmentObserver.get('lane-b', port)).toBeUndefined();
    await fetchPath(
      port,
      'POST',
      '/agent/bad%2Fid',
      JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'initialize' }),
    );
    expect(mcpAttachmentObserver.get('bad/id', port)).toBeUndefined();
    await fetchPath(
      port,
      'POST',
      '/agent/lane-b',
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call' }),
    );
    expect(mcpAttachmentObserver.get('lane-b', port)).toBeUndefined();
    onMCPRequest.mockResolvedValueOnce({
      jsonrpc: '2.0',
      id: 3,
      error: { code: -1, message: 'bad' },
    });
    await fetchPath(
      port,
      'POST',
      '/agent/lane-b',
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'initialize' }),
    );
    expect(mcpAttachmentObserver.get('lane-b', port)).toBeUndefined();
    mcpAttachmentObserver.clear();
  });

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

  it('rejects OPTIONS with 403 and sets no CORS headers', async () => {
    const { status, body, headers } = await fetchPath(port, 'OPTIONS', '/');
    expect(status).toBe(403);
    expect(body).toBe('');
    expect(headers['access-control-allow-origin']).toBeUndefined();
    expect(headers['access-control-allow-methods']).toBeUndefined();
    expect(headers['access-control-allow-headers']).toBeUndefined();
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

  it.each([
    ['a JSON scalar', '42'],
    ['a missing method', JSON.stringify({ jsonrpc: '2.0', id: 1 })],
    [
      'a non-string method',
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 7 }),
    ],
    [
      'the wrong JSON-RPC version',
      JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'tools/list' }),
    ],
  ])('returns a fixed Invalid Request response for %s', async (_case, input) => {
    const { status, body } = await fetchPath(port, 'POST', '/', input);

    expect(status).toBe(400);
    expect(JSON.parse(body)).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' },
    });
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

  // -------------------------------------------------------------------------
  // Caller-workspace URL grammar (TASK_2026_364, Batch A).
  //
  // The accepted grammar is CLOSED. Exactly four shapes parse:
  //   /                               → anonymous (neither field stamped)
  //   /session/{id}                   → session only
  //   /workspace/{root}               → workspace only
  //   /session/{id}/workspace/{root}  → both — the ONLY combined order
  // An optional terminal /profile/{name} may follow these shapes (TASK_2026_595).
  // Invalid trailing path segments still leave the workspace unset.
  // -------------------------------------------------------------------------

  const toolsCallBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
  });

  it.each([
    ['/session/s1/profile/apps', 's1', undefined, undefined, 'apps'],
    [
      '/agent/a1/workspace/D%3A%5Cx/profile/apps',
      undefined,
      'a1',
      'D:\\x',
      'apps',
    ],
    ['/workspace/w/profile/apps/', undefined, undefined, 'w', 'apps'],
    ['/workspace/w/profile/apps?x=1', undefined, undefined, 'w', 'apps'],
    ['/profile/apps', undefined, undefined, undefined, 'apps'],
    ['/profile/%61pps', undefined, undefined, undefined, 'apps'],
    ['/profile/admin', undefined, undefined, undefined, 'admin'],
    ['/profile/apps/session/s1', undefined, undefined, undefined, undefined],
    ['/session/profile/apps', 'profile', undefined, undefined, undefined],
    ['/workspace/w/profile', undefined, undefined, undefined, undefined],
  ])(
    'parses the closed profile grammar: %s',
    async (url, session, agent, workspace, profile) => {
      await fetchPath(port, 'POST', url as string, toolsCallBody);
      const call = onMCPRequest.mock.calls[0][0];
      expect(call._callerSessionId).toBe(session);
      expect(call._callerAgentId).toBe(agent);
      expect(call._callerWorkspaceRoot).toBe(workspace);
      expect(call._callerToolProfile).toBe(profile);
    },
  );

  it('drops a forged body profile when the URL carries none', async () => {
    await fetchPath(
      port,
      'POST',
      '/session/s1',
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        _callerToolProfile: 'apps',
      }),
    );
    expect(onMCPRequest.mock.calls[0][0]._callerToolProfile).toBeUndefined();
  });

  it.each(['/profile/%ZZ', '/profile/%E0%A4', '/session/s1/profile/%E0%A4'])(
    'returns a parse error for an invalid profile escape: %s',
    async (url) => {
      const response = await fetchPath(port, 'POST', url, toolsCallBody);
      expect(response.status).toBe(400);
      expect((JSON.parse(response.body) as MCPResponse).error?.code).toBe(
        -32700,
      );
      expect(onMCPRequest).not.toHaveBeenCalled();
    },
  );

  it('stamps _callerWorkspaceRoot from /workspace/{root} and leaves the session unset', async () => {
    await fetchPath(port, 'POST', '/workspace/ws-plain', toolsCallBody);
    const call = onMCPRequest.mock.calls[0][0];
    expect(call._callerWorkspaceRoot).toBe('ws-plain');
    expect(call._callerSessionId).toBeUndefined();
  });

  it('round-trips an encodeURIComponent-encoded Windows workspace root exactly', async () => {
    const windowsRoot = 'D:\\projects\\ptah-extension';
    await fetchPath(
      port,
      'POST',
      `/workspace/${encodeURIComponent(windowsRoot)}`,
      toolsCallBody,
    );
    const call = onMCPRequest.mock.calls[0][0];
    expect(call._callerWorkspaceRoot).toBe(windowsRoot);
  });

  it('stamps both fields from /session/{id}/workspace/{root} — the only combined order', async () => {
    const windowsRoot = 'D:\\projects\\ptah-extension';
    await fetchPath(
      port,
      'POST',
      `/session/tab-abc/workspace/${encodeURIComponent(windowsRoot)}`,
      toolsCallBody,
    );
    const call = onMCPRequest.mock.calls[0][0];
    expect(call._callerSessionId).toBe('tab-abc');
    expect(call._callerWorkspaceRoot).toBe(windowsRoot);
  });

  it('does not stamp _callerWorkspaceRoot from a session-only URL', async () => {
    await fetchPath(port, 'POST', '/session/tab-abc', toolsCallBody);
    const call = onMCPRequest.mock.calls[0][0];
    expect(call._callerSessionId).toBe('tab-abc');
    expect(call._callerWorkspaceRoot).toBeUndefined();
  });

  it('REJECTS the reversed order /workspace/{root}/session/{id} entirely', async () => {
    // Neither field parses: the session segment is not leading and the
    // workspace segment is not terminal. Half-parsing this shape would
    // attribute the call to a workspace while dropping the session silently.
    await fetchPath(
      port,
      'POST',
      '/workspace/ws-x/session/tab-abc',
      toolsCallBody,
    );
    const call = onMCPRequest.mock.calls[0][0];
    expect(call._callerSessionId).toBeUndefined();
    expect(call._callerWorkspaceRoot).toBeUndefined();
  });

  it('REJECTS a workspace segment behind an unknown prefix', async () => {
    await fetchPath(port, 'POST', '/other/workspace/ws-x', toolsCallBody);
    const call = onMCPRequest.mock.calls[0][0];
    expect(call._callerWorkspaceRoot).toBeUndefined();
  });

  it('REJECTS trailing path segments after the workspace root', async () => {
    await fetchPath(port, 'POST', '/workspace/ws-x/extra', toolsCallBody);
    const call = onMCPRequest.mock.calls[0][0];
    expect(call._callerWorkspaceRoot).toBeUndefined();
  });

  it('accepts a trailing slash and a query string after the workspace root', async () => {
    await fetchPath(port, 'POST', '/workspace/ws-x/?probe=1', toolsCallBody);
    const call = onMCPRequest.mock.calls[0][0];
    expect(call._callerWorkspaceRoot).toBe('ws-x');
  });

  // --- /agent/{id} — spawned-agent identity (TASK_2026_402) ----------------

  it('stamps both fields from /agent/{id}/workspace/{root} — the only combined order', async () => {
    const windowsRoot = 'D:\\projects\\ptah-extension';
    await fetchPath(
      port,
      'POST',
      `/agent/agent-abc/workspace/${encodeURIComponent(windowsRoot)}`,
      toolsCallBody,
    );
    const call = onMCPRequest.mock.calls[0][0];
    expect(call._callerAgentId).toBe('agent-abc');
    expect(call._callerWorkspaceRoot).toBe(windowsRoot);
    // A spawned agent carries no session id — the two leading kinds are
    // mutually exclusive.
    expect(call._callerSessionId).toBeUndefined();
  });

  it('stamps _callerAgentId from an agent-only URL', async () => {
    await fetchPath(port, 'POST', '/agent/agent-abc', toolsCallBody);
    const call = onMCPRequest.mock.calls[0][0];
    expect(call._callerAgentId).toBe('agent-abc');
    expect(call._callerWorkspaceRoot).toBeUndefined();
  });

  it('URL-decodes an agent id containing encoded separators', async () => {
    await fetchPath(
      port,
      'POST',
      `/agent/${encodeURIComponent('a/b?c')}/workspace/ws-x`,
      toolsCallBody,
    );
    const call = onMCPRequest.mock.calls[0][0];
    expect(call._callerAgentId).toBe('a/b?c');
    expect(call._callerWorkspaceRoot).toBe('ws-x');
  });

  it('does not stamp _callerAgentId when the URL carries no /agent/ prefix', async () => {
    await fetchPath(port, 'POST', '/workspace/ws-x', toolsCallBody);
    const call = onMCPRequest.mock.calls[0][0];
    expect(call._callerAgentId).toBeUndefined();
  });

  it('REJECTS the reversed order /workspace/{root}/agent/{id} entirely', async () => {
    // Neither field parses: the agent segment is not leading and the workspace
    // segment is not terminal. Half-parsing this shape would hand
    // `ptah_agent_report` an identity the URL grammar never sanctioned.
    await fetchPath(
      port,
      'POST',
      '/workspace/ws-x/agent/agent-abc',
      toolsCallBody,
    );
    const call = onMCPRequest.mock.calls[0][0];
    expect(call._callerAgentId).toBeUndefined();
    expect(call._callerWorkspaceRoot).toBeUndefined();
  });

  it('REJECTS an agent segment behind an unknown prefix', async () => {
    await fetchPath(port, 'POST', '/other/agent/agent-abc', toolsCallBody);
    const call = onMCPRequest.mock.calls[0][0];
    expect(call._callerAgentId).toBeUndefined();
  });

  it('REJECTS /agent/{id}/session/{id} — the session segment must lead', async () => {
    await fetchPath(
      port,
      'POST',
      '/agent/agent-abc/session/tab-x',
      toolsCallBody,
    );
    const call = onMCPRequest.mock.calls[0][0];
    expect(call._callerAgentId).toBe('agent-abc');
    expect(call._callerSessionId).toBeUndefined();
    expect(call._callerWorkspaceRoot).toBeUndefined();
  });
});

/**
 * Task 10.1 regression: a caller that drops the connection before the reply
 * aborts `request._abortSignal`, which stops `run_check` (tree kill) and
 * `agent_wait` (listener removed). A completed reply never aborts.
 */
describe('request abort on early close', () => {
  class FakeProcess extends EventEmitter {
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    readonly pid = 5150;
  }

  let server: http.Server | null = null;
  let root: string;
  const logger = createLogger();
  const state = createStateStorage();

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ptah-http-abort-'));
  });

  afterEach(async () => {
    await stopHttpServer(server, state, logger);
    server = null;
    rmSync(root, { recursive: true, force: true });
  });

  async function serve(
    onMCPRequest: (request: MCPRequest) => Promise<MCPResponse>,
  ): Promise<number> {
    const result = await startHttpServer({
      port: 0,
      logger,
      workspaceState: state,
      onMCPRequest,
    });
    server = result.server;
    return (server.address() as AddressInfo).port;
  }

  /** POST a tools/call and destroy the socket once `ready` resolves. */
  function postThenDrop(port: number, ready: Promise<void>): void {
    const req = http.request({
      host: 'localhost',
      port,
      method: 'POST',
      path: '/',
      headers: { 'Content-Type': 'application/json' },
    });
    req.on('error', () => undefined);
    req.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {},
      }),
    );
    void ready.then(() => req.destroy());
  }

  async function until(check: () => boolean): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (!check() && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(check()).toBe(true);
  }

  it('kills the run_check tree when the connection closes mid-run', async () => {
    const entry = join(root, ...NX_ENTRY_CANDIDATES[0]);
    mkdirSync(join(entry, '..'), { recursive: true });
    writeFileSync(entry, '');
    const child = new FakeProcess();
    let spawned!: () => void;
    const spawnedPromise = new Promise<void>((r) => (spawned = r));
    const killTree = jest.fn(async () => {
      child.stdout.end();
      child.stderr.end();
      setImmediate(() => child.emit('close', null, 'SIGTERM'));
    });
    let verdict: string | undefined;

    const port = await serve(async (request) => {
      const outcome = await runCheck(
        RunCheckArgsSchema.parse({ project: 'app', targets: ['test'] }),
        {
          workspaceRoot: root,
          spawnProcess: (() => {
            setImmediate(spawned);
            return child as unknown as CheckProcess;
          }) as unknown as SpawnCheckProcess,
          killTree,
          signal: request._abortSignal,
        },
      );
      verdict = outcome.structured.verdict;
      return { jsonrpc: '2.0', id: request.id, result: {} };
    });
    postThenDrop(port, spawnedPromise);

    await until(() => verdict !== undefined);
    expect(killTree).toHaveBeenCalledWith(5150);
    expect(verdict).toBe('cancelled');
  });

  it('ends agent_wait and removes its abort listener when the connection closes', async () => {
    let waiting!: () => void;
    const waitingPromise = new Promise<void>((r) => (waiting = r));
    let signalSeen: AbortSignal | undefined;
    let text: string | undefined;

    const port = await serve(async (request) => {
      text = await runAgentWait(
        AgentWaitArgsSchema.parse({ agentIds: ['a1'] }),
        {
          waitForAgents: (ids, mode, _timeoutMs, signal) =>
            new Promise<AgentWaitResult>((resolve) => {
              signalSeen = signal;
              const onAbort = (): void => {
                signal?.removeEventListener('abort', onAbort);
                resolve({
                  mode,
                  timedOut: false,
                  cancelled: true,
                  waitedMs: 1,
                  entries: ids.map((agentId) => ({
                    agentId,
                    state: 'running' as const,
                    info: { agentId, status: 'running' } as never,
                  })),
                } as unknown as AgentWaitResult);
              };
              signal?.addEventListener('abort', onAbort, { once: true });
              waiting();
            }),
          readOutput: async () => ({ stdout: '', stderr: '' }) as never,
          signal: request._abortSignal,
        },
      );
      return { jsonrpc: '2.0', id: request.id, result: {} };
    });
    postThenDrop(port, waitingPromise);

    await until(() => text !== undefined);
    expect(signalSeen?.aborted).toBe(true);
    expect(getEventListeners(signalSeen as AbortSignal, 'abort')).toHaveLength(
      0,
    );
    expect(text).toContain('WAIT CANCELLED');
  });

  it('does not abort a request whose reply was written', async () => {
    let seen: AbortSignal | undefined;
    const port = await serve(async (request) => {
      seen = request._abortSignal;
      return { jsonrpc: '2.0', id: request.id, result: {} };
    });
    const res = await fetchPath(
      port,
      'POST',
      '/',
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    );
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen?.aborted).toBe(false);
  });

  it('never takes the signal from the request body', async () => {
    let seen: unknown;
    const port = await serve(async (request) => {
      seen = request._abortSignal;
      return { jsonrpc: '2.0', id: request.id, result: {} };
    });
    await fetchPath(
      port,
      'POST',
      '/',
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
        _abortSignal: { aborted: true },
      }),
    );
    expect(seen).toBeInstanceOf(AbortSignal);
    expect((seen as AbortSignal).aborted).toBe(false);
  });
});

describe('HTTP caller authentication', () => {
  let server: http.Server | null = null;
  let port = 0;
  const logger = createLogger();
  const state = createStateStorage();
  let onMCPRequest: jest.Mock<Promise<MCPResponse>, [MCPRequest]>;
  const credentialLogger = {
    debug(): void {
      return undefined;
    },
    info(): void {
      return undefined;
    },
    warn(): void {
      return undefined;
    },
    error(): void {
      return undefined;
    },
  };
  const jsonBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 9,
    method: 'initialize',
  });

  beforeEach(() => {
    onMCPRequest = jest.fn(async (request: MCPRequest) => ({
      jsonrpc: '2.0' as const,
      id: request.id,
      result: { method: request.method },
    }));
  });

  afterEach(async () => {
    if (server) {
      await stopHttpServer(server, state, logger);
      server = null;
    }
  });

  async function listen(
    authenticate?: (input: McpHttpAuthInput) => McpRequestAuth,
  ): Promise<void> {
    const result = await startHttpServer({
      port: 0,
      logger,
      workspaceState: state,
      onMCPRequest,
      ...(authenticate === undefined ? {} : { authenticate }),
    });
    server = result.server;
    port = result.port;
  }

  function seenRequest(): MCPRequest {
    const request = onMCPRequest.mock.calls[0]?.[0];
    if (request === undefined) {
      throw new Error('expected an MCP request');
    }
    return request;
  }

  it('rejects a non-loopback Host with an empty 403 and no CORS', async () => {
    await listen();
    const { status, body, headers } = await fetchPath(
      port,
      'POST',
      '/',
      jsonBody,
      { host: 'evil.example' },
    );
    expect(status).toBe(403);
    expect(body).toBe('');
    expect(headers['access-control-allow-origin']).toBeUndefined();
    expect(onMCPRequest).not.toHaveBeenCalled();
  });

  it('rejects a loopback Host that names a different port', async () => {
    await listen();
    const { status, body } = await fetchPath(port, 'POST', '/', jsonBody, {
      host: '127.0.0.1:1',
    });
    expect(status).toBe(403);
    expect(body).toBe('');
  });

  it('rejects a present Origin with an empty 403 and no CORS', async () => {
    await listen();
    const { status, body, headers } = await fetchPath(
      port,
      'POST',
      '/',
      jsonBody,
      { origin: 'http://evil.example' },
    );
    expect(status).toBe(403);
    expect(body).toBe('');
    expect(headers['access-control-allow-origin']).toBeUndefined();
    expect(headers['access-control-allow-methods']).toBeUndefined();
  });

  it('rejects OPTIONS with an empty 403', async () => {
    await listen();
    const { status, body, headers } = await fetchPath(port, 'OPTIONS', '/');
    expect(status).toBe(403);
    expect(body).toBe('');
    expect(headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects a non-json content type with 415', async () => {
    await listen();
    const { status, body } = await fetchPath(port, 'POST', '/', jsonBody, {
      'content-type': 'text/plain',
    });
    expect(status).toBe(415);
    expect(JSON.parse(body)).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: MCP_CONTENT_TYPE_MESSAGE },
    });
    expect(onMCPRequest).not.toHaveBeenCalled();
  });

  it('accepts application/json with a charset on the grace path', async () => {
    await listen();
    const { status } = await fetchPath(port, 'POST', '/', jsonBody, {
      'content-type': 'application/json; charset=utf-8',
    });
    expect(status).toBe(200);
    expect(seenRequest()._callerCapability).toBe('read-only');
  });

  it('returns 401 for an unknown, expired, or revoked token', async () => {
    const clock = { now: 5_000 };
    const registry = new McpCallerTokenRegistry({
      logger: credentialLogger,
      now: () => clock.now,
    });
    const live = registry.issue(
      { kind: 'agent', agentId: 'lane-a', capability: 'privileged' },
      'lane-a',
      60_000,
    );
    const expired = registry.issue(
      { kind: 'agent', agentId: 'lane-a', capability: 'privileged' },
      'lane-old',
      -1,
    );
    const laneReport = registry.issue(
      { kind: 'agent', agentId: 'lane-report', capability: 'lane-report' },
      'lane-report',
      60_000,
    );
    registry.revokeSubject('lane-report');
    registry.revokeSubject('lane-a');
    await listen((input) => registry.authorize(input));

    for (const token of ['c'.repeat(43), expired, live, laneReport]) {
      const { status, body } = await fetchPath(
        port,
        'POST',
        '/agent/lane-a',
        jsonBody,
        { authorization: `Bearer ${token}` },
      );
      expect(status).toBe(401);
      expect(body).not.toContain(token);
      expect(JSON.parse(body)).toEqual({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32001, message: MCP_AUTH_REQUIRED_MESSAGE },
      });
    }
    expect(onMCPRequest).not.toHaveBeenCalled();
  });

  it('returns 403 when a valid token is presented on another identity', async () => {
    const registry = new McpCallerTokenRegistry({ logger: credentialLogger });
    const token = registry.issue(
      { kind: 'agent', agentId: 'lane-a', capability: 'privileged' },
      'lane-a',
      60_000,
    );
    await listen((input) => registry.authorize(input));
    const { status, body } = await fetchPath(
      port,
      'POST',
      '/agent/other',
      jsonBody,
      { authorization: `Bearer ${token}` },
    );
    expect(status).toBe(403);
    expect(body).not.toContain(token);
    expect(JSON.parse(body)).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32003, message: MCP_CALLER_FORBIDDEN_MESSAGE },
    });
    expect(onMCPRequest).not.toHaveBeenCalled();
  });

  it('returns 403 when a lane-report token names another agent', async () => {
    const registry = new McpCallerTokenRegistry({ logger: credentialLogger });
    const token = registry.issue(
      { kind: 'agent', agentId: 'lane-a', capability: 'lane-report' },
      'lane-a',
      60_000,
    );
    await listen((input) => registry.authorize(input));
    const reportBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'ptah_agent_report', arguments: { message: 'report' } },
    });
    const { status, body } = await fetchPath(
      port,
      'POST',
      '/agent/lane-b',
      reportBody,
      { authorization: `Bearer ${token}` },
    );
    expect(status).toBe(403);
    expect(JSON.parse(body).error.code).toBe(-32003);
    expect(onMCPRequest).not.toHaveBeenCalled();
  });

  it('strips /auth/{token} and stamps the session from the remaining path', async () => {
    const registry = new McpCallerTokenRegistry({ logger: credentialLogger });
    const token = registry.issue(
      { kind: 'session', sessionId: 'tab-1', capability: 'read-only' },
      'tab-1',
      60_000,
    );
    await listen((input) => registry.authorize(input));
    const { status } = await fetchPath(
      port,
      'POST',
      `/auth/${token}/session/tab-1`,
      jsonBody,
    );
    expect(status).toBe(200);
    const request = seenRequest();
    expect(request._callerSessionId).toBe('tab-1');
    expect(request._callerCapability).toBe('read-only');
    expect(request._callerBinding).toMatchObject({
      kind: 'session',
      sessionId: 'tab-1',
      capability: 'read-only',
    });
  });

  it('does not authenticate a token that is only in the query string', async () => {
    const registry = new McpCallerTokenRegistry({ logger: credentialLogger });
    const token = registry.issue(
      { kind: 'session', sessionId: 'tab-1', capability: 'privileged' },
      'tab-1',
      60_000,
    );
    await listen((input) => registry.authorize(input));
    const { status } = await fetchPath(
      port,
      'POST',
      `/session/tab-1?token=${token}`,
      jsonBody,
    );
    expect(status).toBe(200);
    const request = seenRequest();
    expect(request._callerCapability).toBe('read-only');
    expect(request._callerSessionId).toBe('tab-1');
    expect(request._callerBinding?.capability).toBe('read-only');
  });

  it('accepts a legacy caller as read-only, including /agent and /profile/admin', async () => {
    await listen();
    const agent = await fetchPath(port, 'POST', '/agent/lane-a', jsonBody);
    expect(agent.status).toBe(200);
    expect(seenRequest()._callerCapability).toBe('read-only');
    expect(seenRequest()._callerAgentId).toBe('lane-a');
    expect(seenRequest()._callerBinding).toMatchObject({
      kind: 'agent',
      capability: 'read-only',
      agentId: 'lane-a',
    });

    const admin = await fetchPath(port, 'POST', '/profile/admin', jsonBody);
    expect(admin.status).toBe(200);
    expect(onMCPRequest.mock.calls[1]?.[0]?._callerToolProfile).toBe('admin');
    expect(onMCPRequest.mock.calls[1]?.[0]?._callerCapability).toBe(
      'read-only',
    );
  });

  it('maps a tool-permission JSON-RPC error to HTTP 403 and echoes the id', async () => {
    await listen();
    onMCPRequest.mockResolvedValue({
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32003, message: MCP_TOOL_DENIED_MESSAGE },
    });
    const { status, body } = await fetchPath(port, 'POST', '/', jsonBody);
    expect(status).toBe(403);
    expect(JSON.parse(body)).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32003, message: MCP_TOOL_DENIED_MESSAGE },
    });
  });
});
