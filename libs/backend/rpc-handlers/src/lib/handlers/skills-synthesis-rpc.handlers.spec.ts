/**
 * Unit tests for SkillsSynthesisRpcHandlers — diagnostics + analyzeNow +
 * setTriggers + getTriggers (Batch B6, TASK_2026_126).
 *
 * Each new method covers: happy path, Zod invalid params, service throw.
 * Plus a dual-registration smoke test against ALLOWED_METHOD_PREFIXES.
 */

import 'reflect-metadata';
import { container } from 'tsyringe';
import {
  TOKENS,
  RpcUserError,
  ALLOWED_METHOD_PREFIXES,
} from '@ptah-extension/vscode-core';
import { SKILL_SYNTHESIS_TOKENS } from '@ptah-extension/skill-synthesis';
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
    setPin: jest.fn(),
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
      triggers: { sessionEnd: true, idleMs: 600000, bootScan: true },
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
      triggers: { sessionEnd: true, idleMs: 300000, bootScan: false },
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
    expect(result).toEqual({
      triggers: { sessionEnd: true, idleMs: 600000, bootScan: true },
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

describe('SkillsSynthesisRpcHandlers — dual-registration smoke', () => {
  it('every METHODS entry has a prefix listed in ALLOWED_METHOD_PREFIXES', () => {
    for (const method of SkillsSynthesisRpcHandlers.METHODS) {
      const ok = ALLOWED_METHOD_PREFIXES.some((p) => method.startsWith(p));
      expect(ok).toBe(true);
    }
  });
});
