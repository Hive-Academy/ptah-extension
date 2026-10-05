/**
 * Specs for buildAgentNamespace.
 *
 * Covers the 7 methods exposed on ptah.agent.*:
 *   - spawn — ptah-cli routing, disabled-CLI guard, enrichment of spawn request
 *   - status / read / message / stop — thin delegation to AgentProcessManager
 *   - list   — merging cliDetectionService + PtahCliRegistry + preferred-order
 *              ranking
 *   - waitFor / waitForAgents — the event-driven manager wait, no polling
 *
 * The builder only uses a small slice of the AgentProcessManager and
 * CliDetectionService surfaces, so we mock them with typed `jest.Mocked<T>`
 * partials. No `as any` casts.
 */

// The real barrel cannot load here: it reaches tsyringe without the
// reflect-metadata polyfill. The builder needs only PTAH_CLI_ROLE_DELIVERY at
// runtime, overridden with non-default values so a hand-typed literal fails.
jest.mock('@ptah-extension/cli-agent-runtime', () => ({
  MAX_AGENT_WAIT_MS: 900_000,
  PTAH_CLI_ROLE_DELIVERY: {
    roleDelivery: 'native',
    roleChannel: 'agent-selection',
  },
  // Stubbed with a recognizable marker rather than the real renderer: these
  // tests assert what the builder PASSES ON, and the contract text itself is
  // pinned by `cli-adapter.utils.spec.ts` (TASK_2026_515).
  renderLaneCompletionContract: jest.fn(() => 'LANE_COMPLETION_CONTRACT'),
}));

import type {
  AgentProcessManager,
  AgentRoleErrorCode,
  CliDetectionService,
  SdkHandle,
} from '@ptah-extension/cli-agent-runtime';
import type {
  AgentProcessInfo,
  AgentRoleDefinition,
  CliDetectionResult,
  SpawnAgentRequest,
  SpawnAgentResult,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { PtahAPI } from '../types';
import {
  EXECUTION_CANCELLED_MESSAGE,
  executeCode,
} from '../mcp-core/code-execution.engine';
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
  prepareSdkHandleSpawn: jest.Mock;
  reserveAgentId: jest.Mock;
  getStatus: jest.Mock;
  readOutput: jest.Mock;
  sendToAgent: jest.Mock;
  stop: jest.Mock;
  waitForAgents: jest.Mock;
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
    // Pass-through by default: no resume id, nothing to gate or refuse.
    prepareSdkHandleSpawn: jest.fn(
      async (input: { task: string; resumeSessionId?: string }) => ({
        task: input.task,
        ...(input.resumeSessionId
          ? { resumeSessionId: input.resumeSessionId }
          : {}),
      }),
    ),
    // One id per spawn, minted BEFORE the handle exists (TASK_2026_402), so
    // the handle's MCP URL can carry it.
    reserveAgentId: jest.fn().mockReturnValue('reserved-1'),
    getStatus: jest.fn(),
    readOutput: jest.fn(),
    sendToAgent: jest.fn().mockResolvedValue({ mode: 'queue-next-turn' }),
    stop: jest.fn(),
    waitForAgents: jest.fn(),
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
    getPluginPaths: () => Promise<string[] | undefined>;
    getDisabledClis: () => string[];
    getPreferredAgentOrder: () => string[];
    resolveSessionId: (s: string) => string;
    resolveAgentRole: AgentNamespaceDependencies['resolveAgentRole'];
    listAgentRoles: AgentNamespaceDependencies['listAgentRoles'];
  }> = {},
): {
  deps: AgentNamespaceDependencies;
  mocks: {
    processManager: ProcessManagerMock;
    detection: DetectionMock;
    registry: RegistryMock | undefined;
    warn: jest.Mock;
  };
} {
  const warn = jest.fn();
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
    getPluginPaths: overrides.getPluginPaths,
    getPtahCliRegistry: registry ? () => registry as never : undefined,
    getDisabledClis: overrides.getDisabledClis,
    getPreferredAgentOrder: overrides.getPreferredAgentOrder,
    resolveSessionId: overrides.resolveSessionId,
    resolveAgentRole: overrides.resolveAgentRole,
    listAgentRoles: overrides.listAgentRoles,
    logger: { warn },
  };

  return { deps, mocks: { processManager, detection, registry, warn } };
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe('buildAgentNamespace — shape', () => {
  it('exposes spawn/status/read/message/report/stop/list/waitFor', () => {
    const { deps } = makeDeps();
    const ns = buildAgentNamespace(deps);

    expect(typeof ns.spawn).toBe('function');
    expect(typeof ns.status).toBe('function');
    expect(typeof ns.read).toBe('function');
    expect(typeof ns.message).toBe('function');
    expect(typeof ns.report).toBe('function');
    expect(typeof ns.stop).toBe('function');
    expect(typeof ns.list).toBe('function');
    expect(typeof ns.listRoles).toBe('function');
    expect(typeof ns.waitFor).toBe('function');
    expect(typeof ns.waitForAgents).toBe('function');
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
      getPluginPaths: async () => undefined,
    });
    mocks.processManager.spawn.mockResolvedValue({
      agentId: 'a1',
    } as SpawnAgentResult);

    const req: SpawnAgentRequest = {
      task: 'do thing',
      cli: 'codex',
    } as SpawnAgentRequest;
    const out = await buildAgentNamespace(deps).spawn(req);

    expect(out).toEqual({ agentId: 'a1' });
    const enriched = mocks.processManager.spawn.mock.calls[0][0];
    expect(enriched.task).toBe('do thing');
    expect(enriched.cli).toBe('codex');
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

  // TASK_2026_295 — an empty request.parentSessionId is absent, not supplied.
  // `request.parentSessionId ?? getActiveSessionId?.()` does NOT fall through
  // on '', so the empty id both suppressed the fallback AND was then discarded
  // by the truthiness check — the spawn proceeded with no parent at all.
  it('treats an empty request.parentSessionId as absent and falls back to getActiveSessionId()', async () => {
    const { deps, mocks } = makeDeps({
      getActiveSessionId: () => 'tab-1',
      resolveSessionId: (s) => (s === 'tab-1' ? 'session-uuid-1' : s),
    });
    mocks.processManager.spawn.mockResolvedValue({
      agentId: 'a',
    } as SpawnAgentResult);

    await buildAgentNamespace(deps).spawn({
      task: 't',
      parentSessionId: '',
    } as SpawnAgentRequest);

    expect(mocks.processManager.spawn.mock.calls[0][0].parentSessionId).toBe(
      'session-uuid-1',
    );
  });

  it('leaves parentSessionId undefined when it is empty and there is no active session', async () => {
    const { deps, mocks } = makeDeps({ resolveSessionId: (s) => s });
    mocks.processManager.spawn.mockResolvedValue({
      agentId: 'a',
    } as SpawnAgentResult);

    await buildAgentNamespace(deps).spawn({
      task: 't',
      parentSessionId: '',
    } as SpawnAgentRequest);

    expect(
      mocks.processManager.spawn.mock.calls[0][0].parentSessionId,
    ).toBeUndefined();
  });

  it('throws when request.cli is listed in getDisabledClis', async () => {
    const { deps } = makeDeps({ getDisabledClis: () => ['codex'] });
    await expect(
      buildAgentNamespace(deps).spawn({
        task: 't',
        cli: 'codex',
      } as SpawnAgentRequest),
    ).rejects.toThrow(/disabled/i);
  });

  it('adds pluginPaths only when non-empty', async () => {
    const { deps, mocks } = makeDeps({
      getPluginPaths: async () => ['/p/one', '/p/two'],
    });
    mocks.processManager.spawn.mockResolvedValue({
      agentId: 'ok',
    } as SpawnAgentResult);

    await buildAgentNamespace(deps).spawn({
      task: 't',
    } as SpawnAgentRequest);

    const call = mocks.processManager.spawn.mock.calls[0][0];
    expect(call.pluginPaths).toEqual(['/p/one', '/p/two']);
    expect(call.projectGuidance).toBeUndefined();
  });

  it('gives a system-CLI lane the capped guidance once and never a system prompt (TASK_2026_597)', async () => {
    const getProjectGuidance = jest.fn(async () => 'capped project rules');
    const { deps, mocks } = makeDeps({ getProjectGuidance });
    mocks.processManager.spawn.mockResolvedValue({
      agentId: 'ok',
    } as SpawnAgentResult);

    await buildAgentNamespace(deps).spawn({
      task: 't',
      cli: 'opencode',
    } as SpawnAgentRequest);

    expect(getProjectGuidance).toHaveBeenCalledTimes(1);
    expect(mocks.processManager.spawn).toHaveBeenCalledTimes(1);
    const call = mocks.processManager.spawn.mock.calls[0][0];
    expect(call.projectGuidance).toBe('capped project rules');
    expect(call).not.toHaveProperty('systemPrompt');
    expect(JSON.stringify(call).split('capped project rules').length - 1).toBe(
      1,
    );
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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(mocks.registry!.spawnAgent).toHaveBeenCalledWith(
      'agent-a',
      // The Ptah CLI lane never reaches `buildTaskPrompt`, so the builder
      // appends the completion contract itself (TASK_2026_515).
      'task body\n\nLANE_COMPLETION_CONTRACT',
      expect.objectContaining({
        workingDirectory: 'D:/ws',
        agentId: 'reserved-1',
      }),
    );
    // The RECORD keeps the caller's task, not the prompt with the contract on
    // it: the tile, the persisted reference and the completion signal's
    // headline all read that field.
    expect(mocks.processManager.spawnFromSdkHandle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ task: 'task body' }),
    );
    // The SAME reserved id reaches the tracker, so the record and the child's
    // `/agent/{id}` URL cannot disagree.
    expect(mocks.processManager.reserveAgentId).toHaveBeenCalledTimes(1);
    expect(mocks.processManager.spawnFromSdkHandle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agentId: 'reserved-1' }),
    );
    expect(setAgentId).toHaveBeenCalledWith('spawned-1');
  });

  it('forwards the raw model override and modelTier into registry.spawnAgent', async () => {
    const { deps, mocks } = makeDeps();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    mocks.registry!.spawnAgent.mockResolvedValue({
      handle: { id: 'h' } as unknown as SdkHandle,
      agentName: 'MyAgent',
      setAgentId: jest.fn(),
    });
    mocks.processManager.spawnFromSdkHandle.mockResolvedValue({
      agentId: 'spawned-2',
    } as SpawnAgentResult);

    await buildAgentNamespace(deps).spawn({
      task: 'task body',
      ptahCliId: 'agent-a',
      model: 'raw-override-model',
      modelTier: 'opus',
    } as SpawnAgentRequest);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(mocks.registry!.spawnAgent).toHaveBeenCalledWith(
      'agent-a',
      expect.stringContaining('task body'),
      expect.objectContaining({
        model: 'raw-override-model',
        modelTier: 'opus',
      }),
    );
  });

  it('gates a resume before the handle is built and surfaces a `fresh` decision (E.4)', async () => {
    const { deps, mocks } = makeDeps();
    const fresh = {
      decision: 'fresh' as const,
      reason: 'last request 61000 tokens exceeds 60000',
      sessionKnown: true,
    };
    mocks.processManager.prepareSdkHandleSpawn.mockResolvedValueOnce({
      task: '[LANE HANDOFF]\n...\nNew instruction:\nnext step',
      resumeDecision: fresh,
      originalTask: 'first task',
    });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    mocks.registry!.spawnAgent.mockResolvedValue({
      handle: { id: 'h' } as unknown as SdkHandle,
      agentName: 'MyAgent',
      setAgentId: jest.fn(),
    });
    mocks.processManager.spawnFromSdkHandle.mockImplementation(
      async (_handle: unknown, meta: { resumeDecision?: unknown }) => ({
        agentId: 'spawned-3',
        resumeDecision: meta.resumeDecision,
      }),
    );

    const out = await buildAgentNamespace(deps).spawn({
      task: 'next step',
      ptahCliId: 'agent-a',
      model: 'some-model',
      resumeSessionId: 'sess-1',
    } as SpawnAgentRequest);

    expect(mocks.processManager.prepareSdkHandleSpawn).toHaveBeenCalledWith({
      cli: 'ptah-cli',
      task: 'next step',
      model: 'some-model',
      resumeSessionId: 'sess-1',
    });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const [, prompt, options] = mocks.registry!.spawnAgent.mock.calls[0];
    expect(prompt).toBe(
      '[LANE HANDOFF]\n...\nNew instruction:\nnext step\n\nLANE_COMPLETION_CONTRACT',
    );
    expect(options.resumeSessionId).toBeUndefined();
    const meta = mocks.processManager.spawnFromSdkHandle.mock.calls[0][1];
    expect(meta).toEqual(
      expect.objectContaining({
        task: 'next step',
        resumeDecision: fresh,
        originalTask: 'first task',
      }),
    );
    expect(meta.resumeSessionId).toBeUndefined();
    expect(out.resumeDecision).toEqual(fresh);
  });

  it('refuses a blocked model before the registry builds a handle (B-m2)', async () => {
    const { deps, mocks } = makeDeps();
    mocks.processManager.prepareSdkHandleSpawn.mockRejectedValueOnce(
      new Error('Model `mimo-v2.6-flash-free` is blocked for lanes'),
    );

    await expect(
      buildAgentNamespace(deps).spawn({
        task: 't',
        ptahCliId: 'agent-a',
        model: 'mimo-v2.6-flash-free',
      } as SpawnAgentRequest),
    ).rejects.toThrow(/blocked for lanes/);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(mocks.registry!.spawnAgent).not.toHaveBeenCalled();
    expect(mocks.processManager.reserveAgentId).not.toHaveBeenCalled();
    expect(mocks.processManager.spawnFromSdkHandle).not.toHaveBeenCalled();
  });

  it('throws with helpful message when registry returns a failure status', async () => {
    const { deps, mocks } = makeDeps();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
// spawn — role resolution
// ---------------------------------------------------------------------------

class AgentRoleError extends Error {
  constructor(
    readonly code: AgentRoleErrorCode,
    message: string,
    readonly availableRoles: string[] = [],
  ) {
    super(message);
    this.name = 'AgentRoleError';
  }
}

const ROLE_DEFINITION: AgentRoleDefinition = {
  name: 'code-logic-reviewer',
  body: 'Review the logic.',
  sourcePath: 'D:/ws/.claude/agents/code-logic-reviewer.md',
  bytes: 17,
};

function mockPtahCliSpawn(mocks: { registry: RegistryMock | undefined }): void {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  mocks.registry!.spawnAgent.mockResolvedValue({
    handle: { id: 'h' } as unknown as SdkHandle,
    agentName: 'MyAgent',
    setAgentId: jest.fn(),
  });
}

describe('buildAgentNamespace — spawn (role)', () => {
  it('resolves the role before the ptah-cli branch reserves an id or spawns', async () => {
    const order: string[] = [];
    const resolveAgentRole = jest.fn(async () => {
      order.push('resolve');
      return ROLE_DEFINITION;
    });
    // The Ptah CLI spawn-options service reads the guidance itself; the
    // builder no longer fetches a second copy for that lane (TASK_2026_597).
    const getProjectGuidance = jest.fn(async () => {
      order.push('guidance');
      return 'project rules';
    });
    const { deps, mocks } = makeDeps({
      resolveAgentRole,
      getProjectGuidance,
    });
    mockPtahCliSpawn(mocks);
    mocks.processManager.reserveAgentId.mockImplementation(() => {
      order.push('reserve');
      return 'reserved-1';
    });
    mocks.processManager.spawnFromSdkHandle.mockResolvedValue({
      agentId: 'spawned-1',
    } as SpawnAgentResult);

    await buildAgentNamespace(deps).spawn({
      task: 't',
      ptahCliId: 'agent-a',
      role: 'code-logic-reviewer',
    } as SpawnAgentRequest);

    expect(resolveAgentRole).toHaveBeenCalledWith(
      'D:/ws',
      'code-logic-reviewer',
    );
    expect(order).toEqual(['resolve', 'reserve']);
    expect(getProjectGuidance).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(mocks.registry!.spawnAgent.mock.calls[0][2]).not.toHaveProperty(
      'projectGuidance',
    );
  });

  it('resolves the role before the rival branch spawns', async () => {
    const order: string[] = [];
    const resolveAgentRole = jest.fn(async () => {
      order.push('resolve');
      return ROLE_DEFINITION;
    });
    const { deps, mocks } = makeDeps({
      resolveAgentRole,
      getProjectGuidance: async () => {
        order.push('guidance');
        return undefined;
      },
    });
    mocks.processManager.spawn.mockImplementation(async () => {
      order.push('spawn');
      return { agentId: 'a' } as SpawnAgentResult;
    });

    await buildAgentNamespace(deps).spawn({
      task: 't',
      cli: 'codex',
      role: 'code-logic-reviewer',
    } as SpawnAgentRequest);

    expect(order).toEqual(['resolve', 'guidance', 'spawn']);
  });

  it.each([
    ['ptah-cli', { ptahCliId: 'agent-a' }],
    ['rival', { cli: 'codex' }],
  ])(
    'an AgentRoleError on the %s branch spawns nothing and propagates unchanged',
    async (_branch, target) => {
      const failure = new AgentRoleError(
        'unknown_role',
        'Unknown role "nope".',
        ['code-logic-reviewer'],
      );
      const { deps, mocks } = makeDeps({
        resolveAgentRole: jest.fn().mockRejectedValue(failure),
      });

      await expect(
        buildAgentNamespace(deps).spawn({
          task: 't',
          role: 'nope',
          ...target,
        } as SpawnAgentRequest),
      ).rejects.toBe(failure);

      expect(mocks.processManager.reserveAgentId).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(mocks.registry!.spawnAgent).not.toHaveBeenCalled();
      expect(mocks.processManager.spawnFromSdkHandle).not.toHaveBeenCalled();
      expect(mocks.processManager.spawn).not.toHaveBeenCalled();
    },
  );

  it('a non-AgentRoleError resolver failure also spawns nothing', async () => {
    const failure = new Error('disk gone');
    const { deps, mocks } = makeDeps({
      resolveAgentRole: jest.fn().mockRejectedValue(failure),
    });

    await expect(
      buildAgentNamespace(deps).spawn({
        task: 't',
        cli: 'codex',
        role: 'code-logic-reviewer',
      } as SpawnAgentRequest),
    ).rejects.toBe(failure);
    expect(mocks.processManager.spawn).not.toHaveBeenCalled();
  });

  it.each([
    ['ptah-cli', { ptahCliId: 'agent-a' }],
    ['rival', { cli: 'codex' }],
  ])(
    'throws a NAMED error on the %s branch when role is set and no resolver is wired',
    async (_branch, target) => {
      const { deps, mocks } = makeDeps();

      await expect(
        buildAgentNamespace(deps).spawn({
          task: 't',
          role: 'code-logic-reviewer',
          ...target,
        } as SpawnAgentRequest),
      ).rejects.toThrow(/Agent roles are unavailable/);

      expect(mocks.processManager.reserveAgentId).not.toHaveBeenCalled();
      expect(mocks.processManager.spawnFromSdkHandle).not.toHaveBeenCalled();
      expect(mocks.processManager.spawn).not.toHaveBeenCalled();
    },
  );

  it('an empty role string is resolved, never treated as absent', async () => {
    const failure = new AgentRoleError('invalid_role_name', 'Invalid role ""');
    const resolveAgentRole = jest.fn().mockRejectedValue(failure);
    const { deps, mocks } = makeDeps({ resolveAgentRole });

    await expect(
      buildAgentNamespace(deps).spawn({
        task: 't',
        cli: 'codex',
        role: '',
      } as SpawnAgentRequest),
    ).rejects.toBe(failure);
    expect(resolveAgentRole).toHaveBeenCalledWith('D:/ws', '');
    expect(mocks.processManager.spawn).not.toHaveBeenCalled();
  });

  it('ptah-cli branch passes the role to the registry and a roleStamp built from PTAH_CLI_ROLE_DELIVERY', async () => {
    const { deps, mocks } = makeDeps({
      resolveAgentRole: jest.fn().mockResolvedValue(ROLE_DEFINITION),
    });
    mockPtahCliSpawn(mocks);
    mocks.processManager.spawnFromSdkHandle.mockResolvedValue({
      agentId: 'spawned-1',
    } as SpawnAgentResult);

    await buildAgentNamespace(deps).spawn({
      task: 't',
      ptahCliId: 'agent-a',
      role: 'code-logic-reviewer',
    } as SpawnAgentRequest);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(mocks.registry!.spawnAgent).toHaveBeenCalledWith(
      'agent-a',
      expect.stringContaining('t'),
      expect.objectContaining({ role: ROLE_DEFINITION }),
    );
    const meta = mocks.processManager.spawnFromSdkHandle.mock.calls[0][1];
    expect(meta.roleStamp).toEqual({
      role: 'code-logic-reviewer',
      roleDelivery: 'native',
      roleChannel: 'agent-selection',
    });
  });

  it('role-less ptah-cli spawn carries no roleStamp key and no role', async () => {
    const { deps, mocks } = makeDeps();
    mockPtahCliSpawn(mocks);
    mocks.processManager.spawnFromSdkHandle.mockResolvedValue({
      agentId: 'spawned-1',
    } as SpawnAgentResult);

    await buildAgentNamespace(deps).spawn({
      task: 't',
      ptahCliId: 'agent-a',
    } as SpawnAgentRequest);

    const meta = mocks.processManager.spawnFromSdkHandle.mock.calls[0][1];
    expect('roleStamp' in meta).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const options = mocks.registry!.spawnAgent.mock.calls[0][2];
    expect(options.role).toBeUndefined();
  });

  it('rival branch forwards the resolved roleDefinition on the enriched request', async () => {
    const { deps, mocks } = makeDeps({
      resolveAgentRole: jest.fn().mockResolvedValue(ROLE_DEFINITION),
    });
    mocks.processManager.spawn.mockResolvedValue({
      agentId: 'a',
    } as SpawnAgentResult);

    await buildAgentNamespace(deps).spawn({
      task: 't',
      cli: 'codex',
      role: 'code-logic-reviewer',
    } as SpawnAgentRequest);

    const enriched = mocks.processManager.spawn.mock.calls[0][0];
    expect(enriched.role).toBe('code-logic-reviewer');
    expect(enriched.roleDefinition).toBe(ROLE_DEFINITION);
  });

  it('rival branch drops a caller-supplied roleDefinition', async () => {
    const { deps, mocks } = makeDeps();
    mocks.processManager.spawn.mockResolvedValue({
      agentId: 'a',
    } as SpawnAgentResult);

    await buildAgentNamespace(deps).spawn({
      task: 't',
      cli: 'codex',
      roleDefinition: ROLE_DEFINITION,
    } as SpawnAgentRequest);

    const enriched = mocks.processManager.spawn.mock.calls[0][0];
    expect('roleDefinition' in enriched).toBe(false);
  });

  it.each([
    ['ptah-cli', { ptahCliId: 'agent-a' }],
    ['rival', { cli: 'codex' }],
  ])(
    'a nested-worktree workingDirectory on the %s branch still resolves roles from getWorkspaceRoot()',
    async (branch, target) => {
      const resolveAgentRole = jest.fn().mockResolvedValue(ROLE_DEFINITION);
      const worktree = 'D:/ws/.claude-worktrees/lane-1';
      const { deps, mocks } = makeDeps({
        resolveAgentRole,
        getWorkspaceRoot: () => 'D:/ws',
      });
      mockPtahCliSpawn(mocks);
      mocks.processManager.spawnFromSdkHandle.mockResolvedValue({
        agentId: 'spawned-1',
      } as SpawnAgentResult);
      mocks.processManager.spawn.mockResolvedValue({
        agentId: 'a',
      } as SpawnAgentResult);

      await buildAgentNamespace(deps).spawn({
        task: 't',
        role: 'code-logic-reviewer',
        workingDirectory: worktree,
        ...target,
      } as SpawnAgentRequest);

      expect(resolveAgentRole).toHaveBeenCalledTimes(1);
      expect(resolveAgentRole).toHaveBeenCalledWith(
        'D:/ws',
        'code-logic-reviewer',
      );
      const spawnedIn =
        branch === 'ptah-cli'
          ? mocks.processManager.spawnFromSdkHandle.mock.calls[0][1]
              .workingDirectory
          : mocks.processManager.spawn.mock.calls[0][0].workingDirectory;
      expect(spawnedIn).toBe(worktree);
    },
  );
});

describe('buildAgentNamespace — listRoles', () => {
  it('returns the wired listAgentRoles result for the workspace root', async () => {
    const listAgentRoles = jest
      .fn()
      .mockResolvedValue(['architect', 'reviewer']);
    const { deps } = makeDeps({ listAgentRoles });

    await expect(buildAgentNamespace(deps).listRoles()).resolves.toEqual([
      'architect',
      'reviewer',
    ]);
    expect(listAgentRoles).toHaveBeenCalledWith('D:/ws');
  });

  it('returns [] when no listAgentRoles is wired', async () => {
    const { deps } = makeDeps();
    await expect(buildAgentNamespace(deps).listRoles()).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// status / read / message / report / stop — pure delegation
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
    expect(mocks.processManager.readOutput).toHaveBeenCalledWith(
      'x',
      50,
      undefined,
    );
  });

  // TASK_2026_559 Batch 13: offset reaches readOutput.
  it('read() forwards offset', async () => {
    const { deps, mocks } = makeDeps();
    mocks.processManager.readOutput.mockReturnValue({
      stdout: 'hi',
      stderr: '',
    });
    await buildAgentNamespace(deps).read('x', undefined, 120);
    expect(mocks.processManager.readOutput).toHaveBeenCalledWith(
      'x',
      undefined,
      120,
    );
  });

  it('message() routes through sendToAgent and RETURNS the outcome', async () => {
    // The outcome must not be swallowed: `unsupported` means nothing was
    // delivered and `interrupt-resume` means a turn's partial work is gone.
    const { deps, mocks } = makeDeps();
    mocks.processManager.sendToAgent.mockResolvedValue({
      mode: 'interrupt-resume',
      detail: 'turn aborted',
    });
    const outcome = await buildAgentNamespace(deps).message('x', 'go left');
    expect(mocks.processManager.sendToAgent).toHaveBeenCalledWith(
      'x',
      'go left',
    );
    expect(outcome).toEqual({
      mode: 'interrupt-resume',
      detail: 'turn aborted',
    });
  });

  it('report() forwards to the wired deliverAgentReport', async () => {
    const deliverAgentReport = jest
      .fn()
      .mockResolvedValue({ delivered: true, parentSessionId: 'sess-1' });
    const { deps } = makeDeps();
    const ns = buildAgentNamespace({ ...deps, deliverAgentReport });

    await expect(
      ns.report({ agentId: 'a-1', message: 'blocked', summary: 'blocked' }),
    ).resolves.toEqual({ delivered: true, parentSessionId: 'sess-1' });
    expect(deliverAgentReport).toHaveBeenCalledWith({
      agentId: 'a-1',
      message: 'blocked',
      summary: 'blocked',
    });
  });

  it('report() throws a NAMED error when no router is wired', async () => {
    // Absent wiring is a host bug, not a state the calling agent can act on,
    // so it must not masquerade as a `delivered: false` refusal.
    const { deps } = makeDeps();
    await expect(
      buildAgentNamespace(deps).report({ agentId: 'a-1', message: 'x' }),
    ).rejects.toThrow(/Agent reporting is unavailable/);
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
      { cli: 'codex', installed: true, messagingMode: 'queue' },
    ] as CliDetectionResult[]);

    const list = await buildAgentNamespace(deps).list();
    expect(list).toEqual([
      {
        cli: 'codex',
        installed: true,
        messagingMode: 'queue',
        preferredRank: 0,
      },
    ]);
  });

  // `spawn` REJECTS an explicit disabled `cli`, so omitting disabled CLIs here
  // meant the only way to discover the restriction was to fail a spawn. They
  // are now reported with `disabled: true` instead.
  it('reports disabled CLIs with disabled: true instead of omitting them', async () => {
    const { deps, mocks } = makeDeps({
      registry: undefined,
      getDisabledClis: () => ['copilot'],
    });
    mocks.detection.detectAll.mockResolvedValue([
      { cli: 'codex', installed: true, messagingMode: 'queue' },
      { cli: 'copilot', installed: true, messagingMode: 'queue' },
    ] as CliDetectionResult[]);

    const list = await buildAgentNamespace(deps).list();

    expect(list.map((r) => r.cli)).toEqual(['codex', 'copilot']);
    expect(list.find((r) => r.cli === 'codex')?.disabled).toBeUndefined();
    expect(list.find((r) => r.cli === 'copilot')?.disabled).toBe(true);
  });

  it('leaves ptah-cli agents unmarked — disabledClis matches CLI types only', async () => {
    const { deps, mocks } = makeDeps({
      getDisabledClis: () => ['ptah-alice'],
    });
    mocks.detection.detectAll.mockResolvedValue([
      { cli: 'codex', installed: true, messagingMode: 'queue' },
    ] as CliDetectionResult[]);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    mocks.registry!.listAgents.mockResolvedValue([
      {
        id: 'ptah-alice',
        name: 'Alice',
        providerName: 'anthropic',
        hasApiKey: true,
        enabled: true,
      },
    ]);

    const list = await buildAgentNamespace(deps).list();
    const alice = list.find((r) => r.ptahCliId === 'ptah-alice');

    expect(alice).toBeDefined();
    expect(alice?.disabled).toBeUndefined();
  });

  it('stamps ptah-cli rows with PTAH_CLI_ROLE_DELIVERY and leaves detected CLI rows alone', async () => {
    const { deps, mocks } = makeDeps();
    mocks.detection.detectAll.mockResolvedValue([
      { cli: 'codex', installed: true, messagingMode: 'queue' },
    ] as CliDetectionResult[]);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    mocks.registry!.listAgents.mockResolvedValue([
      {
        id: 'ptah-alice',
        name: 'Alice',
        providerName: 'anthropic',
        hasApiKey: true,
        enabled: true,
      },
    ]);

    const list = await buildAgentNamespace(deps).list();
    const alice = list.find((r) => r.ptahCliId === 'ptah-alice');
    const codex = list.find((r) => r.cli === 'codex');

    expect(alice?.roleDelivery).toBe('native');
    expect(alice?.roleChannel).toBe('agent-selection');
    expect(codex?.roleDelivery).toBeUndefined();
    expect(codex?.roleChannel).toBeUndefined();
  });

  it('merges ptah-cli agents that are enabled+hasApiKey and honors preferred order', async () => {
    const { deps, mocks } = makeDeps({
      getPreferredAgentOrder: () => ['ptah-alice', 'codex'],
    });
    mocks.detection.detectAll.mockResolvedValue([
      { cli: 'codex', installed: true, messagingMode: 'queue' },
    ] as CliDetectionResult[]);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
    ).toEqual(['ptah-alice', 'codex']);
    expect(list[0].preferredRank).toBe(1);
    expect(list[1].preferredRank).toBe(2);
  });

  it('falls back to cli results when registry.listAgents throws', async () => {
    const { deps, mocks } = makeDeps();
    mocks.detection.detectAll.mockResolvedValue([
      { cli: 'codex', installed: true, messagingMode: 'queue' },
    ] as CliDetectionResult[]);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    mocks.registry!.listAgents.mockRejectedValue(new Error('registry down'));

    const list = await buildAgentNamespace(deps).list();
    expect(list).toHaveLength(1);
    expect(list[0].cli).toBe('codex');
  });
});

// ---------------------------------------------------------------------------
// waitFor
// ---------------------------------------------------------------------------

describe('buildAgentNamespace — waitFor', () => {
  const info = { agentId: 'x', status: 'completed' } as AgentProcessInfo;

  it('resolves with the terminal record from one waitForAgents call, never polling', async () => {
    const { deps, mocks } = makeDeps();
    mocks.processManager.waitForAgents.mockResolvedValue({
      mode: 'all',
      timedOut: false,
      waitedMs: 12,
      entries: [{ agentId: 'x', state: 'exited', info }],
    });
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    const result = await buildAgentNamespace(deps).waitFor('x', {
      timeout: 5000,
    });

    expect(result).toBe(info);
    expect(mocks.processManager.waitForAgents).toHaveBeenCalledTimes(1);
    // No `execute_code` run in flight, so no signal rides along.
    expect(mocks.processManager.waitForAgents).toHaveBeenCalledWith(
      ['x'],
      'all',
      5000,
      undefined,
    );
    expect(mocks.processManager.getStatus).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });

  it('defaults the timeout to, and caps it at, MAX_AGENT_WAIT_MS', async () => {
    const { deps, mocks } = makeDeps();
    mocks.processManager.waitForAgents.mockResolvedValue({
      mode: 'all',
      timedOut: false,
      waitedMs: 0,
      entries: [{ agentId: 'x', state: 'exited', info }],
    });
    const ns = buildAgentNamespace(deps);

    await ns.waitFor('x');
    await ns.waitFor('x', { timeout: 60 * 60 * 1000 });

    expect(mocks.processManager.waitForAgents.mock.calls[0][2]).toBe(900_000);
    expect(mocks.processManager.waitForAgents.mock.calls[1][2]).toBe(900_000);
  });

  it('rejects with a timeout error when the lane is still running', async () => {
    const { deps, mocks } = makeDeps();
    mocks.processManager.waitForAgents.mockResolvedValue({
      mode: 'all',
      timedOut: true,
      waitedMs: 100,
      entries: [
        {
          agentId: 'x',
          state: 'running',
          info: { ...info, status: 'running' },
        },
      ],
    });

    await expect(
      buildAgentNamespace(deps).waitFor('x', { timeout: 100 }),
    ).rejects.toThrow(/timed out after 100ms for agent x/);
  });

  it.each([
    [-5, 0],
    [Number.NaN, 0],
    ['soon' as unknown as number, 0],
    [1234.9, 1234],
  ])(
    'normalises timeout %p to %p ms, the same value the error names',
    async (requested, expected) => {
      const { deps, mocks } = makeDeps();
      mocks.processManager.waitForAgents.mockResolvedValue({
        mode: 'all',
        timedOut: true,
        waitedMs: expected,
        entries: [
          {
            agentId: 'x',
            state: 'running',
            info: { ...info, status: 'running' },
          },
        ],
      });

      await expect(
        buildAgentNamespace(deps).waitFor('x', { timeout: requested }),
      ).rejects.toThrow(`timed out after ${expected}ms for agent x`);
      expect(mocks.processManager.waitForAgents).toHaveBeenCalledWith(
        ['x'],
        'all',
        expected,
        undefined,
      );
    },
  );

  // TASK_2026_614 Batch 23: `execute_code` cancel reaches `waitFor`.
  it('rejects with a cancellation error when the wait was cancelled', async () => {
    const { deps, mocks } = makeDeps();
    mocks.processManager.waitForAgents.mockResolvedValue({
      mode: 'all',
      timedOut: false,
      cancelled: true,
      waitedMs: 5,
      entries: [
        { agentId: 'x', state: 'running', info: { ...info, status: 'running' } },
      ],
    });

    await expect(buildAgentNamespace(deps).waitFor('x')).rejects.toThrow(
      /waitFor cancelled for agent x: the caller stopped waiting/,
    );
    expect(mocks.processManager.getStatus).not.toHaveBeenCalled();
  });

  it('returns the record when the lane exited as the wait was cancelled', async () => {
    const { deps, mocks } = makeDeps();
    mocks.processManager.waitForAgents.mockResolvedValue({
      mode: 'all',
      timedOut: false,
      cancelled: true,
      waitedMs: 5,
      entries: [{ agentId: 'x', state: 'exited', info }],
    });

    await expect(buildAgentNamespace(deps).waitFor('x')).resolves.toBe(info);
  });

  it('receives the execute_code signal and ends the wait when it aborts', async () => {
    const { deps, mocks } = makeDeps();
    const controller = new AbortController();
    let waitSignal: AbortSignal | undefined;
    let waitSettled: Promise<unknown> = Promise.resolve();
    mocks.processManager.waitForAgents.mockImplementation(
      (_ids: string[], mode: string, _timeout: number, signal?: AbortSignal) => {
        waitSignal = signal;
        const settled = new Promise((resolve) => {
          signal?.addEventListener('abort', () =>
            resolve({
              mode,
              timedOut: false,
              cancelled: true,
              waitedMs: 1,
              entries: [
                {
                  agentId: 'x',
                  state: 'running',
                  info: { ...info, status: 'running' },
                },
              ],
            }),
          );
        });
        waitSettled = settled;
        // The caller goes away while the wait is pending.
        queueMicrotask(() => controller.abort());
        return settled;
      },
    );
    const ptahAPI = { agent: buildAgentNamespace(deps) } as unknown as PtahAPI;
    const logger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger;

    await expect(
      executeCode("ptah.agent.waitFor('x')", 5000, {
        ptahAPI,
        logger,
        signal: controller.signal,
      }),
    ).rejects.toThrow(EXECUTION_CANCELLED_MESSAGE);
    expect(waitSignal).toBe(controller.signal);
    await expect(waitSettled).resolves.toMatchObject({ cancelled: true });
  });

  it.each([
    ['not_found', 'Agent not found: x. This host holds no record'],
    ['other_workspace', 'Agent x exists but belongs to another workspace'],
  ])(
    'rejects a %s id with the getStatus message for it',
    async (state, message) => {
      const { deps, mocks } = makeDeps();
      mocks.processManager.waitForAgents.mockResolvedValue({
        mode: 'all',
        timedOut: false,
        waitedMs: 0,
        entries: [{ agentId: 'x', state }],
      });
      mocks.processManager.getStatus.mockImplementation(() => {
        throw new Error(message);
      });

      await expect(buildAgentNamespace(deps).waitFor('x')).rejects.toThrow(
        message,
      );
    },
  );
});

describe('buildAgentNamespace — waitForAgents', () => {
  it('delegates ids, mode and timeout to the manager unchanged', async () => {
    const { deps, mocks } = makeDeps();
    const result = {
      mode: 'any',
      timedOut: false,
      waitedMs: 3,
      entries: [],
    };
    mocks.processManager.waitForAgents.mockResolvedValue(result);

    await expect(
      buildAgentNamespace(deps).waitForAgents(['a', 'b'], 'any', 30_000),
    ).resolves.toBe(result);
    expect(mocks.processManager.waitForAgents).toHaveBeenCalledWith(
      ['a', 'b'],
      'any',
      30_000,
      undefined,
    );
  });

  it('forwards the abort signal to the manager (TASK_2026_614 Task 10.1)', async () => {
    const { deps, mocks } = makeDeps();
    mocks.processManager.waitForAgents.mockResolvedValue({
      mode: 'all',
      timedOut: false,
      cancelled: true,
      waitedMs: 1,
      entries: [],
    });
    const controller = new AbortController();

    await buildAgentNamespace(deps).waitForAgents(
      ['a'],
      'all',
      1_000,
      controller.signal,
    );

    expect(mocks.processManager.waitForAgents).toHaveBeenCalledWith(
      ['a'],
      'all',
      1_000,
      controller.signal,
    );
  });
});

// ---------------------------------------------------------------------------
// spawn — execute_code boundary (F6-M1, PR1-M1)
// ---------------------------------------------------------------------------

describe('buildAgentNamespace — spawn boundary', () => {
  it.each([
    ['a number', 3],
    ['an empty string', ''],
    ['an over-long string', 'x'.repeat(33)],
    ['an object', { level: 'high' }],
  ])('rejects effort as %s without spawning', async (_label, effort) => {
    const { deps, mocks } = makeDeps();

    await expect(
      buildAgentNamespace(deps).spawn({
        task: 't',
        effort,
      } as unknown as SpawnAgentRequest),
    ).rejects.toThrow(/"effort" must be a string of 1 to 32 characters/);
    expect(mocks.processManager.spawn).not.toHaveBeenCalled();
  });

  it('passes a valid effort through to a system-CLI lane', async () => {
    const { deps, mocks } = makeDeps();
    mocks.processManager.spawn.mockResolvedValue({
      agentId: 'a',
    } as SpawnAgentResult);

    await buildAgentNamespace(deps).spawn({
      task: 't',
      cli: 'codex',
      effort: 'e'.repeat(32),
    } as SpawnAgentRequest);

    expect(mocks.processManager.spawn.mock.calls[0][0].effort).toBe(
      'e'.repeat(32),
    );
  });

  it('drops a caller-supplied systemPrompt with one WARN', async () => {
    const { deps, mocks } = makeDeps();
    mocks.processManager.spawn.mockResolvedValue({
      agentId: 'a',
    } as SpawnAgentResult);

    await buildAgentNamespace(deps).spawn({
      task: 't',
      systemPrompt: 'You are a pirate.',
    } as unknown as SpawnAgentRequest);

    expect(mocks.processManager.spawn.mock.calls[0][0]).not.toHaveProperty(
      'systemPrompt',
    );
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn.mock.calls[0][0]).toMatch(/"systemPrompt".*dropped/);
  });

  it('does not warn when no systemPrompt or effort is supplied', async () => {
    const { deps, mocks } = makeDeps();
    mocks.processManager.spawn.mockResolvedValue({
      agentId: 'a',
    } as SpawnAgentResult);

    await buildAgentNamespace(deps).spawn({ task: 't' } as SpawnAgentRequest);

    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('warns once that a Ptah CLI lane ignores effort, and does not pass it on', async () => {
    const { deps, mocks } = makeDeps();
    mockPtahCliSpawn(mocks);
    mocks.processManager.spawnFromSdkHandle.mockResolvedValue({
      agentId: 'spawned',
    } as SpawnAgentResult);

    await buildAgentNamespace(deps).spawn({
      task: 't',
      ptahCliId: 'agent-a',
      effort: 'high',
    } as SpawnAgentRequest);

    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringMatching(/Ptah CLI lanes do not take "effort"/),
      { ptahCliId: 'agent-a', effort: 'high' },
    );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const options = mocks.registry!.spawnAgent.mock.calls[0][2];
    expect(options).not.toHaveProperty('effort');
  });
});
