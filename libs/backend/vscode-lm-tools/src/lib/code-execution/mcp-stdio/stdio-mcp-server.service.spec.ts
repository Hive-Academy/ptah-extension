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
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
import type {
  MCPRequest,
  MCPResponse,
} from '../mcp-core/types/mcp-protocol.types';
import type { PtahAPIBuilder } from '../ptah-api-builder.service';
import type { PtahAPI } from '../types';
import { countTokensPiecewise } from '@ptah-extension/tool-output-reducers';
import {
  DEFAULT_TOOL_RESULT_BUDGET_CHARS,
  DEFAULT_TOOL_RESULT_BUDGET_TOKENS,
  getToolResultBudget,
} from '../mcp-core/tool-result-budget';
import type { ISessionSubmitHandler } from './session-submit.port';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  NX_ENTRY_CANDIDATES,
  runCheck,
  runningCheckPids,
  type CheckProcess,
  type SpawnCheckProcess,
} from '../mcp-core/run-check.tool';
import { RunCheckArgsSchema } from '../mcp-core/wait-tools-args.schema';

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
      cli: 'codex',
      status: 'running',
      startedAt: '2026-05-24T00:00:00Z',
    }),
    status: jest.fn().mockResolvedValue([]),
    read: jest.fn().mockResolvedValue({
      agentId: 'a-1',
      stdout: '',
      stderr: '',
      lineCount: 0,
      totalLines: 0,
      omittedLines: 0,
      stdoutTotalLines: 0,
      stderrTotalLines: 0,
      truncated: false,
    }),
    message: jest.fn().mockResolvedValue({ mode: 'queue-next-turn' }),
    report: jest
      .fn()
      .mockResolvedValue({ delivered: false, reason: 'unattributed-caller' }),
    stop: jest.fn().mockResolvedValue({
      agentId: 'a-1',
      cli: 'codex',
      status: 'stopped',
      task: 'noop',
      startedAt: '2026-05-24T00:00:00Z',
    }),
    list: jest.fn().mockResolvedValue([]),
    listRoles: jest.fn().mockResolvedValue([]),
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
    it('returns exactly the 10 MVP tool definitions with MCP-wire names', () => {
      const { svc } = makeService();
      const req = makeRequest({ method: 'tools/list' });
      const resp = svc.handleToolsList(req);
      const tools = (resp.result as { tools: { name: string }[] }).tools;
      expect(tools.map((t) => t.name)).toEqual([
        'agent_spawn',
        'agent_status',
        'agent_read',
        'agent_message',
        'agent_report',
        'agent_stop',
        'agent_list',
        'agent_wait',
        'run_check',
        'session_submit',
      ]);
      expect(tools).toHaveLength(10);
      expect(tools.every((t) => !t.name.startsWith('ptah_'))).toBe(true);
    });

    it('filters tools through the allowedTools override', () => {
      const { svc } = makeService();
      const req = makeRequest({ method: 'tools/list' });
      const resp = svc.handleToolsList(req, ['agent_spawn', 'agent_list']);
      const tools = (resp.result as { tools: { name: string }[] }).tools;
      expect(tools.map((t) => t.name)).toEqual(['agent_spawn', 'agent_list']);
    });

    it('ignores an empty allowedTools array (returns all 10 tools)', () => {
      const { svc } = makeService();
      const req = makeRequest({ method: 'tools/list' });
      const resp = svc.handleToolsList(req, []);
      const tools = (resp.result as { tools: { name: string }[] }).tools;
      expect(tools).toHaveLength(10);
    });

    it('declares each served tool’s result ceiling in _meta (review r3: R3-06)', () => {
      const { svc } = makeService();
      const resp = svc.handleToolsList(makeRequest({ method: 'tools/list' }));
      const tools = (
        resp.result as {
          tools: { name: string; _meta?: Record<string, unknown> }[];
        }
      ).tools;
      const declared = Object.fromEntries(
        tools.map((t) => [t.name, t._meta?.['anthropic/maxResultSizeChars']]),
      );
      // The nine dispatcher tools enforce their `ptah_*` budget (8,000
      // chars); session_submit returns up to its own 1 MiB aggregate cap
      // (apps/ptah-cli session-submit.service.ts `AGGREGATE_BUFFER_CAP`).
      expect(declared).toEqual({
        agent_spawn: 8000,
        agent_status: 8000,
        agent_read: 8000,
        agent_message: 8000,
        agent_report: 8000,
        agent_stop: 8000,
        agent_list: 8000,
        agent_wait: 8000,
        run_check: 8000,
        session_submit: 1_048_576,
      });
      for (const tool of tools) {
        if (tool.name !== 'session_submit') {
          expect(declared[tool.name]).toBe(
            getToolResultBudget(`ptah_${tool.name}`).chars,
          );
        }
      }
    });

    it('keeps the declared ceiling on a filtered catalog', () => {
      const { svc } = makeService();
      const resp = svc.handleToolsList(makeRequest({ method: 'tools/list' }), [
        'agent_list',
      ]);
      const tools = (
        resp.result as {
          tools: { name: string; _meta?: Record<string, unknown> }[];
        }
      ).tools;
      expect(tools[0]._meta).toMatchObject({
        'anthropic/maxResultSizeChars': 8000,
      });
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
              cli: 'codex',
              workingDirectory: 'D:/test-workspace',
            },
          },
        }),
      );
      expect(api.spawn).toHaveBeenCalledTimes(1);
      const arg = (api.spawn as jest.Mock).mock.calls[0][0];
      expect(arg.task).toBe('echo hi');
      expect(arg.cli).toBe('codex');
      expect(arg.workingDirectory).toBe('D:/test-workspace');
      const result = resp.result as {
        isError?: boolean;
        structuredContent: { agentId: string; cli: string };
      };
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent.agentId).toBe('a-1');
      expect(result.structuredContent.cli).toBe('codex');
    });

    // TASK_2026_295 — PTAH_MCP_HOST_SESSION_ID reads as '' (not undefined)
    // when it is set but empty, and that '' was threaded straight through to
    // agent.spawn as parentSessionId. An id that identifies no session must be
    // treated as absent.
    describe('PTAH_MCP_HOST_SESSION_ID', () => {
      const ORIGINAL = process.env['PTAH_MCP_HOST_SESSION_ID'];

      afterEach(() => {
        if (ORIGINAL === undefined) {
          delete process.env['PTAH_MCP_HOST_SESSION_ID'];
        } else {
          process.env['PTAH_MCP_HOST_SESSION_ID'] = ORIGINAL;
        }
      });

      async function spawnAndReadParent(): Promise<unknown> {
        const { svc, api } = makeService();
        await svc.handleToolsCall(
          makeRequest({
            params: { name: 'agent_spawn', arguments: { task: 'echo hi' } },
          }),
        );
        return (api.spawn as jest.Mock).mock.calls[0][0].parentSessionId;
      }

      it('passes parentSessionId undefined when the env var is set but empty', async () => {
        process.env['PTAH_MCP_HOST_SESSION_ID'] = '';
        await expect(spawnAndReadParent()).resolves.toBeUndefined();
      });

      it('passes parentSessionId undefined when the env var is unset', async () => {
        delete process.env['PTAH_MCP_HOST_SESSION_ID'];
        await expect(spawnAndReadParent()).resolves.toBeUndefined();
      });

      it('still threads a real host session id through to spawn', async () => {
        process.env['PTAH_MCP_HOST_SESSION_ID'] = 'host-session-uuid';
        await expect(spawnAndReadParent()).resolves.toBe('host-session-uuid');
      });
    });

    it('routes agent_status to PtahAPI.agent.status', async () => {
      const statusResult = [
        {
          agentId: 'a-1',
          cli: 'codex',
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
      expect(api.read).toHaveBeenCalledWith('a-1', 50, undefined);
    });

    // TASK_2026_559 Batch 13: the shared ptah_agent_read schema has `offset`,
    // and the structured result carries the window counts (Batch 12 r1 M2).
    it('routes agent_read with offset and reports the window counts', async () => {
      const { svc, api } = makeService({
        read: jest.fn().mockResolvedValue({
          agentId: 'a-1',
          stdout: 'l11\nl12\n',
          stderr: '',
          lineCount: 2,
          totalLines: 40,
          omittedLines: 38,
          stdoutTotalLines: 40,
          stderrTotalLines: 0,
          truncated: false,
        }) as never,
      });
      const resp = await svc.handleToolsCall(
        makeRequest({
          params: {
            name: 'agent_read',
            arguments: { agentId: 'a-1', tail: 2, offset: 10 },
          },
        }),
      );
      expect(api.read).toHaveBeenCalledWith('a-1', 2, 10);
      const result = resp.result as {
        isError?: boolean;
        content: Array<{ text: string }>;
        structuredContent: Record<string, unknown>;
      };
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({
        agentId: 'a-1',
        lineCount: 2,
        totalLines: 40,
        omittedLines: 38,
        stdout: { totalLines: 40, shownLines: 2, firstLine: 11, lastLine: 12 },
        stderr: { totalLines: 0, shownLines: 0, firstLine: 0, lastLine: 0 },
        truncated: false,
      });
      expect(result.content[0].text).toContain(
        'Showing lines 11-12 of 40 (38 omitted; pass offset/tail to page)',
      );
    });

    it('rejects a negative agent_read offset as mcp_invalid_tool_args', async () => {
      const { svc, api } = makeService();
      const resp = await svc.handleToolsCall(
        makeRequest({
          params: {
            name: 'agent_read',
            arguments: { agentId: 'a-1', offset: -1 },
          },
        }),
      );
      expect(api.read).not.toHaveBeenCalled();
      expect(JSON.stringify(resp)).toContain('mcp_invalid_tool_args');
    });

    it('routes agent_message to PtahAPI.agent.message and reports the mode', async () => {
      const { svc, api } = makeService();
      const resp = await svc.handleToolsCall(
        makeRequest({
          params: {
            name: 'agent_message',
            arguments: { agentId: 'a-1', message: 'be brief' },
          },
        }),
      );
      expect(api.message).toHaveBeenCalledWith('a-1', 'be brief');
      const result = resp.result as {
        structuredContent: { agentId: string; mode: string };
      };
      expect(result.structuredContent.mode).toBe('queue-next-turn');
    });

    it('refuses agent_report with unattributed-caller when no agent id was declared', async () => {
      // No PTAH_MCP_HOST_AGENT_ID in the test environment, so the stdio
      // surface cannot attribute the report — and must say so rather than
      // guess which agent is speaking.
      const { svc, api } = makeService();
      const resp = await svc.handleToolsCall(
        makeRequest({
          params: { name: 'agent_report', arguments: { message: 'blocked' } },
        }),
      );
      expect(api.report).not.toHaveBeenCalled();
      const result = resp.result as {
        structuredContent: { delivered: boolean; reason: string };
      };
      expect(result.structuredContent.delivered).toBe(false);
      expect(result.structuredContent.reason).toBe('unattributed-caller');
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
        { cli: 'codex', installed: true, messagingMode: 'queue' },
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
            new Error('CLI agent unavailable: codex'),
          ) as never,
      });
      const resp = await svc.handleToolsCall(
        makeRequest({
          params: {
            name: 'agent_spawn',
            arguments: { task: 'echo hi', cli: 'codex' },
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
        agent_message: { agentId: 'a-1', message: 'go' },
        agent_report: { message: 'go' },
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

  // TASK_2026_559 Batch 13, review r1 F4: the stdio read is held to the same
  // result budget as the HTTP one, keeping the newest lines.
  describe('agent_read result budget', () => {
    // The stdio spool root is the host process's working directory; point it
    // at a throw-away directory so no spec writes into a real one.
    let spoolRoot: string;

    beforeEach(() => {
      spoolRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-b13-stdio-'));
      jest.spyOn(process, 'cwd').mockReturnValue(spoolRoot);
    });

    afterEach(() => {
      jest.restoreAllMocks();
      fs.rmSync(spoolRoot, { recursive: true, force: true });
    });

    /** The spool file a `Lines <range> in full: <path>` notice names, read back. */
    function spooledWindow(text: string, range: string): string {
      const named = new RegExp(`Lines ${range} in full: (\\S+)`).exec(text);
      expect(named).not.toBeNull();
      const file = named?.[1] ?? '';
      expect(path.dirname(file)).toBe(
        path.join(spoolRoot, '.ptah', 'tmp', 'mcp-out'),
      );
      return fs.readFileSync(file, 'utf8');
    }

    // Review r2 R2-S1 on the stdio surface: the clipped middle is reachable.
    it('spools the whole window when a line is clipped, and names the file', async () => {
      const line =
        'BEGIN ' +
        'a'.repeat(20_000) +
        ' MIDDLE_FAILURE ' +
        'b'.repeat(20_000) +
        ' END';
      const { svc } = makeService({
        read: jest.fn().mockResolvedValue({
          agentId: 'a-1',
          stdout: `${line}\n`,
          stderr: '',
          lineCount: 1,
          totalLines: 1,
          omittedLines: 0,
          stdoutTotalLines: 1,
          stderrTotalLines: 0,
          truncated: false,
        }) as never,
      });
      const resp = await svc.handleToolsCall(
        makeRequest({
          params: { name: 'agent_read', arguments: { agentId: 'a-1' } },
        }),
      );
      const text = (resp.result as { content: Array<{ text: string }> })
        .content[0].text;
      expect(text.length).toBeLessThanOrEqual(DEFAULT_TOOL_RESULT_BUDGET_CHARS);
      expect(countTokensPiecewise(text)).toBeLessThanOrEqual(
        DEFAULT_TOOL_RESULT_BUDGET_TOKENS,
      );
      expect(text).toContain(' END');
      expect(spooledWindow(text, '1-1')).toBe(`${line}\n`);
    });

    function longLines(count: number): string[] {
      return Array.from({ length: count }, (_, i) => {
        const head =
          i === count - 1
            ? `[L${i + 1}] FINAL_FAILURE exit 1 `
            : `[L${i + 1}] step ok `;
        return head + 'x'.repeat(200 - head.length);
      });
    }

    it('returns the default read of 200 long lines within both limits, keeping the final line, with counts that match the text', async () => {
      const lines = longLines(5_000);
      const shown = lines.slice(-200);
      const { svc } = makeService({
        read: jest.fn().mockResolvedValue({
          agentId: 'a-1',
          stdout: shown.join('\n') + '\n',
          stderr: '',
          lineCount: 200,
          totalLines: 5_000,
          omittedLines: 4_800,
          stdoutTotalLines: 5_000,
          stderrTotalLines: 0,
          truncated: false,
        }) as never,
      });
      const resp = await svc.handleToolsCall(
        makeRequest({
          params: { name: 'agent_read', arguments: { agentId: 'a-1' } },
        }),
      );
      const result = resp.result as {
        content: Array<{ text: string }>;
        structuredContent: { lineCount: number; omittedLines: number };
      };
      const text = result.content[0].text;
      expect(text.length).toBeLessThanOrEqual(DEFAULT_TOOL_RESULT_BUDGET_CHARS);
      expect(countTokensPiecewise(text)).toBeLessThanOrEqual(
        DEFAULT_TOOL_RESULT_BUDGET_TOKENS,
      );
      expect(text).toContain('[L5000] FINAL_FAILURE');
      const visible = [...text.matchAll(/\[L(\d+)\]/g)].length;
      expect(visible).toBeGreaterThan(0);
      expect(result.structuredContent.lineCount).toBe(visible);
      expect(result.structuredContent.omittedLines).toBe(5_000 - visible);
      expect(text).toContain(
        `Showing lines ${5_001 - visible}-5000 of 5000 (${
          5_000 - visible
        } omitted; pass offset/tail to page)`,
      );
      expect(spooledWindow(text, '4801-5000')).toBe(shown.join('\n') + '\n');
    });
  });

  // TASK_2026_559 Batch 13, review r1 F2: the repeat-status throttle applies
  // to the stdio surface too, keyed by the host-declared session.
  describe('agent_status repeat throttle', () => {
    const ORIGINAL = process.env['PTAH_MCP_HOST_SESSION_ID'];
    const T0 = Date.parse('2026-09-26T10:00:00.000Z');
    let now = T0;

    beforeEach(() => {
      now = T0;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
      jest.restoreAllMocks();
      if (ORIGINAL === undefined) {
        delete process.env['PTAH_MCP_HOST_SESSION_ID'];
      } else {
        process.env['PTAH_MCP_HOST_SESSION_ID'] = ORIGINAL;
      }
    });

    const running = {
      agentId: 'a-1',
      cli: 'codex',
      status: 'running',
      task: 'noop',
      startedAt: '2026-09-26T09:59:00.000Z',
    };

    const statusCall = (svc: StdioMcpServerService) =>
      svc.handleToolsCall(
        makeRequest({
          params: { name: 'agent_status', arguments: { agentId: 'a-1' } },
        }),
      );

    type StatusResult = {
      content: Array<{ text: string }>;
      structuredContent: Record<string, unknown>;
    };

    it('answers a repeat within 60 s with one line and no agent body, then the full body after 60 s', async () => {
      process.env['PTAH_MCP_HOST_SESSION_ID'] = 'host-session-1';
      const { svc } = makeService({
        status: jest.fn().mockResolvedValue(running) as never,
      });

      const first = (await statusCall(svc)).result as StatusResult;
      expect(first.content[0].text).toContain('## Agent Status');

      now = T0 + 20_000;
      const second = (await statusCall(svc)).result as StatusResult;
      expect(second.content[0].text).toMatch(
        /^Status unchanged since 2026-09-26T10:00:00\.000Z \(running\)\./,
      );
      expect(second.content[0].text).not.toContain('## Agent Status');
      expect(second.structuredContent).toEqual({
        agentId: 'a-1',
        status: 'running',
        unchangedSince: '2026-09-26T10:00:00.000Z',
      });

      now = T0 + 60_000;
      const third = (await statusCall(svc)).result as StatusResult;
      expect(third.content[0].text).toContain('## Agent Status');
    });

    it('returns the full body for a finished agent and for a caller without identity', async () => {
      process.env['PTAH_MCP_HOST_SESSION_ID'] = 'host-session-1';
      const done = makeService({
        status: jest.fn().mockResolvedValue({
          ...running,
          status: 'completed',
          exitCode: 0,
        }) as never,
      });
      await statusCall(done.svc);
      now = T0 + 1_000;
      expect(
        ((await statusCall(done.svc)).result as StatusResult).content[0].text,
      ).toContain('**Status:** completed');

      delete process.env['PTAH_MCP_HOST_SESSION_ID'];
      const anonymous = makeService({
        status: jest.fn().mockResolvedValue(running) as never,
      });
      await statusCall(anonymous.svc);
      now = T0 + 2_000;
      expect(
        ((await statusCall(anonymous.svc)).result as StatusResult).content[0]
          .text,
      ).toContain('## Agent Status');
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

  describe('SDK init failure envelope', () => {
    it('first tools/call returns sdk_init_failed envelope when apiBuilder.build() throws', async () => {
      const buildFn = jest.fn(() => {
        throw new Error('boom: anthropic credential missing');
      });
      const builder = { build: buildFn } as unknown as PtahAPIBuilder;
      const svc = new StdioMcpServerService(makeLogger(), builder);
      const resp = await svc.handleToolsCall(
        makeRequest({
          params: {
            name: 'agent_spawn',
            arguments: { task: 'echo hi', cli: 'codex' },
          },
        }),
      );
      expect(resp.error).toBeUndefined();
      const result = resp.result as {
        isError: boolean;
        content: { type: string; text: string }[];
        structuredContent: { ptah_code: string; tool: string; error: string };
      };
      expect(result.isError).toBe(true);
      expect(result.structuredContent.ptah_code).toBe('sdk_init_failed');
      expect(result.structuredContent.tool).toBe('agent_spawn');
      expect(result.structuredContent.error).toContain(
        'anthropic credential missing',
      );
      expect(result.content[0].text).toContain('Ptah SDK failed to initialize');
      expect(result.content[0].text).toContain('ptah doctor');
      expect(buildFn).toHaveBeenCalledTimes(1);
    });

    it('subsequent tools/call returns sdk_init_failed envelope without re-invoking apiBuilder.build()', async () => {
      const buildFn = jest.fn(() => {
        throw new Error('boom');
      });
      const builder = { build: buildFn } as unknown as PtahAPIBuilder;
      const svc = new StdioMcpServerService(makeLogger(), builder);
      const first = await svc.handleToolsCall(
        makeRequest({
          params: {
            name: 'agent_spawn',
            arguments: { task: 'echo hi', cli: 'codex' },
          },
        }),
      );
      const second = await svc.handleToolsCall(
        makeRequest({
          params: { name: 'agent_list', arguments: {} },
        }),
      );
      // Builder ran once; cached failure short-circuits the second call.
      expect(buildFn).toHaveBeenCalledTimes(1);
      const r1 = first.result as {
        isError: boolean;
        structuredContent: { ptah_code: string };
      };
      const r2 = second.result as {
        isError: boolean;
        structuredContent: { ptah_code: string };
      };
      expect(r1.structuredContent.ptah_code).toBe('sdk_init_failed');
      expect(r2.structuredContent.ptah_code).toBe('sdk_init_failed');
    });

    it('PTAH_TEST_BREAK_SDK_INIT=1 forces sdk_init_failed without invoking apiBuilder.build()', async () => {
      const buildFn = jest.fn(() => ({}) as unknown);
      const builder = { build: buildFn } as unknown as PtahAPIBuilder;
      const svc = new StdioMcpServerService(makeLogger(), builder);
      const prior = process.env['PTAH_TEST_BREAK_SDK_INIT'];
      process.env['PTAH_TEST_BREAK_SDK_INIT'] = '1';
      try {
        const resp = await svc.handleToolsCall(
          makeRequest({
            params: {
              name: 'agent_spawn',
              arguments: { task: 't', cli: 'codex' },
            },
          }),
        );
        expect(resp.error).toBeUndefined();
        const result = resp.result as {
          isError: boolean;
          structuredContent: { ptah_code: string; error: string };
        };
        expect(result.isError).toBe(true);
        expect(result.structuredContent.ptah_code).toBe('sdk_init_failed');
        expect(result.structuredContent.error).toContain(
          'PTAH_TEST_BREAK_SDK_INIT',
        );
        expect(buildFn).not.toHaveBeenCalled();
      } finally {
        if (prior === undefined) {
          delete process.env['PTAH_TEST_BREAK_SDK_INIT'];
        } else {
          process.env['PTAH_TEST_BREAK_SDK_INIT'] = prior;
        }
      }
    });

    it('session_submit dispatch is unaffected by SDK-init failure (does not use agent dispatcher)', async () => {
      const buildFn = jest.fn(() => {
        throw new Error('boom');
      });
      const builder = { build: buildFn } as unknown as PtahAPIBuilder;
      const svc = new StdioMcpServerService(makeLogger(), builder);
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
      await svc.handleToolsCall(
        makeRequest({
          params: { name: 'session_submit', arguments: { task: 'go' } },
        }),
      );
      // session_submit routes via the handler, not the agent dispatcher.
      expect(handler.dispatch).toHaveBeenCalledTimes(1);
      expect(buildFn).not.toHaveBeenCalled();
    });
  });

  describe('unconditional tool availability (open source)', () => {
    it('allows agent_spawn with a ptahCliId provider (previously Pro-gated)', async () => {
      const { svc, api } = makeService();
      const resp = await svc.handleToolsCall(
        makeRequest({
          params: {
            name: 'agent_spawn',
            arguments: { task: 't', ptahCliId: 'openrouter' },
          },
        }),
      );
      expect(resp.error).toBeUndefined();
      const result = resp.result as { isError?: boolean };
      // No license gate: the previously Pro-only provider path is now allowed
      // straight through to the underlying PtahAPI.
      expect(result.isError).toBeUndefined();
      expect(api.spawn).toHaveBeenCalledTimes(1);
      const arg = (api.spawn as jest.Mock).mock.calls[0][0];
      expect(arg.ptahCliId).toBe('openrouter');
    });

    it('dispatches session_submit to the registered handler (previously Pro-gated)', async () => {
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
        params: { name: 'session_submit', arguments: { task: 'go' } },
      });
      const resp = await svc.handleToolsCall(req);
      expect(handler.dispatch).toHaveBeenCalledWith(req, { task: 'go' });
      expect((resp.result as { isError?: boolean }).isError).toBeUndefined();
    });

    it('passes agent_spawn through to PtahAPI unconditionally', async () => {
      const { svc, api } = makeService();
      const resp = await svc.handleToolsCall(
        makeRequest({
          params: {
            name: 'agent_spawn',
            arguments: { task: 'go', cli: 'codex' },
          },
        }),
      );
      expect(resp.error).toBeUndefined();
      expect(api.spawn).toHaveBeenCalled();
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

/**
 * Batch 10 regressions: a peer `notifications/cancelled` aborts the matching
 * wrapper-tool call (Task 10.1), and `dispose()` at stream end aborts every
 * call in flight and kills every live `run_check` tree (Task 10.2).
 */
describe('StdioMcpServerService request abort and dispose', () => {
  /** An `agent_wait` whose manager only returns when its signal fires. */
  function waitUntilAborted(): {
    agentApi: Partial<PtahAPI['agent']>;
    seen: () => AbortSignal | undefined;
  } {
    let seen: AbortSignal | undefined;
    const waitForAgents = jest.fn(
      (
        ids: readonly string[],
        mode: 'all' | 'any',
        _timeoutMs: number,
        signal?: AbortSignal,
      ) =>
        new Promise((resolve) => {
          seen = signal;
          signal?.addEventListener(
            'abort',
            () =>
              resolve({
                mode,
                timedOut: false,
                cancelled: true,
                waitedMs: 1,
                entries: ids.map((agentId) => ({
                  agentId,
                  state: 'running',
                  info: {
                    agentId,
                    cli: 'codex',
                    status: 'running',
                    task: 't',
                    startedAt: '2026-05-24T00:00:00Z',
                  },
                })),
              }),
            { once: true },
          );
        }),
    );
    return {
      agentApi: { waitForAgents } as unknown as Partial<PtahAPI['agent']>,
      seen: () => seen,
    };
  }

  function waitCall(id: string | number): MCPRequest {
    return makeRequest({
      id,
      params: { name: 'agent_wait', arguments: { agentIds: ['a-1'] } },
    });
  }

  async function untilSeen(seen: () => AbortSignal | undefined): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (seen() === undefined && Date.now() < deadline) {
      await new Promise((r) => setImmediate(r));
    }
    expect(seen()).toBeInstanceOf(AbortSignal);
  }

  it('aborts the agent_wait whose id the peer cancels, not the session-submit handler', async () => {
    const wait = waitUntilAborted();
    const { svc } = makeService(wait.agentApi);
    const handler: jest.Mocked<ISessionSubmitHandler> = {
      dispatch: jest.fn(),
      cancel: jest.fn().mockResolvedValue(undefined),
    };
    svc.setSessionSubmitHandler(handler);

    const pending = svc.handleToolsCall(waitCall('r-7'));
    await untilSeen(wait.seen);
    expect(wait.seen()?.aborted).toBe(false);

    await svc.handleCancelled({ requestId: 'r-7' });
    const resp = await pending;

    expect(wait.seen()?.aborted).toBe(true);
    expect(handler.cancel).not.toHaveBeenCalled();
    // The reply exists but is flagged: the transport must not send it.
    expect(svc.wasCancelledByPeer(resp)).toBe(true);
  });

  it('leaves a call alone when the cancel names another id', async () => {
    const wait = waitUntilAborted();
    const { svc } = makeService(wait.agentApi);
    const pending = svc.handleToolsCall(waitCall(8));
    await untilSeen(wait.seen);

    await svc.handleCancelled({ requestId: 9 });
    expect(wait.seen()?.aborted).toBe(false);

    await svc.dispose();
    const resp = await pending;
    expect(wait.seen()?.aborted).toBe(true);
    // Aborted by shutdown, not by the peer: not a peer-cancelled reply.
    expect(svc.wasCancelledByPeer(resp)).toBe(false);
  });

  it('does not flag a call that settled before the cancel arrived', async () => {
    const { svc } = makeService();
    const resp = await svc.handleToolsCall(
      makeRequest({
        id: 'done-1',
        params: { name: 'agent_list', arguments: {} },
      }),
    );
    await svc.handleCancelled({ requestId: 'done-1' });
    expect(svc.wasCancelledByPeer(resp)).toBe(false);
  });

  it('flags a session_submit reply the peer cancelled while it ran, and still forwards the cancel', async () => {
    const { svc } = makeService();
    let finish: (value: MCPResponse) => void = () => undefined;
    const handler: jest.Mocked<ISessionSubmitHandler> = {
      dispatch: jest.fn(
        (request: MCPRequest, _args: unknown) =>
          new Promise<MCPResponse>((resolve) => {
            finish = (value) => resolve({ ...value, id: request.id });
          }),
      ),
      cancel: jest.fn().mockResolvedValue(undefined),
    };
    svc.setSessionSubmitHandler(handler);

    const submitCall = (id: string): MCPRequest =>
      makeRequest({
        id,
        params: { name: 'session_submit', arguments: { prompt: 'x' } },
      });
    const reply: MCPResponse = {
      jsonrpc: '2.0',
      id: 0,
      result: { content: [{ type: 'text', text: 'cancelled' }] },
    };

    const pending = svc.handleToolsCall(submitCall('s-1'));
    await new Promise((r) => setImmediate(r));
    await svc.handleCancelled({ requestId: 's-1' });
    expect(handler.cancel).toHaveBeenCalledWith({ requestId: 's-1' });
    finish(reply);
    expect(svc.wasCancelledByPeer(await pending)).toBe(true);

    const uncancelled = svc.handleToolsCall(submitCall('s-2'));
    await new Promise((r) => setImmediate(r));
    finish(reply);
    expect(svc.wasCancelledByPeer(await uncancelled)).toBe(false);
  });

  it('refuses a second call that reuses an id in flight, and the cancel still reaches the first', async () => {
    const wait = waitUntilAborted();
    const { svc } = makeService(wait.agentApi);
    const first = svc.handleToolsCall(waitCall('dup-1'));
    await untilSeen(wait.seen);
    const firstSignal = wait.seen();

    const second = await svc.handleToolsCall(waitCall('dup-1'));
    expect(second.error?.code).toBe(-32600);
    expect(second.error?.message).toContain('dup-1');
    expect(second.result).toBeUndefined();

    await svc.handleCancelled({ requestId: 'dup-1' });
    expect(firstSignal?.aborted).toBe(true);
    const resp = await first;
    expect(
      (resp.result as { structuredContent: { cancelled: boolean } })
        .structuredContent.cancelled,
    ).toBe(true);
  });

  it('accepts an id again once the call that used it has settled', async () => {
    const wait = waitUntilAborted();
    const { svc } = makeService(wait.agentApi);
    const first = svc.handleToolsCall(waitCall(11));
    await untilSeen(wait.seen);
    await svc.handleCancelled({ requestId: 11 });
    await first;

    const again = svc.handleToolsCall(waitCall(11));
    const deadline = Date.now() + 5_000;
    while (wait.seen()?.aborted !== false && Date.now() < deadline) {
      await new Promise((r) => setImmediate(r));
    }
    expect(wait.seen()?.aborted).toBe(false);
    await svc.dispose();
    expect((await again).error).toBeUndefined();
  });

  it('dispose() kills a live run_check tree by its pid', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-stdio-dispose-'));
    try {
      const entry = path.join(root, ...NX_ENTRY_CANDIDATES[0]);
      fs.mkdirSync(path.dirname(entry), { recursive: true });
      fs.writeFileSync(entry, '');
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        pid: 6161,
      });
      const spawnProcess = jest.fn(() => child as unknown as CheckProcess);
      const killTree = jest.fn(async () => {
        child.stdout.end();
        child.stderr.end();
        setImmediate(() => child.emit('close', null, 'SIGTERM'));
      });
      const run = runCheck(
        RunCheckArgsSchema.parse({ project: 'app', targets: ['test'] }),
        {
          workspaceRoot: root,
          spawnProcess: spawnProcess as unknown as SpawnCheckProcess,
          killTree,
        },
      );
      const deadline = Date.now() + 5_000;
      while (!runningCheckPids().includes(6161) && Date.now() < deadline) {
        await new Promise((r) => setImmediate(r));
      }
      expect(runningCheckPids()).toContain(6161);

      const { svc } = makeService();
      await svc.dispose();

      expect(killTree).toHaveBeenCalledWith(6161);
      expect((await run).structured.verdict).toBe('cancelled');
      expect(runningCheckPids()).not.toContain(6161);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
