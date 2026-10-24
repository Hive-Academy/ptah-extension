import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { watch, existsSync, type FSWatcher } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import axios from 'axios';
import { z } from 'zod';
import { Logger } from '@ptah-extension/vscode-core';
import type { IDisposable } from '@ptah-extension/platform-core';
import type {
  CodexHomeAuthReader,
  CodexHomeAuthEvent,
  CodexUsageEligibility,
} from '@ptah-extension/codex-runtime';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { ProviderModelInfo } from '@ptah-extension/shared';
import { isCodexAccessTokenStale } from '@ptah-extension/shared';
import { SdkError } from '@ptah-extension/agent-sdk';
import type { ICodexAuthService, CodexAuthFile } from './codex-provider.types';

const authFileSchema = z
  .object({
    auth_mode: z.enum(['ApiKey', 'Chatgpt', 'ChatgptAuthTokens']).optional(),
    openai_api_key: z.string().nullable().optional(),
    OPENAI_API_KEY: z.string().nullable().optional(),
    tokens: z
      .object({
        access_token: z.string().optional(),
        refresh_token: z.string().optional(),
        id_token: z.string().optional(),
        account_id: z.string().optional(),
      })
      .passthrough()
      .optional(),
    last_refresh: z.string().optional(),
    api_base_url: z.string().optional(),
  })
  .passthrough();

/**
 * Captures CODEX_HOME relative to the host cwd, trimmed and absolute; otherwise
 * uses the OS profile, never HOME || USERPROFILE. Evidence: TASK_2026_714_c8a2
 * code-logic-review-batch-2c.md findings 1-3 (Codex OS-profile behavior) and
 * harness-sync targets/mcp/codex-home.ts codexHomeDir's trim/homedir convention.
 * Explicit context homes are normalized by the runtime before entering the port.
 */
export function resolveCodexHome(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  homeDirectory: () => string = homedir,
): string {
  return resolve(
    environment['CODEX_HOME']?.trim() || join(homeDirectory(), '.codex'),
  );
}

interface HomeEntry {
  readonly state: HomeAuthState;
  readonly listeners: Set<(event: CodexHomeAuthEvent) => void>;
  generation: number;
}

/** One credential owner per host workspace-provider instance, until DI registration in 5c. */
export class CodexHomeAuthService implements CodexHomeAuthReader {
  private static readonly owners = new WeakMap<
    IWorkspaceProvider,
    CodexHomeAuthService
  >();
  private readonly homes = new Map<string, HomeEntry>();

  static forHost(
    logger: Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>,
    workspaceProvider: IWorkspaceProvider,
  ): CodexHomeAuthService {
    let owner = this.owners.get(workspaceProvider);
    if (!owner) {
      owner = new CodexHomeAuthService(logger, workspaceProvider);
      this.owners.set(workspaceProvider, owner);
    }
    return owner;
  }

  constructor(
    private readonly logger: Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>,
    private readonly workspaceProvider: IWorkspaceProvider,
  ) {}

  /** Backend compatibility surface only; the runtime port never exposes credentials. */
  forHome(home: string): ICodexAuthService {
    return this.entry(home).state;
  }
  isAuthenticated(home: string): Promise<boolean> {
    return this.forHome(home).isAuthenticated();
  }
  getUsageEligibility(home: string): Promise<CodexUsageEligibility> {
    return this.forHome(home).getAccountUsageEligibility();
  }
  ensureTokensFresh(home: string, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return Promise.resolve(false);
    const flight = this.forHome(home).ensureTokensFresh();
    if (!signal) return flight;
    // Cancellation affects this waiter only, not another consumer's rotating-token write.
    return new Promise((resolveResult) => {
      const abort = () => {
        signal.removeEventListener('abort', abort);
        resolveResult(false);
      };
      signal.addEventListener('abort', abort, { once: true });
      void flight.then((result) => {
        signal.removeEventListener('abort', abort);
        resolveResult(signal.aborted ? false : result);
      });
    });
  }
  watch(
    home: string,
    listener: (event: CodexHomeAuthEvent) => void,
  ): IDisposable {
    const entry = this.entry(home);
    const subscription = (event: CodexHomeAuthEvent) => listener(event);
    entry.listeners.add(subscription);
    entry.state.startWatchingAuthFile();
    return {
      dispose: () => {
        entry.listeners.delete(subscription);
        if (!entry.listeners.size) entry.state.stopWatchingAuthFile();
      },
    };
  }
  private entry(home: string): HomeEntry {
    const key = resolve(home);
    let entry = this.homes.get(key);
    if (!entry) {
      const listeners = new Set<(event: CodexHomeAuthEvent) => void>();
      const created: HomeEntry = {
        listeners,
        generation: 0,
        state: new HomeAuthState(
          this.logger,
          this.workspaceProvider,
          key,
          (kind) => {
            created.generation += 1;
            for (const listener of listeners) {
              try {
                listener({ home: key, generation: created.generation, kind });
              } catch {
                this.logger.warn('[CodexAuth] Auth change listener failed.');
              }
            }
          },
        ),
      };
      entry = created;
      this.homes.set(key, entry);
    }
    return entry;
  }
}

/** Debounce window (ms) to coalesce the burst of fs events a single write emits. */
const WATCH_DEBOUNCE_MS = 250;

/**
 * Default OAuth token endpoint used by the Codex CLI to refresh ChatGPT
 * subscription tokens. Overridable via settings for self-hosted proxies.
 */
const DEFAULT_OAUTH_TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token';

/**
 * Public OAuth client id used by the Codex CLI (PKCE public client — not a
 * secret). Overridable via settings to match a custom auth deployment.
 */
const DEFAULT_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

/** Network timeout (ms) for the refresh request. */
const REFRESH_TIMEOUT_MS = 30_000;

/** Shape of the OAuth refresh response. Validated at the network boundary. */
const refreshResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
});

/** Default Codex API endpoint for API key auth mode */
const DEFAULT_API_ENDPOINT_APIKEY = 'https://api.openai.com/v1';

/**
 * Default Codex API endpoint for OAuth (ChatGPT subscription) auth mode.
 * OAuth tokens from `codex login` are ChatGPT subscription tokens — they
 * authenticate against the ChatGPT backend API, NOT the public api.openai.com.
 * Using api.openai.com with OAuth tokens fails with 401 "Missing scopes: api.responses.write".
 */
const DEFAULT_API_ENDPOINT_OAUTH = 'https://chatgpt.com/backend-api/codex';

/**
 * The Codex `/models` endpoint hides each model from clients older than that
 * model's minimum version: on 2026-10-07 `0.0.0` returned 4 of the 7 listed
 * models and `0.162.0` returned all 7. The request sends the newer of this
 * floor and the `client_version` the local Codex app or CLI last wrote to
 * `models_cache.json`, so a newer local Codex lifts the floor without a release.
 */
const CODEX_MODELS_CLIENT_VERSION_FLOOR = '0.162.0';

/** Numeric `major.minor.patch` compare; a missing or non-numeric part counts as 0. */
function compareClientVersions(left: string, right: string): number {
  const parts = (value: string) =>
    value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const a = parts(left);
  const b = parts(right);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

class HomeAuthState implements ICodexAuthService {
  /** Cached auth file content to avoid repeated disk reads within short windows */
  private cachedAuth: CodexAuthFile | null = null;
  private cacheTimestamp = 0;

  /** Cache TTL: re-read auth file at most every 5 seconds */
  private static readonly CACHE_TTL_MS = 5_000;

  /** Single-flight guard so concurrent callers share one refresh request. */
  private refreshInFlight: Promise<boolean> | null = null;

  /** Active fs watcher on ~/.codex (null when not watching). */
  private watcher: FSWatcher | null = null;
  private watchDebounce: ReturnType<typeof setTimeout> | null = null;
  /** Suppress watcher emit while we write our own refreshed tokens back. */
  private suppressWatchUntil = 0;

  constructor(
    private readonly logger: Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>,
    private readonly workspaceProvider: IWorkspaceProvider,
    private readonly home: string,
    private readonly notify: (kind: CodexHomeAuthEvent['kind']) => void,
  ) {}

  private get authFilePath(): string {
    return join(this.home, 'auth.json');
  }

  async getAccountUsageEligibility(): Promise<
    'supported' | 'unsupported-auth' | 'unsupported-config'
  > {
    const auth = await this.readAuthFile();
    if (!auth || this.getApiKey(auth) || auth.auth_mode === 'ApiKey') {
      return 'unsupported-auth';
    }
    if (auth.api_base_url || this.getOAuthApiEndpoint()) {
      return 'unsupported-config';
    }
    return auth.tokens?.access_token ? 'supported' : 'unsupported-auth';
  }

  /**
   * Begin watching ~/.codex/auth.json for external changes (e.g. the user
   * running `codex login` in a terminal). On change, the cache is invalidated
   * and an `authFileChanged` event is broadcast so the adapter can re-init.
   *
   * Idempotent. No-ops when ~/.codex does not exist yet.
   */
  startWatchingAuthFile(): void {
    if (this.watcher) return;

    const dir = dirname(this.authFilePath);
    const file = basename(this.authFilePath);
    if (!existsSync(dir)) {
      this.logger.debug(
        '[CodexAuth] ~/.codex not present yet — auth file watch skipped.',
      );
      return;
    }

    try {
      this.watcher = watch(dir, (_eventType, changedName) => {
        // Some platforms omit the filename; treat null as "maybe ours".
        if (changedName && changedName !== file) return;
        this.handleAuthFileEvent();
      });
      this.watcher.on('error', () => {
        this.stopWatchingAuthFile();
        this.logger.warn(`[CodexAuth] Auth file watcher error: unavailable`);
      });
      this.logger.info('[CodexAuth] Watching ~/.codex/auth.json for changes.');
    } catch {
      this.logger.warn(
        `[CodexAuth] Failed to start auth file watcher: unavailable`,
      );
    }
  }

  /** Stop watching the auth file and clear any pending debounce. */
  stopWatchingAuthFile(): void {
    if (this.watchDebounce) {
      clearTimeout(this.watchDebounce);
      this.watchDebounce = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Debounced auth-file change handler. Ignores changes we caused ourselves
   * (our own refresh write), invalidates the cache, then broadcasts the change.
   */
  private handleAuthFileEvent(): void {
    if (Date.now() < this.suppressWatchUntil) return;
    if (this.watchDebounce) clearTimeout(this.watchDebounce);
    this.watchDebounce = setTimeout(() => {
      this.watchDebounce = null;
      this.clearCache();
      this.notify(existsSync(this.authFilePath) ? 'changed' : 'removed');
    }, WATCH_DEBOUNCE_MS);
    this.watchDebounce.unref?.();
  }

  /**
   * Get the API key from the auth file, checking both snake_case and
   * SCREAMING_CASE field names for compatibility.
   */
  private getApiKey(auth: CodexAuthFile): string | null {
    return auth.openai_api_key || auth.OPENAI_API_KEY || null;
  }

  /**
   * Read the Codex OAuth API endpoint from VS Code settings.
   * Returns empty string when unconfigured (OAuth proxy disabled).
   */
  private getOAuthApiEndpoint(): string {
    return (
      this.workspaceProvider.getConfiguration<string>(
        'ptah',
        'provider.openai-codex.oauthApiEndpoint',
        '',
      ) ?? ''
    );
  }

  /**
   * Check whether valid Codex credentials are available.
   * Returns true if an API key or access token is present in ~/.codex/auth.json.
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      const auth = await this.readAuthFile();
      if (!auth) return false;
      if (this.getApiKey(auth)) return true;
      return !!auth.tokens?.access_token;
    } catch {
      return false;
    }
  }

  /**
   * Get HTTP headers required for Codex API requests.
   * Includes authorization with the best available token.
   *
   * @throws Error if no valid credentials are available
   */
  async getHeaders(): Promise<Record<string, string>> {
    const token = await this.resolveAccessToken();
    if (!token) {
      throw new SdkError(
        'Not authenticated with Codex. Run `codex login` to authenticate.',
      );
    }

    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Get the Codex API base endpoint URL.
   *
   * Resolution order:
   * 1. api_base_url from auth file (explicit override)
   * 2. API key mode → https://api.openai.com/v1
   * 3. OAuth mode → user-configured endpoint from settings, or ChatGPT backend default
   */
  getApiEndpoint(): string {
    if (this.cachedAuth?.api_base_url) {
      return this.cachedAuth.api_base_url;
    }
    const authMode = this.cachedAuth?.auth_mode;
    if (
      authMode === 'ApiKey' ||
      (this.cachedAuth && this.getApiKey(this.cachedAuth))
    ) {
      return DEFAULT_API_ENDPOINT_APIKEY;
    }
    const oauthEndpoint = this.getOAuthApiEndpoint();
    if (oauthEndpoint) {
      this.logger.debug(
        '[CodexAuth] Using custom OAuth API endpoint from settings.',
      );
      return oauthEndpoint;
    }

    this.logger.debug(
      `[CodexAuth] Using default OAuth API endpoint: ${DEFAULT_API_ENDPOINT_OAUTH}`,
    );
    return DEFAULT_API_ENDPOINT_OAUTH;
  }

  /**
   * List models available to the authenticated Codex account via the
   * provider's /models endpoint. Returns an empty array when not authenticated
   * or on any error.
   *
   * Handles both response shapes:
   * - ChatGPT backend (OAuth): `{ models: [{ slug, display_name, ... }] }`,
   *   already scoped to the account; only listed (non-hidden) models are kept.
   * - OpenAI API (API key): `{ data: [{ id }] }`, filtered to Codex/GPT-5 ids.
   */
  async listModels(): Promise<ProviderModelInfo[]> {
    try {
      const token = await this.resolveAccessToken();
      if (!token) return [];
      const clientVersion = await this.resolveModelsClientVersion();
      const endpoint = `${this.getApiEndpoint()}/models?client_version=${clientVersion}`;
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return [];
      const data = (await response.json()) as {
        models?: Array<{
          slug: string;
          display_name?: string;
          description?: string;
          context_window?: number;
          visibility?: string;
        }>;
        data?: Array<{ id: string; owned_by?: string }>;
      };

      if (Array.isArray(data.models)) {
        return data.models
          .filter((m) => m.visibility === 'list')
          .map((m) => ({
            id: m.slug,
            name: m.display_name ?? m.slug,
            description: m.description ?? '',
            contextLength: m.context_window ?? 0,
            ...(typeof m.context_window === 'number' &&
            Number.isFinite(m.context_window) &&
            m.context_window > 0
              ? { contextLengthSource: 'provider' as const }
              : {}),
            supportsToolUse: true,
          }));
      }

      return (data.data ?? [])
        .filter((m) => /codex|gpt-5/i.test(m.id))
        .map((m) => ({
          id: m.id,
          name: m.id,
          description: '',
          contextLength: 0,
          supportsToolUse: true,
        }));
    } catch {
      return [];
    }
  }

  /**
   * Get the current Codex token status for auth UI display.
   * Used by auth status RPC to show warning badges in the UI.
   *
   * When `stale` is true, the OAuth token has expired and the user
   * must run `codex login` to re-authenticate.
   */
  async getTokenStatus(): Promise<{ authenticated: boolean; stale: boolean }> {
    const auth = await this.readAuthFile();
    if (!auth) {
      return { authenticated: false, stale: false };
    }
    if (auth.openai_api_key || auth.OPENAI_API_KEY) {
      return { authenticated: true, stale: false };
    }
    if (!auth.tokens?.access_token) {
      return { authenticated: false, stale: false };
    }

    const stale = this.isTokenStale(auth);
    return { authenticated: true, stale };
  }

  /**
   * Invalidate the in-memory auth file cache.
   * Forces the next readAuthFile() call to read from disk.
   * Called during clearAuthentication() to prevent stale data after provider switch.
   */
  clearCache(): void {
    this.cachedAuth = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Check if credentials are available and not stale.
   *
   * For API key mode, returns true (API keys don't expire).
   * For OAuth mode, returns true if the token is fresh. When stale, attempts a
   * silent refresh using the stored refresh_token; only returns false (user
   * must run `codex login`) when no refresh_token exists or the refresh fails.
   */
  ensureTokensFresh(): Promise<boolean> {
    // The flight is also the per-home lock: disk read through rename is serialized.
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.checkAndRefresh()
      .catch(() => {
        this.logger.warn(
          '[CodexAuth] Credential refresh unavailable. Run `codex login` to re-authenticate.',
        );
        return false;
      })
      .finally(() => {
        this.refreshInFlight = null;
      });
    return this.refreshInFlight;
  }

  private async checkAndRefresh(): Promise<boolean> {
    this.clearCache();
    const auth = await this.readAuthFile();
    if (!auth) return false;
    if (this.getApiKey(auth)) return true;
    if (!auth.tokens?.access_token) return false;
    if (!this.isTokenStale(auth)) return true;
    const refreshToken = auth.tokens.refresh_token;
    if (!refreshToken) {
      this.logger.warn(
        '[CodexAuth] OAuth token expired and no refresh_token present. Run `codex login` to re-authenticate.',
      );
      return false;
    }
    if (this.failedRefreshToken === refreshToken) return false;
    const refreshed = await this.performRefresh(refreshToken);
    // An ambiguous rotating-token response must not be retried on the next call.
    this.failedRefreshToken = refreshed ? undefined : refreshToken;
    return refreshed;
  }

  private failedRefreshToken: string | undefined;

  /**
   * Attempt a silent OAuth token refresh using the stored refresh_token.
   * Concurrent callers share a single in-flight request. On success, the new
   * tokens are written back to ~/.codex/auth.json and the cache invalidated.
   */
  private async performRefresh(refreshToken: string): Promise<boolean> {
    const endpoint = this.getOAuthTokenEndpoint();
    const clientId = this.getOAuthClientId();

    try {
      this.logger.info('[CodexAuth] Refreshing expired OAuth token...');
      const response = await axios.post(
        endpoint,
        {
          client_id: clientId,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          scope: 'openid profile email',
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: REFRESH_TIMEOUT_MS,
        },
      );

      const parsed = refreshResponseSchema.safeParse(response.data);
      if (!parsed.success) {
        this.logger.warn(
          '[CodexAuth] OAuth refresh response missing access_token. Run `codex login` to re-authenticate.',
        );
        return false;
      }

      await this.persistRefreshedTokens(parsed.data, refreshToken);
      this.clearCache();
      this.notify('refreshed');
      this.logger.info('[CodexAuth] OAuth token refreshed successfully.');
      return true;
    } catch (error) {
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      this.logger.warn(
        `[CodexAuth] OAuth token refresh failed${
          status ? ` (HTTP ${status})` : ''
        }. Run \`codex login\` to re-authenticate.`,
      );
      return false;
    }
  }

  /**
   * Merge refreshed tokens into the current auth file and write it back
   * atomically (temp file + rename) to avoid partial writes.
   */
  private async persistRefreshedTokens(
    refreshed: z.infer<typeof refreshResponseSchema>,
    refreshToken: string,
  ): Promise<void> {
    const current = await this.readAuthFileFromDisk();
    if (
      !current ||
      current.tokens?.refresh_token !== refreshToken ||
      this.getApiKey(current)
    ) {
      throw new Error('Auth changed during refresh');
    }
    const next: CodexAuthFile = {
      ...current,
      tokens: {
        ...current?.tokens,
        access_token: refreshed.access_token,
        refresh_token:
          refreshed.refresh_token ?? current?.tokens?.refresh_token,
        id_token: refreshed.id_token ?? current?.tokens?.id_token,
      },
      last_refresh: new Date().toISOString(),
    };

    // Suppress the watcher: this write is ours, not an external `codex login`.
    this.suppressWatchUntil = Date.now() + WATCH_DEBOUNCE_MS * 4;
    const tmpPath = `${this.authFilePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmpPath, JSON.stringify(next, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
        flag: 'wx',
      });
      await rename(tmpPath, this.authFilePath);
    } finally {
      await unlink(tmpPath).catch(() => undefined);
    }
  }

  /** Read the OAuth token endpoint from settings, falling back to the default. */
  private getOAuthTokenEndpoint(): string {
    const configured = this.workspaceProvider.getConfiguration<string>(
      'ptah',
      'provider.openai-codex.oauthTokenEndpoint',
      '',
    );
    return configured || DEFAULT_OAUTH_TOKEN_ENDPOINT;
  }

  /** Read the OAuth client id from settings, falling back to the default. */
  private getOAuthClientId(): string {
    const configured = this.workspaceProvider.getConfiguration<string>(
      'ptah',
      'provider.openai-codex.oauthClientId',
      '',
    );
    return configured || DEFAULT_OAUTH_CLIENT_ID;
  }

  /**
   * Resolve the best available access token.
   * API key takes priority over OAuth tokens.
   * Warns if OAuth token looks stale but still returns it (let the API reject it).
   */
  private async resolveAccessToken(): Promise<string | null> {
    try {
      const auth = await this.readAuthFile();
      if (!auth) return null;
      const apiKey = this.getApiKey(auth);
      if (apiKey) return apiKey;

      if (!auth.tokens?.access_token) return null;
      if (this.isTokenStale(auth)) {
        this.logger.warn(
          '[CodexAuth] OAuth token may be expired. If API calls fail, run `codex login` to re-authenticate.',
        );
      }

      return auth.tokens.access_token;
    } catch {
      this.logger.error(
        `[CodexAuth] Failed to resolve access token: unavailable`,
      );
      return null;
    }
  }

  /**
   * Read and parse the Codex auth file.
   * Uses a short-lived cache to avoid excessive disk I/O.
   */
  private async readAuthFile(): Promise<CodexAuthFile | null> {
    const now = Date.now();
    if (
      this.cachedAuth &&
      now - this.cacheTimestamp < HomeAuthState.CACHE_TTL_MS
    ) {
      return this.cachedAuth;
    }

    try {
      const raw = await readFile(this.authFilePath, 'utf-8');
      const auth = authFileSchema.parse(JSON.parse(raw));
      this.cachedAuth = auth;
      this.cacheTimestamp = now;
      return auth;
    } catch (error) {
      this.cachedAuth = null;
      this.cacheTimestamp = 0;

      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        this.logger.debug(
          '[CodexAuth] Auth file not found at ~/.codex/auth.json',
        );
      } else {
        this.logger.warn(`[CodexAuth] Failed to read auth file: unavailable`);
      }
      return null;
    }
  }

  /**
   * Read and parse the auth file directly from disk, bypassing the cache.
   * Used before an atomic write so we never clobber concurrent external edits.
   */
  /** See CODEX_MODELS_CLIENT_VERSION_FLOOR. */
  private async resolveModelsClientVersion(): Promise<string> {
    try {
      const raw = await readFile(join(this.home, 'models_cache.json'), 'utf-8');
      const cached = (JSON.parse(raw) as { client_version?: unknown })
        .client_version;
      if (
        typeof cached === 'string' &&
        /^\d+\.\d+\.\d+$/.test(cached) &&
        compareClientVersions(cached, CODEX_MODELS_CLIENT_VERSION_FLOOR) > 0
      ) {
        return cached;
      }
    } catch {
      // degradation-audit: optional-capability - no readable cache means no
      // local Codex has fetched models yet; the floor is the documented value.
    }
    return CODEX_MODELS_CLIENT_VERSION_FLOOR;
  }

  private async readAuthFileFromDisk(): Promise<CodexAuthFile | null> {
    try {
      const raw = await readFile(this.authFilePath, 'utf-8');
      return authFileSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  /**
   * Whether the stored OAuth token should be treated as expired.
   *
   * Delegates to the ONE shared rule (`isCodexAccessTokenStale`) so this
   * service and `CodexCliAdapter.ensureTokensFresh` cannot disagree about the
   * same `auth.json`. The token's own JWT `exp` is authoritative; the
   * `last_refresh` age heuristic is the fallback for opaque tokens only — it
   * used to be the whole rule, which reported a ChatGPT-subscription token
   * valid for another nine days as permanently stale (TASK_2026_342).
   */
  private isTokenStale(auth: CodexAuthFile): boolean {
    return isCodexAccessTokenStale({
      accessToken: auth.tokens?.access_token,
      lastRefresh: auth.last_refresh,
    });
  }
}
