/**
 * Stdio MCP server — unit specs.
 *
 * Phase 2 coverage:
 *   1. `handleInitialize` returns the canonical MCP 2024-11-05 envelope.
 *   2. `handleToolsList` returns exactly the 7 MVP tool definitions with
 *      MCP-wire names (no `ptah_` prefix).
 *   3. `handleToolsList` respects an `allowedTools` filter.
 *   4. `handleToolsCall` returns the `not_implemented` placeholder for a
 *      known tool name.
 *   5. `handleToolsCall` returns -32601 / `mcp_tool_not_found` for an
 *      unknown tool name.
 *   6. `handleToolsCall` returns -32602 / `mcp_invalid_tool_args` for a
 *      missing / non-string `name`.
 *   7. `handleCancelled` logs but does not throw on any params shape.
 *   8. `StdioTransport` only forwards notifications while `start()` has
 *      been called and no subsequent `stop()` has fired.
 */

import 'reflect-metadata';

jest.mock('@ptah-extension/vscode-core', () => ({
  TOKENS: {
    LOGGER: Symbol.for('Logger'),
  },
}));

import type { Logger } from '@ptah-extension/vscode-core';
import { StdioMcpServerService } from './stdio-mcp-server.service';
import { StdioTransport, type McpStdioNotifier } from './stdio-transport';
import { MCP_MVP_TOOL_NAMES } from './tool-builders';
import type { MCPRequest } from '../mcp-core/types/mcp-protocol.types';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
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
      const svc = new StdioMcpServerService(makeLogger());
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
      const svc = new StdioMcpServerService(makeLogger());
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
      const svc = new StdioMcpServerService(makeLogger());
      const req = makeRequest({ method: 'tools/list' });
      const resp = svc.handleToolsList(req, ['agent_spawn', 'agent_list']);
      const tools = (resp.result as { tools: { name: string }[] }).tools;
      expect(tools.map((t) => t.name)).toEqual(['agent_spawn', 'agent_list']);
    });

    it('ignores an empty allowedTools array (returns all 7 tools)', () => {
      const svc = new StdioMcpServerService(makeLogger());
      const req = makeRequest({ method: 'tools/list' });
      const resp = svc.handleToolsList(req, []);
      const tools = (resp.result as { tools: { name: string }[] }).tools;
      expect(tools).toHaveLength(7);
    });
  });

  describe('handleToolsCall placeholder', () => {
    it('returns isError:true with ptah_code=not_implemented for a known tool', async () => {
      const svc = new StdioMcpServerService(makeLogger());
      const req = makeRequest({
        params: { name: 'agent_spawn', arguments: { task: 'noop' } },
      });
      const resp = await svc.handleToolsCall(req);
      expect(resp.error).toBeUndefined();
      const result = resp.result as {
        isError: boolean;
        structuredContent: { ptah_code: string; tool: string };
      };
      expect(result.isError).toBe(true);
      expect(result.structuredContent.ptah_code).toBe('not_implemented');
      expect(result.structuredContent.tool).toBe('agent_spawn');
    });

    it('returns -32601 / mcp_tool_not_found for an unknown tool', async () => {
      const svc = new StdioMcpServerService(makeLogger());
      const req = makeRequest({ params: { name: 'does_not_exist' } });
      const resp = await svc.handleToolsCall(req);
      expect(resp.result).toBeUndefined();
      expect(resp.error?.code).toBe(-32601);
      expect((resp.error?.data as { ptah_code: string }).ptah_code).toBe(
        'mcp_tool_not_found',
      );
    });

    it('returns -32602 / mcp_invalid_tool_args for a missing name', async () => {
      const svc = new StdioMcpServerService(makeLogger());
      const req = makeRequest({ params: {} });
      const resp = await svc.handleToolsCall(req);
      expect(resp.error?.code).toBe(-32602);
      expect((resp.error?.data as { ptah_code: string }).ptah_code).toBe(
        'mcp_invalid_tool_args',
      );
    });

    it('returns -32602 / mcp_invalid_tool_args for a non-string name', async () => {
      const svc = new StdioMcpServerService(makeLogger());
      const req = makeRequest({ params: { name: 42 } });
      const resp = await svc.handleToolsCall(req);
      expect(resp.error?.code).toBe(-32602);
    });

    it('accepts every name in MCP_MVP_TOOL_NAMES', async () => {
      const svc = new StdioMcpServerService(makeLogger());
      for (const name of MCP_MVP_TOOL_NAMES) {
        const resp = await svc.handleToolsCall(
          makeRequest({ params: { name } }),
        );
        const result = resp.result as { isError: boolean };
        expect(result.isError).toBe(true);
      }
    });
  });

  describe('handleCancelled', () => {
    it('logs the requestId when provided', async () => {
      const logger = makeLogger();
      const svc = new StdioMcpServerService(logger);
      await svc.handleCancelled({ requestId: 'req-1' });
      expect(logger.info).toHaveBeenCalledWith(
        '[StdioMcpServer] notifications/cancelled',
        expect.objectContaining({ requestId: 'req-1' }),
      );
    });

    it('does not throw on missing params', async () => {
      const svc = new StdioMcpServerService(makeLogger());
      await expect(svc.handleCancelled(undefined)).resolves.toBeUndefined();
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
