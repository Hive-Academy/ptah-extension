/**
 * Unit tests for MemoryRpcHandlers — `memory:purgeBySubjectPattern`.
 *
 * Verifies:
 *   - Valid params with authorized workspaceRoot → routes to store, returns { deleted: N }.
 *   - Empty pattern → Zod rejects (INVALID_PARAMS), store NOT called.
 *   - Invalid mode value → Zod rejects, store NOT called.
 *   - workspaceRoot null → Issue 1 HIGH guard rejects (INVALID_PARAMS), store NOT called.
 *   - workspaceRoot not authorized → Issue 2 MEDIUM guard rejects (UNAUTHORIZED_WORKSPACE),
 *     store NOT called.
 *   - Store throws → handler wraps in RPC error, does NOT leak raw error message to client.
 *
 * Mocking posture: direct constructor injection, narrow jest.Mocked<Pick<T,...>> surfaces.
 * Follows the pattern of indexing-rpc.handlers.spec.ts in the same directory.
 */

import 'reflect-metadata';
import { container } from 'tsyringe';
import {
  TOKENS,
  RpcUserError,
  ALLOWED_METHOD_PREFIXES,
} from '@ptah-extension/vscode-core';
import { MEMORY_TOKENS } from '@ptah-extension/memory-curator';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  createMockWorkspaceProvider,
  type MockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import { MemoryRpcHandlers } from './memory-rpc.handlers';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

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

function makeMemoryStore() {
  return {
    list: jest.fn(),
    getById: jest.fn(),
    getChunks: jest.fn(),
    setPinned: jest.fn(),
    forget: jest.fn(),
    rebuildIndex: jest
      .fn()
      .mockResolvedValue({ rebuiltFts: true, rebuiltVec: true }),
    stats: jest.fn().mockReturnValue({
      core: 0,
      recall: 0,
      archival: 0,
      lastCuratedAt: null,
    }),
    purgeBySubjectPattern: jest.fn().mockReturnValue(0),
  };
}

function makeCodeSymbolStore() {
  return {
    count: jest.fn().mockReturnValue(0),
    purgeJunk: jest.fn().mockReturnValue(0),
    deleteByFile: jest.fn().mockReturnValue(0),
    insertBatch: jest.fn().mockResolvedValue(undefined),
    purgeWorkspace: jest.fn().mockReturnValue(0),
  };
}

function makeMemorySearch() {
  return {
    searchRich: jest.fn().mockResolvedValue({ hits: [], bm25Only: false }),
  };
}

function makeMemoryCurator() {
  return {
    curate: jest.fn().mockResolvedValue({
      extracted: 0,
      merged: 0,
      created: 0,
      skipped: 0,
    }),
    pushEvent: jest.fn(),
  };
}

function makeMemoryDiagnostics() {
  return {
    getSnapshot: jest.fn().mockResolvedValue({
      lastRunAt: null,
      lastRunStats: null,
      lastDecayAt: null,
      lastDecayStats: null,
      recentEvents: [],
      dbHealth: {
        memories: 0,
        memory_chunks: 0,
        memory_chunks_vec: 0,
        memory_chunks_fts: 0,
        code_symbols: 0,
        code_symbols_vec: 0,
        coherent: true,
        mismatches: [],
      },
      triggers: {
        preCompact: true,
        idleMs: 600000,
        turnThreshold: 20,
        bootScan: true,
        userPromptSubmit: {
          enabled: true,
          cueList: [],
          minPromptLength: 20,
        },
        postToolUse: { enabled: true },
        turnComplete: { enabled: true },
        episode: { enabled: true },
        sessionEnd: { enabled: true },
        maxCuratesPerHour: 12,
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Test setup helper
// ---------------------------------------------------------------------------

function buildHandlers(workspaceFolders: string[] = ['/workspace/project']) {
  const logger = makeLogger();
  const rpcHandler = makeRpcHandler();
  const store = makeMemoryStore();
  const codeSymbols = makeCodeSymbolStore();
  const search = makeMemorySearch();
  const curator = makeMemoryCurator();
  const diagnostics = makeMemoryDiagnostics();
  const workspaceProvider: MockWorkspaceProvider = createMockWorkspaceProvider({
    folders: workspaceFolders,
  });

  const child = container.createChildContainer();
  child.registerInstance(TOKENS.LOGGER, logger);
  child.registerInstance(TOKENS.RPC_HANDLER, rpcHandler);
  child.registerInstance(MEMORY_TOKENS.MEMORY_STORE, store);
  child.registerInstance(MEMORY_TOKENS.CODE_SYMBOL_STORE, codeSymbols);
  child.registerInstance(MEMORY_TOKENS.MEMORY_SEARCH, search);
  child.registerInstance(MEMORY_TOKENS.MEMORY_CURATOR, curator);
  child.registerInstance(MEMORY_TOKENS.MEMORY_DIAGNOSTICS_SERVICE, diagnostics);
  child.registerInstance(PLATFORM_TOKENS.WORKSPACE_PROVIDER, workspaceProvider);
  child.register(MemoryRpcHandlers, { useClass: MemoryRpcHandlers });

  const handlers = child.resolve(MemoryRpcHandlers);
  handlers.register();

  return {
    handlers,
    rpcHandler,
    store,
    codeSymbols,
    search,
    curator,
    diagnostics,
    logger,
    workspaceProvider,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// memory:search — workspaceRoot forwarding
// ---------------------------------------------------------------------------

describe('MemoryRpcHandlers — memory:search workspaceRoot forwarding', () => {
  it('forwards workspaceRoot to search.searchRich when provided', async () => {
    const { rpcHandler, search } = buildHandlers(['/workspace/project']);
    search.searchRich.mockResolvedValue({ hits: [], bm25Only: false });

    await rpcHandler.call('memory:search', {
      query: 'hello world',
      topK: 5,
      workspaceRoot: '/workspace/project',
    });

    expect(search.searchRich).toHaveBeenCalledWith(
      'hello world',
      5,
      '/workspace/project',
    );
  });

  it('passes undefined workspaceRoot to search.searchRich when param is absent (global search)', async () => {
    const { rpcHandler, search } = buildHandlers(['/workspace/project']);
    search.searchRich.mockResolvedValue({ hits: [], bm25Only: false });

    await rpcHandler.call('memory:search', {
      query: 'hello world',
      topK: 10,
    });

    expect(search.searchRich).toHaveBeenCalledWith(
      'hello world',
      10,
      undefined,
    );
  });

  it('returns hits and bm25Only from search.searchRich', async () => {
    const { rpcHandler, search } = buildHandlers(['/workspace/project']);
    const fakeHit = {
      memory: {
        id: 'mem-1',
        sessionId: null,
        workspaceRoot: '/workspace/project',
        tier: 'core',
        kind: 'fact',
        subject: 'test',
        content: 'test content',
        sourceMessageIds: [],
        salience: 0.5,
        decayRate: 0.01,
        hits: 0,
        pinned: false,
        createdAt: 1000,
        updatedAt: 1000,
        lastUsedAt: 1000,
        expiresAt: null,
      },
      chunk: {
        id: 'ck-1',
        memoryId: 'mem-1',
        ord: 0,
        text: 'test content',
        tokenCount: 2,
        createdAt: 1000,
      },
      score: 0.9,
      bm25Rank: 1,
      vecRank: null,
    };
    search.searchRich.mockResolvedValue({ hits: [fakeHit], bm25Only: true });

    const result = await rpcHandler.call('memory:search', {
      query: 'test',
      workspaceRoot: '/workspace/project',
    });

    expect(result).toMatchObject({ bm25Only: true });
    expect((result as { hits: unknown[] }).hits).toHaveLength(1);
  });

  it('returns empty hits when params are absent', async () => {
    const { rpcHandler } = buildHandlers(['/workspace/project']);

    const result = await rpcHandler.call('memory:search', undefined);

    expect(result).toEqual({ hits: [], bm25Only: false });
  });

  it('ignores invalid workspaceRoot (empty string) and treats it as absent', async () => {
    const { rpcHandler, search } = buildHandlers(['/workspace/project']);
    search.searchRich.mockResolvedValue({ hits: [], bm25Only: false });

    await rpcHandler.call('memory:search', {
      query: 'hello',
      workspaceRoot: '', // empty — Zod min(1) rejects it
    });

    // workspaceRoot should be undefined (schema rejected the empty string)
    expect(search.searchRich).toHaveBeenCalledWith('hello', 10, undefined);
  });

  it('preserves workspaceRoot when topK is invalid (topK: 0 fails positive() but must not drop scope)', async () => {
    // Regression: previously parsed = MemorySearchParamsSchema.safeParse(params) and on failure
    // workspaceRoot silently became undefined — cross-workspace memory leak.
    const { rpcHandler, search } = buildHandlers(['/workspace/project']);
    search.searchRich.mockResolvedValue({ hits: [], bm25Only: false });

    await rpcHandler.call('memory:search', {
      query: 'x',
      topK: 0, // fails z.number().positive() — must NOT drop workspaceRoot
      workspaceRoot: '/ws',
    });

    expect(search.searchRich).toHaveBeenCalledWith('x', 0, '/ws');
  });

  it('preserves workspaceRoot when topK exceeds max (topK: 51 fails max(50) but must not drop scope)', async () => {
    const { rpcHandler, search } = buildHandlers(['/workspace/project']);
    search.searchRich.mockResolvedValue({ hits: [], bm25Only: false });

    await rpcHandler.call('memory:search', {
      query: 'x',
      topK: 51, // fails z.number().max(50) — must NOT drop workspaceRoot
      workspaceRoot: '/ws',
    });

    expect(search.searchRich).toHaveBeenCalledWith('x', 51, '/ws');
  });
});

describe('MemoryRpcHandlers — memory:purgeBySubjectPattern', () => {
  describe('valid params with authorized workspaceRoot', () => {
    it('routes to store.purgeBySubjectPattern and returns { deleted: N }', async () => {
      const { rpcHandler, store } = buildHandlers(['/workspace/project']);
      store.purgeBySubjectPattern.mockReturnValue(7);

      const result = await rpcHandler.call('memory:purgeBySubjectPattern', {
        pattern: 'node_modules',
        mode: 'substring',
        workspaceRoot: '/workspace/project',
      });

      expect(store.purgeBySubjectPattern).toHaveBeenCalledWith(
        'node_modules',
        'substring',
        '/workspace/project',
      );
      expect(result).toEqual({ deleted: 7 });
    });

    it('works with like mode and passes pattern verbatim to store', async () => {
      const { rpcHandler, store } = buildHandlers(['/workspace/project']);
      store.purgeBySubjectPattern.mockReturnValue(3);

      const result = await rpcHandler.call('memory:purgeBySubjectPattern', {
        pattern: '%node_modules%',
        mode: 'like',
        workspaceRoot: '/workspace/project',
      });

      expect(store.purgeBySubjectPattern).toHaveBeenCalledWith(
        '%node_modules%',
        'like',
        '/workspace/project',
      );
      expect(result).toEqual({ deleted: 3 });
    });
  });

  describe('Zod validation rejections (INVALID_PARAMS)', () => {
    it('rejects empty pattern — Zod min(1) guard', async () => {
      const { rpcHandler, store } = buildHandlers(['/workspace/project']);

      await expect(
        rpcHandler.call('memory:purgeBySubjectPattern', {
          pattern: '',
          mode: 'substring',
          workspaceRoot: '/workspace/project',
        }),
      ).rejects.toMatchObject({
        errorCode: 'INVALID_PARAMS',
        message: 'Invalid parameters for memory:purgeBySubjectPattern',
      });

      expect(store.purgeBySubjectPattern).not.toHaveBeenCalled();
    });

    it('rejects invalid mode value — Zod enum guard', async () => {
      const { rpcHandler, store } = buildHandlers(['/workspace/project']);

      await expect(
        rpcHandler.call('memory:purgeBySubjectPattern', {
          pattern: 'node_modules',
          mode: 'regex',
          workspaceRoot: '/workspace/project',
        }),
      ).rejects.toMatchObject({
        errorCode: 'INVALID_PARAMS',
      });

      expect(store.purgeBySubjectPattern).not.toHaveBeenCalled();
    });

    it('does not leak raw Zod error in the thrown message', async () => {
      const { rpcHandler } = buildHandlers(['/workspace/project']);

      let thrownError: unknown;
      try {
        await rpcHandler.call('memory:purgeBySubjectPattern', {
          pattern: '',
          mode: 'substring',
          workspaceRoot: '/workspace/project',
        });
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(RpcUserError);
      const rpcErr = thrownError as RpcUserError;
      // Should not contain raw Zod details like "ZodError" or "minimum length"
      expect(rpcErr.message).not.toMatch(/ZodError/i);
      expect(rpcErr.message).not.toMatch(/minimum length/i);
      expect(rpcErr.message).not.toMatch(/at least/i);
      expect(rpcErr.message).toBe(
        'Invalid parameters for memory:purgeBySubjectPattern',
      );
    });

    it('logs the full Zod error server-side on invalid params', async () => {
      const { rpcHandler, logger } = buildHandlers(['/workspace/project']);

      try {
        await rpcHandler.call('memory:purgeBySubjectPattern', {
          pattern: '',
          mode: 'substring',
          workspaceRoot: '/workspace/project',
        });
      } catch {
        // expected
      }

      expect(logger.warn).toHaveBeenCalledWith(
        '[memory] purgeBySubjectPattern — invalid params',
        expect.objectContaining({ err: expect.any(String) }),
      );
    });
  });

  describe('Issue 1 (HIGH) — null/undefined workspaceRoot guard', () => {
    it('rejects when workspaceRoot schema is missing (null equivalent)', async () => {
      const { rpcHandler, store } = buildHandlers(['/workspace/project']);

      // The schema tightening to z.string().min(1) means null is rejected at Zod level.
      // Both Zod rejection and the explicit guard protect against this.
      await expect(
        rpcHandler.call('memory:purgeBySubjectPattern', {
          pattern: 'node_modules',
          mode: 'substring',
          workspaceRoot: null,
        }),
      ).rejects.toMatchObject({
        errorCode: 'INVALID_PARAMS',
      });

      expect(store.purgeBySubjectPattern).not.toHaveBeenCalled();
    });

    it('rejects when workspaceRoot is missing entirely', async () => {
      const { rpcHandler, store } = buildHandlers(['/workspace/project']);

      await expect(
        rpcHandler.call('memory:purgeBySubjectPattern', {
          pattern: 'node_modules',
          mode: 'substring',
        }),
      ).rejects.toMatchObject({
        errorCode: 'INVALID_PARAMS',
      });

      expect(store.purgeBySubjectPattern).not.toHaveBeenCalled();
    });
  });

  describe('Issue 2 (MEDIUM) — workspace authorization guard', () => {
    it('rejects when workspaceRoot does not match any open workspace folder', async () => {
      const { rpcHandler, store } = buildHandlers(['/workspace/project']);

      await expect(
        rpcHandler.call('memory:purgeBySubjectPattern', {
          pattern: 'node_modules',
          mode: 'substring',
          workspaceRoot: '/some/other/workspace',
        }),
      ).rejects.toMatchObject({
        errorCode: 'UNAUTHORIZED_WORKSPACE',
        message: 'Workspace not authorized',
      });

      expect(store.purgeBySubjectPattern).not.toHaveBeenCalled();
    });

    it('rejects when no workspace folders are open', async () => {
      const { rpcHandler, store } = buildHandlers([]); // no folders

      await expect(
        rpcHandler.call('memory:purgeBySubjectPattern', {
          pattern: 'node_modules',
          mode: 'substring',
          workspaceRoot: '/workspace/project',
        }),
      ).rejects.toMatchObject({
        errorCode: 'UNAUTHORIZED_WORKSPACE',
      });

      expect(store.purgeBySubjectPattern).not.toHaveBeenCalled();
    });
  });

  describe('store error handling', () => {
    it('wraps store errors in RpcUserError and does not leak raw error message to client', async () => {
      const { rpcHandler, store } = buildHandlers(['/workspace/project']);
      store.purgeBySubjectPattern.mockImplementation(() => {
        throw new Error('SQLITE_CORRUPT: database disk image is malformed');
      });

      let thrownError: unknown;
      try {
        await rpcHandler.call('memory:purgeBySubjectPattern', {
          pattern: 'node_modules',
          mode: 'substring',
          workspaceRoot: '/workspace/project',
        });
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(RpcUserError);
      const rpcErr = thrownError as RpcUserError;
      expect(rpcErr.errorCode).toBe('PERSISTENCE_UNAVAILABLE');
      // Must not leak SQLite internals to the client
      expect(rpcErr.message).not.toContain('SQLITE_CORRUPT');
      expect(rpcErr.message).not.toContain('malformed');
    });

    it('logs the store error at error level', async () => {
      const { rpcHandler, store, logger } = buildHandlers([
        '/workspace/project',
      ]);
      store.purgeBySubjectPattern.mockImplementation(() => {
        throw new Error('db failure');
      });

      try {
        await rpcHandler.call('memory:purgeBySubjectPattern', {
          pattern: 'node_modules',
          mode: 'substring',
          workspaceRoot: '/workspace/project',
        });
      } catch {
        // expected
      }

      expect(logger.error).toHaveBeenCalledWith(
        '[memory] purgeBySubjectPattern failed',
        expect.objectContaining({ error: expect.any(String) }),
      );
    });
  });
});

describe('MemoryRpcHandlers — memory:diagnostics', () => {
  it('returns wire-shaped snapshot from diagnostics service', async () => {
    const { rpcHandler, diagnostics } = buildHandlers(['/workspace/project']);
    diagnostics.getSnapshot.mockResolvedValue({
      lastRunAt: 1700000000000,
      lastRunStats: { extracted: 5, merged: 2, created: 3, skipped: 0 },
      lastDecayAt: 1699000000000,
      lastDecayStats: { scanned: 100, demoted: 4, archived: 1, expired: 0 },
      recentEvents: [
        {
          kind: 'curator-run',
          timestamp: 1700000000000,
          sessionId: 's1',
          stats: { extracted: 5, merged: 2, created: 3, skipped: 0 },
        },
      ],
      dbHealth: {
        memories: 50,
        memory_chunks: 50,
        memory_chunks_vec: 50,
        memory_chunks_fts: 50,
        code_symbols: 100,
        code_symbols_vec: 100,
        coherent: true,
        mismatches: [],
      },
      triggers: {
        preCompact: true,
        idleMs: 600000,
        turnThreshold: 20,
        bootScan: true,
        userPromptSubmit: {
          enabled: true,
          cueList: [],
          minPromptLength: 20,
        },
        postToolUse: { enabled: true },
        turnComplete: { enabled: true },
        episode: { enabled: true },
        sessionEnd: { enabled: true },
        maxCuratesPerHour: 12,
      },
    });

    const result = await rpcHandler.call('memory:diagnostics', {
      workspaceRoot: '/workspace/project',
    });

    expect(diagnostics.getSnapshot).toHaveBeenCalledWith(
      '/workspace/project',
      undefined,
    );
    expect(result).toMatchObject({
      lastRunAt: 1700000000000,
      lastRunStats: { extracted: 5, merged: 2, created: 3, skipped: 0 },
      lastDecayAt: 1699000000000,
      dbHealth: { coherent: true },
      triggers: { preCompact: true, idleMs: 600000 },
    });
    expect((result as { recentEvents: unknown[] }).recentEvents).toHaveLength(
      1,
    );
  });

  it('rejects invalid params with INVALID_PARAMS error envelope', async () => {
    const { rpcHandler, diagnostics } = buildHandlers(['/workspace/project']);

    await expect(
      rpcHandler.call('memory:diagnostics', { workspaceRoot: '' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(diagnostics.getSnapshot).not.toHaveBeenCalled();
  });

  it('wraps service throw in PERSISTENCE_UNAVAILABLE and does not leak raw message', async () => {
    const { rpcHandler, diagnostics } = buildHandlers(['/workspace/project']);
    diagnostics.getSnapshot.mockRejectedValue(
      new Error('SQLITE_CORRUPT: malformed disk image'),
    );

    let thrown: unknown;
    try {
      await rpcHandler.call('memory:diagnostics', {});
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RpcUserError);
    const rpcErr = thrown as RpcUserError;
    expect(rpcErr.errorCode).toBe('PERSISTENCE_UNAVAILABLE');
    expect(rpcErr.message).not.toContain('SQLITE_CORRUPT');
    expect(rpcErr.message).not.toContain('malformed');
  });
});

describe('MemoryRpcHandlers — memory:runNow', () => {
  it('calls curator.curate with sessionId+workspaceRoot and returns wire result', async () => {
    const { rpcHandler, curator } = buildHandlers(['/workspace/project']);
    curator.curate.mockResolvedValue({
      extracted: 4,
      merged: 1,
      created: 3,
      skipped: 0,
    });

    const result = await rpcHandler.call('memory:runNow', {
      sessionId: 'sess-1',
      workspaceRoot: '/workspace/project',
    });

    expect(curator.curate).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      workspaceRoot: '/workspace/project',
    });
    expect(result).toMatchObject({
      success: true,
      stats: { extracted: 4, merged: 1, created: 3, skipped: 0 },
    });
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'manual-run',
        sessionId: 'sess-1',
      }),
    );
  });

  it('rejects empty sessionId with INVALID_PARAMS', async () => {
    const { rpcHandler, curator } = buildHandlers(['/workspace/project']);

    await expect(
      rpcHandler.call('memory:runNow', {
        sessionId: '',
        workspaceRoot: '/workspace/project',
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });

    expect(curator.curate).not.toHaveBeenCalled();
  });

  it('returns error envelope (not throw) when curator throws — message preserved internally only', async () => {
    const { rpcHandler, curator, logger } = buildHandlers([
      '/workspace/project',
    ]);
    curator.curate.mockRejectedValue(new Error('LLM rate limit'));

    const result = await rpcHandler.call('memory:runNow', {
      sessionId: 'sess-x',
      workspaceRoot: '/workspace/project',
    });

    expect(result).toMatchObject({
      success: false,
      stats: null,
      error: 'LLM rate limit',
    });
    expect(logger.error).toHaveBeenCalledWith(
      '[memory] runNow failed',
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it('rejects unauthorized workspace', async () => {
    const { rpcHandler, curator } = buildHandlers(['/workspace/project']);

    await expect(
      rpcHandler.call('memory:runNow', {
        sessionId: 'sess-1',
        workspaceRoot: '/other/workspace',
      }),
    ).rejects.toMatchObject({ errorCode: 'UNAUTHORIZED_WORKSPACE' });
    expect(curator.curate).not.toHaveBeenCalled();
  });

  it('rejects reserved sessionId "manual" with INVALID_PARAMS (Critical-1 guard)', async () => {
    const { rpcHandler, curator } = buildHandlers(['/workspace/project']);
    await expect(
      rpcHandler.call('memory:runNow', {
        sessionId: 'manual',
        workspaceRoot: '/workspace/project',
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(curator.curate).not.toHaveBeenCalled();
  });
});

describe('MemoryRpcHandlers — memory:setTriggers', () => {
  it('persists each provided field via setConfiguration and returns the read-back triggers', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers([
      '/workspace/project',
    ]);
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');

    const result = await rpcHandler.call('memory:setTriggers', {
      triggers: {
        preCompact: false,
        idleMs: 300000,
        turnThreshold: 10,
        bootScan: false,
      },
    });

    expect(setSpy).toHaveBeenCalledWith(
      'ptah',
      'memory.triggers.preCompact',
      false,
    );
    expect(setSpy).toHaveBeenCalledWith(
      'ptah',
      'memory.triggers.idleMs',
      300000,
    );
    expect(setSpy).toHaveBeenCalledWith(
      'ptah',
      'memory.triggers.turnThreshold',
      10,
    );
    expect(setSpy).toHaveBeenCalledWith(
      'ptah',
      'memory.triggers.bootScan',
      false,
    );
    expect(result).toMatchObject({
      triggers: {
        preCompact: false,
        idleMs: 300000,
        turnThreshold: 10,
        bootScan: false,
      },
    });
  });

  it('rejects invalid field types with INVALID_PARAMS', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers([
      '/workspace/project',
    ]);
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');

    await expect(
      rpcHandler.call('memory:setTriggers', {
        triggers: { idleMs: -100 },
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('rejects degenerate idleMs (1ms) with INVALID_PARAMS (Moderate-1)', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers([
      '/workspace/project',
    ]);
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');
    await expect(
      rpcHandler.call('memory:setTriggers', {
        triggers: { idleMs: 1 },
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('rejects degenerate turnThreshold (1) with INVALID_PARAMS (Moderate-1)', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers([
      '/workspace/project',
    ]);
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');
    await expect(
      rpcHandler.call('memory:setTriggers', {
        triggers: { turnThreshold: 1 },
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('accepts idleMs = 0 (disabled) and turnThreshold = 0', async () => {
    const { rpcHandler } = buildHandlers(['/workspace/project']);
    const result = await rpcHandler.call('memory:setTriggers', {
      triggers: { idleMs: 0, turnThreshold: 0 },
    });
    expect(result).toMatchObject({
      triggers: { idleMs: 0, turnThreshold: 0 },
    });
  });

  it('returns PERSISTENCE_UNAVAILABLE without leaking raw error when setConfiguration throws', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers([
      '/workspace/project',
    ]);
    jest
      .spyOn(workspaceProvider, 'setConfiguration')
      .mockRejectedValue(new Error('EACCES: ~/.ptah/settings.json'));

    let thrown: unknown;
    try {
      await rpcHandler.call('memory:setTriggers', {
        triggers: { preCompact: false },
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

describe('MemoryRpcHandlers — memory:getTriggers', () => {
  it('returns defaults when no settings present', async () => {
    const { rpcHandler } = buildHandlers(['/workspace/project']);
    const result = await rpcHandler.call('memory:getTriggers', {});
    expect(result).toMatchObject({
      triggers: {
        preCompact: true,
        idleMs: 600000,
        turnThreshold: 20,
        bootScan: true,
        userPromptSubmit: expect.objectContaining({
          enabled: true,
          minPromptLength: 20,
        }),
        postToolUse: { enabled: true },
        maxCuratesPerHour: 12,
      },
    });
  });

  it('returns persisted values after setTriggers', async () => {
    const { rpcHandler } = buildHandlers(['/workspace/project']);
    await rpcHandler.call('memory:setTriggers', {
      triggers: { idleMs: 120000, turnThreshold: 5 },
    });
    const result = await rpcHandler.call('memory:getTriggers', {});
    expect(result).toMatchObject({
      triggers: { idleMs: 120000, turnThreshold: 5 },
    });
  });

  it('rejects unknown fields when params is non-empty object with extras', async () => {
    const { rpcHandler } = buildHandlers(['/workspace/project']);
    await expect(
      rpcHandler.call('memory:getTriggers', { junk: 'value' } as unknown),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
  });
});

describe('MemoryRpcHandlers — nested triggers (userPromptSubmit / postToolUse / maxCuratesPerHour)', () => {
  it('persists nested userPromptSubmit via flat dotted keys and round-trips', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers([
      '/workspace/project',
    ]);
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');

    const result = await rpcHandler.call('memory:setTriggers', {
      triggers: {
        userPromptSubmit: {
          enabled: false,
          cueList: ['custom-cue'],
          minPromptLength: 50,
        },
      },
    });

    expect(setSpy).toHaveBeenCalledWith(
      'ptah',
      'memory.triggers.userPromptSubmit.enabled',
      false,
    );
    expect(setSpy).toHaveBeenCalledWith(
      'ptah',
      'memory.triggers.userPromptSubmit.cueList',
      ['custom-cue'],
    );
    expect(setSpy).toHaveBeenCalledWith(
      'ptah',
      'memory.triggers.userPromptSubmit.minPromptLength',
      50,
    );

    expect(result).toMatchObject({
      triggers: {
        userPromptSubmit: {
          enabled: false,
          cueList: ['custom-cue'],
          minPromptLength: 50,
        },
      },
    });

    const getResult = await rpcHandler.call('memory:getTriggers', {});
    expect(getResult).toMatchObject({
      triggers: {
        userPromptSubmit: {
          enabled: false,
          cueList: ['custom-cue'],
          minPromptLength: 50,
        },
      },
    });
  });

  it('persists nested postToolUse via flat dotted keys', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers([
      '/workspace/project',
    ]);
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');

    await rpcHandler.call('memory:setTriggers', {
      triggers: { postToolUse: { enabled: false } },
    });

    expect(setSpy).toHaveBeenCalledWith(
      'ptah',
      'memory.triggers.postToolUse.enabled',
      false,
    );
  });

  it('persists maxCuratesPerHour as top-level flat key', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers([
      '/workspace/project',
    ]);
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');

    await rpcHandler.call('memory:setTriggers', {
      triggers: { maxCuratesPerHour: 25 },
    });

    expect(setSpy).toHaveBeenCalledWith(
      'ptah',
      'memory.triggers.maxCuratesPerHour',
      25,
    );

    const getResult = await rpcHandler.call('memory:getTriggers', {});
    expect(getResult).toMatchObject({
      triggers: { maxCuratesPerHour: 25 },
    });
  });

  it('rejects cueList with too many entries (>50) via Zod refinement', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers([
      '/workspace/project',
    ]);
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');
    const tooMany = Array.from({ length: 51 }, (_, i) => `cue${i}`);
    await expect(
      rpcHandler.call('memory:setTriggers', {
        triggers: {
          userPromptSubmit: {
            enabled: true,
            cueList: tooMany,
            minPromptLength: 20,
          },
        },
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('rejects maxCuratesPerHour > 1000 via Zod refinement', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers([
      '/workspace/project',
    ]);
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');
    await expect(
      rpcHandler.call('memory:setTriggers', {
        triggers: { maxCuratesPerHour: 1001 },
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('returns nested defaults when no nested settings present', async () => {
    const { rpcHandler } = buildHandlers(['/workspace/project']);
    const result = await rpcHandler.call('memory:getTriggers', {});
    expect(result).toMatchObject({
      triggers: {
        userPromptSubmit: expect.objectContaining({
          enabled: true,
          minPromptLength: 20,
        }),
        postToolUse: { enabled: true },
        maxCuratesPerHour: 12,
      },
    });
  });
});

describe('MemoryRpcHandlers — dual-registration smoke', () => {
  it('every METHODS entry has a prefix listed in ALLOWED_METHOD_PREFIXES', () => {
    for (const method of MemoryRpcHandlers.METHODS) {
      const ok = ALLOWED_METHOD_PREFIXES.some((p) => method.startsWith(p));
      expect(ok).toBe(true);
    }
  });
});
