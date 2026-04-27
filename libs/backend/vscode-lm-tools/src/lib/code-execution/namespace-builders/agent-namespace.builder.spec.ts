/**
 * Specs for buildAgentNamespace (TASK_2026_100 P1.B5).
 *
 * Covers the 7 methods exposed on ptah.agent.*:
 *   - spawn — ptah-cli routing, disabled-CLI guard, enrichment of spawn request
 *   - status / read / steer / stop — thin delegation to AgentProcessManager
 *   - list   — merging cliDetectionService + PtahCliRegistry + preferred-order
 *              ranking
 *   - waitFor — polling loop, natural completion, and timeout rejection
 *
 * The builder only uses a small slice of the AgentProcessManager and
 * CliDetectionService surfaces, so we mock them with typed `jest.Mocked<T>`
 * partials. No `as any` casts.
 */

import type {
  AgentProcessManager,
  CliDetectionService,
  SdkHandle,
} from '@ptah-extension/agent-sdk';
import type {
  AgentProcessInfo,
  CliDetectionResult,
  SpawnAgentRequest,
  SpawnAgentResult,
} from '@ptah-extension/shared';
import {
  buildAgentNamespace,
  type AgentNamespaceDependencies,
} from './agent-namespace.builder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ProcessManagerMock {
  spawn: jest.Mock;
  spawnFromSdkHandle: jest.Mock;
  getStatus: jest.Mock;
  readOutput: jest.Mock;
  steer: jest.Mock;
  stop: jest.Mock;
}

interface DetectionMock {
  detectAll: jest.Mock;
}

interface RegistryMock {
  listAgents: jest.Mock;
  spawnAgent: jest.Mock;
}

function createProcessManager(): ProcessManagerMock {
  return {
    spawn: jest.fn(),
    spawnFromSdkHandle: jest.fn(),
    getStatus: jest.fn(),
    readOutput: jest.fn(),
    steer: jest.fn(),
    stop: jest.fn(),
  };
}

function createDetection(): DetectionMock {
  return { detectAll: jest.fn().mockResolvedValue([]) };
}

function createRegistry(): RegistryMock {
  return { listAgents: jest.fn(), spawnAgent: jest.fn() };
}

function makeDeps(
  overrides: Partial<{
    processManager: ProcessManagerMock;
    detection: DetectionMock;
    registry: RegistryMock | undefined;
    getWorkspaceRoot: () => string;
    getActiveSessionId: () => string | undefined;
    getProjectGuidance: () => Promise<string | undefined>;
    getSystemPrompt: () => Promise<string | undefined>;
    getPluginPaths: () => Promise<string[] | undefined>;
    getDisabledClis: () => string[];
    getPreferredAgentOrder: () => string[];
    resolveSessionId: (s: string) => string;
  }> = {},
): {
  deps: AgentNamespaceDependencies;
  mocks: {
    processManager: ProcessManagerMock;
    detection: DetectionMock;
    registry: RegistryMock | undefined;
  };
} {
  const processManager = overrides.processManager ?? createProcessManager();
  const detection = overrides.detection ?? createDetection();
  const registry =
    'registry' in overrides ? overrides.registry : createRegistry();

  const deps: AgentNamespaceDependencies = {
    agentProcessManager: processManager as unknown as AgentProcessManager,
    cliDetectionService: detection as unknown as CliDetectionService,
    getWorkspaceRoot: overrides.getWorkspaceRoot ?? (() => 'D:/ws'),
    getActiveSessionId: overrides.getActiveSessionId,
    getProjectGuidance: overrides.getProjectGuidance,
    getSystemPrompt: overrides.getSystemPrompt,
    getPluginPaths: overrides.getPluginPaths,
    getPtahCliRegistry: registry ? () => registry as never : undefined,
    getDisabledClis: overrides.getDisabledClis,
    getPreferredAgentOrder: overrides.getPreferredAgentOrder,
    resolveSessionId: overrides.resolveSessionId,
  };

  return { deps, mocks: { processManager, detection, registry } };
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe('buildAgentNamespace — shape', () => {
  it('exposes spawn/status/read/steer/stop/list/waitFor', () => {
    const { deps } = makeDeps();
    const ns = buildAgentNamespace(deps);

    expect(typeof ns.spawn).toBe('function');
    expect(typeof ns.status).toBe('function');
    expect(typeof ns.read).toBe('function');
    expect(typeof ns.steer).toBe('function');
    expect(typeof ns.stop).toBe('function');
    expect(typeof ns.list).toBe('function');
    expect(typeof ns.waitFor).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// spawn — standard path
// ---------------------------------------------------------------------------

describe('buildAgentNamespace — spawn (non-ptahCli)', () => {
  it('delegates to agentProcessManager.spawn and enriches with session/guidance', async () => {
    const { deps, mocks } = makeDeps({
      getActiveSessionId: () => 'tab-1',
      resolveSessionId: (s) => (s === 'tab-1' ? 'session-uuid-1' : s),
      getProjectGuidance: async () => 'project rules',
      getSystemPrompt: async () => undefined,
      getPluginPaths: async () => undefined,
    });
    mocks.processManager.spawn.mockResolvedValue({
      agentId: 'a1',
    } as SpawnAgentResult);

    const req: SpawnAgentRequest = {
      task: 'do thing',
      cli: 'gemini',
    } as SpawnAgentRequest;
    const out = await buildAgentNamespace(deps).spawn(req);

    expect(out).toEqual({ agentId: 'a1' });
    const enriched = mocks.processManager.spawn.mock.calls[0][0];
    expect(enriched.task).toBe('do thing');
    expect(enriched.cli).toBe('gemini');
    expect(enriched.parentSessionId).toBe('session-uuid-1');
    expect(enriched.projectGuidance).toBe('project rules');
    expect(enriched.systemPrompt).toBeUndefined();
    expect(enriched.pluginPaths).toBeUndefined();
  });

  it('prefers request.parentSessionId over getActiveSessionId()', async () => {
    const { deps, mocks } = makeDeps({
      getActiveSessionId: () => 'global',
      resolveSessionId: (s) => s,
    });
    mocks.processManager.spawn.mockResolvedValue({
      agentId: 'a',
    } as SpawnAgentResult);

    await buildAgentNamespace(deps).spawn({
      task: 't',
      parentSessionId: 'request-parent',
    } as SpawnAgentRequest);

    expect(mocks.processManager.spawn.mock.calls[0][0].parentSessionId).toBe(
      'request-parent',
    );
  });

  it('throws when request.cli is listed in getDisabledClis', async () => {
    const { deps } = makeDeps({ getDisabledClis: () => ['gemini'] });
    await expect(
      buildAgentNamespace(deps).spawn({
        task: 't',
        cli: 'gemini',
      } as SpawnAgentRequest),
    ).rejects.toThrow(/disabled/i);
  });

  it('adds systemPrompt and pluginPaths only when non-empty', async () => {
    const { deps, mocks } = makeDeps({
      getSystemPrompt: async () => 'harness prompt',
      getPluginPaths: async () => ['/p/one', '/p/two'],
    });
    mocks.processManager.spawn.mockResolvedValue({
      agentId: 'ok',
    } as SpawnAgentResult);

    await buildAgentNamespace(deps).spawn({
      task: 't',
    } as SpawnAgentRequest);

    const call = mocks.processManager.spawn.mock.calls[0][0];
    expect(call.systemPrompt).toBe('harness prompt');
    expect(call.pluginPaths).toEqual(['/p/one', '/p/two']);
  });
});

// ---------------------------------------------------------------------------
// spawn — ptah-cli registry path
// ---------------------------------------------------------------------------

describe('buildAgentNamespace — spawn (ptahCliId)', () => {
  it('throws if ptahCliId is set but no registry is wired', async () => {
    const { deps } = makeDeps({ registry: undefined });
    await expect(
      buildAgentNamespace(deps).spawn({
        task: 't',
        ptahCliId: 'agent-a',
      } as SpawnAgentRequest),
    ).rejects.toThrow(/Ptah CLI registry not available/);
  });

  it('routes through registry.spawnAgent and wires agentId back onto the SDK handle', async () => {
    const setAgentId = jest.fn();
    const { deps, mocks } = makeDeps();
    mocks.registry!.spawnAgent.mockResolvedValue({
      handle: { id: 'h' } as unknown as SdkHandle,
      agentName: 'MyAgent',
      setAgentId,
    });
    mocks.processManager.spawnFromSdkHandle.mockResolvedValue({
      agentId: 'spawned-1',
    } as SpawnAgentResult);

    const out = await buildAgentNamespace(deps).spawn({
      task: 'task body',
      ptahCliId: 'agent-a',
    } as SpawnAgentRequest);

    expect(out).toEqual({ agentId: 'spawned-1' });
    expect(mocks.registry!.spawnAgent).toHaveBeenCalledWith(
      'agent-a',
      'task body',
      expect.objectContaining({ workingDirectory: 'D:/ws' }),
    );
    expect(setAgentId).toHaveBeenCalledWith('spawned-1');
  });

  it('throws with helpful message when registry returns a failure status', async () => {
    const { deps, mocks } = makeDeps();
    mocks.registry!.spawnAgent.mockResolvedValue({
      status: 'no_api_key',
      message: 'missing API key',
    });

    await expect(
      buildAgentNamespace(deps).spawn({
        task: 't',
        ptahCliId: 'agent-a',
      } as SpawnAgentRequest),
    ).rejects.toThrow(/missing API key/);
  });
});

// ---------------------------------------------------------------------------
// status / read / steer / stop — pure delegation
// ---------------------------------------------------------------------------

describe('buildAgentNamespace — thin delegates', () => {
  it('status() forwards to getStatus and returns its value', async () => {
    const { deps, mocks } = makeDeps();
    mocks.processManager.getStatus.mockReturnValue({
      agentId: 'x',
      status: 'running',
    });
    const ns = buildAgentNamespace(deps);

    expect(await ns.status('x')).toEqual({ agentId: 'x', status: 'running' });
    expect(mocks.processManager.getStatus).toHaveBeenCalledWith('x');
  });

  it('read() forwards agentId + tail', async () => {
    const { deps, mocks } = makeDeps();
    mocks.processManager.readOutput.mockReturnValue({
      stdout: 'hi',
      stderr: '',
    });
    await buildAgentNamespace(deps).read('x', 50);
    expect(mocks.processManager.readOutput).toHaveBeenCalledWith('x', 50);
  });

  it('steer() fires-and-forgets instruction to steer()', async () => {
    const { deps, mocks } = makeDeps();
    await buildAgentNamespace(deps).steer('x', 'go left');
    expect(mocks.processManager.steer).toHaveBeenCalledWith('x', 'go left');
  });

  it('stop() awaits and returns the manager result', async () => {
    const { deps, mocks } = makeDeps();
    mocks.processManager.stop.mockResolvedValue({
      agentId: 'x',
      status: 'stopped',
    } as AgentProcessInfo);
    expect(await buildAgentNamespace(deps).stop('x')).toEqual({
      agentId: 'x',
      status: 'stopped',
    });
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('buildAgentNamespace — list', () => {
  it('returns raw CLI results annotated with preferredRank: 0 when no registry', async () => {
    const { deps, mocks } = makeDeps({ registry: undefined });
    mocks.detection.detectAll.mockResolvedValue([
      { cli: 'gemini', installed: true, supportsSteer: false },
    ] as CliDetectionResult[]);

    const list = await buildAgentNamespace(deps).list();
    expect(list).toEqual([
      {
        cli: 'gemini',
        installed: true,
        supportsSteer: false,
        preferredRank: 0,
      },
    ]);
  });

  it('filters out disabled CLIs before merging', async () => {
    const { deps, mocks } = makeDeps({
      registry: undefined,
      getDisabledClis: () => ['codex'],
    });
    mocks.detection.detectAll.mockResolvedValue([
      { cli: 'gemini', installed: true, supportsSteer: false },
      { cli: 'codex', installed: true, supportsSteer: false },
    ] as CliDetectionResult[]);

    const list = await buildAgentNamespace(deps).list();
    expect(list.map((r) => r.cli)).toEqual(['gemini']);
  });

  it('merges ptah-cli agents that are enabled+hasApiKey and honors preferred order', async () => {
    const { deps, mocks } = makeDeps({
      getPreferredAgentOrder: () => ['ptah-alice', 'gemini'],
    });
    mocks.detection.detectAll.mockResolvedValue([
      { cli: 'gemini', installed: true, supportsSteer: false },
    ] as CliDetectionResult[]);
    mocks.registry!.listAgents.mockResolvedValue([
      {
        id: 'ptah-alice',
        name: 'Alice',
        providerName: 'anthropic',
        hasApiKey: true,
        enabled: true,
      },
      {
        id: 'ptah-bob',
        name: 'Bob',
        providerName: 'anthropic',
        hasApiKey: false,
        enabled: true,
      },
    ]);

    const list = await buildAgentNamespace(deps).list();
    expect(
      list.map((r) => (r.cli === 'ptah-cli' ? r.ptahCliId : r.cli)),
    ).toEqual(['ptah-alice', 'gemini']);
    expect(list[0].preferredRank).toBe(1);
    expect(list[1].preferredRank).toBe(2);
  });

  it('falls back to cli results when registry.listAgents throws', async () => {
    const { deps, mocks } = makeDeps();
    mocks.detection.detectAll.mockResolvedValue([
      { cli: 'gemini', installed: true, supportsSteer: false },
    ] as CliDetectionResult[]);
    mocks.registry!.listAgents.mockRejectedValue(new Error('registry down'));

    const list = await buildAgentNamespace(deps).list();
    expect(list).toHaveLength(1);
    expect(list[0].cli).toBe('gemini');
  });
});

// ---------------------------------------------------------------------------
// waitFor
// ---------------------------------------------------------------------------

describe('buildAgentNamespace — waitFor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves with final status when agent transitions out of running', async () => {
    const { deps, mocks } = makeDeps();
    mocks.processManager.getStatus
      .mockReturnValueOnce({ agentId: 'x', status: 'running' })
      .mockReturnValueOnce({ agentId: 'x', status: 'completed' });

    const promise = buildAgentNamespace(deps).waitFor('x', {
      pollInterval: 100,
      timeout: 5000,
    });

    // First tick returns running → schedules next check
    await jest.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toEqual({ agentId: 'x', status: 'completed' });
  });

  it('rejects with timeout error once elapsed exceeds the budget', async () => {
    const { deps, mocks } = makeDeps();
    mocks.processManager.getStatus.mockReturnValue({
      agentId: 'x',
      status: 'running',
    });

    const promise = buildAgentNamespace(deps).waitFor('x', {
      pollInterval: 50,
      timeout: 100,
    });
    const rejection = expect(promise).rejects.toThrow(/timed out after 100ms/);

    await jest.advanceTimersByTimeAsync(250);
    await rejection;
  });
});
