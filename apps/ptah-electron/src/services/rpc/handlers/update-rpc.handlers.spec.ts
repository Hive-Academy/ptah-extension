/**
 * update-rpc.handlers.spec.ts
 *
 * Unit tests for UpdateRpcHandlers — the two Electron-local RPC methods
 * that front the auto-update lifecycle:
 *
 *   update:check-now   — triggers an immediate update check via UpdateManager
 *   update:install-now — calls autoUpdater.quitAndInstall() when state=downloaded;
 *                        returns structured UPDATE_NOT_READY error otherwise
 *
 * Strategy:
 *   - Construct UpdateRpcHandlers directly (no DI container) by passing mocks.
 *   - Use createMockRpcHandler() so register() calls can be exercised end-to-end
 *     via handleMessage().
 *   - Mock 'electron-updater' to intercept quitAndInstall() calls without
 *     a real Electron process.
 *
 * TASK_2026_117: Batch 5, Task 5.3
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
// Mock electron-updater
// ---------------------------------------------------------------------------

const mockQuitAndInstall = jest.fn();
const mockAutoUpdater = {
  quitAndInstall: mockQuitAndInstall,
};

jest.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater,
}));

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
// Helper: call an RPC method via the MockRpcHandler
// ---------------------------------------------------------------------------

async function call<TResult>(
  rpcHandler: MockRpcHandler,
  method: string,
  params: Record<string, unknown> = {},
): Promise<{
  success: boolean;
  data?: TResult;
  error?: string;
  code?: string;
}> {
  const response = await rpcHandler.handleMessage({
    method,
    params,
    correlationId: `test-${method}`,
  });
  const responseAny = response as unknown as Record<string, unknown>;
  return {
    success: response.success,
    data: response.data as TResult | undefined,
    error: response.error,
    code: responseAny['errorCode'] as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// Import class under test (after mocks are set up)
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
    mockQuitAndInstall.mockClear();
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

  // -------------------------------------------------------------------------
  // update:check-now
  // -------------------------------------------------------------------------

  describe('update:check-now', () => {
    it('calls updateManager.triggerCheck() and returns { success: true }', async () => {
      const { rpcHandler } = buildHandlers();

      const raw = await rpcHandler.handleMessage({
        method: 'update:check-now',
        params: {},
        correlationId: 'c-check-happy',
      });

      // MockRpcHandler wraps handler return in { success: true, data: ... }
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

      // Handler catches the error and returns structured failure — not an RPC throw
      expect(raw.success).toBe(true);
      const data = raw.data as Record<string, unknown>;
      expect(data['success']).toBe(false);
      expect(data['error']).toBe('Network unreachable');
      expect(updateManager.triggerCheck).toHaveBeenCalledTimes(1);
    });

    it('does not throw to the RPC boundary when triggerCheck rejects', async () => {
      const { rpcHandler } = buildHandlers();
      updateManager.triggerCheck.mockRejectedValue(new Error('timeout'));

      // handleMessage itself must not throw — error is returned structurally
      await expect(
        rpcHandler.handleMessage({
          method: 'update:check-now',
          params: {},
          correlationId: 'c1',
        }),
      ).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // update:install-now
  // -------------------------------------------------------------------------

  describe('update:install-now', () => {
    it('calls autoUpdater.quitAndInstall() when state is "downloaded"', async () => {
      const { rpcHandler } = buildHandlers({
        state: 'downloaded',
        currentVersion: '1.0.0',
        newVersion: '1.1.0',
      });

      const raw = await rpcHandler.handleMessage({
        method: 'update:install-now',
        params: {},
        correlationId: 'c-install-downloaded',
      });

      expect(mockQuitAndInstall).toHaveBeenCalledTimes(1);
      // MockRpcHandler wraps handler return in { success: true, data: ... }
      expect(raw.success).toBe(true);
      const data = raw.data as Record<string, unknown>;
      expect(data['success']).toBe(true);
    });

    it('returns { success: false, code: "UPDATE_NOT_READY" } in data when state is "idle"', async () => {
      const { rpcHandler } = buildHandlers({ state: 'idle' });

      const raw = await rpcHandler.handleMessage({
        method: 'update:install-now',
        params: {},
        correlationId: 'c-install-idle',
      });

      // Handler returns structured error object — MockRpcHandler wraps it as success:true, data:{...}
      expect(raw.success).toBe(true);
      const data = raw.data as Record<string, unknown>;
      expect(data['success']).toBe(false);
      expect(data['code']).toBe('UPDATE_NOT_READY');
    });

    it('does NOT call quitAndInstall() when state is not "downloaded"', async () => {
      const states: UpdateLifecycleState[] = [
        { state: 'idle' },
        { state: 'checking' },
        { state: 'available', currentVersion: '1.0.0', newVersion: '1.1.0' },
        {
          state: 'downloading',
          currentVersion: '1.0.0',
          newVersion: '1.1.0',
          percent: 50,
          bytesPerSecond: 1000,
          transferred: 500,
          total: 1000,
        },
        { state: 'error', message: 'some error' },
      ];

      for (const state of states) {
        mockQuitAndInstall.mockClear();
        const { rpcHandler } = buildHandlers(state);

        await rpcHandler.handleMessage({
          method: 'update:install-now',
          params: {},
          correlationId: `c-not-downloaded-${state.state}`,
        });

        expect(mockQuitAndInstall).not.toHaveBeenCalled();
      }
    });

    it('returned error data includes error message when state is not "downloaded"', async () => {
      const { rpcHandler } = buildHandlers({ state: 'checking' });

      const raw = await rpcHandler.handleMessage({
        method: 'update:install-now',
        params: {},
        correlationId: 'c-install-checking',
      });

      expect(raw.success).toBe(true); // handler returns structured error, not an RPC throw
      const data = raw.data as Record<string, unknown>;
      expect(data['success']).toBe(false);
      expect(data['code']).toBe('UPDATE_NOT_READY');
      expect(typeof data['error']).toBe('string');
    });

    it('reads state synchronously from updateManager.getCurrentState()', async () => {
      const { rpcHandler } = buildHandlers({
        state: 'available',
        currentVersion: '1.0.0',
        newVersion: '1.1.0',
      });

      await rpcHandler.handleMessage({
        method: 'update:install-now',
        params: {},
        correlationId: 'c-sync-state',
      });

      expect(updateManager.getCurrentState).toHaveBeenCalledTimes(1);
      expect(mockQuitAndInstall).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // FIX 3: quitAndInstall() wrapped in try/catch
    // -----------------------------------------------------------------------

    it('FIX 3 — returns { success: false, code: "INSTALL_FAILED" } when quitAndInstall throws', async () => {
      mockQuitAndInstall.mockImplementation(() => {
        throw new Error('elevation required');
      });

      const { rpcHandler } = buildHandlers({
        state: 'downloaded',
        currentVersion: '1.0.0',
        newVersion: '1.1.0',
      });

      const raw = await rpcHandler.handleMessage({
        method: 'update:install-now',
        params: {},
        correlationId: 'c-install-throws',
      });

      // Handler must NOT throw to the RPC boundary — it returns structured failure
      expect(raw.success).toBe(true);
      const data = raw.data as Record<string, unknown>;
      expect(data['success']).toBe(false);
      expect(data['code']).toBe('INSTALL_FAILED');
      expect(typeof data['error']).toBe('string');
      expect(data['error']).toContain('elevation required');

      // quitAndInstall was still called (the throw came from inside it)
      expect(mockQuitAndInstall).toHaveBeenCalledTimes(1);
    });

    it('FIX 3 — logs an error when quitAndInstall throws', async () => {
      mockQuitAndInstall.mockImplementation(() => {
        throw new Error('code sign failure');
      });

      const { rpcHandler } = buildHandlers({
        state: 'downloaded',
        currentVersion: '1.0.0',
        newVersion: '1.1.0',
      });

      await rpcHandler.handleMessage({
        method: 'update:install-now',
        params: {},
        correlationId: 'c-install-log',
      });

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('[UpdateRpcHandlers] quitAndInstall failed'),
        expect.any(Error),
      );
    });
  });
});
