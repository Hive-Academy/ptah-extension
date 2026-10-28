/**
 * Kimi Code credential service: the Kimi Code CLI login first, the stored
 * Kimi Code API key as a fallback.
 *
 * The CLI keeps a 15-minute access token and a rotating refresh token in
 * `~/.kimi-code/credentials/<name>.json`. This service refreshes the token
 * when it expires within 120 s, writes the rotated pair back atomically (so
 * the CLI keeps working), and tells the proxy which credential to send.
 *
 * Not `@injectable()`: the constructor takes a deps object whose clock, home
 * and refresher are test seams. `register-providers.ts` builds it through a
 * factory, the same way it builds `CodexHomeResolver`.
 *
 * SECURITY: no token, refresh token, key, device id, credential file name or
 * response body is ever logged, returned by `getStatus` or put in an error.
 */
import { watch, type FSWatcher } from 'node:fs';
import { basename } from 'node:path';
import type { IAuthSecretsService, Logger } from '@ptah-extension/vscode-core';
import type { SdkAdapterEvents } from '@ptah-extension/agent-sdk';
import { KIMI_CODE_PROVIDER_ENTRY } from '@ptah-extension/shared';
import {
  KimiCodeCredentialStore,
  type KimiCodeWriteOutcome,
} from './kimi-code-credential-store';
import type { KimiCodeTokenFile } from './kimi-code-credential.schemas';
import { KimiCodeHomeResolver } from './kimi-code-home-resolver';
import {
  KimiCodeOAuthRefresher,
  type KimiCodeRefreshOutcome,
} from './kimi-code-oauth-refresher';
import {
  KIMI_CODE_PROVIDER_ID,
  KimiCodeAuthUnavailableError,
  type IKimiCodeAuthService,
  type KimiCodeAuthStatus,
  type KimiCodeRequestCredential,
} from './kimi-code-provider.types';

/** A token is usable while it has more than this left. */
export const KIMI_CODE_REFRESH_MARGIN_MS = 120_000;
const WATCH_DEBOUNCE_MS = 300;

export interface KimiCodeAuthServiceDeps {
  readonly logger: Logger;
  readonly authSecrets: Pick<IAuthSecretsService, 'getProviderKey' | 'hasProviderKey'>;
  readonly events: Pick<SdkAdapterEvents, 'emitAuthFileChanged'>;
  readonly home?: KimiCodeHomeResolver;
  readonly store?: KimiCodeCredentialStore;
  readonly refresher?: Pick<KimiCodeOAuthRefresher, 'refresh'>;
  readonly now?: () => number;
}

interface CurrentLogin {
  readonly file: string;
  readonly tokens: KimiCodeTokenFile;
}

/** Rotated tokens a failed write left only in memory. */
interface PendingPersist {
  readonly file: string;
  readonly expectedRefreshToken: string;
  readonly tokens: KimiCodeTokenFile;
}

export class KimiCodeAuthService implements IKimiCodeAuthService {
  private readonly logger: Logger;
  private readonly authSecrets: KimiCodeAuthServiceDeps['authSecrets'];
  private readonly events: KimiCodeAuthServiceDeps['events'];
  private readonly home: KimiCodeHomeResolver;
  private readonly store: KimiCodeCredentialStore;
  private readonly refresher: Pick<KimiCodeOAuthRefresher, 'refresh'>;
  private readonly now: () => number;

  /** Refresh token the server rejected; never sent again. */
  private rejectedRefreshToken: string | undefined;
  /** Access token upstream rejected and no refresh could replace. */
  private deadAccessToken: string | undefined;
  private pendingPersist: PendingPersist | undefined;
  private refreshFlight: Promise<boolean> | null = null;
  private lastSource: KimiCodeRequestCredential['kind'] | 'none' | undefined;
  private upstreamHostChecked = false;

  private watcher: FSWatcher | null = null;
  private watchingCredentialsDir = false;
  private watchDebounce: ReturnType<typeof setTimeout> | null = null;
  private suppressWatchUntil = 0;

  constructor(deps: KimiCodeAuthServiceDeps) {
    this.logger = deps.logger;
    this.authSecrets = deps.authSecrets;
    this.events = deps.events;
    this.now = deps.now ?? Date.now;
    this.home = deps.home ?? new KimiCodeHomeResolver();
    this.store =
      deps.store ??
      new KimiCodeCredentialStore(this.home, this.logger, { now: this.now });
    this.refresher = deps.refresher ?? new KimiCodeOAuthRefresher(this.logger);
  }

  async getStatus(): Promise<KimiCodeAuthStatus> {
    const detection = await this.store.detect();
    const login = this.currentLogin(detection);
    const stale =
      login !== undefined &&
      this.rejectedRefreshToken === login.tokens.refresh_token;
    const loggedIn = login !== undefined && !stale;
    const hasApiKey = await this.authSecrets.hasProviderKey(
      KIMI_CODE_PROVIDER_ID,
    );
    return {
      cliDetected: detection.cliDetected,
      loggedIn,
      stale,
      hasApiKey,
      credentialSource: loggedIn ? 'cli-login' : hasApiKey ? 'api-key' : 'none',
    };
  }

  async isAuthenticated(): Promise<boolean> {
    return (await this.getStatus()).credentialSource !== 'none';
  }

  async resolveRequestCredential(): Promise<KimiCodeRequestCredential> {
    await this.ensureFresh();
    const login = this.currentLogin(await this.store.detect());
    if (login && this.isServable(login.tokens)) {
      this.noteSource('oauth');
      await this.checkUpstreamHost();
      return { kind: 'oauth', accessToken: login.tokens.access_token };
    }
    const apiKey = (
      await this.authSecrets.getProviderKey(KIMI_CODE_PROVIDER_ID)
    )?.trim();
    if (apiKey) {
      this.noteSource('apiKey');
      return { kind: 'apiKey', apiKey };
    }
    this.noteSource('none');
    const stale =
      login !== undefined &&
      this.rejectedRefreshToken === login.tokens.refresh_token;
    throw new KimiCodeAuthUnavailableError(stale ? 'stale' : 'signed-out');
  }

  ensureFresh(): Promise<boolean> {
    return this.singleFlight(false);
  }

  forceRefresh(): Promise<boolean> {
    return this.singleFlight(true);
  }

  clearCache(): void {
    this.store.invalidate();
  }

  startWatching(): void {
    if (this.watcher) return;
    const credentialsDir = this.home.credentialsDir;
    for (const [dir, isCredentialsDir] of [
      [credentialsDir, true],
      [this.home.path, false],
    ] as const) {
      try {
        this.watcher = watch(dir, (_event, changed) =>
          this.onWatchEvent(isCredentialsDir, changed),
        );
      } catch (error: unknown) {
        // A missing directory throws ENOENT: try the parent, then give up
        // (status is still re-read on every request after the cache TTL).
        this.logger.debug(
          `[KimiCodeAuth] Cannot watch ${isCredentialsDir ? 'credentials' : 'home'} directory (${
            error instanceof Error ? error.name : 'unknown'
          })`,
        );
        continue;
      }
      this.watchingCredentialsDir = isCredentialsDir;
      this.watcher.on('error', () => {
        this.logger.warn('[KimiCodeAuth] Credentials watcher stopped (error)');
        this.stopWatching();
      });
      this.logger.info('[KimiCodeAuth] Watching the Kimi Code CLI login');
      return;
    }
  }

  stopWatching(): void {
    if (this.watchDebounce) {
      clearTimeout(this.watchDebounce);
      this.watchDebounce = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private onWatchEvent(isCredentialsDir: boolean, changed: string | Buffer | null): void {
    const name = changed === null ? null : changed.toString();
    if (isCredentialsDir) {
      // Our own lock and temp files are not logins.
      if (name !== null && !name.endsWith('.json')) return;
    } else if (name !== null && name !== basename(this.home.credentialsDir)) {
      return;
    }
    if (this.now() < this.suppressWatchUntil) return;
    if (this.watchDebounce) clearTimeout(this.watchDebounce);
    this.watchDebounce = setTimeout(() => {
      this.watchDebounce = null;
      this.store.invalidate();
      if (!this.watchingCredentialsDir) {
        // `credentials/` appeared: move the watch onto it.
        this.stopWatching();
        this.startWatching();
      }
      this.events.emitAuthFileChanged({
        providerId: KIMI_CODE_PROVIDER_ID,
        timestamp: this.now(),
      });
    }, WATCH_DEBOUNCE_MS);
    this.watchDebounce.unref?.();
  }

  /** One refresh in flight per process; concurrent callers share it. */
  private singleFlight(force: boolean): Promise<boolean> {
    if (this.refreshFlight) return this.refreshFlight;
    const flight = this.refreshIfNeeded(force)
      .catch((error: unknown) => {
        // degradation-audit: reported - a disk failure while refreshing (for
        // example the lock file cannot be created) must not fail the request:
        // the category is logged and the caller falls back to a still-valid
        // token or the stored key.
        this.logger.warn(
          `[KimiCodeAuth] Refresh failed (${
            error instanceof Error ? error.name : 'unknown'
          })`,
        );
        return false;
      })
      .finally(() => {
        this.refreshFlight = null;
      });
    this.refreshFlight = flight;
    return flight;
  }

  private async refreshIfNeeded(force: boolean): Promise<boolean> {
    await this.retryPendingPersist();
    if (force) this.store.invalidate();
    const login = this.currentLogin(await this.store.detect());
    if (!login) return false;
    if (!force && this.isUsable(login.tokens)) return true;
    if (this.rejectedRefreshToken === login.tokens.refresh_token) return false;
    const heldAccessToken = login.tokens.access_token;

    const locked = await this.store.withRefreshLock(login.file, () =>
      this.refreshUnderLock(login, force, heldAccessToken),
    );
    let fresh: boolean;
    if (locked.acquired) {
      fresh = locked.value;
    } else {
      // Another Ptah process holds the lock past the wait budget: use what is
      // on disk if it is still valid.
      this.store.invalidate();
      const after = this.currentLogin(await this.store.detect());
      fresh =
        after !== undefined &&
        this.isUnexpired(after.tokens) &&
        (!force || after.tokens.access_token !== heldAccessToken);
    }
    // Upstream rejected this token and nothing replaced it: stop sending it,
    // so the stored key (if any) takes over.
    if (force && !fresh) this.deadAccessToken = heldAccessToken;
    return fresh;
  }

  private async refreshUnderLock(
    login: CurrentLogin,
    force: boolean,
    heldAccessToken: string,
  ): Promise<boolean> {
    // Re-read: the CLI or another Ptah process may have refreshed already.
    const disk = await this.store.readTokenFile(login.file);
    this.store.invalidate();
    if (!disk) return false;
    // Rotated tokens a failed write left in memory are newer than the disk
    // file they replace, and the disk refresh token is already consumed.
    // While disk still holds the version they replace, they are the pair to
    // judge and to refresh; persisting them is retried first.
    let current = disk;
    // The disk version our next write must replace.
    let expectedOnDisk = disk.refresh_token;
    const retained = this.retainedFor(login.file, disk);
    if (retained) {
      if ((await this.retryPendingPersist()) === 'failed') {
        // Still unwritten: judge and refresh the retained pair, and keep
        // replacing the original disk version.
        current = retained.tokens;
        expectedOnDisk = retained.expectedRefreshToken;
      } else {
        // Written, or `cas-lost` (another writer replaced the file): the
        // retained reference is settled either way, so adopt the disk.
        const reread = await this.store.readTokenFile(login.file);
        this.store.invalidate();
        if (!reread) return false;
        current = reread;
        expectedOnDisk = reread.refresh_token;
      }
    }
    const alreadyRefreshed = force
      ? current.access_token !== heldAccessToken && this.isUnexpired(current)
      : this.isUsable(current);
    if (alreadyRefreshed) return true;
    if (this.rejectedRefreshToken === current.refresh_token) return false;

    const config = await this.store.readConfig();
    const deviceId = await this.store.readDeviceId();
    const outcome = await this.refresher.refresh(
      current.refresh_token,
      config.oauthHost,
      deviceId,
    );
    return this.applyOutcome(login.file, expectedOnDisk, current, outcome, force);
  }

  /** The retained pair for `file`, while disk still holds what it replaces. */
  private retainedFor(
    file: string,
    disk: KimiCodeTokenFile,
  ): PendingPersist | undefined {
    const pending = this.pendingPersist;
    if (!pending || pending.file !== file) return undefined;
    if (disk.refresh_token === pending.expectedRefreshToken) return pending;
    // The CLI (or another process) wrote a newer login: it wins.
    this.pendingPersist = undefined;
    this.logger.info(
      '[KimiCodeAuth] The token file changed; dropping unwritten refreshed tokens',
    );
    return undefined;
  }

  private async applyOutcome(
    file: string,
    expectedOnDisk: string,
    base: KimiCodeTokenFile,
    outcome: KimiCodeRefreshOutcome,
    force: boolean,
  ): Promise<boolean> {
    if (outcome.kind === 'rejected') {
      // Another writer (the CLI, another Ptah process) may have rotated the
      // file after we read it, consuming the token we sent. Then the login
      // on disk is the live one: adopt it instead of marking it stale.
      const disk = await this.store.readTokenFile(file);
      this.store.invalidate();
      if (
        disk !== undefined &&
        disk.refresh_token !== base.refresh_token &&
        disk.refresh_token !== expectedOnDisk
      ) {
        this.pendingPersist = undefined;
        this.logger.info(
          '[KimiCodeAuth] The token file was rotated by another writer; using it',
        );
        return this.isUnexpired(disk);
      }
      this.rejectedRefreshToken = base.refresh_token;
      this.logger.warn(
        '[KimiCodeAuth] The Kimi Code CLI login was rejected; run `kimi login` again',
      );
      return false;
    }
    if (outcome.kind === 'transient') {
      return !force && this.isUnexpired(base);
    }
    const nowSeconds = Math.floor(this.now() / 1000);
    const response = outcome.tokens;
    const rotated: KimiCodeTokenFile = {
      ...base,
      access_token: response.access_token,
      refresh_token: response.refresh_token,
      expires_at: nowSeconds + response.expires_in,
      expires_in: response.expires_in,
      ...(response.token_type !== undefined
        ? { token_type: response.token_type }
        : {}),
      ...(response.scope !== undefined ? { scope: response.scope } : {}),
    };
    this.rejectedRefreshToken = undefined;
    // A further rotation replaces the retained pair but keeps the disk
    // version it must replace.
    this.pendingPersist = {
      file,
      expectedRefreshToken: expectedOnDisk,
      tokens: rotated,
    };
    await this.retryPendingPersist();
    const login = this.currentLogin(await this.store.detect());
    return login !== undefined && this.isUnexpired(login.tokens);
  }

  /**
   * Write retained rotated tokens. `cas-lost` means the token file no longer
   * holds the version ours replace (the CLI wrote newer tokens): drop ours
   * and use the disk. An I/O failure keeps them in memory for the next call;
   * a rotated refresh token is never silently dropped.
   *
   * @returns what happened, so a caller holding the retained pair knows
   *   whether it is still the one to use (`'failed'`) or the disk now is.
   */
  private async retryPendingPersist(): Promise<
    'none' | KimiCodeWriteOutcome | 'failed'
  > {
    const pending = this.pendingPersist;
    if (!pending) return 'none';
    this.suppressWatchUntil = this.now() + WATCH_DEBOUNCE_MS * 4;
    try {
      const outcome = await this.store.writeRotated(
        pending.file,
        pending.expectedRefreshToken,
        pending.tokens,
      );
      this.pendingPersist = undefined;
      if (outcome === 'cas-lost') {
        this.logger.info(
          '[KimiCodeAuth] The Kimi Code CLI refreshed concurrently; using its tokens',
        );
      }
      return outcome;
    } catch (error: unknown) {
      // degradation-audit: reported - the rotated pair stays in memory as
      // pending and the next refresh retries the write.
      this.logger.warn(
        `[KimiCodeAuth] Refreshed tokens could not be written; keeping them in memory (${
          error instanceof Error ? error.name : 'unknown'
        })`,
      );
      return 'failed';
    }
  }

  /** The retained rotated tokens win over the (older) file they replace. */
  private currentLogin(detection: {
    file?: string;
    tokens?: KimiCodeTokenFile;
  }): CurrentLogin | undefined {
    const pending = this.pendingPersist;
    if (
      pending &&
      detection.file === pending.file &&
      detection.tokens?.refresh_token === pending.expectedRefreshToken
    ) {
      return { file: pending.file, tokens: pending.tokens };
    }
    if (!detection.file || !detection.tokens) return undefined;
    return { file: detection.file, tokens: detection.tokens };
  }

  private isUsable(tokens: KimiCodeTokenFile): boolean {
    return tokens.expires_at * 1000 - this.now() > KIMI_CODE_REFRESH_MARGIN_MS;
  }

  private isUnexpired(tokens: KimiCodeTokenFile): boolean {
    return tokens.expires_at * 1000 > this.now();
  }

  /** Unexpired, refresh token not rejected, access token not rejected. */
  private isServable(tokens: KimiCodeTokenFile): boolean {
    return (
      this.isUnexpired(tokens) &&
      this.rejectedRefreshToken !== tokens.refresh_token &&
      this.deadAccessToken !== tokens.access_token
    );
  }

  /**
   * Assumption A5: a `mainland-cn` login may use another API host than the
   * one Ptah sends to. Log both host names once (no path, no credential) so
   * a mismatch is diagnosable.
   */
  private async checkUpstreamHost(): Promise<void> {
    if (this.upstreamHostChecked) return;
    this.upstreamHostChecked = true;
    const { baseUrlHost } = await this.store.readConfig();
    const ptahHost = new URL(KIMI_CODE_PROVIDER_ENTRY.baseUrl).hostname;
    if (baseUrlHost !== undefined && baseUrlHost !== ptahHost) {
      this.logger.warn(
        `[KimiCodeAuth] The Kimi Code CLI uses API host ${baseUrlHost}; Ptah sends Kimi Code requests to ${ptahHost}`,
      );
    }
  }

  /** Log the credential source once per change, never the credential. */
  private noteSource(source: KimiCodeRequestCredential['kind'] | 'none'): void {
    if (this.lastSource === source) return;
    this.lastSource = source;
    const label =
      source === 'oauth' ? 'cli-login' : source === 'apiKey' ? 'api-key' : 'none';
    this.logger.info(`[KimiCodeAuth] Credential source: ${label}`);
  }
}
