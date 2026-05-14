/**
 * Unit tests for MemoryRpcHandlers — `memory:purgeBySubjectPattern` (TASK_2026_119 Batch 5).
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
import { TOKENS, RpcUserError } from '@ptah-extension/vscode-core';
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
    stats: jest.fn().mockReturnValue({ total: 0, byTier: {} }),
    purgeBySubjectPattern: jest.fn().mockReturnValue(0),
  };
}

function makeMemorySearch() {
  return {
    searchRich: jest.fn().mockResolvedValue({ hits: [], bm25Only: false }),
  };
}

function makeMemoryCurator() {
  return {};
}

// ---------------------------------------------------------------------------
// Test setup helper
// ---------------------------------------------------------------------------

function buildHandlers(workspaceFolders: string[] = ['/workspace/project']) {
  const logger = makeLogger();
  const rpcHandler = makeRpcHandler();
  const store = makeMemoryStore();
  const search = makeMemorySearch();
  const curator = makeMemoryCurator();
  const workspaceProvider: MockWorkspaceProvider = createMockWorkspaceProvider({
    folders: workspaceFolders,
  });

  const child = container.createChildContainer();
  child.registerInstance(TOKENS.LOGGER, logger);
  child.registerInstance(TOKENS.RPC_HANDLER, rpcHandler);
  child.registerInstance(MEMORY_TOKENS.MEMORY_STORE, store);
  child.registerInstance(MEMORY_TOKENS.MEMORY_SEARCH, search);
  child.registerInstance(MEMORY_TOKENS.MEMORY_CURATOR, curator);
  child.registerInstance(PLATFORM_TOKENS.WORKSPACE_PROVIDER, workspaceProvider);
  child.register(MemoryRpcHandlers, { useClass: MemoryRpcHandlers });

  const handlers = child.resolve(MemoryRpcHandlers);
  handlers.register();

  return { handlers, rpcHandler, store, logger, workspaceProvider };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
