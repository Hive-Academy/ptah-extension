/**
 * update-manager.spec.ts
 *
 * Unit tests for UpdateManager — the Electron main-process auto-update
 * orchestrator wrapping electron-updater.
 *
 * Strategy:
 *   - Mock 'electron-updater' with an EventEmitter-based autoUpdater so that
 *     listener tests can fire events synchronously.
 *   - Mock 'fetch' globally to control fetchReleaseNotes() behaviour.
 *   - Use jest fake timers for the 4h interval and the 5s fetch timeout.
 *   - Instantiate UpdateManager directly (no DI container).
 *
 * TASK_2026_117: Batch 5, Task 5.1
 */

import 'reflect-metadata';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// EventEmitter-based autoUpdater mock
// ---------------------------------------------------------------------------

class MockAutoUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  currentVersion = { version: '1.0.0' };

  checkForUpdates = jest.fn().mockResolvedValue(undefined);
  quitAndInstall = jest.fn();
}

const mockAutoUpdater = new MockAutoUpdater();

jest.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater,
}));

// ---------------------------------------------------------------------------
// Import class under test (after mocks)
// ---------------------------------------------------------------------------

import { UpdateManager } from './update-manager';
import type { UpdateLifecycleState } from '@ptah-extension/shared';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

// ---------------------------------------------------------------------------
// DI stub factories
// ---------------------------------------------------------------------------

function makeLogger() {
  return {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function makeWebviewManager() {
  return {
    broadcastMessage: jest.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Helper: create an UpdateManager instance with no DI container
// ---------------------------------------------------------------------------

function createUpdateManager(
  overrides: {
    logger?: ReturnType<typeof makeLogger>;
    webviewManager?: ReturnType<typeof makeWebviewManager>;
  } = {},
) {
  const logger = overrides.logger ?? makeLogger();
  const webviewManager = overrides.webviewManager ?? makeWebviewManager();
  const manager = new UpdateManager(webviewManager as never, logger as never);
  return { manager, logger, webviewManager };
}

// ---------------------------------------------------------------------------
// Reset autoUpdater state between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Remove all listeners so tests are isolated
  mockAutoUpdater.removeAllListeners();
  mockAutoUpdater.checkForUpdates.mockReset().mockResolvedValue(undefined);
  mockAutoUpdater.quitAndInstall.mockReset();
  mockAutoUpdater.currentVersion = { version: '1.0.0' };
  // Reset NODE_ENV to production-like for most tests
  delete process.env['NODE_ENV'];
});

afterEach(() => {
  jest.useRealTimers();
  delete process.env['NODE_ENV'];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UpdateManager', () => {
  // -------------------------------------------------------------------------
  // Dev-mode gate
  // -------------------------------------------------------------------------

  describe('dev-mode gate', () => {
    it('returns early without registering listeners when NODE_ENV=development', async () => {
      process.env['NODE_ENV'] = 'development';
      const { manager, logger } = createUpdateManager();

      await manager.start();

      // Logger must mention the skip
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('development'),
      );
      // No listeners registered on autoUpdater
      expect(mockAutoUpdater.listenerCount('checking-for-update')).toBe(0);
      expect(mockAutoUpdater.listenerCount('update-available')).toBe(0);
      // No interval set
      expect(manager.getCheckInterval()).toBeNull();
    });

    it('does NOT call checkForUpdates when NODE_ENV=development', async () => {
      process.env['NODE_ENV'] = 'development';
      const { manager } = createUpdateManager();

      await manager.start();

      expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Listener registration
  // -------------------------------------------------------------------------

  describe('listener registration', () => {
    it('registers all 6 autoUpdater event listeners after start()', async () => {
      const { manager } = createUpdateManager();

      await manager.start();

      expect(mockAutoUpdater.listenerCount('checking-for-update')).toBe(1);
      expect(mockAutoUpdater.listenerCount('update-available')).toBe(1);
      expect(mockAutoUpdater.listenerCount('update-not-available')).toBe(1);
      expect(mockAutoUpdater.listenerCount('download-progress')).toBe(1);
      expect(mockAutoUpdater.listenerCount('update-downloaded')).toBe(1);
      expect(mockAutoUpdater.listenerCount('error')).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Event → UpdateLifecycleState broadcast
  // -------------------------------------------------------------------------

  describe('event to broadcast mapping', () => {
    it('checking-for-update event broadcasts { state: "checking" }', async () => {
      const { manager, webviewManager } = createUpdateManager();
      await manager.start();

      mockAutoUpdater.emit('checking-for-update');

      expect(webviewManager.broadcastMessage).toHaveBeenCalledWith(
        MESSAGE_TYPES.UPDATE_STATUS_CHANGED,
        expect.objectContaining({ state: 'checking' }),
      );
    });

    it('update-not-available event broadcasts { state: "idle" }', async () => {
      const { manager, webviewManager } = createUpdateManager();
      await manager.start();

      mockAutoUpdater.emit('update-not-available');

      expect(webviewManager.broadcastMessage).toHaveBeenCalledWith(
        MESSAGE_TYPES.UPDATE_STATUS_CHANGED,
        expect.objectContaining({ state: 'idle' }),
      );
    });

    it('error event broadcasts { state: "error", message }', async () => {
      const { manager, webviewManager } = createUpdateManager();
      await manager.start();

      mockAutoUpdater.emit('error', new Error('updater failed'));

      expect(webviewManager.broadcastMessage).toHaveBeenCalledWith(
        MESSAGE_TYPES.UPDATE_STATUS_CHANGED,
        expect.objectContaining({ state: 'error', message: 'updater failed' }),
      );
    });

    it('error event with non-Error broadcasts stringified message', async () => {
      const { manager, webviewManager } = createUpdateManager();
      await manager.start();

      mockAutoUpdater.emit('error', 'string error value');

      expect(webviewManager.broadcastMessage).toHaveBeenCalledWith(
        MESSAGE_TYPES.UPDATE_STATUS_CHANGED,
        expect.objectContaining({
          state: 'error',
          message: 'string error value',
        }),
      );
    });

    it('download-progress event broadcasts { state: "downloading" } with progress fields', async () => {
      const { manager, webviewManager } = createUpdateManager();
      await manager.start();

      // Advance timestamp so throttle passes (first event always passes)
      jest.useFakeTimers();
      const progress = {
        percent: 50,
        bytesPerSecond: 1024,
        transferred: 5000,
        total: 10000,
      };
      mockAutoUpdater.emit('download-progress', progress);

      expect(webviewManager.broadcastMessage).toHaveBeenCalledWith(
        MESSAGE_TYPES.UPDATE_STATUS_CHANGED,
        expect.objectContaining({
          state: 'downloading',
          percent: 50,
          bytesPerSecond: 1024,
          transferred: 5000,
          total: 10000,
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // update-available → fetchReleaseNotes
  // -------------------------------------------------------------------------

  describe('update-available listener', () => {
    it('calls fetchReleaseNotes with info.version and includes result in payload', async () => {
      const { manager, webviewManager } = createUpdateManager();

      // Mock fetch to return a release body
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest
          .fn()
          .mockResolvedValue({ body: '## What is new\n- Feature A' }),
      } as unknown as Response);

      await manager.start();

      mockAutoUpdater.emit('update-available', {
        version: '2.0.0',
        releaseDate: '2026-01-01',
      });

      // fetchReleaseNotes is async — let promises settle
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));

      const broadcastedPayload =
        webviewManager.broadcastMessage.mock.calls.find(
          ([, payload]) =>
            (payload as UpdateLifecycleState).state === 'available',
        )?.[1] as
          | Extract<UpdateLifecycleState, { state: 'available' }>
          | undefined;

      expect(broadcastedPayload).toBeDefined();
      expect(broadcastedPayload?.newVersion).toBe('2.0.0');
      expect(broadcastedPayload?.releaseNotesMarkdown).toBe(
        '## What is new\n- Feature A',
      );
    });

    it('broadcasts with releaseNotesMarkdown=null when fetchReleaseNotes returns null', async () => {
      const { manager, webviewManager } = createUpdateManager();

      // fetchReleaseNotes returns null on non-ok response
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
      } as unknown as Response);

      await manager.start();

      mockAutoUpdater.emit('update-available', { version: '2.0.0' });

      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));

      const broadcastedPayload =
        webviewManager.broadcastMessage.mock.calls.find(
          ([, payload]) =>
            (payload as UpdateLifecycleState).state === 'available',
        )?.[1] as
          | Extract<UpdateLifecycleState, { state: 'available' }>
          | undefined;

      expect(broadcastedPayload).toBeDefined();
      expect(broadcastedPayload?.releaseNotesMarkdown).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // download-progress throttle
  // -------------------------------------------------------------------------

  describe('download-progress throttle', () => {
    it('emitting 20 rapid progress events (<100ms apart) only broadcasts first + final (percent>=99.9)', async () => {
      jest.useFakeTimers();
      const { manager, webviewManager } = createUpdateManager();
      await manager.start();

      // Emit first event — always forwarded because _lastProgressBroadcast = 0
      const firstProgress = {
        percent: 1,
        bytesPerSecond: 100,
        transferred: 100,
        total: 10000,
      };
      mockAutoUpdater.emit('download-progress', firstProgress);

      // Emit 18 events rapidly (no time advance) — all should be throttled
      for (let i = 2; i <= 19; i++) {
        mockAutoUpdater.emit('download-progress', {
          percent: i * 5,
          bytesPerSecond: 100,
          transferred: i * 100,
          total: 10000,
        });
      }

      // Emit final event with percent >= 99.9 — should always be forwarded
      const finalProgress = {
        percent: 100,
        bytesPerSecond: 100,
        transferred: 10000,
        total: 10000,
      };
      mockAutoUpdater.emit('download-progress', finalProgress);

      // Count only download-progress broadcasts
      const progressBroadcasts =
        webviewManager.broadcastMessage.mock.calls.filter(
          ([, payload]) =>
            (payload as UpdateLifecycleState).state === 'downloading',
        );

      // First event (always forwarded) + final event (percent=100 >= 99.9) = 2
      expect(progressBroadcasts).toHaveLength(2);

      // First broadcast: percent=1
      expect(
        (
          progressBroadcasts[0][1] as Extract<
            UpdateLifecycleState,
            { state: 'downloading' }
          >
        ).percent,
      ).toBe(1);

      // Final broadcast: percent=100
      expect(
        (
          progressBroadcasts[1][1] as Extract<
            UpdateLifecycleState,
            { state: 'downloading' }
          >
        ).percent,
      ).toBe(100);
    });

    it('broadcasts a progress event when 100ms have elapsed since last broadcast', async () => {
      jest.useFakeTimers();
      const { manager, webviewManager } = createUpdateManager();
      await manager.start();

      // First event
      mockAutoUpdater.emit('download-progress', {
        percent: 10,
        bytesPerSecond: 100,
        transferred: 100,
        total: 1000,
      });

      // Advance time by 100ms
      jest.advanceTimersByTime(100);

      // Second event after the throttle window — must be forwarded
      mockAutoUpdater.emit('download-progress', {
        percent: 20,
        bytesPerSecond: 100,
        transferred: 200,
        total: 1000,
      });

      const progressBroadcasts =
        webviewManager.broadcastMessage.mock.calls.filter(
          ([, payload]) =>
            (payload as UpdateLifecycleState).state === 'downloading',
        );

      expect(progressBroadcasts.length).toBeGreaterThanOrEqual(2);
    });
  });

  // -------------------------------------------------------------------------
  // start() idempotency
  // -------------------------------------------------------------------------

  describe('start() idempotency', () => {
    it('calling start() twice creates the interval only once', async () => {
      const { manager } = createUpdateManager();
      jest.useFakeTimers();

      await manager.start();
      const firstInterval = manager.getCheckInterval();

      await manager.start(); // second call — must be a no-op
      const secondInterval = manager.getCheckInterval();

      expect(firstInterval).not.toBeNull();
      // Same interval reference — no new timer was created
      expect(secondInterval).toBe(firstInterval);
    });

    it('registers listeners only once even if start() is called twice', async () => {
      const { manager } = createUpdateManager();

      await manager.start();
      const countAfterFirst = mockAutoUpdater.listenerCount(
        'checking-for-update',
      );

      await manager.start();
      const countAfterSecond = mockAutoUpdater.listenerCount(
        'checking-for-update',
      );

      expect(countAfterFirst).toBe(1);
      expect(countAfterSecond).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // dispose()
  // -------------------------------------------------------------------------

  describe('dispose()', () => {
    it('clears the interval and sets _checkInterval to null', async () => {
      jest.useFakeTimers();
      const { manager } = createUpdateManager();

      await manager.start();
      expect(manager.getCheckInterval()).not.toBeNull();

      manager.dispose();
      expect(manager.getCheckInterval()).toBeNull();
    });

    it('does not throw when called before start()', () => {
      const { manager } = createUpdateManager();
      expect(() => manager.dispose()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // getCurrentState()
  // -------------------------------------------------------------------------

  describe('getCurrentState()', () => {
    it('returns idle state initially', () => {
      const { manager } = createUpdateManager();
      expect(manager.getCurrentState()).toEqual({ state: 'idle' });
    });

    it('reflects the last broadcast state after an event', async () => {
      const { manager } = createUpdateManager();
      await manager.start();

      mockAutoUpdater.emit('checking-for-update');

      expect(manager.getCurrentState()).toEqual({ state: 'checking' });
    });

    it('reflects error state after error event', async () => {
      const { manager } = createUpdateManager();
      await manager.start();

      mockAutoUpdater.emit('error', new Error('disk full'));

      expect(manager.getCurrentState()).toEqual({
        state: 'error',
        message: 'disk full',
      });
    });
  });

  // -------------------------------------------------------------------------
  // error event
  // -------------------------------------------------------------------------

  describe('error event handling', () => {
    it('logs the error via logger.error()', async () => {
      const { manager, logger } = createUpdateManager();
      await manager.start();

      mockAutoUpdater.emit('error', new Error('test error'));

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('[UpdateManager]'),
        expect.any(Error),
      );
    });

    it('does not throw from the error event listener', async () => {
      const { manager } = createUpdateManager();
      await manager.start();

      expect(() =>
        mockAutoUpdater.emit('error', new Error('boom')),
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // fetchReleaseNotes
  // -------------------------------------------------------------------------

  describe('fetchReleaseNotes()', () => {
    afterEach(() => {
      // Restore global fetch after each test in this block
      if (jest.isMockFunction(global.fetch)) {
        jest.restoreAllMocks();
      }
    });

    it('happy path: returns the body field from GitHub Releases response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          body: '## Release notes\n- Fix A\n- Fix B',
        }),
      } as unknown as Response);

      const { manager } = createUpdateManager();
      const result = await manager.fetchReleaseNotes('2.5.0');

      expect(result).toBe('## Release notes\n- Fix A\n- Fix B');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('v2.5.0'),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('returns null when the GitHub API returns a non-2xx status', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
      } as unknown as Response);

      const { manager } = createUpdateManager();
      const result = await manager.fetchReleaseNotes('9.9.9');

      expect(result).toBeNull();
    });

    it('returns null when the response has no body field', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      } as unknown as Response);

      const { manager } = createUpdateManager();
      const result = await manager.fetchReleaseNotes('1.0.0');

      expect(result).toBeNull();
    });

    it('timeout: returns null when fetch never resolves (AbortController fires after 5s)', async () => {
      jest.useFakeTimers();

      // fetch that rejects when the abort signal fires
      global.fetch = jest
        .fn()
        .mockImplementation(
          (_url: unknown, init?: { signal?: AbortSignal }) => {
            return new Promise<Response>((_resolve, reject) => {
              if (init?.signal) {
                init.signal.addEventListener('abort', () => {
                  reject(
                    new DOMException(
                      'The operation was aborted.',
                      'AbortError',
                    ),
                  );
                });
              }
              // Never resolves on its own — abort signal drives rejection
            });
          },
        );

      const { manager } = createUpdateManager();
      const promise = manager.fetchReleaseNotes('1.0.0');

      // Advance past the 5-second AbortController timeout
      await jest.advanceTimersByTimeAsync(5001);

      const result = await promise;
      expect(result).toBeNull();
    });

    it('returns null on network error (fetch rejects)', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const { manager } = createUpdateManager();
      const result = await manager.fetchReleaseNotes('1.0.0');

      expect(result).toBeNull();
    });

    it('does not throw — all errors are swallowed and null is returned', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new TypeError('Failed to fetch'));

      const { manager } = createUpdateManager();
      await expect(manager.fetchReleaseNotes('1.0.0')).resolves.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 4h periodic interval
  // -------------------------------------------------------------------------

  describe('4-hour periodic check interval', () => {
    it('sets up the interval after start() and fires checkForUpdates periodically', async () => {
      jest.useFakeTimers();
      const { manager } = createUpdateManager();

      await manager.start();

      // Initial check is called once on startup
      const initialCallCount =
        mockAutoUpdater.checkForUpdates.mock.calls.length;

      // Advance by 4 hours
      jest.advanceTimersByTime(4 * 60 * 60 * 1000);

      // Should have fired the interval callback once more
      expect(mockAutoUpdater.checkForUpdates.mock.calls.length).toBeGreaterThan(
        initialCallCount,
      );
    });
  });

  // -------------------------------------------------------------------------
  // FIX 1: _pendingVersion carried into download-progress broadcasts
  // -------------------------------------------------------------------------

  describe('FIX 1 — _pendingVersion propagated to downloading state', () => {
    it('download-progress broadcast includes newVersion from prior update-available event', async () => {
      const { manager, webviewManager } = createUpdateManager();

      // Mock fetch so fetchReleaseNotes resolves quickly (404 → null)
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
      } as unknown as Response);

      await manager.start();

      // Emit update-available with a known version — caches _pendingVersion
      mockAutoUpdater.emit('update-available', { version: '1.2.3' });

      // Emit download-progress immediately after (before fetchReleaseNotes resolves)
      mockAutoUpdater.emit('download-progress', {
        percent: 42,
        bytesPerSecond: 500,
        transferred: 420,
        total: 1000,
      });

      // The downloading broadcast must have newVersion = '1.2.3' (not '')
      const downloadingCall = webviewManager.broadcastMessage.mock.calls.find(
        ([, payload]) =>
          (payload as UpdateLifecycleState).state === 'downloading',
      );
      expect(downloadingCall).toBeDefined();
      const downloadingPayload = downloadingCall?.[1] as Extract<
        UpdateLifecycleState,
        { state: 'downloading' }
      >;
      expect(downloadingPayload.newVersion).toBe('1.2.3');
    });
  });

  // -------------------------------------------------------------------------
  // FIX 2: dispose() removes all autoUpdater listeners
  // -------------------------------------------------------------------------

  describe('FIX 2 — dispose() removes all autoUpdater listeners', () => {
    it('removes all 6 autoUpdater event listeners on dispose()', async () => {
      const { manager } = createUpdateManager();
      await manager.start();

      // Listeners are registered after start()
      expect(mockAutoUpdater.listenerCount('checking-for-update')).toBe(1);
      expect(mockAutoUpdater.listenerCount('update-available')).toBe(1);
      expect(mockAutoUpdater.listenerCount('update-not-available')).toBe(1);
      expect(mockAutoUpdater.listenerCount('download-progress')).toBe(1);
      expect(mockAutoUpdater.listenerCount('update-downloaded')).toBe(1);
      expect(mockAutoUpdater.listenerCount('error')).toBe(1);

      manager.dispose();

      // dispose() uses a dynamic import which is already resolved in tests
      // — flush the microtask queue so the .then() callback runs
      await new Promise((r) => setTimeout(r, 0));

      expect(mockAutoUpdater.listenerCount('checking-for-update')).toBe(0);
      expect(mockAutoUpdater.listenerCount('update-available')).toBe(0);
      expect(mockAutoUpdater.listenerCount('update-not-available')).toBe(0);
      expect(mockAutoUpdater.listenerCount('download-progress')).toBe(0);
      expect(mockAutoUpdater.listenerCount('update-downloaded')).toBe(0);
      expect(mockAutoUpdater.listenerCount('error')).toBe(0);
    });

    it('resets _listenersRegistered so start() re-registers listeners after dispose()', async () => {
      const { manager } = createUpdateManager();
      await manager.start();

      manager.dispose();
      await new Promise((r) => setTimeout(r, 0));

      // After dispose + re-start, listeners should be registered again (count = 1)
      await manager.start();
      expect(mockAutoUpdater.listenerCount('update-available')).toBe(1);
    });

    it('resets _pendingVersion: download-progress after re-start has empty newVersion until next update-available', async () => {
      const { manager, webviewManager } = createUpdateManager();

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
      } as unknown as Response);

      await manager.start();

      // Prime _pendingVersion
      mockAutoUpdater.emit('update-available', { version: '2.0.0' });

      manager.dispose();
      await new Promise((r) => setTimeout(r, 0));

      // Re-start — _pendingVersion must be '' now
      await manager.start();

      // Without a new update-available event, download-progress should have newVersion = ''
      mockAutoUpdater.emit('download-progress', {
        percent: 10,
        bytesPerSecond: 100,
        transferred: 100,
        total: 1000,
      });

      const downloadingCalls =
        webviewManager.broadcastMessage.mock.calls.filter(
          ([, payload]) =>
            (payload as UpdateLifecycleState).state === 'downloading',
        );
      const lastCall = downloadingCalls[downloadingCalls.length - 1];
      expect(lastCall).toBeDefined();
      const payload = lastCall?.[1] as Extract<
        UpdateLifecycleState,
        { state: 'downloading' }
      >;
      expect(payload.newVersion).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // FIX 4: triggerCheck() readiness gate
  // -------------------------------------------------------------------------

  describe('FIX 4 — triggerCheck() throws when called before start()', () => {
    it('throws "UpdateManager not started" when start() has not been called', async () => {
      const { manager } = createUpdateManager();

      await expect(manager.triggerCheck()).rejects.toThrow(
        'UpdateManager not started',
      );
    });

    it('logs a warning via logger.warn when called before start()', async () => {
      const { manager, logger } = createUpdateManager();

      await expect(manager.triggerCheck()).rejects.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('triggerCheck called before start()'),
      );
    });

    it('does NOT throw when called after start()', async () => {
      const { manager } = createUpdateManager();
      await manager.start();

      await expect(manager.triggerCheck()).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // FIX 5: _broadcast() logs IPC failures via logger.warn
  // -------------------------------------------------------------------------

  describe('FIX 5 — _broadcast() logs broadcastMessage failures', () => {
    it('calls logger.warn when broadcastMessage rejects', async () => {
      const ipcError = new Error('IPC channel closed');
      const webviewManager = {
        broadcastMessage: jest.fn().mockRejectedValue(ipcError),
      };
      const { manager, logger } = createUpdateManager({ webviewManager });
      await manager.start();

      // Trigger an event that calls _broadcast()
      mockAutoUpdater.emit('checking-for-update');

      // Allow the rejected promise microtask to settle
      await new Promise((r) => setTimeout(r, 0));

      expect(logger.warn).toHaveBeenCalledWith(
        '[UpdateManager] broadcastMessage failed',
        expect.any(Error),
      );
    });

    it('calls logger.warn with a wrapped Error when broadcastMessage rejects with non-Error', async () => {
      const webviewManager = {
        broadcastMessage: jest.fn().mockRejectedValue('string rejection'),
      };
      const { manager, logger } = createUpdateManager({ webviewManager });
      await manager.start();

      mockAutoUpdater.emit('checking-for-update');
      await new Promise((r) => setTimeout(r, 0));

      expect(logger.warn).toHaveBeenCalledWith(
        '[UpdateManager] broadcastMessage failed',
        expect.any(Error),
      );
    });
  });
});
