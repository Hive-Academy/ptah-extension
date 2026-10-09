// tool-description.builder reads the language registry (Batch 24c) from the
// workspace-intelligence barrel, whose DI services need the reflect polyfill.
import 'reflect-metadata';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentSpawnArgsSchema } from './agent-spawn-args.schema';
import { buildAgentSpawnTool } from './tool-description.builder';
import { getToolResultBudget } from './tool-result-budget';
import {
  AgentWaitArgsSchema,
  RunCheckArgsSchema,
} from './wait-tools-args.schema';
import { buildAgentWaitTool } from './agent-wait.tool';
import { buildRunCheckTool } from './run-check.tool';
import {
  buildMcpAgentSpawnTool,
  buildMcpAgentWaitTool,
  buildMcpMvpTools,
  buildMcpRunCheckTool,
} from '../mcp-stdio/tool-builders';
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

  it('gives spawn each transport its own name and wait guidance', () => {
    const http = buildAgentSpawnTool();
    const stdio = buildMcpAgentSpawnTool();

    expect(http.name).toBe('ptah_agent_spawn');
    expect(stdio.name).toBe('agent_spawn');
    expect(stdio.inputSchema).toEqual(http.inputSchema);
    expect(stdio._meta).toEqual({
      ...http._meta,
      'anthropic/maxResultSizeChars': getToolResultBudget(http.name).chars,
    });
    expect(http.description).toContain('HTTP calls wait at most 45 s');
    expect(stdio.description).not.toContain('HTTP');
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

// ---------------------------------------------------------------------------
// Blocking waits (TASK_2026_597, Batch 34): ptah_agent_wait / agent_wait and
// ptah_run_check / run_check are served by both surfaces with one contract.
// ---------------------------------------------------------------------------

function textOf(response: MCPResponse | null): string {
  const content = (
    response?.result as { content?: Array<{ text?: string }> } | undefined
  )?.content;
  return content?.[0]?.text ?? '';
}

async function callOverHttp(
  name: string,
  args: Record<string, unknown>,
  ptahAPI: unknown,
  workspaceFolders: string[] = [],
  declaredRoot?: string,
): Promise<MCPResponse> {
  const deps: ProtocolHandlerDependencies = {
    ptahAPI: ptahAPI as PtahAPI,
    permissionPromptService:
      {} as ProtocolHandlerDependencies['permissionPromptService'],
    logger: quietLogger(),
    workspaceProvider: { getWorkspaceFolders: () => workspaceFolders },
  };
  return handleMCPRequest(
    {
      jsonrpc: '2.0',
      id: 'parity',
      method: 'tools/call',
      params: { name, arguments: args },
      ...(declaredRoot !== undefined
        ? { _callerWorkspaceRoot: declaredRoot }
        : {}),
    },
    deps,
  );
}

async function callOverStdio(
  name: string,
  args: Record<string, unknown>,
  ptahAPI: unknown,
  spoolRoot: string = tmpdir(),
): Promise<MCPResponse | null> {
  const dispatcher = new AgentToolDispatcher(
    ptahAPI as PtahAPI,
    quietLogger(),
    undefined,
    undefined,
    () => Date.now(),
    () => spoolRoot,
  );
  return dispatcher.dispatch(
    name,
    { jsonrpc: '2.0', id: 'parity', method: 'tools/call' },
    args,
  );
}

function waitApi(): {
  agent: { waitForAgents: jest.Mock; read: jest.Mock };
} {
  return {
    agent: {
      waitForAgents: jest.fn().mockResolvedValue({
        mode: 'all',
        timedOut: false,
        waitedMs: 4_000,
        entries: [
          {
            agentId: 'a-1',
            state: 'exited',
            info: {
              agentId: 'a-1',
              cli: 'codex',
              task: 't',
              workingDirectory: '/ws',
              status: 'completed',
              exitCode: 0,
              startedAt: '2026-10-03T00:00:00.000Z',
              completedAt: '2026-10-03T00:01:00.000Z',
            },
          },
          { agentId: 'ghost', state: 'not_found' },
        ],
      }),
      read: jest.fn().mockResolvedValue({
        agentId: 'a-1',
        stdout: 'line one\nWROTE: review.md\n',
        stderr: '',
        lineCount: 2,
        totalLines: 2,
        truncated: false,
      }),
    },
  };
}

describe('blocking wait surface parity', () => {
  it.each([
    [
      'ptah_agent_wait',
      'agent_wait',
      buildAgentWaitTool,
      buildMcpAgentWaitTool,
    ],
    ['ptah_run_check', 'run_check', buildRunCheckTool, buildMcpRunCheckTool],
  ] as const)(
    '%s and stdio %s serve the same definition under their own names',
    (httpName, stdioName, buildHttp, buildStdio) => {
      const http = buildHttp();
      const stdio = buildStdio();

      expect(http.name).toBe(httpName);
      expect(stdio.name).toBe(stdioName);
      if (httpName === 'ptah_agent_wait') {
        expect(stdio.inputSchema).toMatchObject({
          type: http.inputSchema.type,
          required: http.inputSchema.required,
        });
        expect(stdio.inputSchema.properties['timeoutSec']).toMatchObject({
          maximum: 900,
        });
      } else {
        expect(stdio.inputSchema).toEqual(http.inputSchema);
      }
      expect(stdio._meta).toEqual({
        ...http._meta,
        'anthropic/maxResultSizeChars': getToolResultBudget(http.name).chars,
      });
      if (httpName === 'ptah_agent_wait') {
        expect(http.description).toContain('HTTP calls wait at most 45 s');
        expect(stdio.description).not.toContain('HTTP');
      } else {
        expect(stdio.description).toBe(http.description);
      }
    },
  );

  it('advertises exactly the keys each shared schema accepts', () => {
    expect(
      Object.keys(buildAgentWaitTool().inputSchema.properties).sort(),
    ).toEqual(Object.keys(AgentWaitArgsSchema.shape).sort());
    expect(
      Object.keys(buildRunCheckTool().inputSchema.properties).sort(),
    ).toEqual(Object.keys(RunCheckArgsSchema.shape).sort());
  });

  it('lists both tools on HTTP tools/list and on the stdio catalog', async () => {
    const deps: ProtocolHandlerDependencies = {
      ptahAPI: {} as PtahAPI,
      permissionPromptService:
        {} as ProtocolHandlerDependencies['permissionPromptService'],
      logger: quietLogger(),
    };
    const listed = await handleMCPRequest(
      { jsonrpc: '2.0', id: 'list', method: 'tools/list' },
      deps,
    );
    const httpNames = (
      listed.result as { tools: Array<{ name: string }> }
    ).tools.map((t) => t.name);
    const stdioNames = buildMcpMvpTools().map((t) => t.name);

    expect(httpNames).toEqual(
      expect.arrayContaining(['ptah_agent_wait', 'ptah_run_check']),
    );
    expect(stdioNames).toEqual(
      expect.arrayContaining(['agent_wait', 'run_check']),
    );
  });

  it('drops both tools from HTTP tools/list when the agent namespace is off', async () => {
    const deps: ProtocolHandlerDependencies = {
      ptahAPI: {} as PtahAPI,
      permissionPromptService:
        {} as ProtocolHandlerDependencies['permissionPromptService'],
      logger: quietLogger(),
      disabledMcpNamespaces: ['agent'],
    };
    const listed = await handleMCPRequest(
      { jsonrpc: '2.0', id: 'list', method: 'tools/list' },
      deps,
    );
    const names = (
      listed.result as { tools: Array<{ name: string }> }
    ).tools.map((t) => t.name);

    expect(names).not.toContain('ptah_agent_wait');
    expect(names).not.toContain('ptah_run_check');
  });

  it('waits through the same PtahAPI call and returns the same reply on both surfaces', async () => {
    const httpApi = waitApi();
    const stdioApi = waitApi();
    const args = { agentIds: ['a-1', 'ghost'], mode: 'all', timeoutSec: 30 };

    const http = await callOverHttp('ptah_agent_wait', args, httpApi);
    const stdio = await callOverStdio('agent_wait', args, stdioApi);

    expect(isError(http)).toBe(false);
    expect(isError(stdio)).toBe(false);
    // The 4th argument is the request's abort signal. Both harnesses call
    // the dispatchers without a transport, so neither carries one.
    expect(httpApi.agent.waitForAgents).toHaveBeenCalledWith(
      ['a-1', 'ghost'],
      'all',
      30_000,
      undefined,
    );
    expect(stdioApi.agent.waitForAgents.mock.calls).toEqual(
      httpApi.agent.waitForAgents.mock.calls,
    );
    expect(textOf(stdio)).toBe(textOf(http));
    expect(textOf(http)).toContain('WROTE: review.md');
    expect(textOf(http)).toContain('[ghost] not found');
    expect(textOf(http).length).toBeLessThanOrEqual(4_000);
    expect(
      (stdio?.result as { structuredContent?: unknown }).structuredContent,
    ).toEqual({
      timedOut: false,
      cancelled: false,
      lanes: [
        { agentId: 'a-1', state: 'exited', status: 'completed', exitCode: 0 },
        { agentId: 'ghost', state: 'not_found' },
      ],
    });
  });

  it('caps only HTTP waits below its request timeout and reports the partial result', async () => {
    const runningResult = {
      mode: 'all' as const,
      timedOut: true,
      cancelled: false,
      waitedMs: 45_000,
      entries: [
        {
          agentId: 'a-1',
          state: 'running' as const,
          info: {
            agentId: 'a-1',
            cli: 'codex' as const,
            task: 't',
            workingDirectory: '/ws',
            status: 'running' as const,
            startedAt: '2026-10-03T00:00:00.000Z',
          },
        },
      ],
    };
    const httpApi = waitApi();
    httpApi.agent.waitForAgents.mockResolvedValue(runningResult);
    const http = await callOverHttp(
      'ptah_agent_wait',
      { agentIds: ['a-1'], timeoutSec: 600 },
      httpApi,
    );

    expect(httpApi.agent.waitForAgents).toHaveBeenCalledWith(
      ['a-1'],
      'all',
      45_000,
      undefined,
    );
    expect(textOf(http)).toContain(
      'WAIT CAPPED at 45 s on the HTTP transport (requested 600 s): 0 of 1 known lane(s) ended, 1 still running. Partial result; call ptah_agent_wait again to keep waiting.',
    );
    expect(textOf(http).length).toBeLessThanOrEqual(4_000);

    const shortHttpApi = waitApi();
    await callOverHttp(
      'ptah_agent_wait',
      { agentIds: ['a-1'], timeoutSec: 20 },
      shortHttpApi,
    );
    expect(shortHttpApi.agent.waitForAgents).toHaveBeenCalledWith(
      ['a-1'],
      'all',
      20_000,
      undefined,
    );

    const stdioApi = waitApi();
    const stdio = await callOverStdio(
      'agent_wait',
      { agentIds: ['a-1'], timeoutSec: 600 },
      stdioApi,
    );
    expect(stdioApi.agent.waitForAgents).toHaveBeenCalledWith(
      ['a-1'],
      'all',
      600_000,
      undefined,
    );
    expect(textOf(stdio)).not.toContain('WAIT CAPPED');
    expect(textOf(stdio)).not.toContain('HTTP');
  });

  it('does not cap an HTTP zero-second wait', async () => {
    const api = waitApi();
    const reply = await callOverHttp(
      'ptah_agent_wait',
      { agentIds: ['a-1'], timeoutSec: 0 },
      api,
    );

    expect(api.agent.waitForAgents).toHaveBeenCalledWith(
      ['a-1'],
      'all',
      0,
      undefined,
    );
    expect(textOf(reply)).not.toContain('WAIT CAPPED');
  });

  it.each([
    ['no agentIds', {}],
    ['an empty agentIds', { agentIds: [] }],
    ['a timeout over 900 s', { agentIds: ['a'], timeoutSec: 901 }],
    ['an unknown mode', { agentIds: ['a'], mode: 'first' }],
    ['an unknown key', { agentIds: ['a'], pollInterval: 5 }],
  ])(
    'rejects agent_wait with %s on both surfaces without waiting',
    async (_label, args) => {
      const httpApi = waitApi();
      const stdioApi = waitApi();

      const http = await callOverHttp('ptah_agent_wait', args, httpApi);
      const stdio = await callOverStdio('agent_wait', args, stdioApi);

      expect(isError(http)).toBe(true);
      expect(isError(stdio)).toBe(true);
      expect(httpApi.agent.waitForAgents).not.toHaveBeenCalled();
      expect(stdioApi.agent.waitForAgents).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'a shell metacharacter in project',
      { project: 'app; rm -rf /', targets: ['test'] },
    ],
    ['a leading dash in project', { project: '--help', targets: ['test'] }],
    ['an unknown target', { project: 'app', targets: ['serve'] }],
    ['no targets', { project: 'app', targets: [] }],
    [
      'a workspace path argument',
      { project: 'app', targets: ['lint'], cwd: '/' },
    ],
  ])('rejects run_check with %s on both surfaces', async (_label, args) => {
    const http = await callOverHttp('ptah_run_check', args, {});
    const stdio = await callOverStdio('run_check', args, {});

    expect(isError(http)).toBe(true);
    expect(isError(stdio)).toBe(true);
    expect(textOf(http)).toMatch(/invalid ptah_run_check arguments/);
    expect(textOf(stdio)).toMatch(/Invalid arguments for run_check/);
  });

  it('runs the check in the caller workspace root on both surfaces (no Nx there: the same error, nothing spawned)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ptah-run-check-parity-'));
    try {
      const args = { project: 'app', targets: ['lint'] };
      // HTTP: the caller declares its root in the MCP URL (S4-a review S1);
      // stdio: the launching process's working directory.
      const http = await callOverHttp(
        'ptah_run_check',
        args,
        {},
        [root],
        root,
      );
      const stdio = await callOverStdio('run_check', args, {}, root);

      expect(isError(http)).toBe(true);
      expect(isError(stdio)).toBe(true);
      expect(textOf(http)).toContain('Nx was not found in this workspace');
      expect(textOf(http)).toContain(join(root, 'node_modules', 'nx'));
      expect(textOf(stdio)).toBe(textOf(http));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
