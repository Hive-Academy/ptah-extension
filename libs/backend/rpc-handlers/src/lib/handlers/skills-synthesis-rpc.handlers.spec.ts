/**
 * Unit tests for the retained Skill Synthesis RPC surface.
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
  SKILL_REPROPAGATION_TOKEN,
  USER_LAYER_MIRROR_SERVICE_TOKEN,
  ProposalNotFoundError,
  SKILLS_ROOT_KEY,
  resolveSkillsRoot,
} from '@ptah-extension/skill-synthesis';
import {
  PLATFORM_TOKENS,
} from '@ptah-extension/platform-core';
import {
  createMockWorkspaceProvider,
  type MockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import {
  AgentSyncGate,
  HARNESS_SYNC_TOKENS,
  HarnessStateStore,
  ManagedManifestStore,
  harnessStatePath,
  type AgentConsentReader,
} from '@ptah-extension/harness-sync';
import type {
  QuarantinedAgentsListing,
  QuarantineRestoreResult,
} from '@ptah-extension/agent-generation';
import {
  AGENT_MODEL_SETTINGS_KEY,
  AgentModelSettings,
  SETTINGS_TOKENS,
  WorkspaceScopeResolver,
  type ISettingsStore,
} from '@ptah-extension/settings-core';
import type {
  AgentModelEntry,
  AgentModelProvider,
} from '@ptah-extension/shared';
import { CliModelListService } from '../services/cli-model-list.service';
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

function makeStore() {
  return {
    findById: jest.fn(),
    listByStatus: jest.fn().mockReturnValue([]),
    listInvocationEvents: jest.fn().mockReturnValue([]),
    getStats: jest.fn().mockReturnValue({
      candidates: 4,
      promoted: 2,
      rejected: 1,
      active: 2,
      dormant: 0,
      merged: 0,
      retired: 0,
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
    markEnhanced: jest.fn(),
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
    saveCloneBody: jest.fn(),
    // TASK_2026_278: the clone surface joins the registry row with the
    // user-layer sidecar's `orphaned` flag, which the registry has no column
    // for. Both reads degrade to "not orphaned" on failure, so these doubles
    // answer the happy path and the failure path is asserted explicitly.
    listClones: jest.fn().mockResolvedValue([]),
    readCloneOrigin: jest.fn().mockResolvedValue(null),
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
    getInvocationStats: jest.fn().mockReturnValue({
      total: 0, succeeded: 0, failed: 0, distinctContexts: 0,
      invocationCount: 0, successRate: null,
    }),
    getScorecards: jest.fn().mockReturnValue({}),
    // B4.4.3: `skillSynthesis:getScorecards` now merges the win-rate pass into
    // the aggregate, so the double has to answer both calls.
    getWinRates: jest.fn().mockReturnValue({}),
    getScorecardDetail: jest
      .fn()
      .mockResolvedValue({ slug: '', rows: [], findingsExcerpt: null }),
  };
}

function buildHandlers(workspaceFolders: string[] = ['/workspace/project'], withScorecard = true) {
  const logger = makeLogger();
  const rpcHandler = makeRpcHandler();
  const sentry = makeSentry();
  const store = makeStore();
  const enhancer = makeEnhancer();
  const registry = makeRegistry();
  const mirror = makeMirror();
  const contentDownload = makeContentDownload();
  const scorecard = makeScorecard();
  const repropagation = { repropagate: jest.fn().mockResolvedValue(undefined) };
  const workspaceProvider: MockWorkspaceProvider = createMockWorkspaceProvider({
    folders: workspaceFolders,
  });

  const child = container.createChildContainer();
  child.registerInstance(TOKENS.LOGGER, logger);
  child.registerInstance(TOKENS.RPC_HANDLER, rpcHandler);
  child.registerInstance(TOKENS.SENTRY_SERVICE, sentry);
  child.registerInstance(
    SKILL_SYNTHESIS_TOKENS.SKILL_ENHANCER_SERVICE,
    enhancer,
  );
  child.registerInstance(SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_STORE, registry);
  child.registerInstance(USER_LAYER_MIRROR_SERVICE_TOKEN, mirror);
  child.registerInstance(PLATFORM_TOKENS.CONTENT_DOWNLOAD, contentDownload);
  if (withScorecard) {
    child.registerInstance(
      SKILL_SYNTHESIS_TOKENS.SKILL_SCORECARD_SERVICE,
      scorecard,
    );
  }
  child.registerInstance(PLATFORM_TOKENS.WORKSPACE_PROVIDER, workspaceProvider);
  child.registerInstance(SKILL_REPROPAGATION_TOKEN, repropagation);
  child.register(SkillsSynthesisRpcHandlers, {
    useClass: SkillsSynthesisRpcHandlers,
  });

  const handlers = child.resolve(SkillsSynthesisRpcHandlers);
  handlers.register();

  return {
    handlers,
    rpcHandler,
    sentry,
    store,
    enhancer,
    registry,
    mirror,
    contentDownload,
    scorecard,
    workspaceProvider,
    logger,
    repropagation,
  };
}

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

  it('listClones joins grade rates with telemetry counts and history', async () => {
    const { rpcHandler, registry, store, scorecard, mirror } = buildHandlers();
    registry.listAll.mockReturnValue([sampleRow]);
    scorecard.getInvocationStats.mockReturnValue({
      total: 5,
      succeeded: 3,
      failed: 2,
      distinctContexts: 4,
      invocationCount: 10,
      successRate: 0.6,
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
      successRate: 0.6,
      historyCount: 2,
      lastEnhancedAt: 1700000000000,
      enhanceMinInvocations: 5,
      enhanceCooldownUntil: 1700000000000 + 24 * 60 * 60 * 1000,
    });
    expect(scorecard.getInvocationStats).toHaveBeenCalledWith('skill', 'deep-research', '/workspace/project');
    expect(store.getInvocationStats).not.toHaveBeenCalled();
  });

  it('listClones returns a null success rate without grades', async () => {
    const { rpcHandler, registry, scorecard, store } = buildHandlers();
    registry.listAll.mockReturnValue([sampleRow]);
    scorecard.getInvocationStats.mockReturnValue({
      total: 0, succeeded: 0, failed: 0, distinctContexts: 3,
      invocationCount: 8, successRate: null,
    });

    const result = (await rpcHandler.call('skillSynthesis:listClones', {})) as {
      clones: Array<{ invocationCount: number; successRate: number | null }>;
    };

    expect(result.clones[0].successRate).toBeNull();
    expect(result.clones[0].invocationCount).toBe(8);
    expect(store.getInvocationStats).not.toHaveBeenCalled();
  });

  it('keeps every clone when one invocation lookup throws', async () => {
    const { rpcHandler, registry, scorecard, logger } = buildHandlers();
    registry.listAll.mockReturnValue([sampleRow, { ...sampleRow, slug: 'other' }]);
    const failure = new Error('telemetry unavailable');
    scorecard.getInvocationStats.mockImplementation((_kind: string, slug: string) => {
      if (slug === 'deep-research') throw failure;
      return { total: 1, succeeded: 1, failed: 0, distinctContexts: 1,
        invocationCount: 3, successRate: 1 };
    });
    const result = await rpcHandler.call('skillSynthesis:listClones', {}) as {
      clones: Array<{ slug: string; invocationCount: number; successRate: number | null }>;
    };
    expect(result.clones).toHaveLength(2);
    expect(result.clones[0]).toMatchObject({ invocationCount: 0, successRate: null });
    expect(result.clones[1]).toMatchObject({ invocationCount: 3, successRate: 1 });
    expect(logger.warn).toHaveBeenCalledWith(
      '[skill-synthesis] clone invocation stats unavailable',
      expect.objectContaining({ slug: 'deep-research', error: failure }),
    );
  });

  it('listClones keeps rows available when the optional scorecard is absent', async () => {
    const { rpcHandler, registry, store, scorecard } = buildHandlers(['/workspace/project'], false);
    registry.listAll.mockReturnValue([sampleRow]);

    const result = (await rpcHandler.call('skillSynthesis:listClones', {})) as {
      clones: Array<{ invocationCount: number; successRate: number | null }>;
    };

    expect(result.clones).toHaveLength(1);
    expect(result.clones[0]).toMatchObject({ invocationCount: 0, successRate: null });
    expect(scorecard.getInvocationStats).not.toHaveBeenCalled();
    expect(store.getInvocationStats).not.toHaveBeenCalled();
  });

  it('listClones uses graded rate even with ungraded invocations', async () => {
    const { rpcHandler, registry, scorecard, store } = buildHandlers();
    registry.listAll.mockReturnValue([sampleRow]);
    scorecard.getInvocationStats.mockReturnValue({
      total: 2,
      succeeded: 1,
      failed: 1,
      distinctContexts: 1,
      invocationCount: 3,
      successRate: 0.5,
    });

    const result = (await rpcHandler.call('skillSynthesis:listClones', {})) as {
      clones: Array<{ successRate: number | null }>;
    };

    expect(result.clones[0].successRate).toBe(0.5);
    expect(store.getInvocationStats).not.toHaveBeenCalled();
  });

  it.each(['agent', 'command'] as const)(
    'listClones reads %s grades using the clone kind',
    async (kind) => {
      const { rpcHandler, registry, scorecard, store } = buildHandlers();
      registry.listAll.mockReturnValue([{ ...sampleRow, kind }]);
      scorecard.getInvocationStats.mockReturnValue({
        total: 2, succeeded: 1, failed: 1, distinctContexts: 1,
        invocationCount: 3, successRate: 0.5,
      });

      const result = (await rpcHandler.call('skillSynthesis:listClones', {})) as {
        clones: Array<{ successRate: number | null }>;
      };

      expect(scorecard.getInvocationStats).toHaveBeenCalledWith(kind, 'deep-research', '/workspace/project');
      expect(result.clones[0].successRate).toBe(0.5);
      expect(store.getInvocationStats).not.toHaveBeenCalled();
    },
  );

  it('listClones returns PERSISTENCE_UNAVAILABLE when registry unbound (VS Code)', async () => {
    const logger = makeLogger();
    const rpcHandler = makeRpcHandler();
    const child = container.createChildContainer();
    child.registerInstance(TOKENS.LOGGER, logger);
    child.registerInstance(TOKENS.RPC_HANDLER, rpcHandler);
    child.registerInstance(TOKENS.SENTRY_SERVICE, makeSentry());
    child.registerInstance(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
      createMockWorkspaceProvider({ folders: ['/workspace/project'] }),
    );
    // The registry is deliberately unbound in this container.
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

    // A click: the harness refresh after the restore never waits (FU-17b).
    expect(enhancer.revert).toHaveBeenCalledWith(
      'deep-research',
      '1717848000000',
      'skill',
      { userInitiated: true },
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
      { userInitiated: true },
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
      workspaceRoot: '/workspace/project',
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
      workspaceRoot: '/workspace/project',
    });
    expect(registry.setDiverged).toHaveBeenCalledWith(
      'skill',
      'deep-research',
      false,
    );
    expect(result).toMatchObject({ sourceHash: 'sha256:ccc' });
  });

  describe('saveCloneBody', () => {
    it('keeps the existing save behavior when expectedSourceHash is absent', async () => {
      const { rpcHandler, registry, mirror, repropagation } = buildHandlers();
      registry.getBySlug.mockReturnValue(sampleRow);
      mirror.saveCloneBody.mockResolvedValue({
        kind: 'skill',
        slug: 'deep-research',
        historyTs: '1700000000001',
        written: true,
        reason: null,
        currentContentHash: 'sha256:saved',
        metadataIncomplete: false,
        reconcileProtected: true,
      });

      const result = await rpcHandler.call('skillSynthesis:saveCloneBody', {
        kind: 'skill',
        slug: 'deep-research',
        body: '# edited by the user',
      });

      expect(mirror.saveCloneBody).toHaveBeenCalledWith({
        kind: 'skill',
        slug: 'deep-research',
        body: '# edited by the user',
        workspaceRoot: '/workspace/project',
      });
      expect(result).toEqual({
        kind: 'skill',
        slug: 'deep-research',
        historyTs: '1700000000001',
        metadataIncomplete: false,
        reconcileProtected: true,
      });
      expect(registry.markEnhanced).not.toHaveBeenCalled();
      expect(repropagation.repropagate).not.toHaveBeenCalled();
    });

    it('stamps and repropagates a committed enhancement save', async () => {
      const { rpcHandler, registry, mirror, repropagation } = buildHandlers();
      registry.getBySlug.mockReturnValue(sampleRow);
      const savedHash = `sha256:${'b'.repeat(64)}`;
      mirror.saveCloneBody.mockResolvedValue({ kind: 'skill', slug: 'deep-research',
        historyTs: '1700000000001', written: true, reason: null,
        currentContentHash: savedHash, metadataIncomplete: false, reconcileProtected: true });
      const result = await rpcHandler.call('skillSynthesis:saveCloneBody', {
        kind: 'skill', slug: 'deep-research', body: '# enhanced', origin: 'enhancement',
        expectedSourceHash: `sha256:${'a'.repeat(64)}`,
      });
      expect(result).toMatchObject({ metadataIncomplete: false });
      expect(registry.markEnhanced).toHaveBeenCalledWith(
        'skill', 'deep-research', expect.any(Number), savedHash,
      );
      expect(repropagation.repropagate).toHaveBeenCalledWith(
        'skill', 'deep-research', '/workspace/project', { userInitiated: true },
      );
    });

    it('skips the enhancement stamp and flags incomplete metadata when no hash is returned', async () => {
      const { rpcHandler, registry, mirror, repropagation } = buildHandlers();
      registry.getBySlug.mockReturnValue(sampleRow);
      mirror.saveCloneBody.mockResolvedValue({
        kind: 'skill', slug: 'deep-research', historyTs: '1700000000001',
        written: true, reason: null, currentContentHash: null,
        metadataIncomplete: false, reconcileProtected: true,
      });

      const result = await rpcHandler.call('skillSynthesis:saveCloneBody', {
        kind: 'skill', slug: 'deep-research', body: '# enhanced', origin: 'enhancement',
      });

      expect(result).toMatchObject({ metadataIncomplete: true });
      expect(registry.markEnhanced).not.toHaveBeenCalled();
      expect(repropagation.repropagate).toHaveBeenCalledWith(
        'skill', 'deep-research', '/workspace/project', { userInitiated: true },
      );
    });

    it('does not stamp or repropagate a stale enhancement draft', async () => {
      const { rpcHandler, registry, mirror, repropagation } = buildHandlers();
      registry.getBySlug.mockReturnValue(sampleRow);
      mirror.saveCloneBody.mockResolvedValue({ kind: 'skill', slug: 'deep-research',
        historyTs: null, written: false, reason: 'stale-source',
        currentContentHash: null, metadataIncomplete: false, reconcileProtected: true });
      await expect(rpcHandler.call('skillSynthesis:saveCloneBody', {
        kind: 'skill', slug: 'deep-research', body: '# enhanced', origin: 'enhancement',
        expectedSourceHash: `sha256:${'a'.repeat(64)}`,
      })).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
      expect(registry.markEnhanced).not.toHaveBeenCalled();
      expect(repropagation.repropagate).not.toHaveBeenCalled();
    });

    it.each([true, false])('passes the hash to the mirror and maps its result (stale=%s)', async (stale) => {
      const expectedSourceHash = `sha256:${'a'.repeat(64)}`;
      const { rpcHandler, registry, mirror } = buildHandlers();
      registry.getBySlug.mockReturnValue(sampleRow);
      mirror.saveCloneBody.mockResolvedValue({
        kind: 'skill',
        slug: 'deep-research',
        historyTs: stale ? null : '1700000000001',
        written: !stale,
        reason: stale ? 'stale-source' : null,
        currentContentHash: stale ? null : 'sha256:saved',
        metadataIncomplete: false,
        reconcileProtected: !stale,
      });
      const save = rpcHandler.call('skillSynthesis:saveCloneBody', {
        kind: 'skill',
        slug: 'deep-research',
        body: 'AFTER',
        expectedSourceHash,
      });
      if (stale) {
        await expect(save).rejects.toMatchObject({
          errorCode: 'INVALID_PARAMS',
          message: expect.stringContaining('changed since the draft'),
        });
      } else {
        await expect(save).resolves.toMatchObject({
          historyTs: '1700000000001',
        });
      }
      expect(mirror.saveCloneBody).toHaveBeenCalledWith({
        kind: 'skill',
        slug: 'deep-research',
        body: 'AFTER',
        workspaceRoot: '/workspace/project',
        expectedSourceHash,
      });
    });

    /**
     * The body write is the commit point. A bookkeeping failure after it is a
     * SUCCESS with a caveat: telling the user the save failed while their edit
     * sits on disk is the one outcome worse than an unqualified success.
     */
    it('returns a SUCCESS carrying metadataIncomplete when the post-write step failed', async () => {
      const { rpcHandler, registry, mirror } = buildHandlers();
      registry.getBySlug.mockReturnValue(sampleRow);
      mirror.saveCloneBody.mockResolvedValue({
        kind: 'skill',
        slug: 'deep-research',
        historyTs: '1700000000001',
        written: true,
        reason: null,
        currentContentHash: null,
        metadataIncomplete: true,
        reconcileProtected: false,
      });

      const result = await rpcHandler.call('skillSynthesis:saveCloneBody', {
        kind: 'skill',
        slug: 'deep-research',
        body: '# edited by the user',
      });

      expect(result).toEqual({
        kind: 'skill',
        slug: 'deep-research',
        historyTs: '1700000000001',
        metadataIncomplete: true,
        reconcileProtected: false,
      });
    });

    /**
     * A sidecar-less clone whose slug shadows an upstream source can be
     * fast-forwarded over by a later reconcile pass (the reconciler's
     * missing-sidecar mint, out of this surface's scope to change). The result
     * says so, so the editor cannot claim an unqualified success.
     */
    it('carries reconcileProtected:false for a sidecar-less clone', async () => {
      const { rpcHandler, registry, mirror } = buildHandlers();
      registry.getBySlug.mockReturnValue(sampleRow);
      mirror.saveCloneBody.mockResolvedValue({
        kind: 'skill',
        slug: 'hand-written',
        historyTs: '1700000000002',
        written: true,
        reason: null,
        currentContentHash: 'sha256:saved',
        metadataIncomplete: false,
        reconcileProtected: false,
      });

      const result = await rpcHandler.call('skillSynthesis:saveCloneBody', {
        kind: 'skill',
        slug: 'hand-written',
        body: '# mine, edited',
      });

      expect(result).toMatchObject({ reconcileProtected: false });
    });

    it('rejects a whitespace-only body before it can reach the mirror', async () => {
      const { rpcHandler, registry, mirror } = buildHandlers();
      registry.getBySlug.mockReturnValue(sampleRow);

      await expect(
        rpcHandler.call('skillSynthesis:saveCloneBody', {
          kind: 'skill',
          slug: 'deep-research',
          body: '   ',
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
      expect(mirror.saveCloneBody).not.toHaveBeenCalled();
    });

    it('never writes the SQLite registry — diverged and pending are untouched', async () => {
      const { rpcHandler, registry, mirror } = buildHandlers();
      registry.getBySlug.mockReturnValue(sampleRow);
      mirror.saveCloneBody.mockResolvedValue({
        kind: 'skill',
        slug: 'deep-research',
        historyTs: '1700000000001',
        written: true,
        reason: null,
        currentContentHash: 'sha256:saved',
        metadataIncomplete: false,
        reconcileProtected: true,
      });

      await rpcHandler.call('skillSynthesis:saveCloneBody', {
        kind: 'skill',
        slug: 'deep-research',
        body: '# edited',
      });

      expect(registry.setDiverged).not.toHaveBeenCalled();
      expect(registry.setPending).not.toHaveBeenCalled();
    });

    it.each([
      ['a traversal slug', { kind: 'skill', slug: '../x', body: 'x' }],
      ['an empty body', { kind: 'skill', slug: 'deep-research', body: '' }],
      ['an unknown kind', { kind: 'plugin', slug: 'deep-research', body: 'x' }],
    ])(
      'rejects %s with INVALID_PARAMS and never reaches the mirror',
      async (_label, params) => {
        const { rpcHandler, registry, mirror } = buildHandlers();
        registry.getBySlug.mockReturnValue(sampleRow);

        await expect(
          rpcHandler.call('skillSynthesis:saveCloneBody', params),
        ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
        expect(mirror.saveCloneBody).not.toHaveBeenCalled();
      },
    );

    it('returns INVALID_PARAMS when no registry row claims the slug', async () => {
      const { rpcHandler, registry, mirror } = buildHandlers();
      registry.getBySlug.mockReturnValue(null);

      await expect(
        rpcHandler.call('skillSynthesis:saveCloneBody', {
          kind: 'skill',
          slug: 'missing',
          body: '# x',
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
      expect(mirror.saveCloneBody).not.toHaveBeenCalled();
    });

    it('maps written:false (row present, file absent) to INVALID_PARAMS', async () => {
      const { rpcHandler, registry, mirror } = buildHandlers();
      registry.getBySlug.mockReturnValue(sampleRow);
      mirror.saveCloneBody.mockResolvedValue({
        kind: 'skill',
        slug: 'deep-research',
        historyTs: null,
        written: false,
        reason: 'clone-missing',
        currentContentHash: null,
        metadataIncomplete: false,
        reconcileProtected: false,
      });

      await expect(
        rpcHandler.call('skillSynthesis:saveCloneBody', {
          kind: 'skill',
          slug: 'deep-research',
          body: '# x',
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    });

    it('never surfaces a raw filesystem message when the mirror throws', async () => {
      const { rpcHandler, registry, mirror, sentry } = buildHandlers();
      registry.getBySlug.mockReturnValue(sampleRow);
      mirror.saveCloneBody.mockRejectedValue(
        new Error(
          'EPERM: refused — /home/someone/.ptah/plugins/secret/SKILL.md',
        ),
      );

      await expect(
        rpcHandler.call('skillSynthesis:saveCloneBody', {
          kind: 'skill',
          slug: 'deep-research',
          body: '# x',
        }),
      ).rejects.toMatchObject({
        errorCode: 'PERSISTENCE_UNAVAILABLE',
        message: 'skillSynthesis:saveCloneBody failed; please try again.',
      });
      expect(sentry.captureException).toHaveBeenCalled();
    });
  });

  /**
   * TASK_2026_278 — E7's "rebase/keep works for plugin, synth AND agent
   * clones".
   *
   * `resolveUpstreamSourceDir` used to bail on `!row.originPluginId`, so the
   * Library offered a Rebase button on every diverged synth skill and agent
   * that could only ever answer PERSISTENCE_UNAVAILABLE. The plugin branch had
   * its own defect: it returned the commands/agents DIRECTORY where
   * `rebaseFileClone` probes a FILE, so those two rebases reported
   * `source-missing` no matter what was on disk.
   */
  describe('rebaseClone upstream resolution', () => {
    function okRebase(kind: string, slug: string) {
      return {
        kind,
        slug,
        sourceHash: 'sha256:new',
        snapshotPath: null,
        failed: false,
      };
    }

    it('resolves a SYNTH skill (no plugin origin) to <skillsRoot>/<slug>', async () => {
      const { rpcHandler, registry, mirror, workspaceProvider } =
        buildHandlers();
      workspaceProvider.__state.config.set(
        `ptah.${SKILLS_ROOT_KEY}`,
        '/data/ptah-skills',
      );
      registry.getBySlug.mockReturnValue({
        ...sampleRow,
        slug: 'synthesized-thing',
        originPluginId: null,
        cloneStatus: 'synth' as const,
      });
      mirror.rebaseClone.mockResolvedValue(
        okRebase('skill', 'synthesized-thing'),
      );

      await rpcHandler.call('skillSynthesis:rebaseClone', {
        kind: 'skill',
        slug: 'synthesized-thing',
      });

      expect(mirror.rebaseClone).toHaveBeenCalledWith({
        kind: 'skill',
        slug: 'synthesized-thing',
        sourceDir: join('/data/ptah-skills', 'synthesized-thing'),
        workspaceRoot: '/workspace/project',
      });
    });

    it('falls back to the default skills root when the setting is unset', async () => {
      const { rpcHandler, registry, mirror } = buildHandlers();
      registry.getBySlug.mockReturnValue({
        ...sampleRow,
        slug: 'synthesized-thing',
        originPluginId: null,
      });
      mirror.rebaseClone.mockResolvedValue(
        okRebase('skill', 'synthesized-thing'),
      );

      await rpcHandler.call('skillSynthesis:rebaseClone', {
        kind: 'skill',
        slug: 'synthesized-thing',
      });

      expect(mirror.rebaseClone).toHaveBeenCalledWith({
        kind: 'skill',
        slug: 'synthesized-thing',
        sourceDir: join(resolveSkillsRoot(null), 'synthesized-thing'),
        workspaceRoot: '/workspace/project',
      });
    });

    it('resolves an AGENT clone to {ws}/.claude/agents/<slug>.md', async () => {
      const { rpcHandler, registry, mirror } = buildHandlers();
      registry.getBySlug.mockReturnValue({
        ...sampleRow,
        kind: 'agent' as const,
        slug: 'backend-developer',
        originPluginId: null,
      });
      mirror.rebaseClone.mockResolvedValue(
        okRebase('agent', 'backend-developer'),
      );

      await rpcHandler.call('skillSynthesis:rebaseClone', {
        kind: 'agent',
        slug: 'backend-developer',
      });

      expect(mirror.rebaseClone).toHaveBeenCalledWith({
        kind: 'agent',
        slug: 'backend-developer',
        sourceDir: join(
          '/workspace/project',
          '.claude',
          'agents',
          'backend-developer.md',
        ),
        workspaceRoot: '/workspace/project',
      });
    });

    it('refuses an agent rebase with no workspace open (nothing to resolve against)', async () => {
      const { rpcHandler, registry, mirror } = buildHandlers([]);
      registry.getBySlug.mockReturnValue({
        ...sampleRow,
        kind: 'agent' as const,
        slug: 'backend-developer',
        originPluginId: null,
      });

      await expect(
        rpcHandler.call('skillSynthesis:rebaseClone', {
          kind: 'agent',
          slug: 'backend-developer',
        }),
      ).rejects.toMatchObject({ errorCode: 'PERSISTENCE_UNAVAILABLE' });
      expect(mirror.rebaseClone).not.toHaveBeenCalled();
    });

    it('resolves a plugin COMMAND to the .md FILE, not the commands directory', async () => {
      const { rpcHandler, registry, mirror } = buildHandlers();
      registry.getBySlug.mockReturnValue({
        ...sampleRow,
        kind: 'command' as const,
        slug: 'orchestrate',
        originPluginId: 'ptah-core',
      });
      mirror.rebaseClone.mockResolvedValue(okRebase('command', 'orchestrate'));

      await rpcHandler.call('skillSynthesis:rebaseClone', {
        kind: 'command',
        slug: 'orchestrate',
      });

      expect(mirror.rebaseClone).toHaveBeenCalledWith({
        kind: 'command',
        slug: 'orchestrate',
        sourceDir: join(
          '/home/.ptah/plugins',
          'ptah-core',
          'commands',
          'orchestrate.md',
        ),
        workspaceRoot: '/workspace/project',
      });
    });

    it('resolves a plugin AGENT to the .md FILE too', async () => {
      const { rpcHandler, registry, mirror } = buildHandlers();
      registry.getBySlug.mockReturnValue({
        ...sampleRow,
        kind: 'agent' as const,
        slug: 'senior-tester',
        originPluginId: 'ptah-core',
      });
      mirror.rebaseClone.mockResolvedValue(okRebase('agent', 'senior-tester'));

      await rpcHandler.call('skillSynthesis:rebaseClone', {
        kind: 'agent',
        slug: 'senior-tester',
      });

      expect(mirror.rebaseClone).toHaveBeenCalledWith({
        kind: 'agent',
        slug: 'senior-tester',
        sourceDir: join(
          '/home/.ptah/plugins',
          'ptah-core',
          'agents',
          'senior-tester.md',
        ),
        workspaceRoot: '/workspace/project',
      });
    });

    it('a plugin-less COMMAND still has no upstream to name', async () => {
      const { rpcHandler, registry, mirror } = buildHandlers();
      registry.getBySlug.mockReturnValue({
        ...sampleRow,
        kind: 'command' as const,
        slug: 'my-command',
        originPluginId: null,
      });

      await expect(
        rpcHandler.call('skillSynthesis:rebaseClone', {
          kind: 'command',
          slug: 'my-command',
        }),
      ).rejects.toMatchObject({ errorCode: 'PERSISTENCE_UNAVAILABLE' });
      expect(mirror.rebaseClone).not.toHaveBeenCalled();
    });
  });

  describe('orphaned flag on the clone surface', () => {
    it('listClones joins the user-layer sidecar flag onto the registry row', async () => {
      const { rpcHandler, registry, store, mirror } = buildHandlers();
      registry.listAll.mockReturnValue([
        sampleRow,
        { ...sampleRow, slug: 'still-there' },
      ]);
      store.getInvocationStats.mockReturnValue({
        total: 0,
        succeeded: 0,
        failed: 0,
        distinctContexts: 0,
      });
      mirror.listClones.mockResolvedValue([
        {
          slug: 'deep-research',
          kind: 'skill',
          pluginId: 'research-pack',
          sourceHash: 'sha256:aaa',
          diverged: true,
          lastEnhancedAt: null,
          pendingSourceHash: null,
          orphaned: true,
        },
        {
          slug: 'still-there',
          kind: 'skill',
          pluginId: 'research-pack',
          sourceHash: 'sha256:bbb',
          diverged: false,
          lastEnhancedAt: null,
          pendingSourceHash: null,
          orphaned: false,
        },
      ]);

      const result = (await rpcHandler.call(
        'skillSynthesis:listClones',
        {},
      )) as { clones: Array<Record<string, unknown>> };

      expect(result.clones.map((c) => [c['slug'], c['orphaned']])).toEqual([
        ['deep-research', true],
        ['still-there', false],
      ]);
    });

    it('degrades to "not orphaned" rather than failing the whole listing', async () => {
      const { rpcHandler, registry, store, mirror } = buildHandlers();
      registry.listAll.mockReturnValue([sampleRow]);
      store.getInvocationStats.mockReturnValue({
        total: 0,
        succeeded: 0,
        failed: 0,
        distinctContexts: 0,
      });
      mirror.listClones.mockRejectedValue(new Error('sidecar read failed'));

      const result = (await rpcHandler.call(
        'skillSynthesis:listClones',
        {},
      )) as { clones: Array<Record<string, unknown>> };

      expect(result.clones).toHaveLength(1);
      expect(result.clones[0]['orphaned']).toBe(false);
    });

    it('getClone reads the ONE sidecar rather than walking every root', async () => {
      const { rpcHandler, registry, store, mirror } = buildHandlers();
      registry.getBySlug.mockReturnValue(sampleRow);
      store.getInvocationStats.mockReturnValue({
        total: 0,
        succeeded: 0,
        failed: 0,
        distinctContexts: 0,
      });
      mirror.readCloneOrigin.mockResolvedValue({
        slug: 'deep-research',
        kind: 'skill',
        pluginId: 'research-pack',
        sourceHash: 'sha256:aaa',
        diverged: false,
        lastEnhancedAt: null,
        pendingSourceHash: null,
        orphaned: true,
      });

      const result = (await rpcHandler.call('skillSynthesis:getClone', {
        kind: 'skill',
        slug: 'deep-research',
      })) as { clone: Record<string, unknown> | null };

      expect(mirror.readCloneOrigin).toHaveBeenCalledWith(
        'skill',
        'deep-research',
        '/workspace/project',
      );
      expect(mirror.listClones).not.toHaveBeenCalled();
      expect(result.clone?.['orphaned']).toBe(true);
    });
  });

  it('invocationStats returns grade counts and telemetry contexts', async () => {
    const { rpcHandler, store, scorecard } = buildHandlers();
    scorecard.getInvocationStats.mockReturnValue({
      total: 5,
      succeeded: 3,
      failed: 2,
      distinctContexts: 2,
      invocationCount: 9,
      successRate: 0.6,
    });

    const result = await rpcHandler.call('skillSynthesis:invocationStats', {
      slug: 'deep-research',
    });

    expect(scorecard.getInvocationStats).toHaveBeenCalledWith('skill', 'deep-research', '/workspace/project');
    expect(store.getInvocationStats).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      slug: 'deep-research',
      stats: { total: 9, succeeded: 3, failed: 2, distinctContexts: 2,
        graded: 5, passed: 3, successRate: 0.6 },
    });
    expect(result).toEqual({
      slug: 'deep-research',
      stats: { total: 9, succeeded: 3, failed: 2, distinctContexts: 2,
        graded: 5, passed: 3, successRate: 0.6 },
    });
  });

  it('invocationStats reports no graded tasks even when telemetry exists', async () => {
    const { rpcHandler, store, scorecard } = buildHandlers();
    scorecard.getInvocationStats.mockReturnValue({
      total: 0, succeeded: 0, failed: 0, distinctContexts: 2,
      invocationCount: 9, successRate: null,
    });

    expect(await rpcHandler.call('skillSynthesis:invocationStats', {
      slug: 'deep-research',
    })).toEqual({
      slug: 'deep-research',
      stats: { total: 9, succeeded: 0, failed: 0, distinctContexts: 2,
        graded: 0, passed: 0, successRate: null },
    });
    expect(store.getInvocationStats).not.toHaveBeenCalled();
  });

  it('invocationStats accepts an agent kind', async () => {
    const { rpcHandler, scorecard } = buildHandlers();
    const result = await rpcHandler.call('skillSynthesis:invocationStats', {
      slug: 'reviewer', kind: 'agent',
    });
    expect(scorecard.getInvocationStats).toHaveBeenCalledWith('agent', 'reviewer', '/workspace/project');
    expect(result).toMatchObject({ stats: { total: 0, graded: 0, successRate: null } });
  });

  it('invocationStats returns zeros when the optional scorecard is absent', async () => {
    const { rpcHandler, scorecard, store } = buildHandlers(['/workspace/project'], false);

    expect(await rpcHandler.call('skillSynthesis:invocationStats', {
      slug: 'deep-research',
    })).toEqual({
      slug: 'deep-research',
      stats: { total: 0, succeeded: 0, failed: 0, distinctContexts: 0,
        graded: 0, passed: 0, successRate: null },
    });
    expect(scorecard.getInvocationStats).not.toHaveBeenCalled();
    expect(store.getInvocationStats).not.toHaveBeenCalled();
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

    expect(scorecard.getScorecards).toHaveBeenCalledWith(['backend-developer'], '/workspace/project');
    expect(result.scorecards['backend-developer'].totalInvocations).toBe(12);
  });

  it('passes the active workspace root to both scorecard reads', async () => {
    const { rpcHandler, scorecard } = buildHandlers(['/workspace/active']);

    await rpcHandler.call('skillSynthesis:getScorecards', {
      slugs: ['backend-developer'],
    });

    expect(scorecard.getScorecards).toHaveBeenCalledWith(
      ['backend-developer'], '/workspace/active',
    );
    expect(scorecard.getWinRates).toHaveBeenCalledWith(
      ['backend-developer'], '/workspace/active',
    );
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

  // B4.4.3 — the win-rate merge. Three inputs, and the whole point is that they
  // do NOT collapse into two: a measured `0` is a skill that lost every settled
  // session, while both a stored `null` and an ABSENT row mean nobody measured
  // it. `0` is falsy, so a `||` on this path retitles the measured loser as
  // unmeasured and the dormancy ranking downstream then demotes the wrong skill.
  // Asserted with toBe(0)/toBeNull(), never toBeFalsy(), which passes for both.
  it('merges win rate onto the card, keeping a measured 0 distinct from unmeasured', async () => {
    const { rpcHandler, scorecard } = buildHandlers();
    scorecard.getScorecards.mockReturnValue({
      'measured-loser': emptyScorecard('measured-loser'),
      'never-settled': emptyScorecard('never-settled'),
      'no-events-at-all': emptyScorecard('no-events-at-all'),
    });
    scorecard.getWinRates.mockReturnValue({
      'measured-loser': {
        slug: 'measured-loser',
        invocations: 3,
        wins: 0,
        unknown: 0,
        winRate: 0,
      },
      'never-settled': {
        slug: 'never-settled',
        invocations: 2,
        wins: 0,
        unknown: 2,
        winRate: null,
      },
      // 'no-events-at-all' is deliberately absent from the map.
    });

    const result = (await rpcHandler.call('skillSynthesis:getScorecards', {
      slugs: ['measured-loser', 'never-settled', 'no-events-at-all'],
    })) as { scorecards: Record<string, { winRate?: number | null }> };

    expect(result.scorecards['measured-loser'].winRate).toBe(0);
    expect(result.scorecards['never-settled'].winRate).toBeNull();
    expect(result.scorecards['no-events-at-all'].winRate).toBeNull();
    expect(scorecard.getWinRates).toHaveBeenCalledWith([
      'measured-loser',
      'never-settled',
      'no-events-at-all',
    ], '/workspace/project');
  });

  it('returns {} scorecards when the scorecard service is unbound', async () => {
    const logger = makeLogger();
    const rpcHandler = makeRpcHandler();
    const child = container.createChildContainer();
    child.registerInstance(TOKENS.LOGGER, logger);
    child.registerInstance(TOKENS.RPC_HANDLER, rpcHandler);
    child.registerInstance(TOKENS.SENTRY_SERVICE, makeSentry());
    child.registerInstance(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
      createMockWorkspaceProvider({ folders: ['/workspace/project'] }),
    );
    // The scorecard service is deliberately unbound in this container.
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
      '/workspace/project',
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

  it('adds no per-method entry to the runtime prefix guard', () => {
    const perMethod = ALLOWED_METHOD_PREFIXES.filter(
      (p) => p.startsWith('skillSynthesis:') && p !== 'skillSynthesis:',
    );
    expect(perMethod).toEqual([]);
  });
});

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
    const { rpcHandler, registry, enhancer } = buildHandlers();
    registry.getBySlug.mockReturnValue(cloneRow);
    enhancer.generateProposal.mockResolvedValue({
      proposed: true,
      slug: 'deep-research',
      kind: 'skill',
      currentBody: 'OLD',
      proposedBody: 'NEW',
      judgeScore: 8,
      judgeReason: 'judge-verdict',
      proposalId: PROPOSAL_ID,
      draft: {
        before: 'OLD',
        after: 'NEW',
        diff: '@@ -1 +1 @@\n-OLD\n+NEW',
        evidence: { trajectory: '', findings: '', scorecard: '' },
        model: 'claude-haiku-4-5-20251001',
        sourceHash: 'sha256:abc',
      },
    });

    const result = await rpcHandler.call('skillSynthesis:previewEnhancement', {
      kind: 'skill',
      slug: 'deep-research',
    });

    expect(enhancer.generateProposal).toHaveBeenCalledWith(
      'deep-research',
      { judgeEnabled: true, minJudgeScore: 6 },
      { manual: true, kind: 'skill', userInitiated: true },
    );
    expect(result).toEqual({
      proposed: true,
      skipReason: null,
      currentBody: 'OLD',
      proposedBody: 'NEW',
      judgeScore: 8,
      judgeReason: 'judge-verdict',
      proposalId: PROPOSAL_ID,
      draft: {
        before: 'OLD',
        after: 'NEW',
        diff: '@@ -1 +1 @@\n-OLD\n+NEW',
        evidence: { trajectory: '', findings: '', scorecard: '' },
        model: 'claude-haiku-4-5-20251001',
        sourceHash: 'sha256:abc',
      },
    });
  });

  it('previewEnhancement never reaches the write path', async () => {
    const { rpcHandler, registry, enhancer, mirror } = buildHandlers();
    registry.getBySlug.mockReturnValue(cloneRow);

    await rpcHandler.call('skillSynthesis:previewEnhancement', {
      kind: 'skill',
      slug: 'deep-research',
    });

    expect(enhancer.enhance).not.toHaveBeenCalled();
    expect(enhancer.applyProposal).not.toHaveBeenCalled();
    expect(mirror.saveCloneBody).not.toHaveBeenCalled();
  });

  it('previewEnhancement returns a provider skip without saving', async () => {
    const { rpcHandler, registry, enhancer, mirror } = buildHandlers();
    registry.getBySlug.mockReturnValue(cloneRow);
    enhancer.generateProposal.mockResolvedValue({
      proposed: false,
      slug: 'deep-research',
      kind: 'skill',
      currentBody: 'OLD',
      proposedBody: null,
      judgeScore: null,
      judgeReason: null,
      proposalId: null,
      skipReason: 'provider-unreachable',
    });

    const result = await rpcHandler.call('skillSynthesis:previewEnhancement', {
      kind: 'skill',
      slug: 'deep-research',
    });

    expect(result).toMatchObject({
      proposed: false,
      proposalId: null,
      skipReason: 'provider-unreachable',
    });
    expect(mirror.saveCloneBody).not.toHaveBeenCalled();
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

    // A click: the harness refresh after the write never waits (FU-17b).
    expect(enhancer.applyProposal).toHaveBeenCalledWith(
      'skill',
      'deep-research',
      PROPOSAL_ID,
      { userInitiated: true },
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

    expect(mirror.listHistory).toHaveBeenCalledWith(
      'skill',
      'deep-research',
      '/workspace/project',
    );
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

describe('SkillsSynthesisRpcHandlers — quarantine list / restore (C2)', () => {
  let tempRoot: string;
  let ws: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(join(tmpdir(), 'ptah-quarantine-rpc-'));
    ws = join(tempRoot, 'project');
    // `.ptah` is a harness workspace-root marker, so `ws` is its own resolved
    // root and a sub-folder of it resolves back to `ws`.
    fs.mkdirSync(join(ws, '.ptah', 'harness'), { recursive: true });
    fs.mkdirSync(join(ws, 'packages', 'app'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  /**
   * Stateful double of the two mirror facade methods: Restore brings the
   * source back, and a later listing then reports the item as
   * `source-restored`, which is what the real derivation does while no clone
   * has been re-created (gate off).
   */
  function makeQuarantineMirror() {
    let sourceRestored = false;
    return {
      listQuarantinedAgents: jest.fn(
        async (root: string): Promise<QuarantinedAgentsListing> => ({
          recordUnreadable: false,
          quarantined: [
            {
              slug: 'reviewer',
              state: sourceRestored ? 'source-restored' : 'quarantined',
              quarantinedAt: '2026-10-01T08:00:00.000Z',
              hasSnapshot: true,
              sourcePath: join(root, '.claude', 'agents', 'reviewer.md'),
            },
          ],
          notOwned: ['kept-local'],
        }),
      ),
      restoreQuarantinedAgent: jest.fn(
        async (
          root: string,
          slug: string,
        ): Promise<QuarantineRestoreResult> => {
          sourceRestored = true;
          return {
            outcome: 'restored',
            path: join(root, '.claude', 'agents', `${slug}.md`),
          };
        },
      ),
    };
  }

  function buildQuarantineHandlers(options: {
    folders?: string[];
    mirror?: ReturnType<typeof makeQuarantineMirror> | null;
    gate?: AgentConsentReader | null;
  }) {
    const rpcHandler = makeRpcHandler();
    const sentry = makeSentry();
    const logger = makeLogger();
    const child = container.createChildContainer();
    child.registerInstance(TOKENS.LOGGER, logger);
    child.registerInstance(TOKENS.RPC_HANDLER, rpcHandler);
    child.registerInstance(TOKENS.SENTRY_SERVICE, sentry);
    child.registerInstance(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
      createMockWorkspaceProvider({ folders: options.folders ?? [ws] }),
    );
    if (options.mirror) {
      child.registerInstance(USER_LAYER_MIRROR_SERVICE_TOKEN, options.mirror);
    }
    if (options.gate) {
      child.registerInstance(HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE, options.gate);
    }
    child.register(SkillsSynthesisRpcHandlers, {
      useClass: SkillsSynthesisRpcHandlers,
    });
    child.resolve(SkillsSynthesisRpcHandlers).register();
    return { rpcHandler, sentry, logger };
  }

  function writeGateState(enabled: boolean): string {
    expect(
      new HarnessStateStore().save(ws, {
        version: 1,
        agentSyncEnabled: enabled,
      }),
    ).toBe(true);
    return harnessStatePath(ws);
  }

  it('gate disabled: restore is `restored` with agentSync disabled, consent untouched, item then `source-restored`', async () => {
    const statePath = writeGateState(false);
    const stateBefore = fs.readFileSync(statePath);
    const gate = new AgentSyncGate(new ManagedManifestStore());
    const enableSpy = jest.spyOn(gate, 'enable');
    const mirror = makeQuarantineMirror();
    const { rpcHandler } = buildQuarantineHandlers({ mirror, gate });

    const restore = await rpcHandler.call(
      'skillSynthesis:restoreQuarantinedAgent',
      { slug: 'reviewer' },
    );

    expect(restore).toEqual({
      outcome: 'restored',
      path: join(ws, '.claude', 'agents', 'reviewer.md'),
      agentSync: 'disabled',
    });
    expect(mirror.restoreQuarantinedAgent).toHaveBeenCalledWith(ws, 'reviewer');
    // PR5: Restore never grants agent-sync consent.
    expect(enableSpy).not.toHaveBeenCalled();
    expect(fs.readFileSync(statePath).equals(stateBefore)).toBe(true);
    expect(gate.resolve(ws)).toEqual({ enabled: false, derived: false });

    const listing = await rpcHandler.call(
      'skillSynthesis:listQuarantinedAgents',
      {},
    );
    expect(listing).toEqual({
      workspaceRoot: ws,
      agentSync: 'disabled',
      quarantined: [
        {
          slug: 'reviewer',
          state: 'source-restored',
          quarantinedAt: '2026-10-01T08:00:00.000Z',
          hasSnapshot: true,
          sourcePath: join(ws, '.claude', 'agents', 'reviewer.md'),
        },
      ],
      notOwned: ['kept-local'],
    });
    expect(fs.readFileSync(statePath).equals(stateBefore)).toBe(true);
  });

  it('gate enabled: reports `enabled`', async () => {
    writeGateState(true);
    const { rpcHandler } = buildQuarantineHandlers({
      mirror: makeQuarantineMirror(),
      gate: new AgentSyncGate(new ManagedManifestStore()),
    });

    const listing = (await rpcHandler.call(
      'skillSynthesis:listQuarantinedAgents',
      undefined,
    )) as { agentSync: string };

    expect(listing.agentSync).toBe('enabled');
  });

  it('gate unregistered: agentSync is `unknown` on list and restore', async () => {
    const { rpcHandler } = buildQuarantineHandlers({
      mirror: makeQuarantineMirror(),
      gate: null,
    });

    const listing = (await rpcHandler.call(
      'skillSynthesis:listQuarantinedAgents',
      {},
    )) as { agentSync: string };
    const restore = await rpcHandler.call(
      'skillSynthesis:restoreQuarantinedAgent',
      { slug: 'reviewer' },
    );

    expect(listing.agentSync).toBe('unknown');
    expect(restore).toMatchObject({
      outcome: 'restored',
      agentSync: 'unknown',
    });
  });

  it('gate resolve throws: agentSync is `unknown`, the restore result still stands', async () => {
    const gate: AgentConsentReader = {
      resolve: jest.fn(() => {
        throw new Error('state unreadable');
      }),
    };
    const { rpcHandler, logger } = buildQuarantineHandlers({
      mirror: makeQuarantineMirror(),
      gate,
    });

    const restore = await rpcHandler.call(
      'skillSynthesis:restoreQuarantinedAgent',
      { slug: 'reviewer' },
    );

    expect(restore).toMatchObject({
      outcome: 'restored',
      agentSync: 'unknown',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      '[skill-synthesis] could not read agent-sync consent',
      { error: 'state unreadable' },
    );
  });

  it('passes the harness-resolved absolute root, not the raw sub-folder', async () => {
    const mirror = makeQuarantineMirror();
    const { rpcHandler } = buildQuarantineHandlers({
      folders: [join(ws, 'packages', 'app')],
      mirror,
    });

    const listing = (await rpcHandler.call(
      'skillSynthesis:listQuarantinedAgents',
      {},
    )) as { workspaceRoot: string };
    await rpcHandler.call('skillSynthesis:restoreQuarantinedAgent', {
      slug: 'reviewer',
    });

    expect(listing.workspaceRoot).toBe(ws);
    expect(mirror.listQuarantinedAgents).toHaveBeenCalledWith(ws);
    expect(mirror.restoreQuarantinedAgent).toHaveBeenCalledWith(ws, 'reviewer');
  });

  it('maps an unreadable record to `recordUnreadable: true` and omits it otherwise', async () => {
    const mirror = makeQuarantineMirror();
    mirror.listQuarantinedAgents.mockResolvedValueOnce({
      recordUnreadable: true,
      quarantined: [],
      notOwned: [],
    });
    const { rpcHandler } = buildQuarantineHandlers({ mirror });

    const unreadable = await rpcHandler.call(
      'skillSynthesis:listQuarantinedAgents',
      {},
    );
    const readable = await rpcHandler.call(
      'skillSynthesis:listQuarantinedAgents',
      {},
    );

    expect(unreadable).toMatchObject({ recordUnreadable: true });
    expect(readable).not.toHaveProperty('recordUnreadable');
  });

  it('carries a refusal outcome and its reason through as a result', async () => {
    const mirror = makeQuarantineMirror();
    mirror.restoreQuarantinedAgent.mockResolvedValueOnce({
      outcome: 'conflict',
      path: join(ws, '.claude', 'agents', 'reviewer.md'),
      reason: 'source differs from the snapshot',
    });
    const { rpcHandler } = buildQuarantineHandlers({ mirror });

    await expect(
      rpcHandler.call('skillSynthesis:restoreQuarantinedAgent', {
        slug: 'reviewer',
      }),
    ).resolves.toEqual({
      outcome: 'conflict',
      path: join(ws, '.claude', 'agents', 'reviewer.md'),
      reason: 'source differs from the snapshot',
      agentSync: 'unknown',
    });
  });

  it.each(['../evil', '..', 'a/b', 'a\\b', ''])(
    'rejects traversal slug %p before the mirror is called (PR4)',
    async (slug) => {
      const mirror = makeQuarantineMirror();
      const { rpcHandler } = buildQuarantineHandlers({ mirror });

      await expect(
        rpcHandler.call('skillSynthesis:restoreQuarantinedAgent', { slug }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
      expect(mirror.restoreQuarantinedAgent).not.toHaveBeenCalled();
    },
  );

  it('mirror service absent: both methods fail with an explicit error, not an empty list', async () => {
    const { rpcHandler } = buildQuarantineHandlers({ mirror: null });

    await expect(
      rpcHandler.call('skillSynthesis:listQuarantinedAgents', {}),
    ).rejects.toMatchObject({ errorCode: 'PERSISTENCE_UNAVAILABLE' });
    await expect(
      rpcHandler.call('skillSynthesis:restoreQuarantinedAgent', {
        slug: 'reviewer',
      }),
    ).rejects.toMatchObject({ errorCode: 'PERSISTENCE_UNAVAILABLE' });
  });

  it('a thrown facade error becomes an RPC error, never a success', async () => {
    const mirror = makeQuarantineMirror();
    mirror.listQuarantinedAgents.mockRejectedValueOnce(
      new Error(
        '[UserLayerMirror] quarantine needs an absolute workspace root',
      ),
    );
    mirror.restoreQuarantinedAgent.mockRejectedValueOnce(new Error('EIO'));
    const { rpcHandler, sentry } = buildQuarantineHandlers({ mirror });

    const listErr = await rpcHandler
      .call('skillSynthesis:listQuarantinedAgents', {})
      .catch((e: unknown) => e);
    const restoreErr = await rpcHandler
      .call('skillSynthesis:restoreQuarantinedAgent', { slug: 'reviewer' })
      .catch((e: unknown) => e);

    expect(listErr).toBeInstanceOf(RpcUserError);
    expect((listErr as RpcUserError).errorCode).toBe('PERSISTENCE_UNAVAILABLE');
    expect((listErr as Error).message).not.toContain('absolute');
    expect(restoreErr).toBeInstanceOf(RpcUserError);
    expect(sentry.captureException).toHaveBeenCalledTimes(2);
  });

  it('no open folder: list is empty with a null root; restore is refused', async () => {
    const mirror = makeQuarantineMirror();
    const { rpcHandler } = buildQuarantineHandlers({ folders: [], mirror });

    await expect(
      rpcHandler.call('skillSynthesis:listQuarantinedAgents', {}),
    ).resolves.toEqual({
      workspaceRoot: null,
      agentSync: 'unknown',
      quarantined: [],
      notOwned: [],
    });
    await expect(
      rpcHandler.call('skillSynthesis:restoreQuarantinedAgent', {
        slug: 'reviewer',
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(mirror.listQuarantinedAgents).not.toHaveBeenCalled();
    expect(mirror.restoreQuarantinedAgent).not.toHaveBeenCalled();
  });
});

describe('SkillsSynthesisRpcHandlers — agent models get / set (C6)', () => {
  type Lists = Record<AgentModelProvider, AgentModelEntry[]>;

  let tempRoot: string;
  let ws: string;
  let otherWs: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(join(tmpdir(), 'ptah-agent-models-rpc-'));
    ws = join(tempRoot, 'project');
    otherWs = join(tempRoot, 'other');
    // `.ptah` marks each folder as its own harness workspace root. The specs
    // read and write nothing under the home directory: the settings store is
    // in memory and the model list service is a double.
    fs.mkdirSync(join(ws, '.ptah'), { recursive: true });
    fs.mkdirSync(join(otherWs, '.ptah'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  /** Live Codex list (provider-reported) and curated lists elsewhere. */
  function defaultLists(): Lists {
    return {
      claude: [],
      codex: [{ id: 'gpt-5-codex' }, { id: 'gpt 5 preview' }],
      copilot: [{ id: 'gpt-4.1', isFallback: true }],
      cursor: [{ id: 'cursor-small', isFallback: true }],
      opencode: [{ id: 'anthropic/claude-sonnet', isFallback: true }],
    };
  }

  /** In-memory settings store; values are JSON-copied like a real file. */
  function makeMemoryStore() {
    const data = new Map<string, unknown>();
    let failWrites = false;
    const writeGlobal = jest.fn(async (key: string, value: unknown) => {
      if (failWrites) throw new Error('EACCES: settings file is read-only');
      if (value === undefined) data.delete(key);
      else data.set(key, JSON.parse(JSON.stringify(value)));
    });
    const store = {
      readGlobal: <T>(key: string): T | undefined => data.get(key) as T,
      writeGlobal,
      readSecret: async () => undefined,
      writeSecret: async () => undefined,
      deleteSecret: async () => undefined,
      watchGlobal: () => ({ dispose: () => undefined }),
      watchSecret: () => ({ dispose: () => undefined }),
      flushSync: () => undefined,
    } as ISettingsStore;
    return {
      store,
      data,
      writeGlobal,
      failWrites: (fail: boolean) => {
        failWrites = fail;
      },
      snapshot: () => JSON.stringify([...data.entries()]),
    };
  }

  function buildAgentModelHandlers(
    options: {
      folders?: string[];
      registerSettings?: boolean;
      registerContainer?: boolean;
      listForClassification?: jest.Mock;
    } = {},
  ) {
    const rpcHandler = makeRpcHandler();
    const sentry = makeSentry();
    const memory = makeMemoryStore();
    const workspaceProvider = createMockWorkspaceProvider({
      folders: options.folders ?? [ws],
    });
    const resolver = new WorkspaceScopeResolver(memory.store, {
      getActivePath: () => workspaceProvider.getWorkspaceRoot(),
      onDidChange: () => ({ dispose: () => undefined }),
    });
    const settings = new AgentModelSettings(memory.store, resolver);
    const updateSpy = jest.spyOn(settings, 'update');
    const listForClassification =
      options.listForClassification ??
      jest.fn(async (): Promise<Lists> => defaultLists());

    const child = container.createChildContainer();
    child.registerInstance(TOKENS.LOGGER, makeLogger());
    child.registerInstance(TOKENS.RPC_HANDLER, rpcHandler);
    child.registerInstance(TOKENS.SENTRY_SERVICE, sentry);
    child.registerInstance(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
      workspaceProvider,
    );
    if (options.registerContainer !== false) {
      child.registerInstance(PLATFORM_TOKENS.DI_CONTAINER, child);
    }
    if (options.registerSettings !== false) {
      child.registerInstance(SETTINGS_TOKENS.AGENT_MODEL_SETTINGS, settings);
    }
    child.registerInstance(CliModelListService, {
      listForClassification,
    } as Pick<CliModelListService, 'listForClassification'> as CliModelListService);
    child.register(SkillsSynthesisRpcHandlers, {
      useClass: SkillsSynthesisRpcHandlers,
    });
    child.resolve(SkillsSynthesisRpcHandlers).register();

    const workspaceKey = (root: string) =>
      resolver.inspectForPath(AGENT_MODEL_SETTINGS_KEY, root).key;
    return {
      rpcHandler,
      sentry,
      memory,
      settings,
      updateSpy,
      listForClassification,
      workspaceProvider,
      workspaceKey,
    };
  }

  function setParams(overrides: Record<string, unknown> = {}) {
    return {
      workspaceRoot: ws,
      slug: 'backend-developer',
      provider: 'codex',
      scope: 'workspace',
      value: 'gpt-5-codex',
      ...overrides,
    };
  }

  it('getAgentModels: returns both layers, the lists and the server classification', async () => {
    const h = buildAgentModelHandlers();
    h.memory.data.set(AGENT_MODEL_SETTINGS_KEY, {
      '*': { codex: 'gpt-5-codex', cursor: 'cursor-small' },
      junk: 'not-an-object',
    });
    h.memory.data.set(h.workspaceKey(ws), {
      'backend-developer': {
        codex: 'my-private-model',
        opencode: 'no-slash',
        claude: 'opus',
        bogus: 'x',
        copilot: 42,
      },
    });

    const result = await h.rpcHandler.call('skillSynthesis:getAgentModels', {});

    expect(result).toEqual({
      workspaceRoot: ws,
      machine: { '*': { codex: 'gpt-5-codex', cursor: 'cursor-small' } },
      workspace: {
        'backend-developer': {
          claude: 'opus',
          codex: 'my-private-model',
          opencode: 'no-slash',
        },
      },
      lists: defaultLists(),
      classification: {
        machine: { '*': { codex: 'listed', cursor: 'unverifiable' } },
        workspace: {
          'backend-developer': {
            claude: 'unverifiable',
            codex: 'unlisted',
            opencode: 'malformed',
          },
        },
      },
      unsupportedProviders: [],
    });
    expect(h.listForClassification).toHaveBeenCalledTimes(1);
  });

  it('getAgentModels: no open folder is a null root with nothing to edit', async () => {
    const h = buildAgentModelHandlers({ folders: [] });

    await expect(
      h.rpcHandler.call('skillSynthesis:getAgentModels', undefined),
    ).resolves.toEqual({
      workspaceRoot: null,
      machine: null,
      workspace: null,
      lists: null,
      classification: { machine: {}, workspace: {} },
      unsupportedProviders: [],
    });
    expect(h.listForClassification).not.toHaveBeenCalled();
  });

  it('getAgentModels: a workspaceRoot that is not the active workspace is refused', async () => {
    const h = buildAgentModelHandlers();

    await expect(
      h.rpcHandler.call('skillSynthesis:getAgentModels', {
        workspaceRoot: otherWs,
      }),
    ).rejects.toMatchObject({ errorCode: 'UNAUTHORIZED_WORKSPACE' });
  });

  it('getAgentModels: unreadable lists degrade to null lists and unverifiable values', async () => {
    const h = buildAgentModelHandlers({
      listForClassification: jest.fn(async () => {
        throw new Error('cli detection failed');
      }),
    });
    h.memory.data.set(h.workspaceKey(ws), {
      reviewer: { codex: 'gpt-5-codex' },
    });

    const result = await h.rpcHandler.call('skillSynthesis:getAgentModels', {
      workspaceRoot: ws,
    });

    expect(result).toMatchObject({
      lists: null,
      classification: {
        machine: {},
        workspace: { reviewer: { codex: 'unverifiable' } },
      },
    });
  });

  it.each([
    ['no AGENT_MODEL_SETTINGS registration', { registerSettings: false }],
    ['no container at all', { registerContainer: false }],
  ])(
    'host with %s: both methods refuse with PERSISTENCE_UNAVAILABLE, nothing written',
    async (_label, options) => {
      const h = buildAgentModelHandlers(options);

      await expect(
        h.rpcHandler.call('skillSynthesis:getAgentModels', {}),
      ).rejects.toMatchObject({ errorCode: 'PERSISTENCE_UNAVAILABLE' });
      await expect(
        h.rpcHandler.call('skillSynthesis:setAgentModel', setParams()),
      ).rejects.toMatchObject({ errorCode: 'PERSISTENCE_UNAVAILABLE' });
      expect(h.memory.writeGlobal).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])(
    '%s workspaceRoot is refused even for machine scope; the global key is unchanged',
    async (_label, workspaceRoot) => {
      const h = buildAgentModelHandlers();
      h.memory.data.set(AGENT_MODEL_SETTINGS_KEY, {
        '*': { codex: 'gpt-5-codex' },
      });
      const before = h.memory.snapshot();
      const params: Record<string, unknown> = setParams({
        scope: 'machine',
        value: 'gpt 5 preview',
      });
      if (workspaceRoot === undefined) delete params['workspaceRoot'];
      else params['workspaceRoot'] = workspaceRoot;

      await expect(
        h.rpcHandler.call('skillSynthesis:setAgentModel', params),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
      expect(h.updateSpy).not.toHaveBeenCalled();
      expect(h.memory.writeGlobal).not.toHaveBeenCalled();
      expect(h.memory.snapshot()).toBe(before);
    },
  );

  it('no open folder: setAgentModel is refused with WORKSPACE_NOT_OPEN', async () => {
    const h = buildAgentModelHandlers({ folders: [] });

    await expect(
      h.rpcHandler.call('skillSynthesis:setAgentModel', setParams()),
    ).rejects.toMatchObject({ errorCode: 'WORKSPACE_NOT_OPEN' });
    expect(h.memory.writeGlobal).not.toHaveBeenCalled();
  });

  it.each(['workspace', 'machine'])(
    'workspace switched between load and save (%s scope): refused, neither workspace key nor the global key changed',
    async (scope) => {
      const h = buildAgentModelHandlers();
      h.memory.data.set(h.workspaceKey(ws), {
        reviewer: { codex: 'gpt-5-codex' },
      });
      h.memory.data.set(h.workspaceKey(otherWs), {
        reviewer: { cursor: 'cursor-small' },
      });
      h.memory.data.set(AGENT_MODEL_SETTINGS_KEY, { '*': { codex: 'x-1' } });

      const loaded = (await h.rpcHandler.call(
        'skillSynthesis:getAgentModels',
        {},
      )) as { workspaceRoot: string };
      const before = h.memory.snapshot();
      h.workspaceProvider.__state.setFolders([otherWs]);

      await expect(
        h.rpcHandler.call(
          'skillSynthesis:setAgentModel',
          setParams({ workspaceRoot: loaded.workspaceRoot, scope }),
        ),
      ).rejects.toMatchObject({ errorCode: 'UNAUTHORIZED_WORKSPACE' });
      expect(h.updateSpy).not.toHaveBeenCalled();
      expect(h.memory.snapshot()).toBe(before);
    },
  );

  it('workspace switched while the lists are read: refused before any write', async () => {
    let switchFolders: () => void = () => undefined;
    const h = buildAgentModelHandlers({
      listForClassification: jest.fn(async () => {
        switchFolders();
        return defaultLists();
      }),
    });
    switchFolders = () => h.workspaceProvider.__state.setFolders([otherWs]);

    await expect(
      h.rpcHandler.call('skillSynthesis:setAgentModel', setParams()),
    ).rejects.toMatchObject({ errorCode: 'UNAUTHORIZED_WORKSPACE' });
    expect(h.updateSpy).not.toHaveBeenCalled();
    expect(h.memory.writeGlobal).not.toHaveBeenCalled();
  });

  it('listed value: saved to the request workspace key with update(root, slug, provider, value, scope)', async () => {
    const h = buildAgentModelHandlers();
    h.memory.data.set(h.workspaceKey(ws), {
      'backend-developer': { cursor: 'cursor-small' },
      reviewer: { codex: 'gpt-5-codex' },
    });

    const result = await h.rpcHandler.call(
      'skillSynthesis:setAgentModel',
      setParams(),
    );

    expect(h.updateSpy).toHaveBeenCalledWith(
      ws,
      'backend-developer',
      'codex',
      'gpt-5-codex',
      'workspace',
    );
    expect(result).toEqual({
      classification: 'listed',
      machine: null,
      workspace: {
        'backend-developer': { cursor: 'cursor-small', codex: 'gpt-5-codex' },
        reviewer: { codex: 'gpt-5-codex' },
      },
    });
    expect(h.memory.data.has(AGENT_MODEL_SETTINGS_KEY)).toBe(false);
  });

  it('machine scope writes the global key and leaves the workspace key alone', async () => {
    const h = buildAgentModelHandlers();

    await h.rpcHandler.call(
      'skillSynthesis:setAgentModel',
      setParams({ scope: 'machine', slug: '*' }),
    );

    expect(h.memory.data.get(AGENT_MODEL_SETTINGS_KEY)).toEqual({
      '*': { codex: 'gpt-5-codex' },
    });
    expect(h.memory.data.has(h.workspaceKey(ws))).toBe(false);
  });

  it('Unlisted without confirmUnlisted: refused "needs confirmation", nothing written', async () => {
    const h = buildAgentModelHandlers();

    const error = await h.rpcHandler
      .call(
        'skillSynthesis:setAgentModel',
        setParams({ value: 'my-private-model' }),
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RpcUserError);
    expect((error as RpcUserError).errorCode).toBe('MODEL_NOT_AVAILABLE');
    expect((error as Error).message).toContain('needs confirmation');
    expect(h.memory.writeGlobal).not.toHaveBeenCalled();
  });

  it('Unlisted with confirmUnlisted: saved and reported as unlisted', async () => {
    const h = buildAgentModelHandlers();

    const result = await h.rpcHandler.call(
      'skillSynthesis:setAgentModel',
      setParams({ value: 'my-private-model', confirmUnlisted: true }),
    );

    expect(result).toMatchObject({ classification: 'unlisted' });
    expect(h.memory.data.get(h.workspaceKey(ws))).toEqual({
      'backend-developer': { codex: 'my-private-model' },
    });
  });

  it('listed-but-syntax-failing Codex value is accepted and saved', async () => {
    const h = buildAgentModelHandlers();

    const result = await h.rpcHandler.call(
      'skillSynthesis:setAgentModel',
      setParams({ value: 'gpt 5 preview' }),
    );

    expect(result).toMatchObject({ classification: 'listed' });
    expect(h.memory.data.get(h.workspaceKey(ws))).toEqual({
      'backend-developer': { codex: 'gpt 5 preview' },
    });
  });

  it('OpenCode listed-but-malformed is refused, even when provider-reported', async () => {
    const lists = defaultLists();
    lists.opencode = [{ id: 'no-slash' }];
    const h = buildAgentModelHandlers({
      listForClassification: jest.fn(async () => lists),
    });

    await expect(
      h.rpcHandler.call(
        'skillSynthesis:setAgentModel',
        setParams({ provider: 'opencode', value: 'no-slash' }),
      ),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(h.memory.writeGlobal).not.toHaveBeenCalled();
  });

  it('a value with a control character is refused as malformed', async () => {
    const h = buildAgentModelHandlers();

    await expect(
      h.rpcHandler.call(
        'skillSynthesis:setAgentModel',
        setParams({ value: 'gpt-5\nmodel: evil', confirmUnlisted: true }),
      ),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(h.memory.writeGlobal).not.toHaveBeenCalled();
  });

  it('a fallback-only list never makes a value listed or unlisted: unverifiable, saved without confirmation', async () => {
    const h = buildAgentModelHandlers();

    const result = await h.rpcHandler.call(
      'skillSynthesis:setAgentModel',
      setParams({ provider: 'cursor', value: 'some-new-model' }),
    );

    expect(result).toMatchObject({ classification: 'unverifiable' });
  });

  it('null value clears one provider, keeps the others, and reads no list', async () => {
    const h = buildAgentModelHandlers();
    h.memory.data.set(h.workspaceKey(ws), {
      'backend-developer': { codex: 'gpt-5-codex', cursor: 'cursor-small' },
    });

    const result = await h.rpcHandler.call(
      'skillSynthesis:setAgentModel',
      setParams({ value: null }),
    );

    expect(result).toMatchObject({
      classification: 'empty',
      workspace: { 'backend-developer': { cursor: 'cursor-small' } },
    });
    expect(h.listForClassification).not.toHaveBeenCalled();
  });

  it('save failure: refused with PERSISTENCE_UNAVAILABLE and the prior settings bytes kept', async () => {
    const h = buildAgentModelHandlers();
    h.memory.data.set(h.workspaceKey(ws), {
      'backend-developer': { codex: 'gpt 5 preview' },
    });
    const before = h.memory.snapshot();
    h.memory.failWrites(true);

    await expect(
      h.rpcHandler.call('skillSynthesis:setAgentModel', setParams()),
    ).rejects.toMatchObject({ errorCode: 'PERSISTENCE_UNAVAILABLE' });
    expect(h.memory.snapshot()).toBe(before);
    expect(h.sentry.captureException).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// TASK_2026_620 B-P — the skills pause switch and the curator restart
// ---------------------------------------------------------------------------

describe('SkillsSynthesisRpcHandlers — preview while skills are paused', () => {
  it('refuses a paused preview before generating a proposal', async () => {
    const { rpcHandler, enhancer, workspaceProvider } = buildHandlers();
    workspaceProvider.__state.config.set('ptah.skillSynthesis.enabled', false);
    await expect(rpcHandler.call('skillSynthesis:previewEnhancement', {
      kind: 'skill', slug: 'deep-research',
    })).rejects.toMatchObject({ errorCode: 'PAUSED' });
    expect(enhancer.generateProposal).not.toHaveBeenCalled();
  });
});
