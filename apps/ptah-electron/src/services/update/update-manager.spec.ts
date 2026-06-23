/**
 * update-manager.spec.ts
 *
 * Unit tests for UpdateManager — the main-process desktop-update detector that
 * queries the GitHub Releases API and compares the latest `electron-v*` tag to
 * the installed version.
 *
 * Strategy:
 *   - Mock 'electron' so app.getVersion() is controllable.
 *   - Mock electron net.fetch to return a releases payload.
 *   - Override process.platform for installer-asset selection tests.
 *   - Instantiate UpdateManager directly (no DI container).
 */

import 'reflect-metadata';

jest.mock('electron', () => ({
  app: { getVersion: jest.fn(() => '0.1.48') },
  net: { fetch: jest.fn() },
}));

import { app, net } from 'electron';
import { UpdateManager } from './update-manager';
import type { UpdateLifecycleState } from '@ptah-extension/shared';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

const getVersion = app.getVersion as jest.Mock;
const netFetch = net.fetch as unknown as jest.Mock;

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
  return { broadcastMessage: jest.fn().mockResolvedValue(undefined) };
}

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
// Fixtures
// ---------------------------------------------------------------------------

interface ReleaseOpts {
  draft?: boolean;
  prerelease?: boolean;
  body?: string | null;
  tag?: string;
  assets?: { name: string; browser_download_url: string }[];
}

function release(version: string, opts: ReleaseOpts = {}) {
  const tag = opts.tag ?? `electron-v${version}`;
  return {
    tag_name: tag,
    html_url: `https://github.com/Hive-Academy/ptah-extension/releases/tag/${tag}`,
    published_at: '2026-06-01T00:00:00Z',
    body: opts.body === undefined ? `notes for ${version}` : opts.body,
    draft: opts.draft ?? false,
    prerelease: opts.prerelease ?? false,
    assets: opts.assets ?? [
      {
        name: `Ptah.Setup.${version}.exe`,
        browser_download_url: `https://dl.example/${version}.exe`,
      },
      {
        name: `Ptah-${version}.dmg`,
        browser_download_url: `https://dl.example/${version}.dmg`,
      },
      {
        name: `Ptah-${version}.AppImage`,
        browser_download_url: `https://dl.example/${version}.AppImage`,
      },
      {
        name: 'latest.yml',
        browser_download_url: 'https://dl.example/latest.yml',
      },
    ],
  };
}

function mockFetchReleases(releases: unknown[]) {
  netFetch.mockResolvedValue({
    ok: true,
    json: jest.fn().mockResolvedValue(releases),
  } as unknown as Response);
}

function availablePayload(
  webviewManager: ReturnType<typeof makeWebviewManager>,
) {
  const call = webviewManager.broadcastMessage.mock.calls.find(
    ([, payload]) => (payload as UpdateLifecycleState).state === 'available',
  );
  return call?.[1] as
    | Extract<UpdateLifecycleState, { state: 'available' }>
    | undefined;
}

function lastState(webviewManager: ReturnType<typeof makeWebviewManager>) {
  const calls = webviewManager.broadcastMessage.mock.calls;
  return calls[calls.length - 1]?.[1] as UpdateLifecycleState | undefined;
}

// ---------------------------------------------------------------------------
// process.platform control
// ---------------------------------------------------------------------------

const ORIGINAL_PLATFORM = process.platform;
function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

beforeEach(() => {
  getVersion.mockReturnValue('0.1.48');
  setPlatform('win32');
  delete process.env['NODE_ENV'];
  netFetch.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
  Object.defineProperty(process, 'platform', {
    value: ORIGINAL_PLATFORM,
    configurable: true,
  });
  delete process.env['NODE_ENV'];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UpdateManager', () => {
  describe('dev-mode gate', () => {
    it('returns early without fetching or setting an interval when NODE_ENV=development', async () => {
      process.env['NODE_ENV'] = 'development';
      const { manager, logger } = createUpdateManager();

      await manager.start();

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('development'),
      );
      expect(netFetch).not.toHaveBeenCalled();
      expect(manager.getCheckInterval()).toBeNull();
    });
  });

  describe('checkViaGitHub() — detection', () => {
    it('broadcasts checking then available when a newer electron release exists', async () => {
      mockFetchReleases([release('0.1.49'), release('0.1.48')]);
      const { manager, webviewManager } = createUpdateManager();

      await manager.checkViaGitHub();

      expect(webviewManager.broadcastMessage).toHaveBeenCalledWith(
        MESSAGE_TYPES.UPDATE_STATUS_CHANGED,
        expect.objectContaining({ state: 'checking' }),
      );
      const payload = availablePayload(webviewManager);
      expect(payload).toBeDefined();
      expect(payload?.currentVersion).toBe('0.1.48');
      expect(payload?.newVersion).toBe('0.1.49');
      expect(payload?.releaseNotesMarkdown).toBe('notes for 0.1.49');
      expect(payload?.releaseUrl).toContain('electron-v0.1.49');
    });

    it('selects the Windows .exe installer on win32', async () => {
      setPlatform('win32');
      mockFetchReleases([release('0.1.49')]);
      const { manager, webviewManager } = createUpdateManager();

      await manager.checkViaGitHub();

      expect(availablePayload(webviewManager)?.downloadUrl).toBe(
        'https://dl.example/0.1.49.exe',
      );
    });

    it('selects the macOS .dmg installer on darwin', async () => {
      setPlatform('darwin');
      mockFetchReleases([release('0.1.49')]);
      const { manager, webviewManager } = createUpdateManager();

      await manager.checkViaGitHub();

      expect(availablePayload(webviewManager)?.downloadUrl).toBe(
        'https://dl.example/0.1.49.dmg',
      );
    });

    it('selects the Linux .AppImage installer on linux', async () => {
      setPlatform('linux');
      mockFetchReleases([release('0.1.49')]);
      const { manager, webviewManager } = createUpdateManager();

      await manager.checkViaGitHub();

      expect(availablePayload(webviewManager)?.downloadUrl).toBe(
        'https://dl.example/0.1.49.AppImage',
      );
    });

    it('downloadUrl is null (falls back to releaseUrl) when no platform asset matches', async () => {
      mockFetchReleases([
        release('0.1.49', {
          assets: [
            {
              name: 'latest.yml',
              browser_download_url: 'https://dl/latest.yml',
            },
          ],
        }),
      ]);
      const { manager, webviewManager } = createUpdateManager();

      await manager.checkViaGitHub();

      const payload = availablePayload(webviewManager);
      expect(payload?.downloadUrl).toBeNull();
      expect(payload?.releaseUrl).toContain('electron-v0.1.49');
    });

    it('broadcasts idle when the installed version is already the latest', async () => {
      getVersion.mockReturnValue('0.1.49');
      mockFetchReleases([release('0.1.49'), release('0.1.48')]);
      const { manager, webviewManager } = createUpdateManager();

      await manager.checkViaGitHub();

      expect(lastState(webviewManager)).toEqual({ state: 'idle' });
    });

    it('picks the highest semver among multiple electron releases', async () => {
      mockFetchReleases([
        release('0.1.47'),
        release('0.1.50'),
        release('0.1.49'),
      ]);
      const { manager, webviewManager } = createUpdateManager();

      await manager.checkViaGitHub();

      expect(availablePayload(webviewManager)?.newVersion).toBe('0.1.50');
    });

    it('ignores draft, prerelease, and non-electron tags', async () => {
      mockFetchReleases([
        release('0.1.99', { draft: true }),
        release('0.1.98', { prerelease: true }),
        release('9.9.9', { tag: 'extension-v9.9.9' }),
        release('0.1.49'),
      ]);
      const { manager, webviewManager } = createUpdateManager();

      await manager.checkViaGitHub();

      expect(availablePayload(webviewManager)?.newVersion).toBe('0.1.49');
    });

    it('broadcasts error when the GitHub request returns a non-2xx status', async () => {
      netFetch.mockResolvedValue({
        ok: false,
        status: 503,
      } as unknown as Response);
      const { manager, webviewManager } = createUpdateManager();

      await manager.checkViaGitHub();

      const state = lastState(webviewManager);
      expect(state?.state).toBe('error');
      expect(
        (state as Extract<UpdateLifecycleState, { state: 'error' }>).message,
      ).toContain('503');
    });

    it('broadcasts error when fetch rejects (network error)', async () => {
      netFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      const { manager, webviewManager } = createUpdateManager();

      await manager.checkViaGitHub();

      expect(lastState(webviewManager)?.state).toBe('error');
    });

    it('unwraps error.cause so a bare "fetch failed" surfaces its real reason', async () => {
      const wrapped = new TypeError('fetch failed');
      (wrapped as { cause?: unknown }).cause = new Error(
        'getaddrinfo ENOTFOUND api.github.com',
      );
      netFetch.mockRejectedValue(wrapped);
      const { manager, webviewManager } = createUpdateManager();

      await manager.checkViaGitHub();

      const state = lastState(webviewManager);
      expect(state?.state).toBe('error');
      expect(
        (state as Extract<UpdateLifecycleState, { state: 'error' }>).message,
      ).toBe('fetch failed: getaddrinfo ENOTFOUND api.github.com');
    });

    it('reports a timeout when the request aborts', async () => {
      const abort = new Error('The operation was aborted');
      abort.name = 'AbortError';
      netFetch.mockRejectedValue(abort);
      const { manager, webviewManager } = createUpdateManager();

      await manager.checkViaGitHub();

      const state = lastState(webviewManager);
      expect(state?.state).toBe('error');
      expect(
        (state as Extract<UpdateLifecycleState, { state: 'error' }>).message,
      ).toContain('timed out');
    });
  });

  describe('start()', () => {
    it('runs an initial check and sets the periodic interval', async () => {
      mockFetchReleases([release('0.1.49')]);
      const { manager, webviewManager } = createUpdateManager();

      await manager.start();
      await Promise.resolve();
      await Promise.resolve();

      expect(netFetch).toHaveBeenCalledTimes(1);
      expect(manager.getCheckInterval()).not.toBeNull();
      expect(availablePayload(webviewManager)?.newVersion).toBe('0.1.49');
    });

    it('is idempotent — calling start() twice creates the interval only once', async () => {
      mockFetchReleases([release('0.1.49')]);
      const { manager } = createUpdateManager();

      await manager.start();
      const first = manager.getCheckInterval();
      await manager.start();

      expect(first).not.toBeNull();
      expect(manager.getCheckInterval()).toBe(first);
    });

    it('re-checks on the 4-hour interval', async () => {
      mockFetchReleases([release('0.1.49')]);
      jest.useFakeTimers();
      const { manager } = createUpdateManager();

      await manager.start();
      const initial = netFetch.mock.calls.length;

      await jest.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);

      expect(netFetch.mock.calls.length).toBeGreaterThan(initial);
    });
  });

  describe('triggerCheck()', () => {
    it('runs a GitHub check', async () => {
      mockFetchReleases([release('0.1.49')]);
      const { manager, webviewManager } = createUpdateManager();

      await manager.triggerCheck();

      expect(availablePayload(webviewManager)?.newVersion).toBe('0.1.49');
    });
  });

  describe('getCurrentState()', () => {
    it('returns idle initially', () => {
      const { manager } = createUpdateManager();
      expect(manager.getCurrentState()).toEqual({ state: 'idle' });
    });

    it('reflects the last broadcast state', async () => {
      mockFetchReleases([release('0.1.49')]);
      const { manager } = createUpdateManager();

      await manager.checkViaGitHub();

      expect(manager.getCurrentState().state).toBe('available');
    });
  });

  describe('dispose()', () => {
    it('clears the interval', async () => {
      mockFetchReleases([release('0.1.49')]);
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

  describe('_broadcast() failure logging', () => {
    it('logs a warning when broadcastMessage rejects', async () => {
      const webviewManager = {
        broadcastMessage: jest.fn().mockRejectedValue(new Error('IPC closed')),
      };
      mockFetchReleases([release('0.1.49')]);
      const { manager, logger } = createUpdateManager({ webviewManager });

      await manager.checkViaGitHub();
      await new Promise((r) => setTimeout(r, 0));

      expect(logger.warn).toHaveBeenCalledWith(
        '[UpdateManager] broadcastMessage failed',
        expect.any(Error),
      );
    });
  });
});
