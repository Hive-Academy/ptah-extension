/**
 * Unit tests for SkillsSynthesisRpcHandlers — diagnostics + analyzeNow +
 * setTriggers + getTriggers (Batch B6, TASK_2026_126).
 *
 * Each new method covers: happy path, Zod invalid params, service throw.
 * Plus a dual-registration smoke test against ALLOWED_METHOD_PREFIXES.
 */

import 'reflect-metadata';
import { join } from 'node:path';
import { container } from 'tsyringe';
import {
  TOKENS,
  RpcUserError,
  ALLOWED_METHOD_PREFIXES,
} from '@ptah-extension/vscode-core';
import {
  SKILL_SYNTHESIS_TOKENS,
  USER_LAYER_MIRROR_SERVICE_TOKEN,
} from '@ptah-extension/skill-synthesis';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  createMockWorkspaceProvider,
  type MockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import { SkillsSynthesisRpcHandlers } from './skills-synthesis-rpc.handlers';

function makeLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
  };
}

function makeRpcHandler() {
  const methods = new Map<string, (params: unknown) => Promise<unknown>>();
  return {
    registerMethod: jest.fn(
      (name: string, fn: (p: unknown) => Promise<unknown>) => {
        methods.set(name, fn);
      },
    ),
    call: async (name: string, params: unknown) => {
      const fn = methods.get(name);
      if (!fn) throw new Error(`No handler registered for ${name}`);
      return fn(params);
    },
  };
}

function makeSentry() {
  return { captureException: jest.fn() };
}

function makeSynthesis() {
  return {
    analyzeSession: jest.fn(),
    readSettings: jest.fn().mockReturnValue({}),
    promote: jest.fn(),
    reject: jest.fn(),
  };
}

function makeStore() {
  return {
    findById: jest.fn(),
    listByStatus: jest.fn().mockReturnValue([]),
    listInvocations: jest.fn().mockReturnValue([]),
    getStats: jest.fn().mockReturnValue({
      candidates: 4,
      promoted: 2,
      rejected: 1,
      invocations: 7,
    }),
    getInvocationStats: jest.fn().mockReturnValue({
      total: 0,
      succeeded: 0,
      failed: 0,
      distinctContexts: 0,
    }),
    setPin: jest.fn(),
  };
}

function makeEnhancer() {
  return {
    enhance: jest.fn().mockResolvedValue({
      changed: false,
      slug: '',
      kind: 'skill',
      judgeScore: null,
      judgeReason: null,
      historyTs: null,
      skipReason: 'below-threshold',
    }),
    revert: jest.fn().mockResolvedValue({
      reverted: false,
      slug: '',
      revertedFrom: '',
      newHistoryTs: null,
    }),
  };
}

function makeRegistry() {
  return {
    listAll: jest.fn().mockReturnValue([]),
    getBySlug: jest.fn().mockReturnValue(null),
    setDiverged: jest.fn(),
    setPending: jest.fn(),
  };
}

function makeMirror() {
  return {
    getUserLayerRoots: jest.fn().mockReturnValue({
      skills: '/home/.ptah/user/skills',
      agents: '/home/.ptah/user/agents',
      commands: '/home/.ptah/user/commands',
    }),
    listHistory: jest.fn().mockResolvedValue([]),
    rebaseClone: jest.fn(),
    keepClone: jest.fn(),
  };
}

function makeContentDownload() {
  return {
    getPluginsPath: jest.fn().mockReturnValue('/home/.ptah/plugins'),
  };
}

function makeDiagnostics() {
  return {
    getSnapshot: jest.fn().mockResolvedValue({
      lastAnalyzeRunAt: null,
      lastCuratorPassAt: null,
      eligibilityHistogram: {
        tooFewTurns: 0,
        lowFidelity: 0,
        insufficientAbstraction: 0,
        accepted: 0,
      },
      byStatus: { candidate: 0, promoted: 0, rejected: 0, invocations: 0 },
      recentEvents: [],
      triggers: {
        sessionEnd: true,
        idleMs: 600000,
        bootScan: true,
        subagentStop: { enabled: true },
        postToolUse: { enabled: true, minEditCount: 3 },
        maxAnalyzesPerHour: 6,
      },
    }),
  };
}

function buildHandlers(workspaceFolders: string[] = ['/workspace/project']) {
  const logger = makeLogger();
  const rpcHandler = makeRpcHandler();
  const sentry = makeSentry();
  const synthesis = makeSynthesis();
  const store = makeStore();
  const diagnostics = makeDiagnostics();
  const enhancer = makeEnhancer();
  const registry = makeRegistry();
  const mirror = makeMirror();
  const contentDownload = makeContentDownload();
  const workspaceProvider: MockWorkspaceProvider = createMockWorkspaceProvider({
    folders: workspaceFolders,
  });

  const child = container.createChildContainer();
  child.registerInstance(TOKENS.LOGGER, logger);
  child.registerInstance(TOKENS.RPC_HANDLER, rpcHandler);
  child.registerInstance(TOKENS.SENTRY_SERVICE, sentry);
  child.registerInstance(
    SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE,
    synthesis,
  );
  child.registerInstance(SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE, store);
  child.registerInstance(
    SKILL_SYNTHESIS_TOKENS.SKILL_DIAGNOSTICS_SERVICE,
    diagnostics,
  );
  child.registerInstance(
    SKILL_SYNTHESIS_TOKENS.SKILL_ENHANCER_SERVICE,
    enhancer,
  );
  child.registerInstance(SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_STORE, registry);
  child.registerInstance(USER_LAYER_MIRROR_SERVICE_TOKEN, mirror);
  child.registerInstance(PLATFORM_TOKENS.CONTENT_DOWNLOAD, contentDownload);
  child.registerInstance(PLATFORM_TOKENS.WORKSPACE_PROVIDER, workspaceProvider);
  child.register(SkillsSynthesisRpcHandlers, {
    useClass: SkillsSynthesisRpcHandlers,
  });

  const handlers = child.resolve(SkillsSynthesisRpcHandlers);
  handlers.register();

  return {
    handlers,
    rpcHandler,
    sentry,
    synthesis,
    store,
    diagnostics,
    enhancer,
    registry,
    mirror,
    contentDownload,
    workspaceProvider,
    logger,
  };
}

describe('SkillsSynthesisRpcHandlers — skillSynthesis:diagnostics', () => {
  it('returns wire-shaped snapshot from diagnostics + store stats', async () => {
    const { rpcHandler, diagnostics, store } = buildHandlers();
    diagnostics.getSnapshot.mockResolvedValue({
      lastAnalyzeRunAt: 1700000000000,
      lastCuratorPassAt: 1699000000000,
      eligibilityHistogram: {
        tooFewTurns: 1,
        lowFidelity: 2,
        insufficientAbstraction: 3,
        accepted: 4,
      },
      byStatus: { candidate: 10, promoted: 3, rejected: 2, invocations: 12 },
      recentEvents: [
        { kind: 'analyze-run', timestamp: 1700000000000, sessionId: 's-1' },
      ],
      triggers: {
        sessionEnd: true,
        idleMs: 300000,
        bootScan: false,
        subagentStop: { enabled: true },
        postToolUse: { enabled: true, minEditCount: 3 },
        maxAnalyzesPerHour: 6,
      },
    });
    store.getStats.mockReturnValue({
      candidates: 10,
      promoted: 3,
      rejected: 2,
      invocations: 12,
    });

    const result = await rpcHandler.call('skillSynthesis:diagnostics', {
      workspaceRoot: '/workspace/project',
    });

    expect(diagnostics.getSnapshot).toHaveBeenCalledWith(
      '/workspace/project',
      undefined,
    );
    expect(result).toMatchObject({
      lastAnalyzeRunAt: 1700000000000,
      lastCuratorPassAt: 1699000000000,
      totalCandidates: 10,
      totalPromoted: 3,
      totalRejected: 2,
      totalInvocations: 12,
      activeSkills: 3,
      eligibilityHistogram: { accepted: 4 },
      triggers: { sessionEnd: true, idleMs: 300000, bootScan: false },
    });
  });

  it('rejects invalid workspaceRoot with INVALID_PARAMS', async () => {
    const { rpcHandler, diagnostics } = buildHandlers();
    await expect(
      rpcHandler.call('skillSynthesis:diagnostics', { workspaceRoot: '' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(diagnostics.getSnapshot).not.toHaveBeenCalled();
  });

  it('wraps diagnostics throw in PERSISTENCE_UNAVAILABLE without leaking', async () => {
    const { rpcHandler, diagnostics } = buildHandlers();
    diagnostics.getSnapshot.mockRejectedValue(
      new Error('SQLITE_CORRUPT: malformed disk image'),
    );
    let thrown: unknown;
    try {
      await rpcHandler.call('skillSynthesis:diagnostics', {});
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RpcUserError);
    const rpcErr = thrown as RpcUserError;
    expect(rpcErr.errorCode).toBe('PERSISTENCE_UNAVAILABLE');
    expect(rpcErr.message).not.toContain('SQLITE_CORRUPT');
  });
});

describe('SkillsSynthesisRpcHandlers — skillSynthesis:analyzeNow', () => {
  it('passes force=true through to synthesis.analyzeSession', async () => {
    const { rpcHandler, synthesis } = buildHandlers();
    synthesis.analyzeSession.mockResolvedValue({
      candidate: { id: 'cand-1' },
      reused: false,
    });

    const result = await rpcHandler.call('skillSynthesis:analyzeNow', {
      sessionId: 'sess-1',
      workspaceRoot: '/workspace/project',
      force: true,
    });

    expect(synthesis.analyzeSession).toHaveBeenCalledWith(
      'sess-1',
      '/workspace/project',
      { force: true },
    );
    expect(result).toMatchObject({
      success: true,
      candidateId: 'cand-1',
      reason: null,
    });
  });

  it('defaults force=false when omitted', async () => {
    const { rpcHandler, synthesis } = buildHandlers();
    synthesis.analyzeSession.mockResolvedValue(null);

    const result = await rpcHandler.call('skillSynthesis:analyzeNow', {
      sessionId: 'sess-2',
      workspaceRoot: '/workspace/project',
    });

    expect(synthesis.analyzeSession).toHaveBeenCalledWith(
      'sess-2',
      '/workspace/project',
      { force: false },
    );
    expect(result).toMatchObject({
      success: false,
      candidateId: null,
      reason: 'ineligible',
    });
  });

  it('rejects empty sessionId with INVALID_PARAMS', async () => {
    const { rpcHandler, synthesis } = buildHandlers();
    await expect(
      rpcHandler.call('skillSynthesis:analyzeNow', {
        sessionId: '',
        workspaceRoot: '/workspace/project',
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(synthesis.analyzeSession).not.toHaveBeenCalled();
  });

  it('rejects reserved sessionId "manual" with INVALID_PARAMS (Critical-1 guard)', async () => {
    const { rpcHandler, synthesis } = buildHandlers();
    await expect(
      rpcHandler.call('skillSynthesis:analyzeNow', {
        sessionId: 'manual',
        workspaceRoot: '/workspace/project',
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(synthesis.analyzeSession).not.toHaveBeenCalled();
  });

  it('returns error envelope when synthesis throws (no leak as raw throw)', async () => {
    const { rpcHandler, synthesis } = buildHandlers();
    synthesis.analyzeSession.mockRejectedValue(new Error('JSONL read failed'));

    const result = await rpcHandler.call('skillSynthesis:analyzeNow', {
      sessionId: 'sess-3',
      workspaceRoot: '/workspace/project',
    });

    expect(result).toMatchObject({
      success: false,
      candidateId: null,
      error: 'JSONL read failed',
    });
  });
});

describe('SkillsSynthesisRpcHandlers — skillSynthesis:setTriggers', () => {
  it('persists each provided field and returns the read-back triggers', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers();
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');

    const result = await rpcHandler.call('skillSynthesis:setTriggers', {
      triggers: { sessionEnd: false, idleMs: 120000, bootScan: false },
    });

    expect(setSpy).toHaveBeenCalledWith(
      'ptah',
      'skillSynthesis.triggers.sessionEnd',
      false,
    );
    expect(setSpy).toHaveBeenCalledWith(
      'ptah',
      'skillSynthesis.triggers.idleMs',
      120000,
    );
    expect(setSpy).toHaveBeenCalledWith(
      'ptah',
      'skillSynthesis.triggers.bootScan',
      false,
    );
    expect(result).toMatchObject({
      triggers: { sessionEnd: false, idleMs: 120000, bootScan: false },
    });
  });

  it('rejects negative idleMs with INVALID_PARAMS', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers();
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');
    await expect(
      rpcHandler.call('skillSynthesis:setTriggers', {
        triggers: { idleMs: -1 },
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('rejects degenerate idleMs (1ms) with INVALID_PARAMS (Moderate-1)', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers();
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');
    await expect(
      rpcHandler.call('skillSynthesis:setTriggers', {
        triggers: { idleMs: 1 },
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('accepts idleMs = 0 (disabled)', async () => {
    const { rpcHandler } = buildHandlers();
    const result = await rpcHandler.call('skillSynthesis:setTriggers', {
      triggers: { idleMs: 0 },
    });
    expect(result).toMatchObject({ triggers: { idleMs: 0 } });
  });

  it('returns PERSISTENCE_UNAVAILABLE without leaking when setConfiguration throws', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers();
    jest
      .spyOn(workspaceProvider, 'setConfiguration')
      .mockRejectedValue(new Error('EACCES: ~/.ptah/settings.json'));
    let thrown: unknown;
    try {
      await rpcHandler.call('skillSynthesis:setTriggers', {
        triggers: { sessionEnd: false },
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RpcUserError);
    const rpcErr = thrown as RpcUserError;
    expect(rpcErr.errorCode).toBe('PERSISTENCE_UNAVAILABLE');
    expect(rpcErr.message).not.toContain('EACCES');
  });
});

describe('SkillsSynthesisRpcHandlers — skillSynthesis:getTriggers', () => {
  it('returns defaults when no settings present', async () => {
    const { rpcHandler } = buildHandlers();
    const result = await rpcHandler.call('skillSynthesis:getTriggers', {});
    expect(result).toMatchObject({
      triggers: {
        sessionEnd: true,
        idleMs: 600000,
        bootScan: true,
        subagentStop: { enabled: true },
        postToolUse: { enabled: true, minEditCount: 3 },
        maxAnalyzesPerHour: 6,
      },
    });
  });

  it('returns persisted values after setTriggers', async () => {
    const { rpcHandler } = buildHandlers();
    await rpcHandler.call('skillSynthesis:setTriggers', {
      triggers: { idleMs: 90000, bootScan: false },
    });
    const result = await rpcHandler.call('skillSynthesis:getTriggers', {});
    expect(result).toMatchObject({
      triggers: { idleMs: 90000, bootScan: false },
    });
  });

  it('rejects unknown fields when params is non-empty object with extras', async () => {
    const { rpcHandler } = buildHandlers();
    await expect(
      rpcHandler.call('skillSynthesis:getTriggers', {
        junk: 'value',
      } as unknown),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });
});

describe('SkillsSynthesisRpcHandlers — nested triggers (subagentStop / postToolUse / maxAnalyzesPerHour)', () => {
  it('persists nested subagentStop via flat dotted keys and round-trips', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers();
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');

    const result = await rpcHandler.call('skillSynthesis:setTriggers', {
      triggers: { subagentStop: { enabled: false } },
    });

    expect(setSpy).toHaveBeenCalledWith(
      'ptah',
      'skillSynthesis.triggers.subagentStop.enabled',
      false,
    );
    expect(result).toMatchObject({
      triggers: { subagentStop: { enabled: false } },
    });

    const getResult = await rpcHandler.call('skillSynthesis:getTriggers', {});
    expect(getResult).toMatchObject({
      triggers: { subagentStop: { enabled: false } },
    });
  });

  it('persists nested postToolUse via 2 flat dotted keys', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers();
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');

    await rpcHandler.call('skillSynthesis:setTriggers', {
      triggers: { postToolUse: { enabled: false, minEditCount: 5 } },
    });

    expect(setSpy).toHaveBeenCalledWith(
      'ptah',
      'skillSynthesis.triggers.postToolUse.enabled',
      false,
    );
    expect(setSpy).toHaveBeenCalledWith(
      'ptah',
      'skillSynthesis.triggers.postToolUse.minEditCount',
      5,
    );
  });

  it('persists maxAnalyzesPerHour as top-level flat key', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers();
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');

    await rpcHandler.call('skillSynthesis:setTriggers', {
      triggers: { maxAnalyzesPerHour: 24 },
    });

    expect(setSpy).toHaveBeenCalledWith(
      'ptah',
      'skillSynthesis.triggers.maxAnalyzesPerHour',
      24,
    );

    const getResult = await rpcHandler.call('skillSynthesis:getTriggers', {});
    expect(getResult).toMatchObject({
      triggers: { maxAnalyzesPerHour: 24 },
    });
  });

  it('rejects minEditCount=0 (below min) via Zod refinement', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers();
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');
    await expect(
      rpcHandler.call('skillSynthesis:setTriggers', {
        triggers: { postToolUse: { enabled: true, minEditCount: 0 } },
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('rejects minEditCount=21 (above max) via Zod refinement', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers();
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');
    await expect(
      rpcHandler.call('skillSynthesis:setTriggers', {
        triggers: { postToolUse: { enabled: true, minEditCount: 21 } },
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('rejects maxAnalyzesPerHour > 1000 via Zod refinement', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers();
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');
    await expect(
      rpcHandler.call('skillSynthesis:setTriggers', {
        triggers: { maxAnalyzesPerHour: 1001 },
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(setSpy).not.toHaveBeenCalled();
  });
});

describe('SkillsSynthesisRpcHandlers — clone/enhance RPC (P3-3)', () => {
  const sampleRow = {
    slug: 'deep-research',
    kind: 'skill' as const,
    userPath: '/home/.ptah/user/skills/deep-research',
    originPluginId: 'research-pack',
    originVersion: '1.0.0',
    sourceHash: 'sha256:aaa',
    cloneStatus: 'clone' as const,
    diverged: false,
    historyDir: null,
    lastEnhancedAt: 1700000000000,
    candidateId: null,
    pendingSourceHash: null,
    createdAt: 1690000000000,
    updatedAt: 1700000000000,
  };

  it('listClones joins registry rows with invocation stats + history count', async () => {
    const { rpcHandler, registry, store, mirror } = buildHandlers();
    registry.listAll.mockReturnValue([sampleRow]);
    store.getInvocationStats.mockReturnValue({
      total: 10,
      succeeded: 7,
      failed: 3,
      distinctContexts: 4,
    });
    mirror.listHistory.mockResolvedValue([
      { ts: 't1', path: '/p/t1', hasSkillMd: true },
      { ts: 't2', path: '/p/t2', hasSkillMd: true },
    ]);

    const result = (await rpcHandler.call('skillSynthesis:listClones', {})) as {
      clones: Array<Record<string, unknown>>;
    };

    expect(result.clones).toHaveLength(1);
    expect(result.clones[0]).toMatchObject({
      slug: 'deep-research',
      kind: 'skill',
      cloneStatus: 'clone',
      invocationCount: 10,
      successRate: 0.7,
      historyCount: 2,
      lastEnhancedAt: 1700000000000,
    });
  });

  it('listClones returns PERSISTENCE_UNAVAILABLE when registry unbound (VS Code)', async () => {
    const logger = makeLogger();
    const rpcHandler = makeRpcHandler();
    const child = container.createChildContainer();
    child.registerInstance(TOKENS.LOGGER, logger);
    child.registerInstance(TOKENS.RPC_HANDLER, rpcHandler);
    child.registerInstance(TOKENS.SENTRY_SERVICE, makeSentry());
    child.registerInstance(
      SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE,
      makeSynthesis(),
    );
    child.registerInstance(
      SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE,
      makeStore(),
    );
    child.registerInstance(
      SKILL_SYNTHESIS_TOKENS.SKILL_DIAGNOSTICS_SERVICE,
      makeDiagnostics(),
    );
    child.registerInstance(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
      createMockWorkspaceProvider({ folders: ['/workspace/project'] }),
    );
    child.register(SkillsSynthesisRpcHandlers, {
      useClass: SkillsSynthesisRpcHandlers,
    });
    child.resolve(SkillsSynthesisRpcHandlers).register();

    await expect(
      rpcHandler.call('skillSynthesis:listClones', {}),
    ).rejects.toMatchObject({ errorCode: 'PERSISTENCE_UNAVAILABLE' });
  });

  it('getClone returns detail, body, and history', async () => {
    const { rpcHandler, registry, mirror } = buildHandlers();
    registry.getBySlug.mockReturnValue(sampleRow);
    mirror.listHistory.mockResolvedValue([
      { ts: '20260101T000000', path: '/p', hasSkillMd: true },
    ]);

    const result = (await rpcHandler.call('skillSynthesis:getClone', {
      slug: 'deep-research',
      kind: 'skill',
    })) as { clone: Record<string, unknown> | null; history: unknown[] };

    expect(registry.getBySlug).toHaveBeenCalledWith('skill', 'deep-research');
    expect(result.clone).toMatchObject({ slug: 'deep-research' });
    expect(result.history).toEqual([{ ts: '20260101T000000', hasBody: true }]);
  });

  it('getClone returns nulls for unknown slug', async () => {
    const { rpcHandler, registry } = buildHandlers();
    registry.getBySlug.mockReturnValue(null);
    const result = await rpcHandler.call('skillSynthesis:getClone', {
      slug: 'missing',
      kind: 'skill',
    });
    expect(result).toMatchObject({ clone: null, body: null, history: [] });
  });

  it('getClone rejects invalid kind with INVALID_PARAMS', async () => {
    const { rpcHandler } = buildHandlers();
    await expect(
      rpcHandler.call('skillSynthesis:getClone', {
        slug: 'x',
        kind: 'bogus',
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });

  it('enhanceNow reads settings and calls enhancer with manual flag', async () => {
    const { rpcHandler, enhancer, synthesis } = buildHandlers();
    synthesis.readSettings.mockReturnValue({ minJudgeScore: 6 });
    enhancer.enhance.mockResolvedValue({
      changed: true,
      slug: 'deep-research',
      kind: 'skill',
      judgeScore: 8,
      judgeReason: 'judge-verdict',
      historyTs: '20260101T000000',
    });

    const result = await rpcHandler.call('skillSynthesis:enhanceNow', {
      slug: 'deep-research',
    });

    expect(enhancer.enhance).toHaveBeenCalledWith(
      'deep-research',
      { minJudgeScore: 6 },
      { manual: true },
    );
    expect(result).toMatchObject({
      changed: true,
      slug: 'deep-research',
      judgeScore: 8,
      skipReason: null,
    });
  });

  it('revertEnhancement delegates to enhancer.revert', async () => {
    const { rpcHandler, enhancer } = buildHandlers();
    enhancer.revert.mockResolvedValue({
      reverted: true,
      slug: 'deep-research',
      revertedFrom: '1717848000000',
      newHistoryTs: '1717848000001',
    });

    const result = await rpcHandler.call('skillSynthesis:revertEnhancement', {
      slug: 'deep-research',
      historyTs: '1717848000000',
    });

    expect(enhancer.revert).toHaveBeenCalledWith(
      'deep-research',
      '1717848000000',
    );
    expect(result).toMatchObject({ reverted: true });
  });

  it('revertEnhancement rejects a traversal historyTs with INVALID_PARAMS; enhancer untouched', async () => {
    const { rpcHandler, enhancer } = buildHandlers();
    await expect(
      rpcHandler.call('skillSynthesis:revertEnhancement', {
        slug: 'deep-research',
        historyTs: '../../etc',
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(enhancer.revert).not.toHaveBeenCalled();
  });

  it('enhanceNow short-circuits with kind-not-supported for an agent-kind clone; enhancer untouched', async () => {
    const { rpcHandler, registry, enhancer } = buildHandlers();
    registry.getBySlug.mockImplementation((kind: string) =>
      kind === 'agent'
        ? { ...sampleRow, kind: 'agent', slug: 'my-agent' }
        : null,
    );

    const result = await rpcHandler.call('skillSynthesis:enhanceNow', {
      slug: 'my-agent',
    });

    expect(result).toMatchObject({
      changed: false,
      slug: 'my-agent',
      kind: 'agent',
      skipReason: 'kind-not-supported',
    });
    expect(enhancer.enhance).not.toHaveBeenCalled();
  });

  it('enhanceNow proceeds to enhancer when the slug is a skill clone', async () => {
    const { rpcHandler, registry, enhancer, synthesis } = buildHandlers();
    synthesis.readSettings.mockReturnValue({ minJudgeScore: 6 });
    registry.getBySlug.mockImplementation((kind: string) =>
      kind === 'skill' ? sampleRow : null,
    );
    enhancer.enhance.mockResolvedValue({
      changed: true,
      slug: 'deep-research',
      kind: 'skill',
      judgeScore: 8,
      judgeReason: 'judge-verdict',
      historyTs: '1717848000000',
    });

    const result = await rpcHandler.call('skillSynthesis:enhanceNow', {
      slug: 'deep-research',
    });

    expect(enhancer.enhance).toHaveBeenCalledWith(
      'deep-research',
      { minJudgeScore: 6 },
      { manual: true },
    );
    expect(result).toMatchObject({ changed: true, skipReason: null });
  });

  it('rebaseClone returns PERSISTENCE_UNAVAILABLE for a poisoned originPluginId (no path join)', async () => {
    const { rpcHandler, registry, mirror, contentDownload } = buildHandlers();
    registry.getBySlug.mockReturnValue({
      ...sampleRow,
      originPluginId: '../../../../etc',
    });

    await expect(
      rpcHandler.call('skillSynthesis:rebaseClone', {
        kind: 'skill',
        slug: 'deep-research',
      }),
    ).rejects.toMatchObject({ errorCode: 'PERSISTENCE_UNAVAILABLE' });
    expect(contentDownload.getPluginsPath).not.toHaveBeenCalled();
    expect(mirror.rebaseClone).not.toHaveBeenCalled();
  });

  it('rebaseClone resolves upstream source dir from plugin path', async () => {
    const { rpcHandler, registry, mirror, contentDownload } = buildHandlers();
    registry.getBySlug.mockReturnValue(sampleRow);
    mirror.rebaseClone.mockResolvedValue({
      kind: 'skill',
      slug: 'deep-research',
      sourceHash: 'sha256:bbb',
      snapshotPath: '/snap',
      failed: false,
    });

    const result = await rpcHandler.call('skillSynthesis:rebaseClone', {
      kind: 'skill',
      slug: 'deep-research',
    });

    expect(contentDownload.getPluginsPath).toHaveBeenCalled();
    expect(mirror.rebaseClone).toHaveBeenCalledWith({
      kind: 'skill',
      slug: 'deep-research',
      sourceDir: join(
        '/home/.ptah/plugins',
        'research-pack',
        'skills',
        'deep-research',
      ),
    });
    expect(registry.setDiverged).toHaveBeenCalledWith(
      'skill',
      'deep-research',
      false,
    );
    expect(result).toMatchObject({ failed: false, sourceHash: 'sha256:bbb' });
  });

  it('rebaseClone returns INVALID_PARAMS when clone row missing', async () => {
    const { rpcHandler, registry } = buildHandlers();
    registry.getBySlug.mockReturnValue(null);
    await expect(
      rpcHandler.call('skillSynthesis:rebaseClone', {
        kind: 'skill',
        slug: 'missing',
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });

  it('keepClone resolves divergence and returns source hash', async () => {
    const { rpcHandler, mirror, registry } = buildHandlers();
    mirror.keepClone.mockResolvedValue({
      kind: 'skill',
      slug: 'deep-research',
      sourceHash: 'sha256:ccc',
    });

    const result = await rpcHandler.call('skillSynthesis:keepClone', {
      kind: 'skill',
      slug: 'deep-research',
    });

    expect(mirror.keepClone).toHaveBeenCalledWith({
      kind: 'skill',
      slug: 'deep-research',
    });
    expect(registry.setDiverged).toHaveBeenCalledWith(
      'skill',
      'deep-research',
      false,
    );
    expect(result).toMatchObject({ sourceHash: 'sha256:ccc' });
  });

  it('invocationStats returns slug-keyed counts from the candidate store', async () => {
    const { rpcHandler, store } = buildHandlers();
    store.getInvocationStats.mockReturnValue({
      total: 5,
      succeeded: 4,
      failed: 1,
      distinctContexts: 2,
    });

    const result = await rpcHandler.call('skillSynthesis:invocationStats', {
      slug: 'deep-research',
    });

    expect(store.getInvocationStats).toHaveBeenCalledWith('deep-research');
    expect(result).toMatchObject({
      slug: 'deep-research',
      stats: { total: 5, succeeded: 4, failed: 1, distinctContexts: 2 },
    });
  });

  it('invocationStats rejects empty slug with INVALID_PARAMS', async () => {
    const { rpcHandler } = buildHandlers();
    await expect(
      rpcHandler.call('skillSynthesis:invocationStats', { slug: '' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });
});

describe('SkillsSynthesisRpcHandlers — dual-registration smoke', () => {
  it('every METHODS entry has a prefix listed in ALLOWED_METHOD_PREFIXES', () => {
    for (const method of SkillsSynthesisRpcHandlers.METHODS) {
      const ok = ALLOWED_METHOD_PREFIXES.some((p) => method.startsWith(p));
      expect(ok).toBe(true);
    }
  });
});
