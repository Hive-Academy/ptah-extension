/**
 * UpdateManager — Electron main-process desktop-update detector.
 *
 * Detects newer releases by querying the GitHub Releases API directly (the same
 * source the landing-page download route uses), comparing the latest
 * `electron-v*` tag to the installed version from `app.getVersion()`. When a
 * newer release exists it broadcasts an `available` state carrying the platform
 * installer URL and release notes; the banner's Download action opens that URL
 * in the browser. No electron-updater, no in-app download/install.
 */

import { injectable, inject } from 'tsyringe';
import { app, net } from 'electron';
import type { IAppUpdater } from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { UpdateLifecycleState } from '@ptah-extension/shared';

const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/Hive-Academy/ptah-extension/releases';

const ELECTRON_TAG_PREFIX = 'electron-v';

/** 4-hour periodic check interval in milliseconds. */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Timeout for the GitHub Releases request. */
const FETCH_TIMEOUT_MS = 5000;

interface WebviewBroadcaster {
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  published_at?: string;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets: GitHubReleaseAsset[];
}

@injectable()
export class UpdateManager implements IAppUpdater {
  private _currentState: UpdateLifecycleState = { state: 'idle' };
  private _checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewBroadcaster,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
  ) {}

  /** Read the latest state synchronously (used by the update:get-state RPC). */
  getCurrentState(): UpdateLifecycleState {
    return this._currentState;
  }

  /** Returns the periodic check interval handle (flows into PostWindowResult). */
  getCheckInterval(): ReturnType<typeof setInterval> | null {
    return this._checkInterval;
  }

  /**
   * Start update detection.
   *
   * Idempotent: the periodic interval is created only once. Dev-mode gate:
   * bails immediately when NODE_ENV === 'development'.
   *
   * E2E gate: `apps/ptah-electron-e2e/src/support/electron-launcher.ts` sets
   * `PTAH_E2E=1` on every harness launch (the same flag `bootstrap.ts` and the
   * RPC handlers already honour). Without this gate, the boot-time check hits
   * the real GitHub Releases API on every e2e run; the verdict then depends on
   * whatever tag happens to be published and on runner network reachability —
   * not on the code under test. A CI build reporting an older version than the
   * latest tag makes `<ptah-update-banner>` render and shift layout, which
   * failed a spec whose overlap guard assumed the banner never appears
   * (TASK_2026_296). Specs that intentionally want the real network path
   * (`auto-updater.spec.ts`'s forced-NODE_ENV cases) opt back in by passing
   * `PTAH_E2E_ALLOW_UPDATE_CHECK: '1'` through `launchPtah`'s `opts.env`.
   */
  async start(): Promise<void> {
    if (process.env['NODE_ENV'] === 'development') {
      this.logger.info('[UpdateManager] Skipped — development mode');
      return;
    }
    if (
      process.env['PTAH_E2E'] === '1' &&
      process.env['PTAH_E2E_ALLOW_UPDATE_CHECK'] !== '1'
    ) {
      this.logger.info(
        '[UpdateManager] Skipped — e2e harness (set PTAH_E2E_ALLOW_UPDATE_CHECK=1 to opt back in)',
      );
      return;
    }
    if (this._checkInterval !== null) {
      return;
    }
    this.logger.info(
      `[UpdateManager] start: checking GitHub releases (installed=${app.getVersion()})`,
    );
    void this.checkViaGitHub();
    this._checkInterval = setInterval(() => {
      void this.checkViaGitHub();
    }, CHECK_INTERVAL_MS);
  }

  /** On-demand check (called by the update:check-now RPC handler). */
  async triggerCheck(): Promise<void> {
    await this.checkViaGitHub();
  }

  /**
   * Query the GitHub Releases API, compare the latest `electron-v*` tag to the
   * installed version, and broadcast the resulting lifecycle state.
   */
  async checkViaGitHub(): Promise<void> {
    this._broadcast({ state: 'checking' });

    const installed = app.getVersion();
    let releases: GitHubRelease[];
    try {
      releases = await this.fetchReleases();
    } catch (error: unknown) {
      const message = this.describeFetchError(error);
      this.logger.warn(
        '[UpdateManager] GitHub releases check failed',
        error instanceof Error ? error : new Error(message),
      );
      this._broadcast({ state: 'error', message });
      return;
    }

    const candidates = releases
      .filter(
        (r) =>
          !r.draft &&
          !r.prerelease &&
          typeof r.tag_name === 'string' &&
          r.tag_name.startsWith(ELECTRON_TAG_PREFIX),
      )
      .map((release) => ({
        release,
        version: release.tag_name.slice(ELECTRON_TAG_PREFIX.length),
      }))
      .sort((a, b) => this.compareVersions(b.version, a.version));

    const latest = candidates[0];
    if (!latest || this.compareVersions(latest.version, installed) <= 0) {
      this.logger.info(
        `[UpdateManager] up to date (installed=${installed}, latest=${
          latest?.version ?? 'none'
        })`,
      );
      this._broadcast({ state: 'idle' });
      return;
    }

    const downloadUrl = this.platformInstallerUrl(latest.release.assets);
    this.logger.info(
      `[UpdateManager] update-available: ${installed} -> ${latest.version} (installer=${
        downloadUrl ?? 'release page'
      })`,
    );
    this._broadcast({
      state: 'available',
      currentVersion: installed,
      newVersion: latest.version,
      releaseDate: latest.release.published_at,
      releaseNotesMarkdown: latest.release.body ?? null,
      downloadUrl,
      releaseUrl: latest.release.html_url,
    });
  }

  /** Tear down the periodic interval. Called from will-quit LIFO cleanup. */
  dispose(): void {
    if (this._checkInterval !== null) {
      clearInterval(this._checkInterval);
      this._checkInterval = null;
    }
  }

  private async fetchReleases(): Promise<GitHubRelease[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const resp = await net.fetch(`${GITHUB_RELEASES_URL}?per_page=10`, {
        signal: controller.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'ptah-electron-updater',
        },
      });
      if (!resp.ok) {
        throw new Error(`GitHub releases request failed: HTTP ${resp.status}`);
      }
      return (await resp.json()) as GitHubRelease[];
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Build a diagnosable message from a fetch rejection. `net.fetch`/undici wrap
   * network-level failures in a generic `TypeError: fetch failed`, stashing the
   * real reason (DNS, refused connection, TLS, proxy, timeout) on `error.cause`.
   * Surface that cause so the banner and logs show why the check failed instead
   * of a bare "fetch failed".
   */
  private describeFetchError(error: unknown): string {
    if (!(error instanceof Error)) {
      return String(error);
    }
    if (error.name === 'AbortError') {
      return `request timed out after ${FETCH_TIMEOUT_MS}ms`;
    }
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) {
      return `${error.message}: ${cause.message}`;
    }
    if (typeof cause === 'string' && cause.length > 0) {
      return `${error.message}: ${cause}`;
    }
    return error.message;
  }

  private platformInstallerUrl(assets: GitHubReleaseAsset[]): string | null {
    const platform = process.platform;
    const matches = (name: string): boolean => {
      const n = name.toLowerCase();
      if (
        n.endsWith('.yml') ||
        n.endsWith('.yaml') ||
        n.endsWith('.blockmap')
      ) {
        return false;
      }
      if (platform === 'win32') {
        return n.endsWith('.exe');
      }
      if (platform === 'darwin') {
        return n.endsWith('.dmg') || n.includes('-mac.zip');
      }
      return n.endsWith('.appimage') || n.endsWith('.deb');
    };
    const asset = assets.find((a) => matches(a.name));
    return asset?.browser_download_url ?? null;
  }

  private compareVersions(a: string, b: string): number {
    const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
    const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let k = 0; k < len; k++) {
      const diff = (pa[k] ?? 0) - (pb[k] ?? 0);
      if (diff !== 0) {
        return diff > 0 ? 1 : -1;
      }
    }
    return 0;
  }

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
