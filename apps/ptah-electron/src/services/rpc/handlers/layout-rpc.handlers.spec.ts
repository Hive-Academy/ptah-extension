/**
 * layout-rpc.handlers.spec.ts
 *
 * CHARACTERIZATION tests for LayoutRpcHandlers — the Electron-local RPC
 * methods backing desktop layout persistence:
 *
 *   layout:persist — save layout state to IStateStorage
 *   layout:restore — restore saved layout state from IStateStorage
 *
 * These tests exist to PIN current behavior before the P3 handler-unification
 * move (TASK_2026_171), not to validate "correct" behavior. Two odd bits are
 * deliberately pinned as-is even though they look wrong:
 *
 *   - Both methods swallow storage errors and still return `{ success: true }`
 *     (layout-rpc.handlers.ts:50-56 and :72-78). A caller cannot distinguish
 *     "persisted" from "silently failed to persist" via the RPC response.
 *   - layout:restore spreads saved fields at the TOP LEVEL of the result
 *     (`{ success: true, ...saved }`), not nested under a `data` key.
 *
 * Strategy: construct LayoutRpcHandlers directly (no DI container) using
 * `createMockRpcHandler()` so register() calls can be exercised end-to-end
 * via handleMessage(), mirroring update-rpc.handlers.spec.ts in this
 * directory.
 */

import 'reflect-metadata';

import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import {
  createMockStateStorage,
  type MockStateStorage,
  type MockStateStorageOverrides,
} from '@ptah-extension/platform-core/testing';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import type { IStateStorage } from '@ptah-extension/platform-core';

import { LayoutRpcHandlers } from './layout-rpc.handlers';

/** Mirrors the private `LAYOUT_STORAGE_KEY` constant in layout-rpc.handlers.ts:18. */
const LAYOUT_STORAGE_KEY = 'electron.layout.state';

describe('LayoutRpcHandlers', () => {
  let logger: MockLogger;
  let rpcHandler: MockRpcHandler;
  let stateStorage: MockStateStorage;

  function buildHandlers(overrides?: MockStateStorageOverrides) {
    logger = createMockLogger();
    rpcHandler = createMockRpcHandler();
    stateStorage = createMockStateStorage(overrides);

    const handlers = new LayoutRpcHandlers(
      logger as unknown as Logger,
      rpcHandler as unknown as RpcHandler,
      stateStorage as unknown as IStateStorage,
    );
    handlers.register();
    return { handlers, rpcHandler, stateStorage };
  }

  describe('layout:persist', () => {
    it('persists non-empty params and returns { success: true }', async () => {
      const { rpcHandler, stateStorage } = buildHandlers();

      const raw = await rpcHandler.handleMessage({
        method: 'layout:persist',
        params: { sidebarWidth: 280 },
        correlationId: 'c-persist-happy',
      });

      expect(raw.success).toBe(true);
      const data = raw.data as Record<string, unknown>;
      expect(data['success']).toBe(true);
      expect(stateStorage.update).toHaveBeenCalledTimes(1);
      expect(stateStorage.update).toHaveBeenCalledWith(LAYOUT_STORAGE_KEY, {
        sidebarWidth: 280,
      });
    });

    it('does not call storage.update for undefined or empty params, yet still returns { success: true }', async () => {
      const { rpcHandler, stateStorage } = buildHandlers();

      const rawUndefined = await rpcHandler.handleMessage({
        method: 'layout:persist',
        params: undefined,
        correlationId: 'c-persist-undefined',
      });
      const rawEmpty = await rpcHandler.handleMessage({
        method: 'layout:persist',
        params: {},
        correlationId: 'c-persist-empty',
      });

      expect(stateStorage.update).not.toHaveBeenCalled();
      expect((rawUndefined.data as Record<string, unknown>)['success']).toBe(
        true,
      );
      expect((rawEmpty.data as Record<string, unknown>)['success']).toBe(true);
    });

    it('CHARACTERIZATION: swallows a storage.update failure and still returns { success: true }', async () => {
      const { rpcHandler, stateStorage } = buildHandlers({
        update: async () => {
          throw new Error('disk full');
        },
      });

      const raw = await rpcHandler.handleMessage({
        method: 'layout:persist',
        params: { sidebarWidth: 280 },
        correlationId: 'c-persist-error',
      });

      expect(stateStorage.update).toHaveBeenCalledTimes(1);
      // Pinned as-is: a persistence failure is reported as success, not failure.
      expect(raw.success).toBe(true);
      const data = raw.data as Record<string, unknown>;
      expect(data['success']).toBe(true);
      expect(logger.error).toHaveBeenCalledWith(
        '[Electron RPC] layout:persist failed',
        expect.any(Error),
      );
    });
  });

  describe('layout:restore', () => {
    it('returns { success: true, ...saved } with saved fields spread at the TOP level', async () => {
      const { rpcHandler } = buildHandlers({
        seed: {
          [LAYOUT_STORAGE_KEY]: { sidebarWidth: 280, editorWidth: 600 },
        },
      });

      const raw = await rpcHandler.handleMessage({
        method: 'layout:restore',
        params: {},
        correlationId: 'c-restore-happy',
      });

      expect(raw.success).toBe(true);
      // Pinned exact shape: fields are spread onto the result, not nested
      // under a `data`/`state` key.
      expect(raw.data).toEqual({
        success: true,
        sidebarWidth: 280,
        editorWidth: 600,
      });
    });

    it('returns bare { success: true } when no saved state exists', async () => {
      const { rpcHandler } = buildHandlers();

      const raw = await rpcHandler.handleMessage({
        method: 'layout:restore',
        params: {},
        correlationId: 'c-restore-empty',
      });

      expect(raw.data).toEqual({ success: true });
    });

    it('CHARACTERIZATION: swallows a storage.get failure and still returns { success: true }', async () => {
      const { rpcHandler } = buildHandlers({
        get: () => {
          throw new Error('read error');
        },
      });

      const raw = await rpcHandler.handleMessage({
        method: 'layout:restore',
        params: {},
        correlationId: 'c-restore-error',
      });

      // Pinned as-is: a read failure is reported as success, not failure.
      expect(raw.success).toBe(true);
      expect(raw.data).toEqual({ success: true });
      expect(logger.error).toHaveBeenCalledWith(
        '[Electron RPC] layout:restore failed',
        expect.any(Error),
      );
    });
  });

  it('register() registers exactly layout:persist and layout:restore', () => {
    const { rpcHandler } = buildHandlers();

    expect(rpcHandler.registerMethod).toHaveBeenCalledTimes(2);
    expect(rpcHandler.registerMethod).toHaveBeenCalledWith(
      'layout:persist',
      expect.any(Function),
    );
    expect(rpcHandler.registerMethod).toHaveBeenCalledWith(
      'layout:restore',
      expect.any(Function),
    );
  });
});
