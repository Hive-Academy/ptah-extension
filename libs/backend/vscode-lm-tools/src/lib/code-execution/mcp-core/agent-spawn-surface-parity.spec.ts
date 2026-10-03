// tool-description.builder reads the language registry (Batch 24c) from the
// workspace-intelligence barrel, whose DI services need the reflect polyfill.
import 'reflect-metadata';
import { AgentSpawnArgsSchema } from './agent-spawn-args.schema';
import { buildAgentSpawnTool } from './tool-description.builder';
import { getToolResultBudget } from './tool-result-budget';
import { buildMcpAgentSpawnTool } from '../mcp-stdio/tool-builders';
import { AgentToolDispatcher } from '../mcp-stdio/agent-tool.dispatcher';
import {
  handleMCPRequest,
  type ProtocolHandlerDependencies,
} from './protocol-dispatcher';
import type { Logger } from '@ptah-extension/vscode-core';
import type { MCPRequest, MCPResponse, PtahAPI } from '../types';

function quietLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function spawnMock(): jest.Mock {
  return jest.fn().mockResolvedValue({
    agentId: 'a-1',
    cli: 'codex',
    status: 'running',
    startedAt: '2026-10-03T00:00:00.000Z',
  });
}

function isError(response: MCPResponse | null): boolean {
  return (
    (response?.result as { isError?: boolean } | undefined)?.isError === true
  );
}

/** Spawn through the HTTP surface; returns the request PtahAPI received. */
async function spawnOverHttp(
  args: Record<string, unknown>,
): Promise<{ spawn: jest.Mock; response: MCPResponse | null }> {
  const spawn = spawnMock();
  const deps: ProtocolHandlerDependencies = {
    ptahAPI: { agent: { spawn } } as unknown as PtahAPI,
    permissionPromptService:
      {} as ProtocolHandlerDependencies['permissionPromptService'],
    logger: quietLogger(),
  };
  const request: MCPRequest = {
    jsonrpc: '2.0',
    id: 'parity',
    method: 'tools/call',
    params: { name: 'ptah_agent_spawn', arguments: args },
  };
  return { spawn, response: await handleMCPRequest(request, deps) };
}

/** Spawn through the stdio surface; returns the request PtahAPI received. */
async function spawnOverStdio(
  args: Record<string, unknown>,
): Promise<{ spawn: jest.Mock; response: MCPResponse | null }> {
  const spawn = spawnMock();
  const dispatcher = new AgentToolDispatcher(
    { agent: { spawn } } as unknown as PtahAPI,
    quietLogger(),
  );
  const request: MCPRequest = {
    jsonrpc: '2.0',
    id: 'parity',
    method: 'tools/call',
  };
  return {
    spawn,
    response: await dispatcher.dispatch('agent_spawn', request, args),
  };
}

describe('agent spawn surface parity', () => {
  it('advertises exactly the keys the shared schema accepts', () => {
    const advertised = Object.keys(
      buildAgentSpawnTool().inputSchema.properties,
    ).sort();
    const accepted = Object.keys(AgentSpawnArgsSchema.shape).sort();

    expect(advertised).toEqual(accepted);
  });

  it('gives the stdio tool the HTTP definition under its own name', () => {
    const http = buildAgentSpawnTool();
    const stdio = buildMcpAgentSpawnTool();

    expect(http.name).toBe('ptah_agent_spawn');
    expect(stdio.name).toBe('agent_spawn');
    // The HTTP `tools/list` stamps the result ceiling onto the builder's
    // definition (`declareResultBudgets`); the stdio builder declares the
    // same ceiling itself, so the two served definitions are equal.
    expect({ ...stdio, name: http.name }).toEqual({
      ...http,
      _meta: {
        ...http._meta,
        'anthropic/maxResultSizeChars': getToolResultBudget(http.name).chars,
      },
    });
  });

  it('requires only task on both surfaces', () => {
    expect(buildAgentSpawnTool().inputSchema.required).toEqual(['task']);
    expect(buildMcpAgentSpawnTool().inputSchema.required).toEqual(['task']);
    expect(AgentSpawnArgsSchema.safeParse({ task: 't' }).success).toBe(true);
  });

  it('advertises effort as a string on both surfaces', () => {
    for (const tool of [buildAgentSpawnTool(), buildMcpAgentSpawnTool()]) {
      const effort = (
        tool.inputSchema.properties as Record<string, { type?: string }>
      )['effort'];
      expect(effort?.type).toBe('string');
    }
  });

  it('forwards the same SpawnAgentRequest from HTTP and stdio, effort included', async () => {
    const args = {
      task: 'Review the diff',
      cli: 'codex',
      role: 'code-logic-reviewer',
      effort: 'high',
      model: 'm-1',
      deliverables: ['review.md'],
    };

    const http = await spawnOverHttp(args);
    const stdio = await spawnOverStdio(args);

    expect(isError(http.response)).toBe(false);
    expect(isError(stdio.response)).toBe(false);
    expect(http.spawn).toHaveBeenCalledTimes(1);
    expect(stdio.spawn).toHaveBeenCalledTimes(1);
    const fromHttp = http.spawn.mock.calls[0][0];
    const fromStdio = stdio.spawn.mock.calls[0][0];
    expect(fromHttp.effort).toBe('high');
    expect(fromStdio).toEqual(fromHttp);
  });

  it('passes an effort the CLI may not take through unchanged (the policy decides)', async () => {
    const http = await spawnOverHttp({ task: 't', effort: 'ultra' });
    const stdio = await spawnOverStdio({ task: 't', effort: 'ultra' });

    expect(http.spawn.mock.calls[0][0].effort).toBe('ultra');
    expect(stdio.spawn.mock.calls[0][0].effort).toBe('ultra');
  });

  it('leaves effort undefined on both surfaces when it is omitted', async () => {
    const http = await spawnOverHttp({ task: 't' });
    const stdio = await spawnOverStdio({ task: 't' });

    expect(http.spawn.mock.calls[0][0].effort).toBeUndefined();
    expect(stdio.spawn.mock.calls[0][0].effort).toBeUndefined();
  });

  it.each([
    ['a number', 3],
    ['an empty string', ''],
    ['an over-long string', 'x'.repeat(33)],
    ['an object', { level: 'high' }],
  ])(
    'rejects effort as %s on both surfaces without spawning',
    async (_label, effort) => {
      const http = await spawnOverHttp({ task: 't', effort });
      const stdio = await spawnOverStdio({ task: 't', effort });

      expect(isError(http.response)).toBe(true);
      expect(isError(stdio.response)).toBe(true);
      expect(http.spawn).not.toHaveBeenCalled();
      expect(stdio.spawn).not.toHaveBeenCalled();
    },
  );
});
