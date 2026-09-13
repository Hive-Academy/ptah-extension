/**
 * Specs for buildAgentNamespace.
 *
 * Covers the 7 methods exposed on ptah.agent.*:
 *   - spawn — ptah-cli routing, disabled-CLI guard, enrichment of spawn request
 *   - status / read / message / stop — thin delegation to AgentProcessManager
 *   - list   — merging cliDetectionService + PtahCliRegistry + preferred-order
 *              ranking
 *   - waitFor — polling loop, natural completion, and timeout rejection
 *
 * The builder only uses a small slice of the AgentProcessManager and
 * CliDetectionService surfaces, so we mock them with typed `jest.Mocked<T>`
 * partials. No `as any` casts.
 */

// The real barrel cannot load here: it reaches tsyringe without the
// reflect-metadata polyfill. The builder needs only PTAH_CLI_ROLE_DELIVERY at
// runtime, overridden with non-default values so a hand-typed literal fails.
jest.mock('@ptah-extension/cli-agent-runtime', () => ({
  PTAH_CLI_ROLE_DELIVERY: {
    roleDelivery: 'native',
    roleChannel: 'agent-selection',
  },
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
  reserveAgentId: jest.Mock;
  getStatus: jest.Mock;
  readOutput: jest.Mock;
  sendToAgent: jest.Mock;
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
    // One id per spawn, minted BEFORE the handle exists (TASK_2026_402), so
    // the handle's MCP URL can carry it.
    reserveAgentId: jest.fn().mockReturnValue('reserved-1'),
    getStatus: jest.fn(),
    readOutput: jest.fn(),
    sendToAgent: jest.fn().mockResolvedValue({ mode: 'queue-next-turn' }),
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
    resolveAgentRole: AgentNamespaceDependencies['resolveAgentRole'];
    listAgentRoles: AgentNamespaceDependencies['listAgentRoles'];
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
    resolveAgentRole: overrides.resolveAgentRole,
    listAgentRoles: overrides.listAgentRoles,
  };

  return { deps, mocks: { processManager, detection, registry } };
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
      'task body',
      expect.objectContaining({
        workingDirectory: 'D:/ws',
        agentId: 'reserved-1',
      }),
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
      'task body',
      expect.objectContaining({
        model: 'raw-override-model',
        modelTier: 'opus',
      }),
    );
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
    const { deps, mocks } = makeDeps({
      resolveAgentRole,
      getProjectGuidance: async () => {
        order.push('guidance');
        return undefined;
      },
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
    expect(order).toEqual(['resolve', 'guidance', 'reserve']);
  });

  it('resolves the role before the rival branch spawns', async () => {
    const order: string[] = [];
    const resolveAgentRole = jest.fn(async () => {
      order.push('resolve');
      return ROLE_DEFINITION;
    });
    const { deps, mocks } = makeDeps({
      resolveAgentRole,
      getSystemPrompt: async () => {
        order.push('system-prompt-read');
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

    expect(order).toEqual(['resolve', 'system-prompt-read', 'spawn']);
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
      't',
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
    expect(mocks.processManager.readOutput).toHaveBeenCalledWith('x', 50);
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
