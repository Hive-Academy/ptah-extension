/**
 * UpdateManager — Electron main-process auto-update orchestrator.
 *
 * Wraps `electron-updater`'s `autoUpdater` to provide:
 *   - Event-driven state tracking via `UpdateLifecycleState` discriminated union
 *   - Broadcast of state changes to the renderer via `WebviewManager`
 *   - Throttled `download-progress` events (≤ 10 Hz, final ≥99.9% always forwarded)
 *   - 4-hour periodic background checks
 *   - `triggerCheck()` for on-demand check-now RPC
 *   - `dispose()` for LIFO cleanup in `main.ts` `will-quit`
 *   - `fetchReleaseNotes()` — GitHub Releases API fetch, main-process only,
 *     result embedded in `update-available` / `update-downloaded` payloads
 *
 * TASK_2026_117: In-App Electron Auto-Update UX (VS Code-Style)
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { UpdateLifecycleState } from '@ptah-extension/shared';

/** GitHub repository constants for release-notes fetching. */
const PTAH_GITHUB_OWNER = 'hive-academy';
const PTAH_GITHUB_REPO = 'ptah-extension';

/** Minimum milliseconds between `download-progress` broadcasts (10 Hz). */
const PROGRESS_THROTTLE_MS = 100;

/** 4-hour periodic check interval in milliseconds. */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

interface WebviewBroadcaster {
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

@injectable()
export class UpdateManager {
  private _currentState: UpdateLifecycleState = { state: 'idle' };
  private _checkInterval: ReturnType<typeof setInterval> | null = null;
  private _lastProgressBroadcast = 0;
  private _listenersRegistered = false;
  /** Cached version from the most recent `update-available` or `update-downloaded` event. */
  private _pendingVersion = '';

  constructor(
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewBroadcaster,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
  ) {}

  /** Read the latest state synchronously (used by the RPC install-now handler). */
  getCurrentState(): UpdateLifecycleState {
    return this._currentState;
  }

  /** Returns the periodic check interval handle (flows into PostWindowResult). */
  getCheckInterval(): ReturnType<typeof setInterval> | null {
    return this._checkInterval;
  }

  /**
   * Start the auto-updater lifecycle.
   *
   * Idempotent: safe to call multiple times — the interval is created only once.
   * Dev-mode gate: bails immediately when NODE_ENV === 'development'.
   */
  async start(): Promise<void> {
    if (process.env['NODE_ENV'] === 'development') {
      this.logger.info('[UpdateManager] Skipped — development mode');
      return;
    }

    // Idempotency guard — do not create a second interval if already started.
    if (this._checkInterval !== null) {
      return;
    }

    const { autoUpdater } = await import('electron-updater');

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    if (!this._listenersRegistered) {
      this._listenersRegistered = true;

      autoUpdater.on('checking-for-update', () => {
        this._broadcast({ state: 'checking' });
      });

      autoUpdater.on(
        'update-available',
        (info: { version: string; releaseDate?: string }) => {
          // FIX 1: Cache the pending version BEFORE the async fetch so that
          // download-progress events fired during the fetch window can use it.
          this._pendingVersion = info.version;
          // Fetch release notes async; broadcast once resolved (non-blocking)
          void this.fetchReleaseNotes(info.version).then(
            (releaseNotesMarkdown) => {
              this._broadcast({
                state: 'available',
                currentVersion: autoUpdater.currentVersion?.version ?? '',
                newVersion: info.version,
                releaseDate: info.releaseDate,
                releaseNotesMarkdown,
              });
            },
          );
        },
      );

      autoUpdater.on('update-not-available', () => {
        this._broadcast({ state: 'idle' });
      });

      autoUpdater.on(
        'download-progress',
        (progress: {
          percent: number;
          bytesPerSecond: number;
          transferred: number;
          total: number;
        }) => {
          const now = Date.now();
          const elapsed = now - this._lastProgressBroadcast;
          const isFinal = progress.percent >= 99.9;

          if (elapsed >= PROGRESS_THROTTLE_MS || isFinal) {
            this._lastProgressBroadcast = now;
            this._broadcast({
              state: 'downloading',
              currentVersion: autoUpdater.currentVersion?.version ?? '',
              // FIX 1: use cached _pendingVersion (set in update-available handler)
              newVersion: this._pendingVersion,
              percent: progress.percent,
              bytesPerSecond: progress.bytesPerSecond,
              transferred: progress.transferred,
              total: progress.total,
            });
          }
        },
      );

      autoUpdater.on(
        'update-downloaded',
        (info: { version: string; releaseDate?: string }) => {
          // FIX 1: Keep _pendingVersion up-to-date in the downloaded event as well.
          this._pendingVersion = info.version;
          void this.fetchReleaseNotes(info.version).then(
            (releaseNotesMarkdown) => {
              this._broadcast({
                state: 'downloaded',
                currentVersion: autoUpdater.currentVersion?.version ?? '',
                newVersion: info.version,
                releaseDate: info.releaseDate,
                releaseNotesMarkdown,
              });
            },
          );
        },
      );

      autoUpdater.on('error', (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          '[UpdateManager] Auto-updater error',
          err instanceof Error ? err : new Error(message),
        );
        this._broadcast({ state: 'error', message });
      });
    }

    // Trigger an immediate check on startup
    void autoUpdater.checkForUpdates()?.catch((err: unknown) => {
      this.logger.warn(
        '[UpdateManager] Initial check failed',
        err instanceof Error ? err : new Error(String(err)),
      );
    });

    // Schedule periodic background checks every 4 hours.
    this._checkInterval = setInterval(() => {
      void autoUpdater.checkForUpdates()?.catch((err: unknown) => {
        this.logger.warn(
          '[UpdateManager] Periodic check failed',
          err instanceof Error ? err : new Error(String(err)),
        );
      });
    }, CHECK_INTERVAL_MS);
  }

  /**
   * On-demand update check (called by the `update:check-now` RPC handler).
   * Errors are re-thrown so the handler can wrap them in a structured response.
   *
   * FIX 4: Guards against being called before start() registers listeners.
   * Throws so the RPC handler can return { success: false, error }.
   */
  async triggerCheck(): Promise<void> {
    if (!this._listenersRegistered) {
      this.logger.warn(
        '[UpdateManager] triggerCheck called before start() — listeners not registered',
      );
      throw new Error('UpdateManager not started');
    }
    const { autoUpdater } = await import('electron-updater');
    await autoUpdater.checkForUpdates();
  }

  /**
   * Tear down the auto-updater lifecycle.
   *
   * FIX 2: Removes all autoUpdater listeners in addition to clearing the
   * interval, preventing listener accumulation on the process-global
   * autoUpdater singleton if a new UpdateManager instance is ever created
   * after dispose() (e.g. macOS re-init or test re-runs).
   *
   * After dispose() the manager is re-startable: call start() again and all
   * six listeners will be re-registered fresh.
   *
   * Called from `will-quit` LIFO cleanup in main.ts.
   */
  dispose(): void {
    if (this._checkInterval !== null) {
      clearInterval(this._checkInterval);
      this._checkInterval = null;
    }

    // Remove all autoUpdater listeners so the singleton does not accumulate
    // handlers across UpdateManager instances.
    void import('electron-updater').then(({ autoUpdater }) => {
      autoUpdater.removeAllListeners('checking-for-update');
      autoUpdater.removeAllListeners('update-available');
      autoUpdater.removeAllListeners('update-not-available');
      autoUpdater.removeAllListeners('download-progress');
      autoUpdater.removeAllListeners('update-downloaded');
      autoUpdater.removeAllListeners('error');
    });

    this._listenersRegistered = false;
    this._pendingVersion = '';
  }

  /**
   * Fetch GitHub Releases markdown body for a given version tag.
   *
   * - URL: `https://api.github.com/repos/{owner}/{repo}/releases/tags/v{version}`
   * - 5-second AbortController timeout.
   * - Returns `null` on any error (HTTP error, network error, timeout, parse error).
   *   Never throws.
   */
  async fetchReleaseNotes(version: string): Promise<string | null> {
    const url = `https://api.github.com/repos/${PTAH_GITHUB_OWNER}/${PTAH_GITHUB_REPO}/releases/tags/v${version}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'ptah-electron-updater',
        },
      });

      if (!resp.ok) {
        return null;
      }

      const data = (await resp.json()) as { body?: string | null };
      return data.body ?? null;
    } catch {
      // Covers AbortError (timeout), network errors, JSON parse errors — all silent.
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Synchronously update `_currentState` BEFORE broadcasting so that the
   * `update:install-now` RPC handler can read state without a race condition.
   *
   * FIX 5: Log IPC failures instead of swallowing them so that a closed or
   * erroring webview does not silently prevent state updates from reaching
   * the renderer.
   */
  private _broadcast(payload: UpdateLifecycleState): void {
    this._currentState = payload;
    this.webviewManager
      .broadcastMessage(MESSAGE_TYPES.UPDATE_STATUS_CHANGED, payload)
      .catch((err: unknown) => {
        this.logger.warn(
          '[UpdateManager] broadcastMessage failed',
          err instanceof Error ? err : new Error(String(err)),
        );
      });
  }
}
