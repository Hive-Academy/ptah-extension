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
import type { Logger } from '@ptah-extension/vscode-core';
import { MEMORY_TOKENS, MemoryStore } from '@ptah-extension/memory-curator';
import {
  MIGRATIONS,
  type IEmbedder,
  type SqliteConnectionService,
  type VecStatusService,
} from '@ptah-extension/persistence-sqlite';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  createMockWorkspaceProvider,
  type MockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
// The workspace-intelligence barrel loads tree-sitter (ESM); only its DI token
// is used here, so the same token is provided without loading the barrel.
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  CODE_SYMBOL_INDEXER: Symbol.for('PtahCodeSymbolIndexer'),
}));
import { CODE_SYMBOL_INDEXER } from '@ptah-extension/workspace-intelligence';
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
    getActiveById: jest.fn(),
    getChunks: jest.fn(),
    recordUse: jest.fn(),
    setPinned: jest.fn().mockReturnValue(true),
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
    listQuarantined: jest.fn().mockReturnValue({ rows: [], total: 0 }),
    restoreQuarantined: jest.fn().mockReturnValue({ restored: 0 }),
  };
}

function makeMemory(id = 'mem-1') {
  return {
    id,
    sessionId: 'session-1',
    workspaceRoot: '/workspace/project',
    tier: 'recall',
    kind: 'fact',
    subject: 'subject',
    content: 'content',
    sourceMessageIds: [],
    salience: 0.5,
    decayRate: 0,
    hits: 1,
    pinned: false,
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: 1,
    expiresAt: null,
  };
}

function makeCodeSymbolStore() {
  return {
    count: jest.fn().mockReturnValue(0),
    purgeJunk: jest.fn().mockReturnValue(0),
    deleteByFile: jest.fn().mockReturnValue(0),
    insertBatch: jest.fn().mockResolvedValue(undefined),
    purgeWorkspace: jest.fn().mockReturnValue(0),
    search: jest.fn().mockReturnValue({ items: [], total: 0 }),
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
      outcome: 'ran',
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
      storage: {
        dbBytes: null,
        reclaimableBytes: null,
        autoVacuumIncremental: null,
        observations: {
          pendingRows: null,
          pendingBytes: null,
          oldestPendingAt: null,
          stuckEligibleRows: null,
          processedRows: null,
          processedBytesEstimate: null,
          measuredAt: null,
          quarantineLedgerRows: null,
          bootScanFailuresPending: null,
          bootScanFailuresGivenUp: null,
        },
        retention: {
          enabled: true,
          processedDays: 30,
          stuckDays: 7,
          lastRun: null,
          lastCompletedAt: null,
          nextDueAt: null,
          lastSkippedAt: null,
          lastSkipReason: null,
        },
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

function buildHandlers(
  workspaceFolders: string[] = ['/workspace/project'],
  codeIndex?: { invalidateCoverage: jest.Mock },
) {
  return buildHandlersWithStore(workspaceFolders, makeMemoryStore(), codeIndex);
}

/** Same wiring as {@link buildHandlers}, over a caller-supplied store (mock or real). */
function buildHandlersWithStore<TStore extends object>(
  workspaceFolders: string[],
  store: TStore,
  codeIndex?: { invalidateCoverage: jest.Mock },
) {
  const logger = makeLogger();
  const rpcHandler = makeRpcHandler();
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
  if (codeIndex !== undefined) {
    child.registerInstance(CODE_SYMBOL_INDEXER, codeIndex);
  }
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
        request: null,
        investigated: null,
        learned: null,
        completed: null,
        nextSteps: null,
        type: 'discovery',
        concepts: [],
        files: [],
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

describe('MemoryRpcHandlers — explicit use recording', () => {
  it('records a found memory:get result', async () => {
    const { rpcHandler, store } = buildHandlers();
    store.getActiveById.mockReturnValue(makeMemory());
    store.getChunks.mockReturnValue([]);

    const result = await rpcHandler.call('memory:get', { id: 'mem-1' });

    expect(store.recordUse).toHaveBeenCalledWith(['mem-1']);
    expect(result).toMatchObject({ memory: { id: 'mem-1' }, chunks: [] });
  });

  it('does not record memory:get when the memory is not found', async () => {
    const { rpcHandler, store } = buildHandlers();
    store.getActiveById.mockReturnValue(null);

    const result = await rpcHandler.call('memory:get', { id: 'missing' });

    expect(store.recordUse).not.toHaveBeenCalled();
    expect(result).toEqual({ memory: null, chunks: [] });
  });

  it('reads through the active-only lookup, so a quarantined id reads as missing', async () => {
    const { rpcHandler, store } = buildHandlers();
    store.getActiveById.mockReturnValue(null);

    const result = await rpcHandler.call('memory:get', { id: 'quarantined' });

    expect(store.getActiveById).toHaveBeenCalledWith('quarantined');
    expect(store.getChunks).not.toHaveBeenCalled();
    expect(store.recordUse).not.toHaveBeenCalled();
    expect(result).toEqual({ memory: null, chunks: [] });
  });

  it('does not record memory:list or memory:search results', async () => {
    const { rpcHandler, store, search } = buildHandlers();
    store.list.mockReturnValue({ memories: [makeMemory()], total: 1 });
    search.searchRich.mockResolvedValue({ hits: [], bm25Only: false });

    await rpcHandler.call('memory:list', {});
    await rpcHandler.call('memory:search', { query: 'content' });

    expect(store.recordUse).not.toHaveBeenCalled();
  });

  it('returns a found memory unchanged when recording fails', async () => {
    const { rpcHandler, store, logger } = buildHandlers();
    store.getActiveById.mockReturnValue(makeMemory());
    store.getChunks.mockReturnValue([]);
    store.recordUse.mockImplementation(() => {
      throw new Error('usage ledger unavailable');
    });

    const result = await rpcHandler.call('memory:get', { id: 'mem-1' });

    expect(result).toMatchObject({ memory: { id: 'mem-1' }, chunks: [] });
    expect(logger.warn).toHaveBeenCalledWith(
      '[memory] failed to record memory use',
      { error: 'usage ledger unavailable' },
    );
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
    const storage = {
      dbBytes: 8192,
      reclaimableBytes: 2048,
      autoVacuumIncremental: true,
      observations: {
        pendingRows: 4,
        pendingBytes: 512,
        oldestPendingAt: 1699000000000,
        stuckEligibleRows: 1,
        processedRows: 20,
        processedBytesEstimate: 2560,
        measuredAt: 1700000000000,
        quarantineLedgerRows: 2,
        bootScanFailuresPending: 0,
        bootScanFailuresGivenUp: 0,
      },
      retention: {
        enabled: true,
        processedDays: 30,
        stuckDays: 7,
        lastRun: null,
        lastCompletedAt: 1700000000000,
        nextDueAt: 1700086400000,
        lastSkippedAt: null,
        lastSkipReason: null,
      },
    };
    diagnostics.getSnapshot.mockResolvedValue({
      lastRunAt: 1700000000000,
      lastRunStats: { extracted: 5, merged: 2, created: 3, skipped: 0 },
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
      storage,
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
      dbHealth: { coherent: true },
      storage,
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
      outcome: 'ran',
      extracted: 4,
      merged: 1,
      created: 3,
      skipped: 0,
    });

    const result = await rpcHandler.call('memory:runNow', {
      sessionId: 'sess-1',
      workspaceRoot: '/workspace/project',
    });

    // `userInitiated`: a user is waiting, so the pass skips the background-work
    // governor (TASK_2026_437 C14, Batch 16b). Only this RPC sets it.
    expect(curator.curate).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      workspaceRoot: '/workspace/project',
      userInitiated: true,
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

  /**
   * TASK_2026_306 Batch 10, F-1 — the one curate call site a HUMAN drives.
   *
   * Every count is zero both when the pass ran and learned nothing and when
   * the provider quota gate stopped it before dispatch. Reporting counts alone
   * hands the user `success: true, extracted: 0` during a cooldown — the exact
   * "ran and found nothing" reading this batch exists to eliminate, at the
   * surface where the user is actively waiting on the answer.
   *
   * The pair below is the discriminating one: identical counts, opposite
   * `outcome`. Drop the field from the handler and the first case fails.
   */
  describe('the stall discriminator reaches the user-driven surface', () => {
    it('reports outcome "stalled" on the response AND the manual-run event', async () => {
      const { rpcHandler, curator, logger } = buildHandlers([
        '/workspace/project',
      ]);
      curator.curate.mockResolvedValue({
        outcome: 'stalled',
        extracted: 0,
        merged: 0,
        created: 0,
        skipped: 0,
      });

      const result = await rpcHandler.call('memory:runNow', {
        sessionId: 'sess-cooldown',
        workspaceRoot: '/workspace/project',
      });

      expect(result).toMatchObject({
        // The RPC itself succeeded — `success: false` is reserved for a thrown
        // failure, and conflating the two would swap one ambiguity for another.
        success: true,
        stats: { outcome: 'stalled', extracted: 0 },
      });
      expect(curator.pushEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'manual-run',
          sessionId: 'sess-cooldown',
          stats: expect.objectContaining({ outcome: 'stalled' }),
        }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[memory] runNow — pass stalled before dispatch; nothing was consumed',
        expect.objectContaining({ sessionId: 'sess-cooldown' }),
      );
    });

    it('reports outcome "ran" for a pass that dispatched and found nothing', async () => {
      // Byte-identical counts to the case above. `outcome` is the only thing
      // that separates them, which is the whole point.
      const { rpcHandler, curator } = buildHandlers(['/workspace/project']);
      curator.curate.mockResolvedValue({
        outcome: 'ran',
        extracted: 0,
        merged: 0,
        created: 0,
        skipped: 0,
      });

      const result = await rpcHandler.call('memory:runNow', {
        sessionId: 'sess-empty',
        workspaceRoot: '/workspace/project',
      });

      expect(result).toMatchObject({
        success: true,
        stats: { outcome: 'ran', extracted: 0 },
      });
      expect(curator.pushEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'manual-run',
          stats: expect.objectContaining({ outcome: 'ran' }),
        }),
      );
    });
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
        maxCuratesPerHour: 20,
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

  it('round-trips curatorProvider/curatorModel through setTriggers → getTriggers', async () => {
    const { rpcHandler, workspaceProvider } = buildHandlers([
      '/workspace/project',
    ]);
    const setSpy = jest.spyOn(workspaceProvider, 'setConfiguration');

    await rpcHandler.call('memory:setTriggers', {
      triggers: {
        curatorProvider: 'anthropic',
        curatorModel: 'claude-haiku-4-5-20251001',
      },
    });

    expect(setSpy).toHaveBeenCalledWith(
      'ptah',
      'memory.curatorProvider',
      'anthropic',
    );
    expect(setSpy).toHaveBeenCalledWith(
      'ptah',
      'memory.curatorModel',
      'claude-haiku-4-5-20251001',
    );

    const result = await rpcHandler.call('memory:getTriggers', {});
    expect(result).toMatchObject({
      triggers: {
        curatorProvider: 'anthropic',
        curatorModel: 'claude-haiku-4-5-20251001',
      },
    });
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
        maxCuratesPerHour: 20,
      },
    });
  });
});

// ---------------------------------------------------------------------------
// workspaceRoot scoping at the RPC boundary — TASK_2026_315 A4
//
// The defect was `params?.workspaceRoot ?? undefined`: `??` treats null as
// nullish, so the webview's explicit `null` ("global/unscoped memories")
// collapsed into `undefined` ("no filter") and the store answered with the
// union of every workspace in the shared database.
// ---------------------------------------------------------------------------

describe('MemoryRpcHandlers — memory:stats workspace scoping', () => {
  it('never passes undefined to the stores when the param is omitted (no cross-workspace union)', async () => {
    const { rpcHandler, store, codeSymbols } = buildHandlers([
      '/workspace/project',
    ]);

    await rpcHandler.call('memory:stats', {});

    expect(store.stats).toHaveBeenCalledWith('/workspace/project');
    expect(codeSymbols.count).toHaveBeenCalledWith('/workspace/project');
    expect(store.stats).not.toHaveBeenCalledWith(undefined);
    expect(codeSymbols.count).not.toHaveBeenCalledWith(undefined);
  });

  it('scopes an omitted param to null (global/unscoped) when no folder is open', async () => {
    const { rpcHandler, store, codeSymbols } = buildHandlers([]);

    await rpcHandler.call('memory:stats', {});

    expect(store.stats).toHaveBeenCalledWith(null);
    expect(codeSymbols.count).toHaveBeenCalledWith(null);
  });

  it('preserves an explicit null as null — global memories stay a distinct query', async () => {
    const { rpcHandler, store, codeSymbols } = buildHandlers([]);

    await rpcHandler.call('memory:stats', { workspaceRoot: null });

    expect(store.stats).toHaveBeenCalledWith(null);
    expect(codeSymbols.count).toHaveBeenCalledWith(null);
  });

  it('forwards an explicit workspaceRoot unchanged', async () => {
    const { rpcHandler, store, codeSymbols } = buildHandlers([
      '/workspace/project',
    ]);

    await rpcHandler.call('memory:stats', { workspaceRoot: '/other/ws' });

    expect(store.stats).toHaveBeenCalledWith('/other/ws');
    expect(codeSymbols.count).toHaveBeenCalledWith('/other/ws');
  });

  // The Memory tab's "All workspaces" toggle. Passing `null` alone used to mean
  // this by accident and now means "global/unscoped rows only" — `scope: 'all'`
  // is the only way to ask for the cross-workspace total.
  it("scope:'all' produces the cross-workspace union (undefined = no predicate)", async () => {
    const { rpcHandler, store, codeSymbols } = buildHandlers([
      '/workspace/project',
    ]);

    await rpcHandler.call('memory:stats', {
      workspaceRoot: null,
      scope: 'all',
    });

    expect(store.stats).toHaveBeenCalledWith(undefined);
    expect(codeSymbols.count).toHaveBeenCalledWith(undefined);
  });

  it("scope:'all' ignores an explicit workspaceRoot rather than narrowing", async () => {
    const { rpcHandler, store } = buildHandlers(['/workspace/project']);

    await rpcHandler.call('memory:stats', {
      workspaceRoot: '/workspace/project',
      scope: 'all',
    });

    expect(store.stats).toHaveBeenCalledWith(undefined);
  });

  it("scope:'workspace' with no folder open still means global/unscoped, not a union", async () => {
    const { rpcHandler, store, codeSymbols } = buildHandlers([]);

    await rpcHandler.call('memory:stats', { scope: 'workspace' });

    expect(store.stats).toHaveBeenCalledWith(null);
    expect(codeSymbols.count).toHaveBeenCalledWith(null);
  });

  it('rejects an unknown scope value', async () => {
    const { rpcHandler, store } = buildHandlers(['/workspace/project']);

    await expect(
      rpcHandler.call('memory:stats', { scope: 'everything' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(store.stats).not.toHaveBeenCalled();
  });
});

describe('MemoryRpcHandlers — memory:searchSymbols workspace scoping', () => {
  it('scopes an omitted workspaceRoot to the current root instead of every workspace', async () => {
    const { rpcHandler, codeSymbols } = buildHandlers(['/workspace/project']);

    await rpcHandler.call('memory:searchSymbols', { query: 'login' });

    expect(codeSymbols.search).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceRoot: '/workspace/project' }),
    );
  });

  it('scopes to null when no folder is open', async () => {
    const { rpcHandler, codeSymbols } = buildHandlers([]);

    await rpcHandler.call('memory:searchSymbols', { query: 'login' });

    expect(codeSymbols.search).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceRoot: null }),
    );
  });

  // The Memory tab's "All workspaces" toggle omits `workspaceRoot`. Without an
  // explicit scope that is indistinguishable from "no folder open", and an
  // all-workspaces symbol search silently narrowed to the active workspace.
  it("scope:'all' spans every workspace (undefined = no predicate)", async () => {
    const { rpcHandler, codeSymbols } = buildHandlers(['/workspace/project']);

    await rpcHandler.call('memory:searchSymbols', {
      query: 'login',
      scope: 'all',
    });

    expect(codeSymbols.search).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceRoot: undefined }),
    );
  });

  it("scope:'all' spans every workspace even with no folder open", async () => {
    const { rpcHandler, codeSymbols } = buildHandlers([]);

    await rpcHandler.call('memory:searchSymbols', { scope: 'all' });

    expect(codeSymbols.search).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceRoot: undefined }),
    );
  });

  it('rejects an unknown scope value', async () => {
    const { rpcHandler, codeSymbols } = buildHandlers(['/workspace/project']);

    await expect(
      rpcHandler.call('memory:searchSymbols', { scope: 'everything' }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(codeSymbols.search).not.toHaveBeenCalled();
  });
});

describe('MemoryRpcHandlers — memory:purgeJunk workspace refusal', () => {
  it('refuses an omitted workspaceRoot (purgeBySubjectPattern precedent)', async () => {
    const { rpcHandler, codeSymbols } = buildHandlers(['/workspace/project']);

    await expect(rpcHandler.call('memory:purgeJunk', {})).rejects.toMatchObject(
      { errorCode: 'INVALID_PARAMS' },
    );
    expect(codeSymbols.purgeJunk).not.toHaveBeenCalled();
  });

  it('refuses an explicit null workspaceRoot', async () => {
    const { rpcHandler, codeSymbols } = buildHandlers(['/workspace/project']);

    await expect(
      rpcHandler.call('memory:purgeJunk', { workspaceRoot: null }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(codeSymbols.purgeJunk).not.toHaveBeenCalled();
  });

  it('still refuses an unauthorized workspace', async () => {
    const { rpcHandler, codeSymbols } = buildHandlers(['/workspace/project']);

    await expect(
      rpcHandler.call('memory:purgeJunk', { workspaceRoot: '/somewhere/else' }),
    ).rejects.toMatchObject({ errorCode: 'UNAUTHORIZED_WORKSPACE' });
    expect(codeSymbols.purgeJunk).not.toHaveBeenCalled();
  });

  it('purges an authorized workspace', async () => {
    const { rpcHandler, codeSymbols } = buildHandlers(['/workspace/project']);
    codeSymbols.purgeJunk.mockReturnValue(7);

    const result = await rpcHandler.call('memory:purgeJunk', {
      workspaceRoot: '/workspace/project',
    });

    expect(codeSymbols.purgeJunk).toHaveBeenCalledWith('/workspace/project');
    expect(result).toEqual({ deleted: 7 });
  });

  // TASK_2026_559 Batch 24b r1 B2: the purge deletes indexed rows, so the
  // code index's live coverage is invalidated first — before the delete, and
  // also when the delete fails part-way.
  it('invalidates the code index coverage before deleting', async () => {
    const order: string[] = [];
    const codeIndex = {
      invalidateCoverage: jest.fn(() => order.push('invalidate')),
    };
    const { rpcHandler, codeSymbols } = buildHandlers(
      ['/workspace/project'],
      codeIndex,
    );
    codeSymbols.purgeJunk.mockImplementation(() => {
      order.push('purge');
      return 1;
    });

    await rpcHandler.call('memory:purgeJunk', {
      workspaceRoot: '/workspace/project',
    });

    expect(codeIndex.invalidateCoverage).toHaveBeenCalledWith(
      '/workspace/project',
    );
    expect(order).toEqual(['invalidate', 'purge']);
  });

  it('keeps the invalidation when the delete throws', async () => {
    const codeIndex = { invalidateCoverage: jest.fn() };
    const { rpcHandler, codeSymbols } = buildHandlers(
      ['/workspace/project'],
      codeIndex,
    );
    codeSymbols.purgeJunk.mockImplementation(() => {
      throw new Error('disk I/O error');
    });

    await expect(
      rpcHandler.call('memory:purgeJunk', {
        workspaceRoot: '/workspace/project',
      }),
    ).rejects.toMatchObject({ errorCode: 'PERSISTENCE_UNAVAILABLE' });
    expect(codeIndex.invalidateCoverage).toHaveBeenCalledTimes(1);
  });

  it('never invalidates on a refused purge', async () => {
    const codeIndex = { invalidateCoverage: jest.fn() };
    const { rpcHandler } = buildHandlers(['/workspace/project'], codeIndex);

    await expect(
      rpcHandler.call('memory:purgeJunk', { workspaceRoot: '/somewhere/else' }),
    ).rejects.toMatchObject({ errorCode: 'UNAUTHORIZED_WORKSPACE' });
    expect(codeIndex.invalidateCoverage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Quarantine review and restore surface — TASK_2026_563 M5 (component 8)
// ---------------------------------------------------------------------------

describe('MemoryRpcHandlers — memory:restoreQuarantined validation and authorization', () => {
  it.each([
    ['an omitted workspaceRoot key', { all: true }],
    ['no selector', { workspaceRoot: '/workspace/project' }],
    [
      'two selectors',
      { workspaceRoot: '/workspace/project', all: true, reason: 'rule:x' },
    ],
    [
      'a reason that is not rule:<id>',
      { workspaceRoot: '/workspace/project', reason: 'commitlint' },
    ],
    [
      'more than 500 ids',
      {
        workspaceRoot: '/workspace/project',
        ids: Array.from({ length: 501 }, (_, i) => `m-${i}`),
      },
    ],
    ['an empty-string workspaceRoot', { workspaceRoot: '', all: true }],
    ['all: false', { workspaceRoot: '/workspace/project', all: false }],
  ])('rejects %s with INVALID_PARAMS', async (_label, params) => {
    const { rpcHandler, store } = buildHandlers(['/workspace/project']);

    await expect(
      rpcHandler.call('memory:restoreQuarantined', params),
    ).rejects.toMatchObject({
      errorCode: 'INVALID_PARAMS',
      message: 'Invalid parameters for memory:restoreQuarantined',
    });
    expect(store.restoreQuarantined).not.toHaveBeenCalled();
  });

  it('rejects an unauthorized workspace with UNAUTHORIZED_WORKSPACE', async () => {
    const { rpcHandler, store } = buildHandlers(['/workspace/project']);

    await expect(
      rpcHandler.call('memory:restoreQuarantined', {
        workspaceRoot: '/somewhere/else',
        all: true,
      }),
    ).rejects.toMatchObject({ errorCode: 'UNAUTHORIZED_WORKSPACE' });
    expect(store.restoreQuarantined).not.toHaveBeenCalled();
  });

  it('passes an authorized workspace and the ids selector to the store', async () => {
    const { rpcHandler, store } = buildHandlers(['/workspace/project']);
    store.restoreQuarantined.mockReturnValue({ restored: 2 });

    const result = await rpcHandler.call('memory:restoreQuarantined', {
      workspaceRoot: '/workspace/project',
      ids: ['m-1', 'm-2'],
    });

    expect(store.restoreQuarantined).toHaveBeenCalledWith(
      { ids: ['m-1', 'm-2'] },
      '/workspace/project',
    );
    expect(result).toEqual({ restored: 2 });
  });

  it('accepts an explicit null as the unscoped rows and logs the scope', async () => {
    const { rpcHandler, store, logger } = buildHandlers([]);

    await rpcHandler.call('memory:restoreQuarantined', {
      workspaceRoot: null,
      reason: 'rule:commitlint-scope-facts',
    });

    expect(store.restoreQuarantined).toHaveBeenCalledWith(
      { reason: 'rule:commitlint-scope-facts' },
      null,
    );
    expect(logger.info).toHaveBeenCalledWith('[memory] restoreQuarantined', {
      scope: 'unscoped',
    });
  });

  it('wraps a store failure in PERSISTENCE_UNAVAILABLE without leaking it', async () => {
    const { rpcHandler, store, logger } = buildHandlers(['/workspace/project']);
    store.restoreQuarantined.mockImplementation(() => {
      throw new Error('SQLITE_BUSY: database is locked');
    });

    let thrown: unknown;
    try {
      await rpcHandler.call('memory:restoreQuarantined', {
        workspaceRoot: '/workspace/project',
        all: true,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(RpcUserError);
    const rpcErr = thrown as RpcUserError;
    expect(rpcErr.errorCode).toBe('PERSISTENCE_UNAVAILABLE');
    expect(rpcErr.message).not.toContain('SQLITE_BUSY');
    expect(logger.error).toHaveBeenCalledWith(
      '[memory] restoreQuarantined failed',
      { error: 'SQLITE_BUSY: database is locked' },
    );
  });
});

describe('MemoryRpcHandlers — memory:listQuarantined scope and mapping', () => {
  it('scopes an omitted workspaceRoot to the current workspace', async () => {
    const { rpcHandler, store } = buildHandlers(['/workspace/project']);

    await rpcHandler.call('memory:listQuarantined', {});

    expect(store.listQuarantined).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceRoot: '/workspace/project' }),
    );
  });

  it('preserves an explicit null as the unscoped rows', async () => {
    const { rpcHandler, store } = buildHandlers(['/workspace/project']);

    await rpcHandler.call('memory:listQuarantined', { workspaceRoot: null });

    expect(store.listQuarantined).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceRoot: null }),
    );
  });

  it("scope:'all' lists every workspace", async () => {
    const { rpcHandler, store } = buildHandlers(['/workspace/project']);

    await rpcHandler.call('memory:listQuarantined', {
      scope: 'all',
      reason: 'rule:commitlint-scope-facts',
      limit: 20,
      offset: 40,
    });

    expect(store.listQuarantined).toHaveBeenCalledWith({
      workspaceRoot: undefined,
      reason: 'rule:commitlint-scope-facts',
      limit: 20,
      offset: 40,
    });
  });

  it('maps every row to the wire shape, keeping its workspaceRoot', async () => {
    const { rpcHandler, store } = buildHandlers(['/workspace/project']);
    store.listQuarantined.mockReturnValue({
      rows: [
        {
          id: 'q-1',
          workspaceRoot: null,
          subject: 'commitlint scope',
          kind: 'fact',
          tier: 'recall',
          reason: 'rule:commitlint-scope-facts',
          quarantinedAt: 42,
          excerpt: 'excerpt',
        },
      ],
      total: 7,
    });

    const result = await rpcHandler.call('memory:listQuarantined', {
      scope: 'all',
    });

    expect(result).toEqual({
      items: [
        {
          id: 'q-1',
          workspaceRoot: null,
          subject: 'commitlint scope',
          kind: 'fact',
          tier: 'recall',
          reason: 'rule:commitlint-scope-facts',
          quarantinedAt: 42,
          excerpt: 'excerpt',
        },
      ],
      total: 7,
    });
  });

  it.each([
    ['an unknown scope', { scope: 'everything' }],
    ['a reason that is not rule:<id>', { reason: 'anything' }],
    ['a limit above 500', { limit: 501 }],
  ])('rejects %s with INVALID_PARAMS', async (_label, params) => {
    const { rpcHandler, store } = buildHandlers(['/workspace/project']);

    await expect(
      rpcHandler.call('memory:listQuarantined', params),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    expect(store.listQuarantined).not.toHaveBeenCalled();
  });

  it('wraps a store failure in PERSISTENCE_UNAVAILABLE', async () => {
    const { rpcHandler, store } = buildHandlers(['/workspace/project']);
    store.listQuarantined.mockImplementation(() => {
      throw new Error('SQLITE_CORRUPT');
    });

    await expect(
      rpcHandler.call('memory:listQuarantined', {}),
    ).rejects.toMatchObject({ errorCode: 'PERSISTENCE_UNAVAILABLE' });
  });
});

// ---------------------------------------------------------------------------
// Real store on real SQLite. `better-sqlite3` is rebuilt for Electron's ABI, so
// under plain Jest the opener falls back to `node:sqlite`. The opener is local
// (the skills-synthesis digest spec precedent): this lib imports its siblings
// through their barrels only. No binding at all fails the suite, never skips it.
// ---------------------------------------------------------------------------

interface RawTestDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}

function openRawTestDb(): RawTestDb {
  try {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => RawTestDb;
    return new Database(':memory:');
  } catch {
    // Falls through to the built-in binding.
  }
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (file: string) => RawTestDb;
  };
  return new DatabaseSync(':memory:');
}

const WS = '/workspace/project';
const REASON = 'rule:commitlint-scope-facts';

interface RealStoreHarness {
  readonly raw: RawTestDb;
  readonly rpcHandler: ReturnType<typeof makeRpcHandler>;
}

const openRawDbs: RawTestDb[] = [];

/**
 * Every bundled migration's base SQL (0048 adds the quarantine columns), a
 * real `MemoryStore` over it, and the handlers wired to that store. The
 * connection stand-in supplies `transaction()` because `node:sqlite` has none.
 */
function buildRealStoreHandlers(workspaceFolders: string[]): RealStoreHarness {
  const raw = openRawTestDb();
  openRawDbs.push(raw);
  raw.exec('PRAGMA foreign_keys = ON');
  for (const migration of [...MIGRATIONS].sort(
    (a, b) => a.version - b.version,
  )) {
    if (migration.sql) raw.exec(migration.sql);
  }
  const db = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    close: () => raw.close(),
    transaction:
      <T extends (...args: unknown[]) => unknown>(fn: T) =>
      (...args: unknown[]) => {
        raw.exec('BEGIN');
        try {
          const out = fn(...args);
          raw.exec('COMMIT');
          return out;
        } catch (error: unknown) {
          raw.exec('ROLLBACK');
          throw error;
        }
      },
  };
  const connection = {
    db,
    isOpen: true,
    vecExtensionLoaded: false,
    handleFatalWriteError: () => undefined,
  } as unknown as SqliteConnectionService;
  const store = new MemoryStore(
    makeLogger() as unknown as Logger,
    connection,
    { embed: jest.fn(), dim: 384 } as unknown as IEmbedder,
    { available: false } as unknown as VecStatusService,
  );
  const { rpcHandler } = buildHandlersWithStore(workspaceFolders, store);
  return { raw, rpcHandler };
}

function seedMemory(
  raw: RawTestDb,
  id: string,
  workspaceRoot: string | null,
  quarantined: boolean,
): void {
  raw
    .prepare(
      `INSERT INTO memories (
         id, session_id, workspace_root, tier, kind, subject, content,
         source_message_ids, salience, decay_rate, hits, pinned,
         created_at, updated_at, last_used_at, expires_at,
         type, concepts_json, files_json, quarantined_at, quarantine_reason
       ) VALUES (?, NULL, ?, 'recall', 'fact', ?, ?, '[]', 0.5, 0.01, 0, 0,
         1000, 1000, 1000, NULL, 'discovery', '[]', '[]', ?, ?)`,
    )
    .run(
      id,
      workspaceRoot,
      `subject ${id}`,
      `content of ${id}`,
      quarantined ? 5000 : null,
      quarantined ? REASON : null,
    );
  raw
    .prepare(
      `INSERT INTO memory_chunks (id, memory_id, ord, text, token_count, created_at)
       VALUES (?, ?, 0, ?, 3, 1000)`,
    )
    .run(`${id}-chunk-0`, id, `content of ${id}`);
}

function quarantineState(raw: RawTestDb, id: string) {
  return raw
    .prepare(
      'SELECT quarantined_at, quarantine_reason, hits FROM memories WHERE id = ?',
    )
    .get(id) as {
    quarantined_at: number | null;
    quarantine_reason: string | null;
    hits: number;
  };
}

/** One NULL-scope and one named-scope quarantined row, plus an active control. */
function seedScopes(raw: RawTestDb): void {
  seedMemory(raw, 'q-null', null, true);
  seedMemory(raw, 'q-named', WS, true);
  seedMemory(raw, 'active-named', WS, false);
}

describe('MemoryRpcHandlers — memory:pin / memory:unpin report whether a row matched', () => {
  it.each([
    ['memory:pin', true],
    ['memory:unpin', false],
  ] as const)('%s succeeds for an active row', async (method, pinned) => {
    const { rpcHandler, store } = buildHandlers();
    store.setPinned.mockReturnValue(true);

    const result = await rpcHandler.call(method, { id: 'mem-1' });

    expect(store.setPinned).toHaveBeenCalledWith('mem-1', pinned);
    expect(result).toEqual({ success: true, pinned });
  });

  it.each(['memory:pin', 'memory:unpin'])(
    '%s reports no success when no active row matched (missing or quarantined)',
    async (method) => {
      const { rpcHandler, store } = buildHandlers();
      store.setPinned.mockReturnValue(false);

      const result = await rpcHandler.call(method, { id: 'quarantined' });

      expect(result).toEqual({ success: false, pinned: false });
    },
  );
});

describe('MemoryRpcHandlers — quarantine surface against a real store', () => {
  afterEach(() => {
    for (const raw of openRawDbs.splice(0)) raw.close();
  });

  it('an explicit null restore lifts only the unscoped row', async () => {
    const { raw, rpcHandler } = buildRealStoreHandlers([WS]);
    seedScopes(raw);

    const result = await rpcHandler.call('memory:restoreQuarantined', {
      workspaceRoot: null,
      all: true,
    });

    expect(result).toEqual({ restored: 1 });
    expect(quarantineState(raw, 'q-null')).toMatchObject({
      quarantined_at: null,
      quarantine_reason: null,
    });
    expect(quarantineState(raw, 'q-named')).toMatchObject({
      quarantined_at: 5000,
      quarantine_reason: REASON,
    });
  });

  it('a named restore lifts only that workspace, never the unscoped row', async () => {
    const { raw, rpcHandler } = buildRealStoreHandlers([WS]);
    seedScopes(raw);

    const result = await rpcHandler.call('memory:restoreQuarantined', {
      workspaceRoot: WS,
      reason: REASON,
    });

    expect(result).toEqual({ restored: 1 });
    expect(quarantineState(raw, 'q-named').quarantined_at).toBeNull();
    expect(quarantineState(raw, 'q-null')).toMatchObject({
      quarantined_at: 5000,
      quarantine_reason: REASON,
    });
  });

  it('lists by scope tri-state with workspaceRoot on every item', async () => {
    const { raw, rpcHandler } = buildRealStoreHandlers([WS]);
    seedScopes(raw);

    type ListResult = {
      items: Array<{ id: string; workspaceRoot: string | null }>;
      total: number;
    };
    const all = (await rpcHandler.call('memory:listQuarantined', {
      scope: 'all',
    })) as ListResult;
    const unscoped = (await rpcHandler.call('memory:listQuarantined', {
      workspaceRoot: null,
    })) as ListResult;
    const current = (await rpcHandler.call(
      'memory:listQuarantined',
      {},
    )) as ListResult;

    expect(all.total).toBe(2);
    expect(
      all.items
        .map((item) => [item.id, item.workspaceRoot])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ).toEqual([
      ['q-named', WS],
      ['q-null', null],
    ]);
    expect(unscoped.items).toEqual([
      expect.objectContaining({
        id: 'q-null',
        workspaceRoot: null,
        reason: REASON,
        excerpt: 'content of q-null',
      }),
    ]);
    expect(current.items.map((item) => item.id)).toEqual(['q-named']);
    expect(current.items[0].workspaceRoot).toBe(WS);
  });

  it('memory:get reads a quarantined id as missing, then the memory after restore', async () => {
    const { raw, rpcHandler } = buildRealStoreHandlers([WS]);
    seedScopes(raw);

    const before = await rpcHandler.call('memory:get', { id: 'q-named' });
    expect(before).toEqual({ memory: null, chunks: [] });
    expect(quarantineState(raw, 'q-named').hits).toBe(0);

    await rpcHandler.call('memory:restoreQuarantined', {
      workspaceRoot: WS,
      ids: ['q-named'],
    });
    const after = (await rpcHandler.call('memory:get', {
      id: 'q-named',
    })) as { memory: { id: string } | null; chunks: unknown[] };

    expect(after.memory).toMatchObject({ id: 'q-named', workspaceRoot: WS });
    expect(after.chunks).toHaveLength(1);
    expect(quarantineState(raw, 'q-named').hits).toBe(1);
  });

  it('memory:pin on a quarantined id reports no success and pins nothing', async () => {
    const { raw, rpcHandler } = buildRealStoreHandlers([WS]);
    seedScopes(raw);

    const quarantined = await rpcHandler.call('memory:pin', { id: 'q-named' });
    const missing = await rpcHandler.call('memory:unpin', { id: 'no-such-id' });
    const active = await rpcHandler.call('memory:pin', { id: 'active-named' });

    expect(quarantined).toEqual({ success: false, pinned: false });
    expect(missing).toEqual({ success: false, pinned: false });
    expect(active).toEqual({ success: true, pinned: true });
    const pinnedOf = (id: string) =>
      (
        raw.prepare('SELECT pinned FROM memories WHERE id = ?').get(id) as {
          pinned: number;
        }
      ).pinned;
    expect(pinnedOf('q-named')).toBe(0);
    expect(pinnedOf('active-named')).toBe(1);
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
