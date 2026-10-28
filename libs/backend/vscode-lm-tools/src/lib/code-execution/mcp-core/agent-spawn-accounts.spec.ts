/**
 * Public spawn drift tests for the Claude account selection (TASK_2026_712,
 * Batch 34c).
 *
 * Both MCP transports (HTTP `ptah_agent_spawn`, stdio `agent_spawn`) run
 * through the REAL `ptah.agent` namespace into a mocked process manager, so
 * every assertion reads the `SpawnAgentRequest` the runtime would receive.
 * Nothing executes a CLI: the process manager and the Ptah CLI registry are
 * jest mocks, and no sign-in or credential path is touched.
 */

// The tool builders and the cli-agent-runtime barrel reach tsyringe-decorated
// services, which need the reflect polyfill before they load.
import 'reflect-metadata';
import type {
  AgentProcessManager,
  CliDetectionService,
} from '@ptah-extension/cli-agent-runtime';
import { SYSTEM_CLI_TYPES } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { AgentSpawnArgsSchema } from './agent-spawn-args.schema';
import {
  handleMCPRequest,
  type ProtocolHandlerDependencies,
} from './protocol-dispatcher';
import { AgentToolDispatcher } from '../mcp-stdio/agent-tool.dispatcher';
import { buildAgentNamespace } from '../namespace-builders/agent-namespace.builder';
import type { MCPRequest, MCPResponse, PtahAPI } from '../types';

const ORIGINAL_SEVEN = [
  'codex',
  'copilot',
  'cursor',
  'antigravity',
  'opencode',
  'pi',
  'grok',
] as const;

interface Harness {
  readonly ptahAPI: PtahAPI;
  readonly spawn: jest.Mock;
  readonly spawnFromSdkHandle: jest.Mock;
  readonly registrySpawn: jest.Mock;
  readonly warn: jest.Mock;
}

function quietLogger(): Logger {
  const logger: Partial<Logger> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return logger as Logger;
}

/** The real agent namespace over a mocked process manager and registry. */
function makeHarness(): Harness {
  const spawn = jest.fn().mockResolvedValue({
    agentId: 'a-1',
    cli: 'claude',
    status: 'running',
    startedAt: '2026-10-24T00:00:00.000Z',
  });
  const spawnFromSdkHandle = jest.fn().mockResolvedValue({
    agentId: 'p-1',
    cli: 'ptah-cli',
    status: 'running',
    startedAt: '2026-10-24T00:00:00.000Z',
  });
  const prepareSdkHandleSpawn = jest
    .fn()
    .mockImplementation(
      async (input: { task: string; resumeSessionId?: string }) => ({
        task: input.task,
        ...(input.resumeSessionId
          ? { resumeSessionId: input.resumeSessionId }
          : {}),
      }),
    );
  const processManager: Partial<AgentProcessManager> = {
    spawn,
    spawnFromSdkHandle,
    prepareSdkHandleSpawn,
    reserveAgentId: jest.fn().mockReturnValue('reserved-1'),
  };
  const detection: Partial<CliDetectionService> = {
    detectAll: jest.fn().mockResolvedValue([]),
  };
  const registrySpawn = jest.fn().mockResolvedValue({
    handle: { id: 'h' },
    agentName: 'Provider agent',
    setAgentId: jest.fn(),
  });
  const warn = jest.fn();
  const agent = buildAgentNamespace({
    agentProcessManager: processManager as AgentProcessManager,
    cliDetectionService: detection as CliDetectionService,
    getWorkspaceRoot: () => 'D:/ws',
    getPtahCliRegistry: () => ({
      listAgents: jest.fn().mockResolvedValue([]),
      spawnAgent: registrySpawn,
    }),
    logger: { warn },
  });
  const api: Partial<PtahAPI> = { agent };
  return {
    ptahAPI: api as PtahAPI,
    spawn,
    spawnFromSdkHandle,
    registrySpawn,
    warn,
  };
}

function isError(response: MCPResponse | null): boolean {
  return (
    (response?.result as { isError?: boolean } | undefined)?.isError === true
  );
}

type Transport = 'http' | 'stdio';

async function spawnOver(
  transport: Transport,
  args: Record<string, unknown>,
): Promise<Harness & { response: MCPResponse | null }> {
  const harness = makeHarness();
  const request: MCPRequest = {
    jsonrpc: '2.0',
    id: 'accounts',
    method: 'tools/call',
    ...(transport === 'http'
      ? { params: { name: 'ptah_agent_spawn', arguments: args } }
      : {}),
  };
  if (transport === 'http') {
    const deps: ProtocolHandlerDependencies = {
      ptahAPI: harness.ptahAPI,
      permissionPromptService:
        {} as ProtocolHandlerDependencies['permissionPromptService'],
      logger: quietLogger(),
    };
    return { ...harness, response: await handleMCPRequest(request, deps) };
  }
  const dispatcher = new AgentToolDispatcher(harness.ptahAPI, quietLogger());
  return {
    ...harness,
    response: await dispatcher.dispatch('agent_spawn', request, args),
  };
}

const TRANSPORTS: readonly Transport[] = ['http', 'stdio'];

describe('agent spawn CLI selector (D31 drift)', () => {
  it('accepts the original seven system CLIs plus claude, in tuple order', () => {
    expect([...SYSTEM_CLI_TYPES]).toEqual([...ORIGINAL_SEVEN, 'claude']);
    for (const cli of SYSTEM_CLI_TYPES) {
      expect(AgentSpawnArgsSchema.safeParse({ task: 't', cli }).success).toBe(
        true,
      );
    }
  });

  it('keeps ptah-cli out of the cli selector; it is reached by ptahCliId', () => {
    expect(SYSTEM_CLI_TYPES).not.toContain('ptah-cli');
    expect(
      AgentSpawnArgsSchema.safeParse({ task: 't', cli: 'ptah-cli' }).success,
    ).toBe(false);
    expect(
      AgentSpawnArgsSchema.safeParse({ task: 't', ptahCliId: 'p-1' }).success,
    ).toBe(true);
  });
});

describe.each(TRANSPORTS)('agent spawn accounts over %s', (transport) => {
  it.each(SYSTEM_CLI_TYPES)(
    'leaves an old caller unchanged: %s spawns with no accountSelection key',
    async (cli) => {
      const run = await spawnOver(transport, { task: 't', cli });

      expect(isError(run.response)).toBe(false);
      expect(run.spawn).toHaveBeenCalledTimes(1);
      const forwarded = run.spawn.mock.calls[0][0];
      expect(forwarded.cli).toBe(cli);
      expect(forwarded).not.toHaveProperty('accountSelection');
    },
  );

  it.each([
    ['ambient', { kind: 'ambient' }],
    ['omitted', { kind: 'omitted' }],
  ])(
    'forwards an %s selection on a claude lane to the process manager',
    async (_label, accountSelection) => {
      const run = await spawnOver(transport, {
        task: 't',
        cli: 'claude',
        accountSelection,
      });

      expect(isError(run.response)).toBe(false);
      expect(run.spawn).toHaveBeenCalledTimes(1);
      expect(run.spawn.mock.calls[0][0]).toMatchObject({
        cli: 'claude',
        accountSelection,
      });
    },
  );

  it('forwards an ambient resume so the runtime resume gate decides', async () => {
    const run = await spawnOver(transport, {
      task: 't',
      cli: 'claude',
      resume_session_id: 'sdk-session-1',
      accountSelection: { kind: 'ambient' },
    });

    expect(isError(run.response)).toBe(false);
    expect(run.spawn.mock.calls[0][0]).toMatchObject({
      resumeSessionId: 'sdk-session-1',
      accountSelection: { kind: 'ambient' },
    });
  });

  it('refuses a resume that names a different account, before any spawn', async () => {
    const run = await spawnOver(transport, {
      task: 't',
      cli: 'claude',
      resume_session_id: 'sdk-session-1',
      accountSelection: { kind: 'named', profileId: 'profile-0002' },
    });

    expect(isError(run.response)).toBe(true);
    expect(run.spawn).not.toHaveBeenCalled();
    expect(run.spawnFromSdkHandle).not.toHaveBeenCalled();
  });

  it('forwards a named claude selection so the runtime admits the account', async () => {
    const accountSelection = { kind: 'named', profileId: 'profile-0001' };
    const run = await spawnOver(transport, {
      task: 't',
      cli: 'claude',
      accountSelection,
    });

    expect(isError(run.response)).toBe(false);
    expect(run.spawn).toHaveBeenCalledTimes(1);
    expect(run.spawn.mock.calls[0][0]).toMatchObject({
      cli: 'claude',
      accountSelection,
    });
  });

  it.each(ORIGINAL_SEVEN)(
    'refuses a named selection on cli %s before spawn',
    async (cli) => {
      const run = await spawnOver(transport, {
        task: 't',
        cli,
        accountSelection: { kind: 'named', profileId: 'profile-0001' },
      });

      expect(isError(run.response)).toBe(true);
      expect(run.spawn).not.toHaveBeenCalled();
    },
  );

  it('gives ptahCliId precedence over cli: the Ptah CLI registry spawns', async () => {
    const run = await spawnOver(transport, {
      task: 't',
      cli: 'codex',
      ptahCliId: 'p-1',
      modelTier: 'haiku',
    });

    expect(isError(run.response)).toBe(false);
    expect(run.spawn).not.toHaveBeenCalled();
    expect(run.registrySpawn).toHaveBeenCalledTimes(1);
    expect(run.registrySpawn.mock.calls[0][0]).toBe('p-1');
    expect(run.registrySpawn.mock.calls[0][2]).toMatchObject({
      modelTier: 'haiku',
    });
    expect(run.spawnFromSdkHandle).toHaveBeenCalledTimes(1);
  });

  it('refuses an account selection on a Ptah CLI agent', async () => {
    const run = await spawnOver(transport, {
      task: 't',
      ptahCliId: 'p-1',
      accountSelection: { kind: 'ambient' },
    });

    expect(isError(run.response)).toBe(true);
    expect(run.registrySpawn).not.toHaveBeenCalled();
    expect(run.spawnFromSdkHandle).not.toHaveBeenCalled();
  });

  it('passes modelTier through unchanged next to an account selection', async () => {
    const run = await spawnOver(transport, {
      task: 't',
      cli: 'claude',
      modelTier: 'opus',
      accountSelection: { kind: 'ambient' },
    });

    expect(run.spawn.mock.calls[0][0]).toMatchObject({
      modelTier: 'opus',
      accountSelection: { kind: 'ambient' },
    });
  });

  it('forwards an explicit effort as given, so it wins over the settings default', async () => {
    const run = await spawnOver(transport, {
      task: 't',
      cli: 'claude',
      effort: 'high',
      accountSelection: { kind: 'ambient' },
    });

    expect(run.spawn.mock.calls[0][0].effort).toBe('high');
  });

  it('says truthfully that a Ptah CLI lane ignores effort', async () => {
    const run = await spawnOver(transport, {
      task: 't',
      ptahCliId: 'p-1',
      effort: 'high',
    });

    expect(isError(run.response)).toBe(false);
    expect(run.warn).toHaveBeenCalledWith(
      expect.stringMatching(/Ptah CLI lanes do not take "effort"/),
      { ptahCliId: 'p-1', effort: 'high' },
    );
    expect(run.registrySpawn.mock.calls[0][2]).not.toHaveProperty('effort');
  });
});

describe('agent spawn accounts: transport parity', () => {
  it('sends the same request to the process manager from HTTP and stdio', async () => {
    const args = {
      task: 't',
      cli: 'claude',
      modelTier: 'sonnet',
      effort: 'medium',
      accountSelection: { kind: 'ambient' },
    };

    const http = await spawnOver('http', args);
    const stdio = await spawnOver('stdio', args);

    expect(stdio.spawn.mock.calls[0][0]).toEqual(http.spawn.mock.calls[0][0]);
  });
});
