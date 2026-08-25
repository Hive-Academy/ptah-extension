/**
 * update-rpc.handlers.spec.ts
 *
 * Unit tests for UpdateRpcHandlers — the RPC methods backing the desktop
 * update dialog:
 *
 *   update:get-state — returns the current lifecycle state (race-proof hydration)
 *   update:check-now — triggers an immediate GitHub Releases check
 *   update:mark-downloaded — stops later checks prompting for one version
 *
 * Strategy:
 *   - Construct UpdateRpcHandlers directly (no DI container) by passing mocks.
 *   - Use createMockRpcHandler() so register() calls can be exercised end-to-end
 *     via handleMessage().
 *
 * The updater mock is typed as the IAppUpdater port. While this class lived in
 * apps/ptah-electron the spec had to load it through a `require()` shim and
 * cast the mock to `never`, because the constructor named the concrete
 * Electron-local UpdateManager. Behind the port that is a plain import
 * (TASK_2026_171 risk R10); the five cases below are otherwise unchanged.
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
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import type {
  AppUpdateState,
  IAppUpdater,
} from '@ptah-extension/platform-core';
import type { UpdateLifecycleState } from '@ptah-extension/shared';

import { UpdateRpcHandlers } from './update-rpc.handlers';

// ---------------------------------------------------------------------------
// Mock IAppUpdater
// ---------------------------------------------------------------------------

interface MockAppUpdater extends IAppUpdater {
  triggerCheck: jest.Mock;
  getCurrentState: jest.Mock;
  markDownloaded: jest.Mock;
}

function createMockAppUpdater(
  stateOverride: AppUpdateState = { state: 'idle' },
): MockAppUpdater {
  return {
    triggerCheck: jest.fn().mockResolvedValue(undefined),
    getCurrentState: jest.fn().mockReturnValue(stateOverride),
    markDownloaded: jest.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UpdateRpcHandlers', () => {
  let logger: MockLogger;
  let rpcHandler: MockRpcHandler;
  let updateManager: MockAppUpdater;

  beforeEach(() => {
    logger = createMockLogger();
    rpcHandler = createMockRpcHandler();
    updateManager = createMockAppUpdater();
  });

  function buildHandlers(state: AppUpdateState = { state: 'idle' }) {
    updateManager = createMockAppUpdater(state);
    const handlers = new UpdateRpcHandlers(
      logger as unknown as Logger,
      rpcHandler as unknown as RpcHandler,
      updateManager,
    );
    handlers.register();
    return { handlers, rpcHandler };
  }

  describe('update:get-state', () => {
    it('returns the current lifecycle state from updateManager', async () => {
      const { rpcHandler } = buildHandlers({
        state: 'available',
        currentVersion: '0.1.48',
        newVersion: '0.1.49',
        downloadUrl: 'https://dl/0.1.49.exe',
        releaseUrl: 'https://gh/electron-v0.1.49',
      });

      const raw = await rpcHandler.handleMessage({
        method: 'update:get-state',
        params: {},
        correlationId: 'c-get-state',
      });

      expect(raw.success).toBe(true);
      const data = raw.data as { state: UpdateLifecycleState };
      expect(data.state).toEqual({
        state: 'available',
        currentVersion: '0.1.48',
        newVersion: '0.1.49',
        downloadUrl: 'https://dl/0.1.49.exe',
        releaseUrl: 'https://gh/electron-v0.1.49',
      });
      expect(updateManager.getCurrentState).toHaveBeenCalledTimes(1);
    });

    it('returns { state: "idle" } when no update activity has occurred', async () => {
      const { rpcHandler } = buildHandlers({ state: 'idle' });

      const raw = await rpcHandler.handleMessage({
        method: 'update:get-state',
        params: {},
        correlationId: 'c-get-state-idle',
      });

      const data = raw.data as { state: UpdateLifecycleState };
      expect(data.state).toEqual({ state: 'idle' });
    });
  });

  describe('update:check-now', () => {
    it('calls updateManager.triggerCheck() and returns { success: true }', async () => {
      const { rpcHandler } = buildHandlers();

      const raw = await rpcHandler.handleMessage({
        method: 'update:check-now',
        params: {},
        correlationId: 'c-check-happy',
      });

      expect(raw.success).toBe(true);
      const data = raw.data as Record<string, unknown>;
      expect(data['success']).toBe(true);
      expect(updateManager.triggerCheck).toHaveBeenCalledTimes(1);
    });

    it('returns { success: false, error } inside data when triggerCheck throws', async () => {
      const { rpcHandler } = buildHandlers();
      updateManager.triggerCheck.mockRejectedValue(
        new Error('Network unreachable'),
      );

      const raw = await rpcHandler.handleMessage({
        method: 'update:check-now',
        params: {},
        correlationId: 'c-check-error',
      });

      expect(raw.success).toBe(true);
      const data = raw.data as Record<string, unknown>;
      expect(data['success']).toBe(false);
      expect(data['error']).toBe('Network unreachable');
      expect(updateManager.triggerCheck).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('[UpdateRpcHandlers] update:check-now failed'),
        expect.any(Error),
      );
    });

    it('does not throw to the RPC boundary when triggerCheck rejects', async () => {
      const { rpcHandler } = buildHandlers();
      updateManager.triggerCheck.mockRejectedValue(new Error('timeout'));

      await expect(
        rpcHandler.handleMessage({
          method: 'update:check-now',
          params: {},
          correlationId: 'c1',
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('update:mark-downloaded', () => {
    it('forwards the version to updateManager.markDownloaded()', async () => {
      const { rpcHandler } = buildHandlers();

      const raw = await rpcHandler.handleMessage({
        method: 'update:mark-downloaded',
        params: { version: '0.1.49' },
        correlationId: 'c-mark',
      });

      expect(raw.success).toBe(true);
      expect((raw.data as Record<string, unknown>)['success']).toBe(true);
      expect(updateManager.markDownloaded).toHaveBeenCalledWith('0.1.49');
    });

    it('rejects a missing version at the schema boundary', async () => {
      const { rpcHandler } = buildHandlers();

      const raw = await rpcHandler.handleMessage({
        method: 'update:mark-downloaded',
        params: {},
        correlationId: 'c-mark-missing',
      });

      expect(raw.success).toBe(false);
      expect(updateManager.markDownloaded).not.toHaveBeenCalled();
    });

    it('rejects an empty version at the schema boundary', async () => {
      const { rpcHandler } = buildHandlers();

      const raw = await rpcHandler.handleMessage({
        method: 'update:mark-downloaded',
        params: { version: '' },
        correlationId: 'c-mark-empty',
      });

      expect(raw.success).toBe(false);
      expect(updateManager.markDownloaded).not.toHaveBeenCalled();
    });
  });
});
