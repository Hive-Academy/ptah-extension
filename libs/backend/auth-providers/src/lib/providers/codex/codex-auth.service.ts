/**
 * Codex Authentication Service
 *
 * Reads and manages Codex authentication from ~/.codex/auth.json,
 * the auth file written by the Codex CLI (`codex login`).
 *
 * Auth resolution priority:
 * 1. openai_api_key field (never expires, highest priority)
 * 2. OAuth tokens.access_token (read-only; when expired, user must run `codex login`)
 *
 * API endpoint depends on auth mode:
 * - ApiKey â†’ https://api.openai.com/v1
 * - OAuth â†’ user-configured endpoint from settings, or https://chatgpt.com/backend-api/codex
 *
 * When an OAuth token expires, the user is directed to run `codex login`.
 *
 * Security: NEVER logs full tokens -- only length and first 4 characters.
 *
 * APPROVED EXCEPTION: This file does NOT import vscode â€” it reads credentials from
 * ~/.codex/auth.json using Node.js fs APIs. No platform abstraction needed.
 */

import { injectable, inject } from 'tsyringe';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { watch, existsSync, type FSWatcher } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import axios from 'axios';
import { z } from 'zod';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { ProviderModelInfo } from '@ptah-extension/shared';
import {
  SdkError,
  SDK_TOKENS,
  type SdkAdapterEvents,
} from '@ptah-extension/agent-sdk';
import type { ICodexAuthService, CodexAuthFile } from './codex-provider.types';

/** Path to the Codex auth file */
const AUTH_FILE_PATH = join(homedir(), '.codex', 'auth.json');

/** Debounce window (ms) to coalesce the burst of fs events a single write emits. */
const WATCH_DEBOUNCE_MS = 250;

/** Max age (ms) before considering token stale. OAuth tokens last ~1h; consider stale at 50 min. */
const TOKEN_MAX_AGE_MS = 50 * 60 * 1000;

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
 * OAuth tokens from `codex login` are ChatGPT subscription tokens â€” they
 * authenticate against the ChatGPT backend API, NOT the public api.openai.com.
 * Using api.openai.com with OAuth tokens fails with 401 "Missing scopes: api.responses.write".
 */
const DEFAULT_API_ENDPOINT_OAUTH = 'https://chatgpt.com/backend-api/codex';

@injectable()
export class CodexAuthService implements ICodexAuthService {
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
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(SDK_TOKENS.SDK_ADAPTER_EVENTS)
    private readonly events: SdkAdapterEvents,
  ) {}

  /**
   * Begin watching ~/.codex/auth.json for external changes (e.g. the user
   * running `codex login` in a terminal). On change, the cache is invalidated
   * and an `authFileChanged` event is broadcast so the adapter can re-init.
   *
   * Idempotent. No-ops when ~/.codex does not exist yet.
   */
  startWatchingAuthFile(): void {
    if (this.watcher) return;

    const dir = dirname(AUTH_FILE_PATH);
    const file = basename(AUTH_FILE_PATH);
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
      this.watcher.on('error', (error) => {
        this.logger.warn(
          `[CodexAuth] Auth file watcher error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
      this.logger.info('[CodexAuth] Watching ~/.codex/auth.json for changes.');
    } catch (error) {
      this.logger.warn(
        `[CodexAuth] Failed to start auth file watcher: ${
          error instanceof Error ? error.message : String(error)
        }`,
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
      this.events.emitAuthFileChanged({
        providerId: 'openai-codex',
        timestamp: Date.now(),
      });
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
   * 2. API key mode â†’ https://api.openai.com/v1
   * 3. OAuth mode â†’ user-configured endpoint from settings, or ChatGPT backend default
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
        `[CodexAuth] Using custom OAuth API endpoint from settings: ${oauthEndpoint}`,
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
   * provider's /models endpoint, filtered to Codex/GPT-5 models. Returns an
   * empty array when not authenticated or on any error.
   */
  async listModels(): Promise<ProviderModelInfo[]> {
    try {
      const token = await this.resolveAccessToken();
      if (!token) return [];
      const endpoint = `${this.getApiEndpoint()}/models`;
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return [];
      const data = (await response.json()) as {
        data?: Array<{ id: string; owned_by?: string }>;
      };
      const models = data.data ?? [];
      return models
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

    const stale = this.isTokenStale(auth.last_refresh);
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
  async ensureTokensFresh(): Promise<boolean> {
    this.cacheTimestamp = 0; // Force re-read from disk

    try {
      const auth = await this.readAuthFile();
      if (!auth) return false;
      if (this.getApiKey(auth)) return true;
      if (!auth.tokens?.access_token) return false;

      if (!this.isTokenStale(auth.last_refresh)) {
        return true;
      }

      return await this.refreshAccessToken(auth);
    } catch (error) {
      this.logger.error(
        `[CodexAuth] ensureTokensFresh failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  /**
   * Attempt a silent OAuth token refresh using the stored refresh_token.
   * Concurrent callers share a single in-flight request. On success, the new
   * tokens are written back to ~/.codex/auth.json and the cache invalidated.
   */
  private async refreshAccessToken(auth: CodexAuthFile): Promise<boolean> {
    const refreshToken = auth.tokens?.refresh_token;
    if (!refreshToken) {
      this.logger.warn(
        '[CodexAuth] OAuth token expired and no refresh_token present. Run `codex login` to re-authenticate.',
      );
      return false;
    }

    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = this.performRefresh(refreshToken).finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  /**
   * Execute the OAuth refresh request and persist the rotated tokens.
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

      await this.persistRefreshedTokens(parsed.data);
      this.clearCache();
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
  ): Promise<void> {
    const current = await this.readAuthFileFromDisk();
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
    const tmpPath = `${AUTH_FILE_PATH}.tmp`;
    await writeFile(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
    await rename(tmpPath, AUTH_FILE_PATH);
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
      if (this.isTokenStale(auth.last_refresh)) {
        this.logger.warn(
          '[CodexAuth] OAuth token may be expired. If API calls fail, run `codex login` to re-authenticate.',
        );
      }

      return auth.tokens.access_token;
    } catch (error) {
      this.logger.error(
        `[CodexAuth] Failed to resolve access token: ${
          error instanceof Error ? error.message : String(error)
        }`,
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
      now - this.cacheTimestamp < CodexAuthService.CACHE_TTL_MS
    ) {
      return this.cachedAuth;
    }

    try {
      const raw = await readFile(AUTH_FILE_PATH, 'utf-8');
      const auth = JSON.parse(raw) as CodexAuthFile;
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
        this.logger.warn(
          `[CodexAuth] Failed to read auth file: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return null;
    }
  }

  /**
   * Read and parse the auth file directly from disk, bypassing the cache.
   * Used before an atomic write so we never clobber concurrent external edits.
   */
  private async readAuthFileFromDisk(): Promise<CodexAuthFile | null> {
    try {
      const raw = await readFile(AUTH_FILE_PATH, 'utf-8');
      return JSON.parse(raw) as CodexAuthFile;
    } catch {
      return null;
    }
  }

  /**
   * Check whether the stored token is likely expired based on last_refresh timestamp.
   */
  private isTokenStale(lastRefresh?: string): boolean {
    if (!lastRefresh) return true;
    try {
      const refreshTime = new Date(lastRefresh).getTime();
      if (isNaN(refreshTime)) return true;
      return Date.now() - refreshTime > TOKEN_MAX_AGE_MS;
    } catch {
      return true;
    }
  }
}
