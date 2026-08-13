/**
 * Unit tests for SkillsSynthesisRpcHandlers — diagnostics + analyzeNow +
 * setTriggers + getTriggers (Batch B6, TASK_2026_126).
 *
 * Each new method covers: happy path, Zod invalid params, service throw.
 * Plus a dual-registration smoke test against ALLOWED_METHOD_PREFIXES.
 */

import 'reflect-metadata';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { container } from 'tsyringe';
import {
  TOKENS,
  RpcUserError,
  ALLOWED_METHOD_PREFIXES,
} from '@ptah-extension/vscode-core';
import {
  SKILL_SYNTHESIS_TOKENS,
  USER_LAYER_MIRROR_SERVICE_TOKEN,
  ProposalNotFoundError,
  SKILL_LANE_IDS,
  SKILL_LANE_FIELDS,
  SKILL_LANE_KEYS,
  SKILL_LANE_DEFAULTS,
} from '@ptah-extension/skill-synthesis';
import {
  PLATFORM_TOKENS,
  FILE_BASED_SETTINGS_KEYS,
  FILE_BASED_SETTINGS_DEFAULTS,
  isFileBasedSettingKey,
} from '@ptah-extension/platform-core';
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
    generateProposal: jest.fn().mockResolvedValue({
      proposed: false,
      slug: '',
      kind: 'skill',
      currentBody: null,
      proposedBody: null,
      judgeScore: null,
      judgeReason: null,
      proposalId: null,
      skipReason: 'below-threshold',
    }),
    applyProposal: jest.fn().mockResolvedValue({
      applied: true,
      slug: '',
      kind: 'skill',
      judgeScore: null,
      judgeReason: null,
      historyTs: null,
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

function emptyScorecard(slug: string) {
  return {
    slug,
    totalInvocations: 0,
    gradedCount: 0,
    gradedSuccessRate: null,
    avgInputTokens: null,
    avgOutputTokens: null,
    avgCacheReadTokens: null,
    totalInputTokens: null,
    totalOutputTokens: null,
    avgCostUsd: null,
    avgDurationMs: null,
    avgToolCount: null,
    recentVerdicts: [],
  };
}

function makeScorecard() {
  return {
    getScorecards: jest.fn().mockReturnValue({}),
    getScorecardDetail: jest
      .fn()
      .mockResolvedValue({ slug: '', rows: [], findingsExcerpt: null }),
  };
}

/**
 * The queue store is injected non-optionally (it ships with the same
 * `registerSkillSynthesisServices` call as the candidate store), so every
 * container that resolves the handler class must provide it. The queue method
 * itself is exercised in `skills-synthesis-rpc.queue.spec.ts`.
 */
function makeQueueStore() {
  return {
    listRecent: jest.fn().mockReturnValue([]),
  };
}

/**
 * The budget store is injected non-optionally for the same reason as the queue
 * store, so it too must be present in EVERY container in this file — including
 * the two deliberately-sparse ones. There are four construction sites here plus
 * one in `skills-synthesis-rpc.queue.spec.ts`; a new constructor parameter
 * breaks all five, which is a known cost and a filed follow-up, not something
 * to fix by consolidating them inside a feature batch.
 */
function makeBudgetStore() {
  return {
    todayStageUsage: jest.fn().mockReturnValue([]),
  };
}

function makeDiagnostics() {
  return {
    getSnapshot: jest.fn().mockResolvedValue({
      lastAnalyzeRunAt: null,
      lastCuratorPassAt: null,
      eligibilityHistogram: {
        prefilterTooThin: 0,
        prefilterRejected: 0,
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
        turnComplete: { enabled: true },
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
  const scorecard = makeScorecard();
  const queueStore = makeQueueStore();
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
  child.registerInstance(
    SKILL_SYNTHESIS_TOKENS.SKILL_SCORECARD_SERVICE,
    scorecard,
  );
  child.registerInstance(SKILL_SYNTHESIS_TOKENS.SKILL_QUEUE_STORE, queueStore);
  child.registerInstance(
    SKILL_SYNTHESIS_TOKENS.SKILL_BUDGET_STORE,
    makeBudgetStore(),
  );
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
    scorecard,
    queueStore,
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
        prefilterTooThin: 1,
        prefilterRejected: 5,
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
        turnComplete: { enabled: true },
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
      enhanceMinInvocations: 5,
      enhanceCooldownUntil: 1700000000000 + 24 * 60 * 60 * 1000,
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
    // The registry is what this test leaves unbound; the queue and budget
    // stores are not optional, so both must be present even in a
    // deliberately-sparse container.
    child.registerInstance(
      SKILL_SYNTHESIS_TOKENS.SKILL_QUEUE_STORE,
      makeQueueStore(),
    );
    child.registerInstance(
      SKILL_SYNTHESIS_TOKENS.SKILL_BUDGET_STORE,
      makeBudgetStore(),
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

  it('enhanceNow reads settings and calls enhancer with manual flag + kind', async () => {
    const { rpcHandler, registry, enhancer, synthesis } = buildHandlers();
    synthesis.readSettings.mockReturnValue({ minJudgeScore: 6 });
    registry.getBySlug.mockReturnValue(sampleRow);
    enhancer.enhance.mockResolvedValue({
      changed: true,
      slug: 'deep-research',
      kind: 'skill',
      judgeScore: 8,
      judgeReason: 'judge-verdict',
      historyTs: '20260101T000000',
    });

    const result = await rpcHandler.call('skillSynthesis:enhanceNow', {
      kind: 'skill',
      slug: 'deep-research',
    });

    expect(enhancer.enhance).toHaveBeenCalledWith(
      'deep-research',
      { minJudgeScore: 6 },
      { manual: true, kind: 'skill' },
    );
    expect(result).toMatchObject({
      changed: true,
      slug: 'deep-research',
      judgeScore: 8,
      skipReason: null,
    });
  });

  it('revertEnhancement delegates to enhancer.revert with kind', async () => {
    const { rpcHandler, enhancer } = buildHandlers();
    enhancer.revert.mockResolvedValue({
      reverted: true,
      slug: 'deep-research',
      revertedFrom: '1717848000000',
      newHistoryTs: '1717848000001',
    });

    const result = await rpcHandler.call('skillSynthesis:revertEnhancement', {
      kind: 'skill',
      slug: 'deep-research',
      historyTs: '1717848000000',
    });

    expect(enhancer.revert).toHaveBeenCalledWith(
      'deep-research',
      '1717848000000',
      'skill',
    );
    expect(result).toMatchObject({ reverted: true });
  });

  it('revertEnhancement forwards an agent kind to enhancer.revert', async () => {
    const { rpcHandler, enhancer } = buildHandlers();
    enhancer.revert.mockResolvedValue({
      reverted: true,
      slug: 'my-agent',
      revertedFrom: '1717848000000',
      newHistoryTs: '1717848000001',
    });

    await rpcHandler.call('skillSynthesis:revertEnhancement', {
      kind: 'agent',
      slug: 'my-agent',
      historyTs: '1717848000000',
    });

    expect(enhancer.revert).toHaveBeenCalledWith(
      'my-agent',
      '1717848000000',
      'agent',
    );
  });

  it('revertEnhancement rejects a traversal historyTs with INVALID_PARAMS; enhancer untouched', async () => {
    const { rpcHandler, enhancer } = buildHandlers();
    await expect(
      rpcHandler.call('skillSynthesis:revertEnhancement', {
        kind: 'skill',
        slug: 'deep-research',
        historyTs: '../../etc',
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(enhancer.revert).not.toHaveBeenCalled();
  });

  it('enhanceNow enhances an agent-kind clone with kind agent', async () => {
    const { rpcHandler, registry, enhancer, synthesis } = buildHandlers();
    synthesis.readSettings.mockReturnValue({ minJudgeScore: 6 });
    registry.getBySlug.mockImplementation((kind: string) =>
      kind === 'agent'
        ? { ...sampleRow, kind: 'agent', slug: 'my-agent' }
        : null,
    );
    enhancer.enhance.mockResolvedValue({
      changed: true,
      slug: 'my-agent',
      kind: 'agent',
      judgeScore: 8,
      judgeReason: 'judge-verdict',
      historyTs: '1717848000000',
    });

    const result = await rpcHandler.call('skillSynthesis:enhanceNow', {
      kind: 'agent',
      slug: 'my-agent',
    });

    expect(enhancer.enhance).toHaveBeenCalledWith(
      'my-agent',
      { minJudgeScore: 6 },
      { manual: true, kind: 'agent' },
    );
    expect(result).toMatchObject({ changed: true, kind: 'agent' });
  });

  it('enhanceNow enhances a command-kind clone with kind command', async () => {
    const { rpcHandler, registry, enhancer, synthesis } = buildHandlers();
    synthesis.readSettings.mockReturnValue({ minJudgeScore: 6 });
    registry.getBySlug.mockImplementation((kind: string) =>
      kind === 'command'
        ? { ...sampleRow, kind: 'command', slug: 'my-cmd' }
        : null,
    );
    enhancer.enhance.mockResolvedValue({
      changed: false,
      slug: 'my-cmd',
      kind: 'command',
      judgeScore: null,
      judgeReason: null,
      historyTs: null,
    });

    await rpcHandler.call('skillSynthesis:enhanceNow', {
      kind: 'command',
      slug: 'my-cmd',
    });

    expect(enhancer.enhance).toHaveBeenCalledWith(
      'my-cmd',
      { minJudgeScore: 6 },
      { manual: true, kind: 'command' },
    );
  });

  it('enhanceNow rejects with INVALID_PARAMS when no clone exists for (kind, slug); enhancer untouched', async () => {
    const { rpcHandler, registry, enhancer } = buildHandlers();
    registry.getBySlug.mockReturnValue(null);

    await expect(
      rpcHandler.call('skillSynthesis:enhanceNow', {
        kind: 'agent',
        slug: 'missing',
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
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
      kind: 'skill',
      slug: 'deep-research',
    });

    expect(enhancer.enhance).toHaveBeenCalledWith(
      'deep-research',
      { minJudgeScore: 6 },
      { manual: true, kind: 'skill' },
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

describe('SkillsSynthesisRpcHandlers — skillSynthesis:getScorecards', () => {
  it('passes validated slugs to the scorecard service and returns the map', async () => {
    const { rpcHandler, scorecard } = buildHandlers();
    scorecard.getScorecards.mockReturnValue({
      'backend-developer': {
        ...emptyScorecard('backend-developer'),
        totalInvocations: 12,
      },
    });

    const result = (await rpcHandler.call('skillSynthesis:getScorecards', {
      slugs: ['backend-developer'],
    })) as { scorecards: Record<string, { totalInvocations: number }> };

    expect(scorecard.getScorecards).toHaveBeenCalledWith(['backend-developer']);
    expect(result.scorecards['backend-developer'].totalInvocations).toBe(12);
  });

  it('returns a typed empty scorecard for a no-data slug', async () => {
    const { rpcHandler, scorecard } = buildHandlers();
    scorecard.getScorecards.mockReturnValue({
      'idle-agent': emptyScorecard('idle-agent'),
    });

    const result = (await rpcHandler.call('skillSynthesis:getScorecards', {
      slugs: ['idle-agent'],
    })) as {
      scorecards: Record<
        string,
        { totalInvocations: number; gradedSuccessRate: number | null }
      >;
    };

    expect(result.scorecards['idle-agent']).toMatchObject({
      totalInvocations: 0,
      gradedSuccessRate: null,
    });
  });

  it('returns {} scorecards when the scorecard service is unbound', async () => {
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
    // The scorecard service is what this test leaves unbound; the queue and
    // budget stores are not optional, so both must be present even in a sparse
    // container.
    child.registerInstance(
      SKILL_SYNTHESIS_TOKENS.SKILL_QUEUE_STORE,
      makeQueueStore(),
    );
    child.registerInstance(
      SKILL_SYNTHESIS_TOKENS.SKILL_BUDGET_STORE,
      makeBudgetStore(),
    );
    child.register(SkillsSynthesisRpcHandlers, {
      useClass: SkillsSynthesisRpcHandlers,
    });
    child.resolve(SkillsSynthesisRpcHandlers).register();

    const result = await rpcHandler.call('skillSynthesis:getScorecards', {
      slugs: ['a'],
    });
    expect(result).toEqual({ scorecards: {} });
  });

  it('rejects a non-array slugs param with INVALID_PARAMS', async () => {
    const { rpcHandler, scorecard } = buildHandlers();
    await expect(
      rpcHandler.call('skillSynthesis:getScorecards', { slugs: 'nope' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(scorecard.getScorecards).not.toHaveBeenCalled();
  });

  it('rejects an oversized slugs list (>500) with INVALID_PARAMS', async () => {
    const { rpcHandler, scorecard } = buildHandlers();
    const slugs = Array.from({ length: 501 }, (_, i) => `agent-${i}`);
    await expect(
      rpcHandler.call('skillSynthesis:getScorecards', { slugs }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(scorecard.getScorecards).not.toHaveBeenCalled();
  });

  it('rejects an empty-string slug entry with INVALID_PARAMS', async () => {
    const { rpcHandler, scorecard } = buildHandlers();
    await expect(
      rpcHandler.call('skillSynthesis:getScorecards', { slugs: [''] }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(scorecard.getScorecards).not.toHaveBeenCalled();
  });

  it('wraps a scorecard-service throw without leaking the raw message', async () => {
    const { rpcHandler, scorecard } = buildHandlers();
    scorecard.getScorecards.mockImplementation(() => {
      throw new Error('SQLITE_CORRUPT: malformed disk image');
    });
    let thrown: unknown;
    try {
      await rpcHandler.call('skillSynthesis:getScorecards', { slugs: ['a'] });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RpcUserError);
    expect((thrown as RpcUserError).message).not.toContain('SQLITE_CORRUPT');
  });
});

describe('SkillsSynthesisRpcHandlers — skillSynthesis:getScorecardDetail', () => {
  it('delegates to the scorecard service with slug + limit', async () => {
    const { rpcHandler, scorecard } = buildHandlers();
    scorecard.getScorecardDetail.mockResolvedValue({
      slug: 'backend-developer',
      rows: [
        {
          taskId: 'TASK_2026_001',
          succeeded: true,
          exactAttribution: true,
          inputTokens: 100,
          outputTokens: 10,
          costUsd: 0.2,
          durationMs: 1000,
          invokedAt: 1000,
          reconciledAt: 5000,
        },
      ],
      findingsExcerpt: 'findings',
    });

    const result = (await rpcHandler.call('skillSynthesis:getScorecardDetail', {
      slug: 'backend-developer',
      limit: 10,
    })) as { slug: string; rows: unknown[]; findingsExcerpt: string | null };

    expect(scorecard.getScorecardDetail).toHaveBeenCalledWith(
      'backend-developer',
      10,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.findingsExcerpt).toBe('findings');
  });

  it('returns a typed empty detail for a no-data slug', async () => {
    const { rpcHandler, scorecard } = buildHandlers();
    scorecard.getScorecardDetail.mockResolvedValue({
      slug: 'idle-agent',
      rows: [],
      findingsExcerpt: null,
    });

    const result = await rpcHandler.call('skillSynthesis:getScorecardDetail', {
      slug: 'idle-agent',
    });
    expect(result).toEqual({
      slug: 'idle-agent',
      rows: [],
      findingsExcerpt: null,
    });
  });

  it('rejects an empty slug with INVALID_PARAMS', async () => {
    const { rpcHandler, scorecard } = buildHandlers();
    await expect(
      rpcHandler.call('skillSynthesis:getScorecardDetail', { slug: '' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(scorecard.getScorecardDetail).not.toHaveBeenCalled();
  });

  it('rejects a non-integer limit with INVALID_PARAMS', async () => {
    const { rpcHandler, scorecard } = buildHandlers();
    await expect(
      rpcHandler.call('skillSynthesis:getScorecardDetail', {
        slug: 'agent',
        limit: 2.5,
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(scorecard.getScorecardDetail).not.toHaveBeenCalled();
  });

  it('rejects a limit above 100 with INVALID_PARAMS', async () => {
    const { rpcHandler, scorecard } = buildHandlers();
    await expect(
      rpcHandler.call('skillSynthesis:getScorecardDetail', {
        slug: 'agent',
        limit: 101,
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(scorecard.getScorecardDetail).not.toHaveBeenCalled();
  });

  it('wraps a scorecard-service throw without leaking the raw message', async () => {
    const { rpcHandler, scorecard } = buildHandlers();
    scorecard.getScorecardDetail.mockRejectedValue(
      new Error('EACCES: ~/.ptah/specs'),
    );
    let thrown: unknown;
    try {
      await rpcHandler.call('skillSynthesis:getScorecardDetail', {
        slug: 'agent',
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RpcUserError);
    expect((thrown as RpcUserError).message).not.toContain('EACCES');
  });
});

describe('SkillsSynthesisRpcHandlers — dual-registration smoke', () => {
  it('every METHODS entry has a prefix listed in ALLOWED_METHOD_PREFIXES', () => {
    for (const method of SkillsSynthesisRpcHandlers.METHODS) {
      const ok = ALLOWED_METHOD_PREFIXES.some((p) => method.startsWith(p));
      expect(ok).toBe(true);
    }
  });

  // Correction C11. `skillSynthesis:` was already allowed before this batch,
  // and the runtime guard is per PREFIX, not per method. A `getLanes` /
  // `setLanes` entry appearing in that list would be a second, redundant way to
  // say the same thing — and the next person to add a method would reasonably
  // conclude they had to add one too.
  it('adds no per-method entry to the runtime prefix guard', () => {
    const perMethod = ALLOWED_METHOD_PREFIXES.filter(
      (p) => p.startsWith('skillSynthesis:') && p !== 'skillSynthesis:',
    );
    expect(perMethod).toEqual([]);
  });
});

describe('SkillsSynthesisRpcHandlers — lane settings keys (B1.8.1)', () => {
  // `platform-core` cannot import `skill-synthesis` (it is the leaf that
  // `skill-synthesis` depends on), so its lane key list and defaults are a
  // literal restatement. `rpc-handlers` imports BOTH, which makes this the one
  // place the restatement can be checked mechanically instead of by comment.
  const laneEntries = SKILL_LANE_IDS.flatMap((id) =>
    SKILL_LANE_FIELDS.map(
      (field) =>
        [id, field, SKILL_LANE_KEYS[id][field]] as [
          (typeof SKILL_LANE_IDS)[number],
          (typeof SKILL_LANE_FIELDS)[number],
          string,
        ],
    ),
  );

  it('derives 32 dotted keys — four lanes × eight fields', () => {
    expect(laneEntries).toHaveLength(32);
  });

  it.each(laneEntries)(
    '%s.%s → routes %s to ~/.ptah/settings.json',
    (_id, _field, key) => {
      expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
      expect(isFileBasedSettingKey(key)).toBe(true);
    },
  );

  it.each(laneEntries)(
    '%s.%s → platform-core default for %s equals SKILL_LANE_DEFAULTS',
    (id, field, key) => {
      expect(
        Object.prototype.hasOwnProperty.call(FILE_BASED_SETTINGS_DEFAULTS, key),
      ).toBe(true);
      expect(FILE_BASED_SETTINGS_DEFAULTS[key]).toBe(
        SKILL_LANE_DEFAULTS[id][field],
      );
    },
  );

  it('registers no lane key platform-core knows about and SKILL_LANE_KEYS does not', () => {
    const declared = new Set(laneEntries.map(([, , key]) => key));
    const stray = [...FILE_BASED_SETTINGS_KEYS].filter(
      (key) =>
        /^skillSynthesis\.(archaeologist|synthesis|judge|replay)\./.test(key) &&
        !declared.has(key),
    );
    expect(stray).toEqual([]);
  });

  it('defaults every lane to inherit — provider and model both empty', () => {
    for (const id of SKILL_LANE_IDS) {
      expect(SKILL_LANE_DEFAULTS[id].provider).toBe('');
      expect(SKILL_LANE_DEFAULTS[id].model).toBe('');
      expect(FILE_BASED_SETTINGS_DEFAULTS[SKILL_LANE_KEYS[id].provider]).toBe(
        '',
      );
      expect(FILE_BASED_SETTINGS_DEFAULTS[SKILL_LANE_KEYS[id].model]).toBe('');
    }
  });
});

describe('SkillsSynthesisRpcHandlers — skillSynthesis:getLanes / setLanes (B1.8.2)', () => {
  it('returns the four inherit-by-default lanes when nothing is persisted', async () => {
    const { rpcHandler } = buildHandlers();
    const result = (await rpcHandler.call('skillSynthesis:getLanes', {})) as {
      lanes: Record<string, Record<string, unknown>>;
    };

    expect(Object.keys(result.lanes).sort()).toEqual(
      [...SKILL_LANE_IDS].sort(),
    );
    for (const id of SKILL_LANE_IDS) {
      expect(result.lanes[id]).toEqual(SKILL_LANE_DEFAULTS[id]);
    }
  });

  it('round-trips all 32 lane keys through setLanes → getLanes', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers();
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');

    // Deliberately no provider-id literal: `provider` is an opaque registry id
    // and this spec must not become the place a vendor name leaks into a lane
    // code path (global invariant 1).
    const patch = {
      archaeologist: {
        provider: 'lane-provider-a',
        model: 'lane-model-a',
        defaultTier: 'opus' as const,
        structuredOutput: 'parse' as const,
        toolUse: 'none' as const,
        timeoutMs: 111000,
        maxInputChars: 11100,
        maxPasses: 7,
      },
      synthesis: {
        provider: 'lane-provider-b',
        model: 'lane-model-b',
        defaultTier: 'sonnet' as const,
        structuredOutput: 'parse' as const,
        toolUse: 'required' as const,
        timeoutMs: 222000,
        maxInputChars: 22200,
        maxPasses: 2,
      },
      judge: {
        provider: 'lane-provider-c',
        model: 'lane-model-c',
        defaultTier: 'haiku' as const,
        structuredOutput: 'sdk' as const,
        toolUse: 'required' as const,
        timeoutMs: 33000,
        maxInputChars: 3300,
        maxPasses: 3,
      },
      replay: {
        provider: 'lane-provider-d',
        model: 'lane-model-d',
        defaultTier: 'opus' as const,
        structuredOutput: 'parse' as const,
        toolUse: 'none' as const,
        timeoutMs: 44000,
        maxInputChars: 4400,
        maxPasses: 4,
      },
    };

    const setResult = (await rpcHandler.call('skillSynthesis:setLanes', {
      lanes: patch,
    })) as { lanes: Record<string, Record<string, unknown>> };

    // Every one of the 32 dotted keys reached setConfiguration individually —
    // per-key routing is what makes file-based settings work at all.
    for (const id of SKILL_LANE_IDS) {
      for (const field of SKILL_LANE_FIELDS) {
        expect(setSpy).toHaveBeenCalledWith(
          'ptah',
          SKILL_LANE_KEYS[id][field],
          patch[id][field],
        );
      }
    }
    expect(setSpy).toHaveBeenCalledTimes(32);

    const getResult = (await rpcHandler.call(
      'skillSynthesis:getLanes',
      {},
    )) as { lanes: Record<string, Record<string, unknown>> };

    for (const id of SKILL_LANE_IDS) {
      const expected = { id, ...patch[id] };
      expect(setResult.lanes[id]).toEqual(expected);
      expect(getResult.lanes[id]).toEqual(expected);
    }
  });

  it('writes only the fields named in a sparse patch and leaves the rest alone', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers();
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');

    const result = (await rpcHandler.call('skillSynthesis:setLanes', {
      lanes: { judge: { timeoutMs: 60000 } },
    })) as { lanes: Record<string, Record<string, unknown>> };

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(
      'ptah',
      SKILL_LANE_KEYS.judge.timeoutMs,
      60000,
    );
    expect(result.lanes['judge']).toEqual({
      ...SKILL_LANE_DEFAULTS.judge,
      timeoutMs: 60000,
    });
    expect(result.lanes['synthesis']).toEqual(SKILL_LANE_DEFAULTS.synthesis);
  });

  it('returns the READ-BACK state, not an echo of the patch', async () => {
    // `readSkillLane` serves the default when a persisted value is unusable.
    // Echoing the request would report a write that did not take effect.
    const { rpcHandler, workspaceProvider } = buildHandlers();
    await workspaceProvider.setConfiguration(
      'ptah',
      SKILL_LANE_KEYS.judge.timeoutMs,
      -5,
    );
    const result = (await rpcHandler.call('skillSynthesis:getLanes', {})) as {
      lanes: Record<string, Record<string, unknown>>;
    };
    expect(result.lanes['judge']['timeoutMs']).toBe(
      SKILL_LANE_DEFAULTS.judge.timeoutMs,
    );
  });

  it('rejects a non-positive timeoutMs with INVALID_PARAMS and writes nothing', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers();
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');
    await expect(
      rpcHandler.call('skillSynthesis:setLanes', {
        lanes: { judge: { timeoutMs: 0 } },
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('rejects an unknown lane id with INVALID_PARAMS', async () => {
    const { rpcHandler } = buildHandlers();
    await expect(
      rpcHandler.call('skillSynthesis:setLanes', {
        lanes: { curator: { timeoutMs: 1000 } },
      } as unknown),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });

  it('rejects an unknown lane FIELD with INVALID_PARAMS', async () => {
    const { rpcHandler } = buildHandlers();
    await expect(
      rpcHandler.call('skillSynthesis:setLanes', {
        lanes: { judge: { temperature: 0.7 } },
      } as unknown),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });

  it('rejects an out-of-vocabulary structuredOutput mode', async () => {
    const { rpcHandler } = buildHandlers();
    await expect(
      rpcHandler.call('skillSynthesis:setLanes', {
        lanes: { judge: { structuredOutput: 'yaml' } },
      } as unknown),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });

  it('rejects an empty patch that names no lane', async () => {
    const { rpcHandler } = buildHandlers();
    await expect(
      rpcHandler.call('skillSynthesis:setLanes', { lanes: {} }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });

  it('rejects unknown params on getLanes', async () => {
    const { rpcHandler } = buildHandlers();
    await expect(
      rpcHandler.call('skillSynthesis:getLanes', { junk: 'value' } as unknown),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });

  it('surfaces PERSISTENCE_UNAVAILABLE without leaking the underlying message', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers();
    jest
      .spyOn(workspaceProvider, 'setConfiguration')
      .mockRejectedValue(new Error('EACCES: ~/.ptah/settings.json'));
    let thrown: unknown;
    try {
      await rpcHandler.call('skillSynthesis:setLanes', {
        lanes: { judge: { timeoutMs: 60000 } },
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

describe('SkillsSynthesisRpcHandlers — candidate summary judge fields (B1.8.3)', () => {
  function candidateRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'cand-1',
      name: 'refactor-jest-configs',
      description: 'Refactor jest configs into a shared preset',
      bodyPath: '/tmp/cand-1/SKILL.md',
      sourceSessionIds: ['s-1'],
      trajectoryHash: 'hash-1',
      embeddingRowid: null,
      status: 'candidate' as const,
      successCount: 3,
      failureCount: 1,
      createdAt: 1700000000000,
      promotedAt: null,
      rejectedAt: null,
      rejectedReason: null,
      pinned: false,
      residency: 'resident' as const,
      judgeStatus: null,
      judgeScore: null,
      judgeReason: null,
      judgeCriteria: {
        novelty: null,
        actionability: null,
        scope: null,
        generalization: null,
        triggerClarity: null,
      },
      judgePanelRationales: null,
      judgedAt: null,
      displayName: null,
      ...overrides,
    };
  }

  async function listOne(row: Record<string, unknown>) {
    const { rpcHandler, store } = buildHandlers();
    store.listByStatus.mockReturnValue([row]);
    const result = (await rpcHandler.call('skillSynthesis:listCandidates', {
      status: 'candidate',
    })) as { candidates: Array<Record<string, unknown>> };
    return result.candidates[0];
  }

  it('projects a never-judged candidate as all-null, never zero', async () => {
    const summary = await listOne(candidateRow());
    expect(summary['judgeStatus']).toBeNull();
    expect(summary['judgeScore']).toBeNull();
    expect(summary['judgeScore']).not.toBe(0);
    expect(summary['judgeReason']).toBeNull();
    expect(summary['judgeCriteria']).toBeNull();
    expect(summary['displayName']).toBeNull();
  });

  it('carries an unscored verdict as status + reason with a NULL score', async () => {
    // The defect this replaces: a failed judge call used to fabricate
    // `{passed: true, score: 10}`, which the UI rendered as a genuine verdict.
    const summary = await listOne(
      candidateRow({
        judgeStatus: 'unscored',
        judgeScore: null,
        judgeReason: 'judge-call-threw',
      }),
    );
    expect(summary['judgeStatus']).toBe('unscored');
    expect(summary['judgeScore']).toBeNull();
    expect(summary['judgeReason']).toBe('judge-call-threw');
  });

  it('carries a genuine zero score as 0, distinct from unscored', async () => {
    const summary = await listOne(
      candidateRow({
        judgeStatus: 'scored',
        judgeScore: 0,
        judgeReason: 'no reusable workflow',
        judgeCriteria: {
          novelty: 0,
          actionability: 0,
          scope: 0,
          generalization: 0,
          triggerClarity: 0,
        },
      }),
    );
    expect(summary['judgeScore']).toBe(0);
    expect(summary['judgeScore']).not.toBeNull();
    expect(summary['judgeCriteria']).toEqual({
      novelty: 0,
      actionability: 0,
      scope: 0,
      generalization: 0,
      triggerClarity: 0,
    });
  });

  it('forwards a scored verdict with its five criteria and display name', async () => {
    const summary = await listOne(
      candidateRow({
        displayName: 'Share one Jest preset across libs',
        judgeStatus: 'scored',
        judgeScore: 7.4,
        judgeReason: 'reusable and well triggered',
        judgeCriteria: {
          novelty: 7,
          actionability: 8,
          scope: 7,
          generalization: 7,
          triggerClarity: 8,
        },
      }),
    );
    expect(summary['displayName']).toBe('Share one Jest preset across libs');
    expect(summary['judgeStatus']).toBe('scored');
    expect(summary['judgeScore']).toBe(7.4);
    expect(summary['judgeCriteria']).toEqual({
      novelty: 7,
      actionability: 8,
      scope: 7,
      generalization: 7,
      triggerClarity: 8,
    });
  });

  it('reports a disabled gate as a status, not as an absent verdict', async () => {
    const summary = await listOne(
      candidateRow({ judgeStatus: 'disabled', judgeReason: 'judge gate off' }),
    );
    expect(summary['judgeStatus']).toBe('disabled');
    expect(summary['judgeScore']).toBeNull();
  });

  it('collapses an all-null criteria block to null rather than five blanks', async () => {
    const summary = await listOne(candidateRow({ judgeStatus: 'unscored' }));
    expect(summary['judgeCriteria']).toBeNull();
  });
});

const fakeSuggestionRow = {
  id: 'sug-1',
  name: 'My Skill',
  description: 'does things',
  body: '## Body\nStep 1.',
  memberSessionIds: ['s-1'],
  memberCandidateIds: ['c-1'],
  clusterSize: 3,
  technologyFingerprint: 'fp-abc',
  judgeScore: 7.5,
  status: 'pending' as const,
  createdAt: 1700000000000,
  decidedAt: null,
};

function makeSuggestionStore() {
  return {
    listByStatus: jest.fn().mockReturnValue([]),
    hasExistingForCluster: jest.fn().mockReturnValue(false),
    insertPending: jest.fn(),
    findById: jest.fn().mockReturnValue(fakeSuggestionRow),
    updatePending: jest.fn().mockReturnValue(fakeSuggestionRow),
  };
}

function makeCurator() {
  return {
    runManual: jest.fn().mockResolvedValue({
      reportPath: '/tmp/report.md',
      changesQueued: 0,
      skippedPinned: 0,
    }),
    start: jest.fn(),
    stop: jest.fn(),
    acceptSuggestion: jest.fn().mockReturnValue({
      accepted: true,
      filePath: '/home/.ptah/user/skills/my-skill/SKILL.md',
    }),
    dismissSuggestion: jest.fn().mockReturnValue({ dismissed: true }),
  };
}

function buildHandlersWithSuggestions(
  workspaceFolders: string[] = ['/workspace/project'],
) {
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
  const suggestionStore = makeSuggestionStore();
  const curator = makeCurator();
  const queueStore = makeQueueStore();
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
  child.registerInstance(
    SKILL_SYNTHESIS_TOKENS.SKILL_SUGGESTION_STORE,
    suggestionStore,
  );
  child.registerInstance(SKILL_SYNTHESIS_TOKENS.SKILL_CURATOR_SERVICE, curator);
  child.registerInstance(SKILL_SYNTHESIS_TOKENS.SKILL_QUEUE_STORE, queueStore);
  child.registerInstance(
    SKILL_SYNTHESIS_TOKENS.SKILL_BUDGET_STORE,
    makeBudgetStore(),
  );
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
    suggestionStore,
    curator,
    queueStore,
  };
}

describe('SkillsSynthesisRpcHandlers — skillSynthesis:listSuggestions', () => {
  it('happy path: calls suggestionStore.listByStatus with pending default and returns mapped suggestions', async () => {
    const { rpcHandler, suggestionStore } = buildHandlersWithSuggestions();
    const fakeRow = {
      id: 'sug-1',
      name: 'My Skill',
      description: 'does things',
      body: '## Description\nx',
      memberSessionIds: ['s-1'],
      memberCandidateIds: ['c-1'],
      clusterSize: 3,
      technologyFingerprint: 'fp-abc',
      judgeScore: 7.5,
      status: 'pending' as const,
      createdAt: 1700000000000,
      decidedAt: null,
    };
    suggestionStore.listByStatus.mockReturnValue([fakeRow]);

    const result = await rpcHandler.call('skillSynthesis:listSuggestions', {});

    expect(suggestionStore.listByStatus).toHaveBeenCalledWith('pending');
    expect(result).toMatchObject({
      suggestions: [
        {
          id: 'sug-1',
          name: 'My Skill',
          description: 'does things',
          clusterSize: 3,
          technologyFingerprint: 'fp-abc',
          judgeScore: 7.5,
          memberSessionIds: ['s-1'],
          status: 'pending',
          createdAt: 1700000000000,
        },
      ],
    });
  });

  it('happy path: forwards explicit status=accepted to listByStatus', async () => {
    const { rpcHandler, suggestionStore } = buildHandlersWithSuggestions();
    suggestionStore.listByStatus.mockReturnValue([]);

    const result = await rpcHandler.call('skillSynthesis:listSuggestions', {
      status: 'accepted',
    });

    expect(suggestionStore.listByStatus).toHaveBeenCalledWith('accepted');
    expect(result).toMatchObject({ suggestions: [] });
  });

  it('desktop guard: throws PERSISTENCE_UNAVAILABLE when suggestionStore is absent (VS Code)', async () => {
    const { rpcHandler } = buildHandlers();

    await expect(
      rpcHandler.call('skillSynthesis:listSuggestions', {}),
    ).rejects.toMatchObject({ errorCode: 'PERSISTENCE_UNAVAILABLE' });
  });

  it('param validation: invalid status value rejected with INVALID_PARAMS', async () => {
    const { rpcHandler } = buildHandlersWithSuggestions();

    await expect(
      rpcHandler.call('skillSynthesis:listSuggestions', { status: 'bogus' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });
});

describe('SkillsSynthesisRpcHandlers — skillSynthesis:acceptSuggestion', () => {
  it('happy path: calls curator.acceptSuggestion with id + settings and returns accepted + filePath', async () => {
    const { rpcHandler, curator, synthesis } = buildHandlersWithSuggestions();
    const fakeSettings = {
      enabled: true,
      successesToPromote: 3,
      dedupCosineThreshold: 0.85,
      maxActiveSkills: 50,
      candidatesDir: '',
      eligibilityMinTurns: 5,
      evictionDecayRate: 0.95,
      generalizationContextThreshold: 3,
      dedupClusterThreshold: 0.78,
      prefilterMinEdits: 1,
      prefilterMinChars: 800,
      prefilterMinToolUses: 2,
      judgeEnabled: true,
      minJudgeScore: 6.0,
      judgeModel: 'inherit',
      maxPinnedSkills: 10,
      curatorEnabled: true,
      curatorIntervalHours: 24,
      suggestionMinClusterSize: 2,
      suggestionMaxCandidates: 200,
    };
    synthesis.readSettings.mockReturnValue(fakeSettings);
    curator.acceptSuggestion.mockReturnValue({
      accepted: true,
      filePath: '/home/.ptah/user/skills/my-skill/SKILL.md',
    });

    const result = await rpcHandler.call('skillSynthesis:acceptSuggestion', {
      id: 'sug-42',
    });

    expect(synthesis.readSettings).toHaveBeenCalled();
    expect(curator.acceptSuggestion).toHaveBeenCalledWith(
      'sug-42',
      fakeSettings,
    );
    expect(result).toMatchObject({
      accepted: true,
      filePath: '/home/.ptah/user/skills/my-skill/SKILL.md',
    });
  });

  it('desktop guard: throws PERSISTENCE_UNAVAILABLE when curator is absent (VS Code)', async () => {
    const { rpcHandler } = buildHandlers();

    await expect(
      rpcHandler.call('skillSynthesis:acceptSuggestion', { id: 'sug-1' }),
    ).rejects.toMatchObject({ errorCode: 'PERSISTENCE_UNAVAILABLE' });
  });

  it('param validation: missing id rejected with INVALID_PARAMS', async () => {
    const { rpcHandler } = buildHandlersWithSuggestions();

    await expect(
      rpcHandler.call('skillSynthesis:acceptSuggestion', {}),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });

  it('param validation: empty id rejected with INVALID_PARAMS', async () => {
    const { rpcHandler } = buildHandlersWithSuggestions();

    await expect(
      rpcHandler.call('skillSynthesis:acceptSuggestion', { id: '' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });
});

describe('SkillsSynthesisRpcHandlers — skillSynthesis:dismissSuggestion', () => {
  it('happy path: calls curator.dismissSuggestion with id and returns dismissed', async () => {
    const { rpcHandler, curator } = buildHandlersWithSuggestions();
    curator.dismissSuggestion.mockReturnValue({ dismissed: true });

    const result = await rpcHandler.call('skillSynthesis:dismissSuggestion', {
      id: 'sug-99',
    });

    expect(curator.dismissSuggestion).toHaveBeenCalledWith('sug-99');
    expect(result).toMatchObject({ dismissed: true });
  });

  it('happy path: optional reason field is accepted and does not break dispatch', async () => {
    const { rpcHandler, curator } = buildHandlersWithSuggestions();
    curator.dismissSuggestion.mockReturnValue({ dismissed: true });

    const result = await rpcHandler.call('skillSynthesis:dismissSuggestion', {
      id: 'sug-99',
      reason: 'not useful',
    });

    expect(curator.dismissSuggestion).toHaveBeenCalledWith('sug-99');
    expect(result).toMatchObject({ dismissed: true });
  });

  it('desktop guard: throws PERSISTENCE_UNAVAILABLE when curator is absent (VS Code)', async () => {
    const { rpcHandler } = buildHandlers();

    await expect(
      rpcHandler.call('skillSynthesis:dismissSuggestion', { id: 'sug-1' }),
    ).rejects.toMatchObject({ errorCode: 'PERSISTENCE_UNAVAILABLE' });
  });

  it('param validation: missing id rejected with INVALID_PARAMS', async () => {
    const { rpcHandler } = buildHandlersWithSuggestions();

    await expect(
      rpcHandler.call('skillSynthesis:dismissSuggestion', {}),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });

  it('param validation: empty id rejected with INVALID_PARAMS', async () => {
    const { rpcHandler } = buildHandlersWithSuggestions();

    await expect(
      rpcHandler.call('skillSynthesis:dismissSuggestion', { id: '' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });

  it('param validation: reason exceeding 500 chars rejected with INVALID_PARAMS', async () => {
    const { rpcHandler } = buildHandlersWithSuggestions();

    await expect(
      rpcHandler.call('skillSynthesis:dismissSuggestion', {
        id: 'sug-1',
        reason: 'x'.repeat(501),
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });
});

describe('SkillsSynthesisRpcHandlers — skillSynthesis:getSuggestion', () => {
  it('happy path: calls suggestionStore.findById and returns suggestion with body', async () => {
    const { rpcHandler, suggestionStore } = buildHandlersWithSuggestions();
    suggestionStore.findById.mockReturnValue(fakeSuggestionRow);

    const result = await rpcHandler.call('skillSynthesis:getSuggestion', {
      id: 'sug-1',
    });

    expect(suggestionStore.findById).toHaveBeenCalledWith('sug-1');
    expect(result).toMatchObject({
      suggestion: {
        id: 'sug-1',
        name: 'My Skill',
        description: 'does things',
        body: '## Body\nStep 1.',
        status: 'pending',
      },
    });
  });

  it('returns suggestion:null when findById returns null (not found)', async () => {
    const { rpcHandler, suggestionStore } = buildHandlersWithSuggestions();
    suggestionStore.findById.mockReturnValue(null);

    const result = (await rpcHandler.call('skillSynthesis:getSuggestion', {
      id: 'missing',
    })) as { suggestion: null };

    expect(result.suggestion).toBeNull();
  });

  it('desktop guard: throws PERSISTENCE_UNAVAILABLE when suggestionStore is absent (VS Code)', async () => {
    const { rpcHandler } = buildHandlers();

    await expect(
      rpcHandler.call('skillSynthesis:getSuggestion', { id: 'sug-1' }),
    ).rejects.toMatchObject({ errorCode: 'PERSISTENCE_UNAVAILABLE' });
  });

  it('param validation: missing id rejected with INVALID_PARAMS', async () => {
    const { rpcHandler } = buildHandlersWithSuggestions();

    await expect(
      rpcHandler.call('skillSynthesis:getSuggestion', {}),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });

  it('param validation: empty id rejected with INVALID_PARAMS', async () => {
    const { rpcHandler } = buildHandlersWithSuggestions();

    await expect(
      rpcHandler.call('skillSynthesis:getSuggestion', { id: '' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });
});

describe('SkillsSynthesisRpcHandlers — skillSynthesis:updateSuggestion', () => {
  it('happy path: calls updatePending with fields and returns updated=true when still pending', async () => {
    const { rpcHandler, suggestionStore } = buildHandlersWithSuggestions();
    const updatedRow = {
      ...fakeSuggestionRow,
      name: 'New Name',
      status: 'pending' as const,
    };
    suggestionStore.updatePending.mockReturnValue(updatedRow);

    const result = await rpcHandler.call('skillSynthesis:updateSuggestion', {
      id: 'sug-1',
      name: 'New Name',
    });

    expect(suggestionStore.updatePending).toHaveBeenCalledWith('sug-1', {
      name: 'New Name',
      description: undefined,
      body: undefined,
    });
    expect(result).toMatchObject({
      updated: true,
      suggestion: expect.objectContaining({ name: 'New Name' }),
    });
  });

  it('returns updated=false when the row is accepted (immutable)', async () => {
    const { rpcHandler, suggestionStore } = buildHandlersWithSuggestions();
    // Store returns the accepted row unchanged (it was already accepted)
    const acceptedRow = { ...fakeSuggestionRow, status: 'accepted' as const };
    suggestionStore.updatePending.mockReturnValue(acceptedRow);

    const result = (await rpcHandler.call('skillSynthesis:updateSuggestion', {
      id: 'sug-1',
      name: 'ignored',
    })) as { updated: boolean; suggestion: unknown };

    expect(result.updated).toBe(false);
    expect(result.suggestion).not.toBeNull();
  });

  it('returns updated=false and suggestion=null when id not found', async () => {
    const { rpcHandler, suggestionStore } = buildHandlersWithSuggestions();
    suggestionStore.updatePending.mockReturnValue(null);

    const result = (await rpcHandler.call('skillSynthesis:updateSuggestion', {
      id: 'missing',
      name: 'x',
    })) as { updated: boolean; suggestion: null };

    expect(result.updated).toBe(false);
    expect(result.suggestion).toBeNull();
  });

  it('desktop guard: throws PERSISTENCE_UNAVAILABLE when suggestionStore is absent (VS Code)', async () => {
    const { rpcHandler } = buildHandlers();

    await expect(
      rpcHandler.call('skillSynthesis:updateSuggestion', {
        id: 'sug-1',
        name: 'x',
      }),
    ).rejects.toMatchObject({ errorCode: 'PERSISTENCE_UNAVAILABLE' });
  });

  it('param validation: missing id rejected with INVALID_PARAMS', async () => {
    const { rpcHandler } = buildHandlersWithSuggestions();

    await expect(
      rpcHandler.call('skillSynthesis:updateSuggestion', { name: 'x' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });

  it('param validation: empty id rejected with INVALID_PARAMS', async () => {
    const { rpcHandler } = buildHandlersWithSuggestions();

    await expect(
      rpcHandler.call('skillSynthesis:updateSuggestion', { id: '' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });

  it('param validation: name longer than 200 chars rejected with INVALID_PARAMS', async () => {
    const { rpcHandler } = buildHandlersWithSuggestions();

    await expect(
      rpcHandler.call('skillSynthesis:updateSuggestion', {
        id: 'sug-1',
        name: 'x'.repeat(201),
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });
});

// ─── Preview-before-apply RPC surface ──────────────────────────────────────

describe('SkillsSynthesisRpcHandlers — previewEnhancement / applyProposal', () => {
  const PROPOSAL_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

  const cloneRow = {
    slug: 'deep-research',
    kind: 'skill' as const,
    userPath: '/home/.ptah/user/skills/deep-research',
    originPluginId: 'research-pack',
    originVersion: '1.0.0',
    sourceHash: 'sha256:aaa',
    cloneStatus: 'clone' as const,
    diverged: false,
    historyDir: null,
    lastEnhancedAt: null,
    candidateId: null,
    pendingSourceHash: null,
    createdAt: 1690000000000,
    updatedAt: 1700000000000,
  };

  it('previewEnhancement returns both bodies, judge verdict, and a proposalId', async () => {
    const { rpcHandler, registry, enhancer, synthesis } = buildHandlers();
    registry.getBySlug.mockReturnValue(cloneRow);
    synthesis.readSettings.mockReturnValue({ minJudgeScore: 6 });
    enhancer.generateProposal.mockResolvedValue({
      proposed: true,
      slug: 'deep-research',
      kind: 'skill',
      currentBody: 'OLD',
      proposedBody: 'NEW',
      judgeScore: 8,
      judgeReason: 'judge-verdict',
      proposalId: PROPOSAL_ID,
    });

    const result = await rpcHandler.call('skillSynthesis:previewEnhancement', {
      kind: 'skill',
      slug: 'deep-research',
    });

    expect(enhancer.generateProposal).toHaveBeenCalledWith(
      'deep-research',
      { minJudgeScore: 6 },
      { manual: true, kind: 'skill' },
    );
    expect(result).toEqual({
      proposed: true,
      skipReason: null,
      currentBody: 'OLD',
      proposedBody: 'NEW',
      judgeScore: 8,
      judgeReason: 'judge-verdict',
      proposalId: PROPOSAL_ID,
    });
  });

  it('previewEnhancement never reaches the write path', async () => {
    const { rpcHandler, registry, enhancer } = buildHandlers();
    registry.getBySlug.mockReturnValue(cloneRow);

    await rpcHandler.call('skillSynthesis:previewEnhancement', {
      kind: 'skill',
      slug: 'deep-research',
    });

    expect(enhancer.enhance).not.toHaveBeenCalled();
    expect(enhancer.applyProposal).not.toHaveBeenCalled();
  });

  it('previewEnhancement surfaces a skip verdict with a null proposalId', async () => {
    const { rpcHandler, registry, enhancer } = buildHandlers();
    registry.getBySlug.mockReturnValue(cloneRow);
    enhancer.generateProposal.mockResolvedValue({
      proposed: false,
      slug: 'deep-research',
      kind: 'skill',
      currentBody: 'OLD',
      proposedBody: 'NEW',
      judgeScore: 3,
      judgeReason: 'judge-verdict',
      proposalId: null,
      skipReason: 'judge-rejected',
    });

    const result = await rpcHandler.call('skillSynthesis:previewEnhancement', {
      kind: 'skill',
      slug: 'deep-research',
    });

    expect(result).toMatchObject({
      proposed: false,
      skipReason: 'judge-rejected',
      proposalId: null,
      proposedBody: 'NEW',
    });
  });

  it('previewEnhancement rejects an unknown slug with INVALID_PARAMS', async () => {
    const { rpcHandler, registry, enhancer } = buildHandlers();
    registry.getBySlug.mockReturnValue(null);

    await expect(
      rpcHandler.call('skillSynthesis:previewEnhancement', {
        kind: 'skill',
        slug: 'missing',
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(enhancer.generateProposal).not.toHaveBeenCalled();
  });

  it('previewEnhancement rejects an invalid kind with INVALID_PARAMS', async () => {
    const { rpcHandler, enhancer } = buildHandlers();

    await expect(
      rpcHandler.call('skillSynthesis:previewEnhancement', {
        kind: 'bogus',
        slug: 'deep-research',
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(enhancer.generateProposal).not.toHaveBeenCalled();
  });

  it('previewEnhancement wraps an enhancer throw without leaking the message', async () => {
    const { rpcHandler, registry, enhancer } = buildHandlers();
    registry.getBySlug.mockReturnValue(cloneRow);
    enhancer.generateProposal.mockRejectedValue(
      new Error('ENOENT: /home/secret/token.json'),
    );

    let thrown: unknown;
    try {
      await rpcHandler.call('skillSynthesis:previewEnhancement', {
        kind: 'skill',
        slug: 'deep-research',
      });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ errorCode: 'PERSISTENCE_UNAVAILABLE' });
    expect((thrown as Error).message).not.toContain('token.json');
  });

  it('applyProposal forwards kind/slug/proposalId and returns the history stamp', async () => {
    const { rpcHandler, enhancer } = buildHandlers();
    enhancer.applyProposal.mockResolvedValue({
      applied: true,
      slug: 'deep-research',
      kind: 'skill',
      judgeScore: 8,
      judgeReason: 'judge-verdict',
      historyTs: '1700000000000',
    });

    const result = await rpcHandler.call('skillSynthesis:applyProposal', {
      kind: 'skill',
      slug: 'deep-research',
      proposalId: PROPOSAL_ID,
    });

    expect(enhancer.applyProposal).toHaveBeenCalledWith(
      'skill',
      'deep-research',
      PROPOSAL_ID,
    );
    expect(result).toEqual({ applied: true, historyTs: '1700000000000' });
  });

  it('applyProposal maps an unknown proposalId to a clean INVALID_PARAMS', async () => {
    const { rpcHandler, enhancer, sentry } = buildHandlers();
    enhancer.applyProposal.mockRejectedValue(
      new ProposalNotFoundError('not-found', PROPOSAL_ID),
    );

    let thrown: unknown;
    try {
      await rpcHandler.call('skillSynthesis:applyProposal', {
        kind: 'skill',
        slug: 'deep-research',
        proposalId: PROPOSAL_ID,
      });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect((thrown as Error).message).toContain('Preview again');
    // A stale preview is user error, not a crash — no Sentry noise.
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('applyProposal maps an expired proposal the same way', async () => {
    const { rpcHandler, enhancer } = buildHandlers();
    enhancer.applyProposal.mockRejectedValue(
      new ProposalNotFoundError('expired', PROPOSAL_ID),
    );

    await expect(
      rpcHandler.call('skillSynthesis:applyProposal', {
        kind: 'skill',
        slug: 'deep-research',
        proposalId: PROPOSAL_ID,
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });

  it('applyProposal rejects a malformed proposalId before touching the enhancer', async () => {
    const { rpcHandler, enhancer } = buildHandlers();

    await expect(
      rpcHandler.call('skillSynthesis:applyProposal', {
        kind: 'skill',
        slug: 'deep-research',
        proposalId: '../../etc/passwd',
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(enhancer.applyProposal).not.toHaveBeenCalled();
  });

  it('applyProposal rejects a missing proposalId', async () => {
    const { rpcHandler, enhancer } = buildHandlers();

    await expect(
      rpcHandler.call('skillSynthesis:applyProposal', {
        kind: 'skill',
        slug: 'deep-research',
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(enhancer.applyProposal).not.toHaveBeenCalled();
  });
});

describe('SkillsSynthesisRpcHandlers — getHistoryBody', () => {
  let tmpRoot: string;
  let skillsRoot: string;
  let snapshotDir: string;
  const TS = '1700000000000';

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(join(tmpdir(), 'ptah-history-'));
    skillsRoot = join(tmpRoot, 'skills');
    snapshotDir = join(skillsRoot, 'deep-research', '.history', TS);
    fs.mkdirSync(snapshotDir, { recursive: true });
    fs.writeFileSync(join(snapshotDir, 'SKILL.md'), 'SNAPSHOT BODY', 'utf8');
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function withRealRoots() {
    const built = buildHandlers();
    built.mirror.getUserLayerRoots.mockReturnValue({
      skills: skillsRoot,
      agents: join(tmpRoot, 'agents'),
      commands: join(tmpRoot, 'commands'),
    });
    return built;
  }

  it('returns the snapshot body for an enumerated timestamp', async () => {
    const { rpcHandler, mirror } = withRealRoots();
    mirror.listHistory.mockResolvedValue([
      { ts: TS, path: snapshotDir, hasSkillMd: true },
    ]);

    const result = await rpcHandler.call('skillSynthesis:getHistoryBody', {
      kind: 'skill',
      slug: 'deep-research',
      ts: TS,
    });

    expect(mirror.listHistory).toHaveBeenCalledWith('skill', 'deep-research');
    expect(result).toEqual({ body: 'SNAPSHOT BODY', ts: TS });
  });

  it('returns null for a timestamp that history does not list', async () => {
    const { rpcHandler, mirror } = withRealRoots();
    mirror.listHistory.mockResolvedValue([
      { ts: TS, path: snapshotDir, hasSkillMd: true },
    ]);

    const result = await rpcHandler.call('skillSynthesis:getHistoryBody', {
      kind: 'skill',
      slug: 'deep-research',
      ts: '1600000000000',
    });

    expect(result).toEqual({ body: null, ts: '1600000000000' });
  });

  it('returns null when the snapshot carries no artifact file', async () => {
    const { rpcHandler, mirror } = withRealRoots();
    mirror.listHistory.mockResolvedValue([
      { ts: TS, path: snapshotDir, hasSkillMd: false },
    ]);

    const result = await rpcHandler.call('skillSynthesis:getHistoryBody', {
      kind: 'skill',
      slug: 'deep-research',
      ts: TS,
    });

    expect(result).toEqual({ body: null, ts: TS });
  });

  it.each([
    '../../../etc/passwd',
    '..',
    '1700000000000/../../..',
    'a/../../b',
    '.history',
    '',
  ])('rejects traversal-shaped ts %p with INVALID_PARAMS', async (ts) => {
    const { rpcHandler, mirror } = withRealRoots();

    await expect(
      rpcHandler.call('skillSynthesis:getHistoryBody', {
        kind: 'skill',
        slug: 'deep-research',
        ts,
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(mirror.listHistory).not.toHaveBeenCalled();
  });

  it.each(['../evil', 'a/b', ''])(
    'rejects traversal-shaped slug %p with INVALID_PARAMS',
    async (slug) => {
      const { rpcHandler, mirror } = withRealRoots();

      await expect(
        rpcHandler.call('skillSynthesis:getHistoryBody', {
          kind: 'skill',
          slug,
          ts: TS,
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
      expect(mirror.listHistory).not.toHaveBeenCalled();
    },
  );

  it('refuses to read a listed snapshot that resolves outside the clone root', async () => {
    const { rpcHandler, mirror } = withRealRoots();
    // Defense in depth: even if history enumeration handed back a path outside
    // the clone root, the containment check must veto the read.
    const outside = join(tmpRoot, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(join(outside, 'SKILL.md'), 'LEAKED', 'utf8');
    mirror.listHistory.mockResolvedValue([
      { ts: TS, path: outside, hasSkillMd: true },
    ]);

    const result = await rpcHandler.call('skillSynthesis:getHistoryBody', {
      kind: 'skill',
      slug: 'deep-research',
      ts: TS,
    });

    expect(result).toEqual({ body: null, ts: TS });
  });

  it('reads the flat <slug>.md artifact for an agent clone', async () => {
    const { rpcHandler, mirror } = withRealRoots();
    const agentSnapshot = join(
      tmpRoot,
      'agents',
      '.history',
      'deep-research',
      TS,
    );
    fs.mkdirSync(agentSnapshot, { recursive: true });
    fs.writeFileSync(
      join(agentSnapshot, 'deep-research.md'),
      'AGENT SNAPSHOT',
      'utf8',
    );
    mirror.listHistory.mockResolvedValue([
      { ts: TS, path: agentSnapshot, hasSkillMd: true },
    ]);

    const result = await rpcHandler.call('skillSynthesis:getHistoryBody', {
      kind: 'agent',
      slug: 'deep-research',
      ts: TS,
    });

    expect(result).toEqual({ body: 'AGENT SNAPSHOT', ts: TS });
  });

  it('wraps a listHistory throw in PERSISTENCE_UNAVAILABLE without leaking', async () => {
    const { rpcHandler, mirror } = withRealRoots();
    mirror.listHistory.mockRejectedValue(
      new Error('EACCES: /home/secret/.ssh/id_rsa'),
    );

    let thrown: unknown;
    try {
      await rpcHandler.call('skillSynthesis:getHistoryBody', {
        kind: 'skill',
        slug: 'deep-research',
        ts: TS,
      });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ errorCode: 'PERSISTENCE_UNAVAILABLE' });
    expect((thrown as Error).message).not.toContain('id_rsa');
  });
});
