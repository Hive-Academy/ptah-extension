/**
 * update-rpc.handlers.spec.ts
 *
 * Unit tests for UpdateRpcHandlers — the Electron-local RPC methods backing
 * the desktop update banner:
 *
 *   update:get-state — returns the current lifecycle state (race-proof hydration)
 *   update:check-now — triggers an immediate GitHub Releases check
 *
 * Strategy:
 *   - Construct UpdateRpcHandlers directly (no DI container) by passing mocks.
 *   - Use createMockRpcHandler() so register() calls can be exercised end-to-end
 *     via handleMessage().
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
import type { Logger } from '@ptah-extension/vscode-core';
import type { RpcHandler } from '@ptah-extension/vscode-core';
import type { UpdateLifecycleState } from '@ptah-extension/shared';

// ---------------------------------------------------------------------------
// Mock UpdateManager
// ---------------------------------------------------------------------------

interface MockUpdateManager {
  triggerCheck: jest.Mock;
  getCurrentState: jest.Mock<UpdateLifecycleState>;
}

function createMockUpdateManager(
  stateOverride: UpdateLifecycleState = { state: 'idle' },
): MockUpdateManager {
  return {
    triggerCheck: jest.fn().mockResolvedValue(undefined),
    getCurrentState: jest
      .fn<UpdateLifecycleState, []>()
      .mockReturnValue(stateOverride),
  };
}

// ---------------------------------------------------------------------------
// Import class under test
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UpdateRpcHandlers } = require('./update-rpc.handlers') as {
  UpdateRpcHandlers: new (
    logger: Logger,
    rpcHandler: RpcHandler,
    updateManager: MockUpdateManager,
  ) => { register(): void };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UpdateRpcHandlers', () => {
  let logger: MockLogger;
  let rpcHandler: MockRpcHandler;
  let updateManager: MockUpdateManager;

  beforeEach(() => {
    logger = createMockLogger();
    rpcHandler = createMockRpcHandler();
    updateManager = createMockUpdateManager();
  });

  function buildHandlers(state: UpdateLifecycleState = { state: 'idle' }) {
    updateManager = createMockUpdateManager(state);
    const handlers = new UpdateRpcHandlers(
      logger as unknown as Logger,
      rpcHandler as unknown as RpcHandler,
      updateManager as never,
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
});
