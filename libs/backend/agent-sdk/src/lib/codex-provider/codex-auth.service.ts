/**
 * Codex Authentication Service - TASK_2025_193 Batch 3
 *
 * Reads and manages Codex authentication from ~/.codex/auth.json,
 * the auth file written by the Codex CLI (`codex login`).
 *
 * Auth resolution priority:
 * 1. openai_api_key field (never expires, highest priority)
 * 2. OAuth tokens.access_token (refreshed proactively when stale)
 *
 * API endpoint depends on auth mode:
 * - ApiKey → https://api.openai.com/v1
 * - Chatgpt (OAuth) → https://chatgpt.com/backend-api/codex
 *
 * OAuth token refresh is deduplicated to prevent race conditions
 * with single-use refresh tokens. Updated tokens are written atomically
 * (write to .tmp then rename) to avoid file corruption.
 *
 * Security: NEVER logs full tokens -- only length and first 4 characters.
 *
 * APPROVED EXCEPTION: This file does NOT import vscode — it reads credentials from
 * ~/.codex/auth.json using Node.js fs APIs. No platform abstraction needed.
 * See TASK_2025_199.
 */

import { injectable, inject } from 'tsyringe';
import axios from 'axios';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { ICodexAuthService, CodexAuthFile } from './codex-provider.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Path to the Codex auth file */
const AUTH_FILE_PATH = join(homedir(), '.codex', 'auth.json');

/** OAuth token refresh endpoint (same as Codex CLI uses) */
const REFRESH_URL = 'https://auth.openai.com/oauth/token';

/** OAuth client ID for Codex */
const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

/** Max age (ms) before proactive refresh. OAuth tokens last ~1h; refresh at 50 min. */
const TOKEN_MAX_AGE_MS = 50 * 60 * 1000;

/** Default Codex API endpoint for API key auth mode */
const DEFAULT_API_ENDPOINT_APIKEY = 'https://api.openai.com/v1';

/** Default Codex API endpoint for ChatGPT OAuth auth mode */
const DEFAULT_API_ENDPOINT_CHATGPT = 'https://chatgpt.com/backend-api/codex';

/** Timeout for refresh requests */
const REFRESH_TIMEOUT_MS = 10_000;

/**
 * Safely describes a token for logging -- never exposes the full value.
 */
function describeToken(token: string): string {
  return `length=${token.length}, prefix=${token.substring(0, 4)}...`;
}

// ---------------------------------------------------------------------------
// Service Implementation
// ---------------------------------------------------------------------------

@injectable()
export class CodexAuthService implements ICodexAuthService {
  /** Guard against concurrent refresh attempts (single-use refresh tokens) */
  private refreshInFlight: Promise<string | null> | null = null;

  /** Cached auth file content to avoid repeated disk reads within short windows */
  private cachedAuth: CodexAuthFile | null = null;
  private cacheTimestamp = 0;

  /** Cache TTL: re-read auth file at most every 5 seconds */
  private static readonly CACHE_TTL_MS = 5_000;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Get the API key from the auth file, checking both snake_case and
   * SCREAMING_CASE field names for compatibility.
   */
  private getApiKey(auth: CodexAuthFile): string | null {
    // Codex CLI writes snake_case; check both for safety
    return auth.openai_api_key || auth.OPENAI_API_KEY || null;
  }

  /**
   * Check whether valid Codex credentials are available.
   * Returns true if an API key or access token is present in ~/.codex/auth.json.
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      const auth = await this.readAuthFile();
      if (!auth) return false;

      // API key is always valid
      if (this.getApiKey(auth)) return true;

      // OAuth token must exist
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
      throw new Error(
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
   * 2. Auth mode-based default:
   *    - API key → https://api.openai.com/v1
   *    - ChatGPT OAuth → https://chatgpt.com/backend-api/codex
   */
  getApiEndpoint(): string {
    // Use cached auth if fresh enough; fall back to default if unavailable.
    // This is synchronous because the proxy calls it frequently and the
    // cached value is almost always available after the first readAuthFile().
    if (this.cachedAuth?.api_base_url) {
      return this.cachedAuth.api_base_url;
    }

    // Auth mode determines the default endpoint
    const authMode = this.cachedAuth?.auth_mode;
    if (
      authMode === 'ApiKey' ||
      (this.cachedAuth && this.getApiKey(this.cachedAuth))
    ) {
      return DEFAULT_API_ENDPOINT_APIKEY;
    }
    // ChatGPT OAuth mode (default for `codex login`)
    return DEFAULT_API_ENDPOINT_CHATGPT;
  }

  /**
   * Get the current Codex token status for auth UI display.
   * Used by auth status RPC to show warning badges in the UI.
   */
  async getTokenStatus(): Promise<{ authenticated: boolean; stale: boolean }> {
    const auth = await this.readAuthFile();
    if (!auth) {
      return { authenticated: false, stale: false };
    }

    // API key mode -- never expires
    if (auth.openai_api_key || auth.OPENAI_API_KEY) {
      return { authenticated: true, stale: false };
    }

    // OAuth mode -- check token presence and staleness
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
   * Proactively refresh OAuth tokens if they are stale.
   * Called during extension startup and on auth failures.
   *
   * @returns true if tokens are fresh (or were successfully refreshed).
   *          Returns false for API key auth (cannot refresh an API key).
   */
  async ensureTokensFresh(): Promise<boolean> {
    // Invalidate cache so we always read fresh data from disk.
    // This is critical for 401 retry: without it, the cache serves the same
    // stale token that caused the 401 in the first place.
    this.cacheTimestamp = 0;

    try {
      const auth = await this.readAuthFile();
      if (!auth) return false;

      // API keys cannot be refreshed. If the key is invalid/revoked, retrying
      // with the same key is pointless. Return false so the proxy does not
      // wastefully retry with the same bad key.
      if (this.getApiKey(auth)) {
        this.logger.warn(
          '[CodexAuth] ensureTokensFresh called with API key auth -- API keys cannot be refreshed. ' +
            'If you are seeing 401 errors, your API key may be invalid or revoked.',
        );
        return false;
      }

      // No tokens at all
      if (!auth.tokens?.access_token || !auth.tokens.refresh_token) {
        return false;
      }

      // Refresh if stale
      if (this.isTokenStale(auth.last_refresh)) {
        this.logger.info(
          '[CodexAuth] Token appears stale, refreshing proactively...',
        );
        const refreshed = await this.refreshAccessToken(auth);
        return refreshed !== null;
      }

      return true;
    } catch (error) {
      this.logger.error(
        `[CodexAuth] ensureTokensFresh failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve the best available access token.
   * API key takes priority over OAuth tokens.
   * Proactively refreshes stale OAuth tokens.
   */
  private async resolveAccessToken(): Promise<string | null> {
    try {
      const auth = await this.readAuthFile();
      if (!auth) return null;

      // API key takes priority -- never expires
      const apiKey = this.getApiKey(auth);
      if (apiKey) {
        return apiKey;
      }

      if (!auth.tokens?.access_token) return null;

      // Proactively refresh if token looks stale
      if (auth.tokens.refresh_token && this.isTokenStale(auth.last_refresh)) {
        this.logger.info(
          '[CodexAuth] Token stale, attempting refresh before use...',
        );
        const refreshed = await this.refreshAccessToken(auth);
        if (refreshed) return refreshed;
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
      // File not found or unreadable -- clear cache
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

  /**
   * Refresh the OAuth access token using the stored refresh token.
   * Guards against concurrent refresh attempts (single-use refresh tokens).
   * On success, writes updated tokens back to auth.json atomically.
   */
  private async refreshAccessToken(
    auth: CodexAuthFile,
  ): Promise<string | null> {
    if (!auth.tokens?.refresh_token) return null;

    // Deduplicate concurrent refresh calls
    if (this.refreshInFlight) {
      this.logger.debug(
        '[CodexAuth] Refresh already in flight, waiting for result...',
      );
      return this.refreshInFlight;
    }

    this.refreshInFlight = this.doRefreshAccessToken(auth);
    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  /**
   * Perform the actual OAuth token refresh.
   * POST to https://auth.openai.com/oauth/token with the refresh token.
   */
  private async doRefreshAccessToken(
    auth: CodexAuthFile,
  ): Promise<string | null> {
    // Guard: verify tokens and refresh_token are present
    const refreshToken = auth.tokens?.refresh_token;
    if (!refreshToken) {
      this.logger.warn(
        '[CodexAuth] Cannot refresh: auth file has no refresh_token',
      );
      return null;
    }

    try {
      this.logger.debug(
        `[CodexAuth] Refreshing OAuth token (refresh_token: ${describeToken(
          refreshToken,
        )})`,
      );

      const { data: body } = await axios.post<{
        access_token?: string;
        refresh_token?: string;
        id_token?: string;
        expires_in?: number;
      }>(
        REFRESH_URL,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: OAUTH_CLIENT_ID,
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: REFRESH_TIMEOUT_MS,
        },
      );

      if (!body.access_token) {
        this.logger.warn('[CodexAuth] Token refresh returned no access_token');
        return null;
      }

      this.logger.info(
        `[CodexAuth] Token refreshed successfully (new token: ${describeToken(
          body.access_token,
        )})`,
      );

      // Persist updated tokens atomically (write to .tmp, then rename)
      const updated: CodexAuthFile = {
        ...auth,
        tokens: {
          ...(auth.tokens ?? {}),
          access_token: body.access_token,
          ...(body.refresh_token && { refresh_token: body.refresh_token }),
          ...(body.id_token && { id_token: body.id_token }),
        },
        last_refresh: new Date().toISOString(),
      };

      await this.writeAuthFileAtomic(updated);

      // Update cache with fresh data
      this.cachedAuth = updated;
      this.cacheTimestamp = Date.now();

      return body.access_token;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        this.logger.warn(
          `[CodexAuth] Token refresh failed: HTTP ${error.response.status}`,
        );
        return null;
      }
      this.logger.error(
        `[CodexAuth] Token refresh error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /** Maximum number of retries for writing the auth file */
  private static readonly WRITE_RETRY_COUNT = 3;

  /**
   * Write the auth file atomically using write-to-temp-then-rename.
   * Retries up to 3 times on failure. If all retries fail, throws so the
   * caller knows the refresh token was NOT persisted to disk.
   *
   * This is critical because OAuth refresh tokens are single-use: once
   * consumed server-side, the old token on disk is invalid. If we fail
   * to persist the new token, the user must re-authenticate via `codex login`.
   */
  private async writeAuthFileAtomic(auth: CodexAuthFile): Promise<void> {
    const tmpPath = AUTH_FILE_PATH + '.tmp';
    let lastError: unknown;

    for (
      let attempt = 1;
      attempt <= CodexAuthService.WRITE_RETRY_COUNT;
      attempt++
    ) {
      try {
        await writeFile(tmpPath, JSON.stringify(auth, null, 2), 'utf-8');
        await rename(tmpPath, AUTH_FILE_PATH);
        this.logger.debug('[CodexAuth] Auth file updated atomically');
        return;
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `[CodexAuth] Auth file write attempt ${attempt}/${
            CodexAuthService.WRITE_RETRY_COUNT
          } failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // All retries exhausted -- the refresh token was consumed server-side
    // but NOT persisted to disk. The user will need to re-authenticate.
    this.logger.error(
      `[CodexAuth] CRITICAL: Failed to persist refreshed auth tokens after ${CodexAuthService.WRITE_RETRY_COUNT} attempts. ` +
        'The OAuth refresh token was consumed but not saved to disk. ' +
        'On next restart, authentication will fail. Run `codex login` to re-authenticate.',
    );
    throw new Error(
      `Failed to write auth file after ${
        CodexAuthService.WRITE_RETRY_COUNT
      } attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }
}
