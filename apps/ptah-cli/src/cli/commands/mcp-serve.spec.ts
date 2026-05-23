/**
 * Unit tests for `ptah mcp-serve` (Phase 2 of TASK_2026_128).
 *
 * Coverage:
 *   1. `initialize` handshake responds with `protocolVersion: '2024-11-05'`
 *      and `serverInfo: { name: 'ptah', version }`.
 *   2. `tools/list` returns the 7 MVP tool definitions with MCP-wire names
 *      (no `ptah_` prefix).
 *   3. `--allow-tools` filter narrows the catalog.
 *   4. `tools/call` returns the placeholder `not_implemented` envelope.
 *   5. `tools/call` for an unknown tool surfaces as a JSON-RPC -32601 error.
 *   6. `mcp_host_session_id` is exported via `PTAH_MCP_HOST_SESSION_ID`
 *      while the command runs and restored on shutdown.
 *   7. SIGTERM triggers an exit code of 143; stdin EOF triggers 0.
 *   8. `notifications/initialized` is emitted post-handshake.
 *
 * Test strategy mirrors `interact.spec.ts` — a `PassThrough` pair stands
 * in for stdin/stdout, `withEngine` is faked to return a synthetic
 * container, and `StdioMcpServerService` is injected through the
 * `serverFactory` hook so the test never touches the real DI graph.
 */

import { PassThrough } from 'node:stream';

jest.mock(
  '@ptah-extension/agent-sdk',
  () => {
    const {
      mockAnthropicProviders,
    } = require('../../test-utils/agent-sdk-mock');
    return {
      SDK_TOKENS: {
        SDK_PERMISSION_HANDLER: Symbol.for('SdkPermissionHandler'),
      },
      ANTHROPIC_PROVIDERS: mockAnthropicProviders(),
    };
  },
  { virtual: true },
);

import {
  execute,
  type McpServeExecuteHooks,
  type McpServeOptions,
} from './mcp-serve.js';
import { decodeMessage } from '../jsonrpc/encoder.js';
import {
  isJsonRpcErrorResponse,
  isJsonRpcNotification,
  isJsonRpcSuccessResponse,
  type JsonRpcMessage,
} from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type {
  MCPRequest,
  MCPResponse,
  StdioMcpServerService,
} from '@ptah-extension/vscode-lm-tools';

const baseGlobals: GlobalOptions = {
  json: true,
  human: false,
  cwd: 'D:/test-workspace',
  quiet: false,
  verbose: false,
  noColor: true,
  autoApprove: false,
  reveal: false,
};

interface Harness {
  stdin: PassThrough;
  stdout: PassThrough;
  outLines: string[];
  exitCalls: number[];
  hooks: McpServeExecuteHooks;
  sigintHandlers: Set<() => void>;
  sigtermHandlers: Set<() => void>;
  waitForLines: (n: number, timeoutMs?: number) => Promise<string[]>;
  findLine: (
    pred: (m: JsonRpcMessage) => boolean,
    timeoutMs?: number,
  ) => Promise<JsonRpcMessage>;
  send: (obj: unknown) => void;
  fakeStdioServer: jest.Mocked<StdioMcpServerService>;
}

function makeFakeStdioServer(): jest.Mocked<StdioMcpServerService> {
  const buildToolListResult = (
    allowed?: readonly string[],
  ): { tools: { name: string }[] } => {
    const mvp = [
      'agent_spawn',
      'agent_status',
      'agent_read',
      'agent_steer',
      'agent_stop',
      'agent_list',
      'session_submit',
    ];
    const filtered =
      allowed && allowed.length > 0
        ? mvp.filter((name) => allowed.includes(name))
        : mvp;
    return { tools: filtered.map((name) => ({ name })) };
  };

  return {
    handleInitialize: jest.fn(
      (request: MCPRequest, info): MCPResponse => ({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: info,
        },
      }),
    ),
    handleToolsList: jest.fn(
      (request: MCPRequest, allowed?: readonly string[]): MCPResponse => ({
        jsonrpc: '2.0',
        id: request.id,
        result: buildToolListResult(allowed),
      }),
    ),
    handleToolsCall: jest.fn(
      async (request: MCPRequest): Promise<MCPResponse> => {
        const params = request.params as { name?: unknown };
        if (typeof params?.name !== 'string') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: -32602,
              message: 'Invalid params',
              data: { ptah_code: 'mcp_invalid_tool_args' },
            },
          };
        }
        const known = [
          'agent_spawn',
          'agent_status',
          'agent_read',
          'agent_steer',
          'agent_stop',
          'agent_list',
          'session_submit',
        ].includes(params.name);
        if (!known) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: `Unknown tool: ${params.name}`,
                },
              ],
              isError: true,
              structuredContent: {
                ptah_code: 'mcp_tool_not_found',
                tool: params.name,
              },
            },
          };
        }
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            content: [
              {
                type: 'text',
                text: 'Tool dispatch not yet implemented — Phase 3.',
              },
            ],
            isError: true,
            structuredContent: {
              ptah_code: 'not_implemented',
              tool: params.name,
              phase: 2,
            },
          },
        };
      },
    ),
    handleCancelled: jest.fn(async (): Promise<void> => undefined),
  } as unknown as jest.Mocked<StdioMcpServerService>;
}

function makeHarness(): Harness {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const outLines: string[] = [];
  let outBuffer = '';
  stdout.on('data', (chunk: Buffer) => {
    outBuffer += chunk.toString('utf8');
    let idx = outBuffer.indexOf('\n');
    while (idx !== -1) {
      outLines.push(outBuffer.slice(0, idx));
      outBuffer = outBuffer.slice(idx + 1);
      idx = outBuffer.indexOf('\n');
    }
  });

  const exitCalls: number[] = [];
  const sigintHandlers = new Set<() => void>();
  const sigtermHandlers = new Set<() => void>();

  const fakeStdioServer = makeFakeStdioServer();
  const fakeLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const container = {
    resolve: jest.fn((token: symbol) => {
      if (token === Symbol.for('Logger')) return fakeLogger;
      throw new Error(`unexpected token: ${String(token)}`);
    }),
    isRegistered: jest.fn(() => true),
  };
  const pushAdapter = { on: jest.fn(), removeAllListeners: jest.fn() };
  const transport = { call: jest.fn() };

  let idCounter = 0;
  const hooks: McpServeExecuteHooks = {
    withEngine: (async (
      _globals: unknown,
      _opts: unknown,
      fn: (ctx: unknown) => Promise<unknown>,
    ): Promise<unknown> => {
      return fn({ container, transport, pushAdapter });
    }) as unknown as McpServeExecuteHooks['withEngine'],
    serverFactory: () => fakeStdioServer,
    stdin,
    stdout,
    randomId: (): string => {
      idCounter += 1;
      return `id-${idCounter}`;
    },
    exit: (code: number): void => {
      exitCalls.push(code);
    },
    installSignal: (signal, handler) => {
      const set = signal === 'SIGINT' ? sigintHandlers : sigtermHandlers;
      set.add(handler);
      return () => set.delete(handler);
    },
    version: '0.2.32',
    drainTimeoutMs: 250,
  };

  const waitForLines = (n: number, timeoutMs = 1500): Promise<string[]> =>
    new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = (): void => {
        if (outLines.length >= n) {
          resolve(outLines.slice(0, n));
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(
            new Error(
              `Timed out waiting for ${n} lines (got ${outLines.length}): ${outLines.join(
                ' | ',
              )}`,
            ),
          );
          return;
        }
        setTimeout(tick, 5);
      };
      tick();
    });

  const findLine = (
    pred: (m: JsonRpcMessage) => boolean,
    timeoutMs = 1500,
  ): Promise<JsonRpcMessage> =>
    new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = (): void => {
        for (const line of outLines) {
          const decoded = decodeMessage(line);
          if (decoded.ok && pred(decoded.message)) {
            resolve(decoded.message);
            return;
          }
        }
        if (Date.now() - start > timeoutMs) {
          reject(
            new Error(
              `Timed out finding matching line. Lines so far: ${outLines.join(
                ' | ',
              )}`,
            ),
          );
          return;
        }
        setTimeout(tick, 5);
      };
      tick();
    });

  const send = (obj: unknown): void => {
    stdin.write(`${JSON.stringify(obj)}\n`);
  };

  return {
    stdin,
    stdout,
    outLines,
    exitCalls,
    hooks,
    sigintHandlers,
    sigtermHandlers,
    waitForLines,
    findLine,
    send,
    fakeStdioServer,
  };
}

async function flushAsync(ticks = 8): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    await Promise.resolve();
  }
}

const NO_OPTS: McpServeOptions = {};

describe('ptah mcp-serve', () => {
  afterEach(() => {
    delete process.env['PTAH_MCP_HOST_SESSION_ID'];
  });

  describe('initialize handshake', () => {
    it('responds with MCP 2024-11-05 envelope and serverInfo', async () => {
      const h = makeHarness();
      const promise = execute(NO_OPTS, baseGlobals, h.hooks);
      await flushAsync();

      h.send({ jsonrpc: '2.0', id: 'init-1', method: 'initialize' });
      const resp = await h.findLine(
        (m) =>
          isJsonRpcSuccessResponse(m) &&
          (m as { id: string | number }).id === 'init-1',
      );
      if (!isJsonRpcSuccessResponse(resp)) throw new Error('expected success');
      const result = resp.result as {
        protocolVersion: string;
        serverInfo: { name: string; version: string };
      };
      expect(result.protocolVersion).toBe('2024-11-05');
      expect(result.serverInfo).toEqual({ name: 'ptah', version: '0.2.32' });

      h.stdin.end();
      await promise;
    });

    it('emits notifications/initialized after withEngine resolves', async () => {
      const h = makeHarness();
      const promise = execute(NO_OPTS, baseGlobals, h.hooks);
      await flushAsync();

      const initNotif = await h.findLine(
        (m) =>
          isJsonRpcNotification(m) &&
          (m as { method: string }).method === 'notifications/initialized',
      );
      expect(isJsonRpcNotification(initNotif)).toBe(true);

      h.stdin.end();
      await promise;
    });
  });

  describe('tools/list', () => {
    it('returns 7 MVP tools with MCP-wire names (no ptah_ prefix)', async () => {
      const h = makeHarness();
      const promise = execute(NO_OPTS, baseGlobals, h.hooks);
      await flushAsync();

      h.send({ jsonrpc: '2.0', id: 'list-1', method: 'tools/list' });
      const resp = await h.findLine(
        (m) =>
          isJsonRpcSuccessResponse(m) &&
          (m as { id: string | number }).id === 'list-1',
      );
      if (!isJsonRpcSuccessResponse(resp)) throw new Error('expected success');
      const tools = (resp.result as { tools: { name: string }[] }).tools;
      expect(tools).toHaveLength(7);
      expect(tools.map((t) => t.name)).toEqual([
        'agent_spawn',
        'agent_status',
        'agent_read',
        'agent_steer',
        'agent_stop',
        'agent_list',
        'session_submit',
      ]);
      expect(tools.every((t) => !t.name.startsWith('ptah_'))).toBe(true);

      h.stdin.end();
      await promise;
    });

    it('narrows the catalog when --allow-tools is supplied', async () => {
      const h = makeHarness();
      const promise = execute(
        { allowTools: ['agent_spawn', 'agent_list'] },
        baseGlobals,
        h.hooks,
      );
      await flushAsync();

      h.send({ jsonrpc: '2.0', id: 'list-2', method: 'tools/list' });
      const resp = await h.findLine(
        (m) =>
          isJsonRpcSuccessResponse(m) &&
          (m as { id: string | number }).id === 'list-2',
      );
      if (!isJsonRpcSuccessResponse(resp)) throw new Error('expected success');
      const tools = (resp.result as { tools: { name: string }[] }).tools;
      expect(tools.map((t) => t.name)).toEqual(['agent_spawn', 'agent_list']);

      h.stdin.end();
      await promise;
    });
  });

  describe('tools/call placeholder', () => {
    it('returns isError:true with ptah_code=not_implemented for a known tool', async () => {
      const h = makeHarness();
      const promise = execute(NO_OPTS, baseGlobals, h.hooks);
      await flushAsync();

      h.send({
        jsonrpc: '2.0',
        id: 'call-1',
        method: 'tools/call',
        params: { name: 'agent_spawn', arguments: { task: 'noop' } },
      });
      const resp = await h.findLine(
        (m) =>
          isJsonRpcSuccessResponse(m) &&
          (m as { id: string | number }).id === 'call-1',
      );
      if (!isJsonRpcSuccessResponse(resp)) throw new Error('expected success');
      const result = resp.result as {
        isError: boolean;
        structuredContent: { ptah_code: string };
      };
      expect(result.isError).toBe(true);
      expect(result.structuredContent.ptah_code).toBe('not_implemented');

      h.stdin.end();
      await promise;
    });

    it('surfaces unknown tool as MCP tool error (isError:true)', async () => {
      const h = makeHarness();
      const promise = execute(NO_OPTS, baseGlobals, h.hooks);
      await flushAsync();

      h.send({
        jsonrpc: '2.0',
        id: 'call-2',
        method: 'tools/call',
        params: { name: 'nonexistent_tool' },
      });
      const resp = await h.findLine(
        (m) =>
          isJsonRpcSuccessResponse(m) &&
          (m as { id: string | number }).id === 'call-2',
      );
      if (!isJsonRpcSuccessResponse(resp)) throw new Error('expected success');
      const result = resp.result as {
        isError: boolean;
        structuredContent: { ptah_code: string; tool: string };
      };
      expect(result.isError).toBe(true);
      expect(result.structuredContent.ptah_code).toBe('mcp_tool_not_found');
      expect(result.structuredContent.tool).toBe('nonexistent_tool');

      h.stdin.end();
      await promise;
    });

    it('surfaces invalid params as JSON-RPC -32602', async () => {
      const h = makeHarness();
      const promise = execute(NO_OPTS, baseGlobals, h.hooks);
      await flushAsync();

      h.send({
        jsonrpc: '2.0',
        id: 'call-3',
        method: 'tools/call',
        params: { arguments: { task: 'noop' } },
      });
      const resp = await h.findLine(
        (m) =>
          isJsonRpcErrorResponse(m) &&
          (m as { id: string | number }).id === 'call-3',
      );
      if (!isJsonRpcErrorResponse(resp)) throw new Error('expected error');
      expect(resp.error.code).toBe(-32602);
      expect((resp.error.data as { ptah_code: string }).ptah_code).toBe(
        'mcp_invalid_tool_args',
      );

      h.stdin.end();
      await promise;
    });
  });

  describe('mcp_host_session_id env var', () => {
    it('exports PTAH_MCP_HOST_SESSION_ID during execution and restores on shutdown', async () => {
      const before = process.env['PTAH_MCP_HOST_SESSION_ID'];
      const h = makeHarness();
      const promise = execute(NO_OPTS, baseGlobals, h.hooks);
      await flushAsync();
      expect(typeof process.env['PTAH_MCP_HOST_SESSION_ID']).toBe('string');
      expect(
        process.env['PTAH_MCP_HOST_SESSION_ID']?.length ?? 0,
      ).toBeGreaterThan(0);

      h.stdin.end();
      await promise;
      expect(process.env['PTAH_MCP_HOST_SESSION_ID']).toBe(before);
    });
  });

  describe('lifecycle exit codes', () => {
    it('exits 0 on stdin EOF', async () => {
      const h = makeHarness();
      const promise = execute(NO_OPTS, baseGlobals, h.hooks);
      await flushAsync();
      h.stdin.end();
      await promise;
      expect(h.exitCalls).toEqual([0]);
    });

    it('exits 143 on SIGTERM', async () => {
      const h = makeHarness();
      const promise = execute(NO_OPTS, baseGlobals, h.hooks);
      await flushAsync();
      for (const handler of h.sigtermHandlers) handler();
      await promise;
      expect(h.exitCalls).toEqual([143]);
    });

    it('exits 130 on SIGINT', async () => {
      const h = makeHarness();
      const promise = execute(NO_OPTS, baseGlobals, h.hooks);
      await flushAsync();
      for (const handler of h.sigintHandlers) handler();
      await promise;
      expect(h.exitCalls).toEqual([130]);
    });
  });

  describe('DI wiring', () => {
    it('registers tools/list, tools/call, notifications/cancelled and resolves the stdio MCP server', async () => {
      const h = makeHarness();
      const promise = execute(NO_OPTS, baseGlobals, h.hooks);
      await flushAsync();

      h.send({ jsonrpc: '2.0', id: 'cancel-1', method: 'tools/list' });
      await h.findLine(
        (m) =>
          isJsonRpcSuccessResponse(m) &&
          (m as { id: string | number }).id === 'cancel-1',
      );
      expect(h.fakeStdioServer.handleToolsList).toHaveBeenCalled();

      h.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: { requestId: 'req-1' },
        })}\n`,
      );
      await flushAsync();
      expect(h.fakeStdioServer.handleCancelled).toHaveBeenCalled();

      h.stdin.end();
      await promise;
    });
  });
});
