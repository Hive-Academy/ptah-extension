/**
 * Stdio MCP server — unit specs.
 *
 * Phase 3 coverage (this revision):
 *   1. `handleInitialize` returns the canonical MCP 2024-11-05 envelope.
 *   2. `handleToolsList` returns exactly the 7 MVP tool definitions with
 *      MCP-wire names (no `ptah_` prefix); the `allowedTools` filter
 *      narrows the catalog; an empty filter is ignored.
 *   3. `handleToolsCall` routes the six `agent_*` tools through the
 *      `AgentToolDispatcher`, calling the underlying `PtahAPI.agent.*`
 *      methods and surfacing the MCP result envelope.
 *   4. `handleToolsCall` returns -32602 / `mcp_invalid_tool_args` for a
 *      missing or non-string `name`.
 *   5. `handleToolsCall` returns `isError:true` / `mcp_tool_not_found`
 *      for unknown tool names.
 *   6. `handleToolsCall` returns `sdk_init_failed` for `session_submit`
 *      when no handler is registered, and delegates to the registered
 *      handler when one is set.
 *   7. `handleCancelled` forwards the requestId to the registered
 *      session-submit handler when present.
 *   8. `StdioTransport` only forwards notifications between `start()` and
 *      `stop()`.
 */

import 'reflect-metadata';

jest.mock('@ptah-extension/vscode-core', () => ({
  TOKENS: {
    LOGGER: Symbol.for('Logger'),
    PTAH_API_BUILDER: Symbol.for('PtahAPIBuilder'),
  },
}));

import type { Logger } from '@ptah-extension/vscode-core';
import { StdioMcpServerService } from './stdio-mcp-server.service';
import { StdioTransport, type McpStdioNotifier } from './stdio-transport';
import { MCP_MVP_TOOL_NAMES } from './tool-builders';
import type { MCPRequest } from '../mcp-core/types/mcp-protocol.types';
import type { PtahAPIBuilder } from '../ptah-api-builder.service';
import type { PtahAPI } from '../types';
import type { ISessionSubmitHandler } from './session-submit.port';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeAgentApi(
  overrides: Partial<PtahAPI['agent']> = {},
): PtahAPI['agent'] {
  return {
    spawn: jest.fn().mockResolvedValue({
      agentId: 'a-1',
      cli: 'gemini',
      status: 'running',
      startedAt: '2026-05-24T00:00:00Z',
    }),
    status: jest.fn().mockResolvedValue([]),
    read: jest.fn().mockResolvedValue({
      agentId: 'a-1',
      stdout: '',
      stderr: '',
      lineCount: 0,
      truncated: false,
    }),
    steer: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue({
      agentId: 'a-1',
      cli: 'gemini',
      status: 'stopped',
      task: 'noop',
      startedAt: '2026-05-24T00:00:00Z',
    }),
    list: jest.fn().mockResolvedValue([]),
    waitFor: jest.fn(),
    ...overrides,
  } as PtahAPI['agent'];
}

function makeApiBuilder(agentApi?: Partial<PtahAPI['agent']>): PtahAPIBuilder {
  const api: Partial<PtahAPI> = { agent: makeAgentApi(agentApi) };
  return {
    build: jest.fn().mockReturnValue(api),
  } as unknown as PtahAPIBuilder;
}

function makeService(agentApi?: Partial<PtahAPI['agent']>): {
  svc: StdioMcpServerService;
  api: PtahAPI['agent'];
} {
  const builder = makeApiBuilder(agentApi);
  const svc = new StdioMcpServerService(makeLogger(), builder);
  return {
    svc,
    api: (builder.build() as { agent: PtahAPI['agent'] }).agent,
  };
}

function makeRequest(overrides: Partial<MCPRequest> = {}): MCPRequest {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    ...overrides,
  };
}

describe('StdioMcpServerService', () => {
  describe('handleInitialize', () => {
    it('returns the MCP 2024-11-05 handshake envelope', () => {
      const { svc } = makeService();
      const req = makeRequest({ method: 'initialize', id: 'abc' });
      const resp = svc.handleInitialize(req, {
        name: 'ptah',
        version: '0.2.32',
      });
      expect(resp).toEqual({
        jsonrpc: '2.0',
        id: 'abc',
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'ptah', version: '0.2.32' },
        },
      });
    });
  });

  describe('handleToolsList', () => {
    it('returns exactly the 7 MVP tool definitions with MCP-wire names', () => {
      const { svc } = makeService();
      const req = makeRequest({ method: 'tools/list' });
      const resp = svc.handleToolsList(req);
      const tools = (resp.result as { tools: { name: string }[] }).tools;
      expect(tools.map((t) => t.name)).toEqual([
        'agent_spawn',
        'agent_status',
        'agent_read',
        'agent_steer',
        'agent_stop',
        'agent_list',
        'session_submit',
      ]);
      expect(tools).toHaveLength(7);
      expect(tools.every((t) => !t.name.startsWith('ptah_'))).toBe(true);
    });

    it('filters tools through the allowedTools override', () => {
      const { svc } = makeService();
      const req = makeRequest({ method: 'tools/list' });
      const resp = svc.handleToolsList(req, ['agent_spawn', 'agent_list']);
      const tools = (resp.result as { tools: { name: string }[] }).tools;
      expect(tools.map((t) => t.name)).toEqual(['agent_spawn', 'agent_list']);
    });

    it('ignores an empty allowedTools array (returns all 7 tools)', () => {
      const { svc } = makeService();
      const req = makeRequest({ method: 'tools/list' });
      const resp = svc.handleToolsList(req, []);
      const tools = (resp.result as { tools: { name: string }[] }).tools;
      expect(tools).toHaveLength(7);
    });
  });

  describe('handleToolsCall input validation', () => {
    it('returns -32602 / mcp_invalid_tool_args for a missing name', async () => {
      const { svc } = makeService();
      const req = makeRequest({ params: {} });
      const resp = await svc.handleToolsCall(req);
      expect(resp.error?.code).toBe(-32602);
      expect((resp.error?.data as { ptah_code: string }).ptah_code).toBe(
        'mcp_invalid_tool_args',
      );
    });

    it('returns -32602 / mcp_invalid_tool_args for a non-string name', async () => {
      const { svc } = makeService();
      const req = makeRequest({ params: { name: 42 } });
      const resp = await svc.handleToolsCall(req);
      expect(resp.error?.code).toBe(-32602);
    });

    it('returns isError:true / mcp_tool_not_found for an unknown tool', async () => {
      const { svc } = makeService();
      const req = makeRequest({ params: { name: 'does_not_exist' } });
      const resp = await svc.handleToolsCall(req);
      expect(resp.error).toBeUndefined();
      const result = resp.result as {
        isError: boolean;
        structuredContent: { ptah_code: string; tool: string };
      };
      expect(result.isError).toBe(true);
      expect(result.structuredContent.ptah_code).toBe('mcp_tool_not_found');
      expect(result.structuredContent.tool).toBe('does_not_exist');
    });

    it('rejects agent_spawn with empty task as mcp_invalid_tool_args', async () => {
      const { svc, api } = makeService();
      const resp = await svc.handleToolsCall(
        makeRequest({
          params: { name: 'agent_spawn', arguments: { task: '' } },
        }),
      );
      const result = resp.result as {
        isError: boolean;
        structuredContent: { ptah_code: string };
      };
      expect(result.isError).toBe(true);
      expect(result.structuredContent.ptah_code).toBe('mcp_invalid_tool_args');
      expect(api.spawn).not.toHaveBeenCalled();
    });

    it('rejects agent_read without agentId as mcp_invalid_tool_args', async () => {
      const { svc, api } = makeService();
      const resp = await svc.handleToolsCall(
        makeRequest({
          params: { name: 'agent_read', arguments: {} },
        }),
      );
      const result = resp.result as {
        isError: boolean;
        structuredContent: { ptah_code: string };
      };
      expect(result.isError).toBe(true);
      expect(result.structuredContent.ptah_code).toBe('mcp_invalid_tool_args');
      expect(api.read).not.toHaveBeenCalled();
    });
  });

  describe('agent_* dispatch', () => {
    it('routes agent_spawn to PtahAPI.agent.spawn with normalized params', async () => {
      const { svc, api } = makeService();
      const resp = await svc.handleToolsCall(
        makeRequest({
          params: {
            name: 'agent_spawn',
            arguments: {
              task: 'echo hi',
              cli: 'gemini',
              workingDirectory: 'D:/test-workspace',
            },
          },
        }),
      );
      expect(api.spawn).toHaveBeenCalledTimes(1);
      const arg = (api.spawn as jest.Mock).mock.calls[0][0];
      expect(arg.task).toBe('echo hi');
      expect(arg.cli).toBe('gemini');
      expect(arg.workingDirectory).toBe('D:/test-workspace');
      const result = resp.result as {
        isError?: boolean;
        structuredContent: { agentId: string; cli: string };
      };
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent.agentId).toBe('a-1');
      expect(result.structuredContent.cli).toBe('gemini');
    });

    it('routes agent_status to PtahAPI.agent.status', async () => {
      const statusResult = [
        {
          agentId: 'a-1',
          cli: 'gemini',
          status: 'running',
          task: 'noop',
          startedAt: '2026-05-24T00:00:00Z',
        },
      ];
      const { svc, api } = makeService({
        status: jest.fn().mockResolvedValue(statusResult) as never,
      });
      const resp = await svc.handleToolsCall(
        makeRequest({
          params: { name: 'agent_status', arguments: { agentId: 'a-1' } },
        }),
      );
      expect(api.status).toHaveBeenCalledWith('a-1');
      const result = resp.result as {
        structuredContent: { agents: unknown[] };
      };
      expect(result.structuredContent.agents).toEqual(statusResult);
    });

    it('routes agent_read with the optional tail', async () => {
      const { svc, api } = makeService();
      await svc.handleToolsCall(
        makeRequest({
          params: {
            name: 'agent_read',
            arguments: { agentId: 'a-1', tail: 50 },
          },
        }),
      );
      expect(api.read).toHaveBeenCalledWith('a-1', 50);
    });

    it('routes agent_steer to PtahAPI.agent.steer', async () => {
      const { svc, api } = makeService();
      const resp = await svc.handleToolsCall(
        makeRequest({
          params: {
            name: 'agent_steer',
            arguments: { agentId: 'a-1', instruction: 'be brief' },
          },
        }),
      );
      expect(api.steer).toHaveBeenCalledWith('a-1', 'be brief');
      const result = resp.result as {
        structuredContent: { agentId: string; steered: boolean };
      };
      expect(result.structuredContent.steered).toBe(true);
    });

    it('routes agent_stop to PtahAPI.agent.stop', async () => {
      const { svc, api } = makeService();
      const resp = await svc.handleToolsCall(
        makeRequest({
          params: { name: 'agent_stop', arguments: { agentId: 'a-1' } },
        }),
      );
      expect(api.stop).toHaveBeenCalledWith('a-1');
      const result = resp.result as {
        structuredContent: { agentId: string; status: string };
      };
      expect(result.structuredContent.agentId).toBe('a-1');
      expect(result.structuredContent.status).toBe('stopped');
    });

    it('routes agent_list to PtahAPI.agent.list', async () => {
      const listResult = [
        { cli: 'gemini', installed: true, supportsSteer: false },
      ];
      const { svc, api } = makeService({
        list: jest.fn().mockResolvedValue(listResult) as never,
      });
      const resp = await svc.handleToolsCall(
        makeRequest({ params: { name: 'agent_list', arguments: {} } }),
      );
      expect(api.list).toHaveBeenCalledTimes(1);
      const result = resp.result as {
        structuredContent: { agents: unknown[]; total: number };
      };
      expect(result.structuredContent.agents).toEqual(listResult);
      expect(result.structuredContent.total).toBe(1);
    });

    it('surfaces underlying spawn failures as mcp_tool_failed', async () => {
      const { svc } = makeService({
        spawn: jest
          .fn()
          .mockRejectedValue(
            new Error('CLI agent unavailable: gemini'),
          ) as never,
      });
      const resp = await svc.handleToolsCall(
        makeRequest({
          params: {
            name: 'agent_spawn',
            arguments: { task: 'echo hi', cli: 'gemini' },
          },
        }),
      );
      const result = resp.result as {
        isError: boolean;
        structuredContent: { ptah_code: string };
      };
      expect(result.isError).toBe(true);
      expect(result.structuredContent.ptah_code).toBe('mcp_tool_failed');
    });

    it('accepts every name in MCP_MVP_TOOL_NAMES via tools/call', async () => {
      const { svc } = makeService();
      const argsByName: Record<string, Record<string, unknown>> = {
        agent_spawn: { task: 'noop' },
        agent_status: {},
        agent_read: { agentId: 'a-1' },
        agent_steer: { agentId: 'a-1', instruction: 'go' },
        agent_stop: { agentId: 'a-1' },
        agent_list: {},
        // session_submit is exercised in its own describe block.
        session_submit: { task: 'noop' },
      };
      for (const name of MCP_MVP_TOOL_NAMES) {
        const resp = await svc.handleToolsCall(
          makeRequest({
            params: { name, arguments: argsByName[name] ?? {} },
          }),
        );
        // Each route returns some `result`; none of them throw or fall
        // through to a JSON-RPC error.
        expect(resp.error).toBeUndefined();
        expect(resp.result).toBeDefined();
      }
    });
  });

  describe('session_submit dispatch', () => {
    it('returns sdk_init_failed when no handler is registered', async () => {
      const { svc } = makeService();
      const resp = await svc.handleToolsCall(
        makeRequest({
          params: {
            name: 'session_submit',
            arguments: { task: 'plan something' },
          },
        }),
      );
      const result = resp.result as {
        isError: boolean;
        structuredContent: { ptah_code: string };
      };
      expect(result.isError).toBe(true);
      expect(result.structuredContent.ptah_code).toBe('sdk_init_failed');
    });

    it('delegates to the registered handler when present', async () => {
      const { svc } = makeService();
      const handler: jest.Mocked<ISessionSubmitHandler> = {
        dispatch: jest.fn().mockResolvedValue({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [{ type: 'text', text: 'done' }],
            structuredContent: { tabId: 't-1' },
          },
        }),
        cancel: jest.fn().mockResolvedValue(undefined),
      };
      svc.setSessionSubmitHandler(handler);
      const req = makeRequest({
        params: {
          name: 'session_submit',
          arguments: { task: 'plan something' },
        },
      });
      const resp = await svc.handleToolsCall(req);
      expect(handler.dispatch).toHaveBeenCalledWith(req, {
        task: 'plan something',
      });
      expect(
        (resp.result as { structuredContent: { tabId: string } })
          .structuredContent.tabId,
      ).toBe('t-1');
    });
  });

  describe('handleCancelled', () => {
    it('logs the requestId when provided', async () => {
      const logger = makeLogger();
      const svc = new StdioMcpServerService(logger, makeApiBuilder());
      await svc.handleCancelled({ requestId: 'req-1' });
      expect(logger.info).toHaveBeenCalledWith(
        '[StdioMcpServer] notifications/cancelled',
        expect.objectContaining({ requestId: 'req-1' }),
      );
    });

    it('does not throw on missing params', async () => {
      const { svc } = makeService();
      await expect(svc.handleCancelled(undefined)).resolves.toBeUndefined();
    });

    it('forwards the requestId to the session-submit handler', async () => {
      const { svc } = makeService();
      const handler: jest.Mocked<ISessionSubmitHandler> = {
        dispatch: jest.fn(),
        cancel: jest.fn().mockResolvedValue(undefined),
      };
      svc.setSessionSubmitHandler(handler);
      await svc.handleCancelled({ requestId: 'req-99' });
      expect(handler.cancel).toHaveBeenCalledWith({ requestId: 'req-99' });
    });
  });
});

describe('StdioTransport', () => {
  function makeNotifier(): {
    notifier: McpStdioNotifier;
    notify: jest.Mock;
  } {
    const notify = jest.fn().mockResolvedValue(undefined);
    return { notifier: { notify }, notify };
  }

  it('does not forward notifications before start()', async () => {
    const { notifier, notify } = makeNotifier();
    const transport = new StdioTransport({ notifier });
    await transport.notify('notifications/progress', { progress: 1 });
    expect(notify).not.toHaveBeenCalled();
  });

  it('forwards notifications between start() and stop()', async () => {
    const { notifier, notify } = makeNotifier();
    const transport = new StdioTransport({ notifier });
    await transport.start();
    await transport.notify('notifications/message', { kind: 'info' });
    expect(notify).toHaveBeenCalledWith('notifications/message', {
      kind: 'info',
    });
  });

  it('stops forwarding after stop()', async () => {
    const { notifier, notify } = makeNotifier();
    const transport = new StdioTransport({ notifier });
    await transport.start();
    await transport.stop();
    await transport.notify('notifications/message', { kind: 'info' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('isStarted reflects lifecycle', async () => {
    const { notifier } = makeNotifier();
    const transport = new StdioTransport({ notifier });
    expect(transport.isStarted()).toBe(false);
    await transport.start();
    expect(transport.isStarted()).toBe(true);
    await transport.stop();
    expect(transport.isStarted()).toBe(false);
  });
});
