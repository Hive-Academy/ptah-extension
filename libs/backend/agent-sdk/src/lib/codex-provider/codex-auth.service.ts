/**
 * Codex Authentication Service - TASK_2025_193 Batch 3
 *
 * Reads and manages Codex authentication from ~/.codex/auth.json,
 * the auth file written by the Codex CLI (`codex login`).
 *
 * Auth resolution priority:
 * 1. OPENAI_API_KEY field (never expires, highest priority)
 * 2. OAuth tokens.access_token (refreshed proactively when stale)
 *
 * OAuth token refresh is deduplicated to prevent race conditions
 * with single-use refresh tokens. Updated tokens are written atomically
 * (write to .tmp then rename) to avoid file corruption.
 *
 * Security: NEVER logs full tokens -- only length and first 4 characters.
 */

import { injectable, inject } from 'tsyringe';
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

/** Default Codex API endpoint */
const DEFAULT_API_ENDPOINT = 'https://api.chatgpt.com';

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
   * Check whether valid Codex credentials are available.
   * Returns true if an API key or access token is present in ~/.codex/auth.json.
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      const auth = await this.readAuthFile();
      if (!auth) return false;

      // API key is always valid
      if (auth.OPENAI_API_KEY) return true;

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
        'Not authenticated with Codex. Run `codex login` to authenticate.'
      );
    }

    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Get the Codex API base endpoint URL.
   * Uses api_base_url from the auth file if present, otherwise defaults
   * to https://api.chatgpt.com.
   */
  getApiEndpoint(): string {
    // Use cached auth if fresh enough; fall back to default if unavailable.
    // This is synchronous because the proxy calls it frequently and the
    // cached value is almost always available after the first readAuthFile().
    if (this.cachedAuth?.api_base_url) {
      return this.cachedAuth.api_base_url;
    }
    return DEFAULT_API_ENDPOINT;
  }

  /**
   * Proactively refresh OAuth tokens if they are stale.
   * Called during extension startup and on auth failures.
   *
   * @returns true if tokens are fresh (or were successfully refreshed)
   */
  async ensureTokensFresh(): Promise<boolean> {
    try {
      const auth = await this.readAuthFile();
      if (!auth) return false;

      // API key never expires
      if (auth.OPENAI_API_KEY) return true;

      // No tokens at all
      if (!auth.tokens?.access_token || !auth.tokens.refresh_token) {
        return false;
      }

      // Refresh if stale
      if (this.isTokenStale(auth.last_refresh)) {
        this.logger.info(
          '[CodexAuth] Token appears stale, refreshing proactively...'
        );
        const refreshed = await this.refreshAccessToken(auth);
        return refreshed !== null;
      }

      return true;
    } catch (error) {
      this.logger.error(
        `[CodexAuth] ensureTokensFresh failed: ${
          error instanceof Error ? error.message : String(error)
        }`
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
      if (auth.OPENAI_API_KEY) {
        return auth.OPENAI_API_KEY;
      }

      if (!auth.tokens?.access_token) return null;

      // Proactively refresh if token looks stale
      if (auth.tokens.refresh_token && this.isTokenStale(auth.last_refresh)) {
        this.logger.info(
          '[CodexAuth] Token stale, attempting refresh before use...'
        );
        const refreshed = await this.refreshAccessToken(auth);
        if (refreshed) return refreshed;
      }

      return auth.tokens.access_token;
    } catch (error) {
      this.logger.error(
        `[CodexAuth] Failed to resolve access token: ${
          error instanceof Error ? error.message : String(error)
        }`
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
          '[CodexAuth] Auth file not found at ~/.codex/auth.json'
        );
      } else {
        this.logger.warn(
          `[CodexAuth] Failed to read auth file: ${
            error instanceof Error ? error.message : String(error)
          }`
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
    auth: CodexAuthFile
  ): Promise<string | null> {
    if (!auth.tokens?.refresh_token) return null;

    // Deduplicate concurrent refresh calls
    if (this.refreshInFlight) {
      this.logger.debug(
        '[CodexAuth] Refresh already in flight, waiting for result...'
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
    auth: CodexAuthFile
  ): Promise<string | null> {
    try {
      this.logger.info(
        `[CodexAuth] Refreshing OAuth token (refresh_token: ${describeToken(
          auth.tokens!.refresh_token!
        )})`
      );

      const response = await fetch(REFRESH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: auth.tokens!.refresh_token!,
          client_id: OAUTH_CLIENT_ID,
        }).toString(),
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logger.warn(
          `[CodexAuth] Token refresh failed: HTTP ${response.status}`
        );
        return null;
      }

      const body = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
        id_token?: string;
        expires_in?: number;
      };

      if (!body.access_token) {
        this.logger.warn('[CodexAuth] Token refresh returned no access_token');
        return null;
      }

      this.logger.info(
        `[CodexAuth] Token refreshed successfully (new token: ${describeToken(
          body.access_token
        )})`
      );

      // Persist updated tokens atomically (write to .tmp, then rename)
      const updated: CodexAuthFile = {
        ...auth,
        tokens: {
          ...auth.tokens!,
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
      this.logger.error(
        `[CodexAuth] Token refresh error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  /**
   * Write the auth file atomically using write-to-temp-then-rename.
   * This prevents corruption if the process crashes mid-write or the
   * Codex CLI writes concurrently.
   */
  private async writeAuthFileAtomic(auth: CodexAuthFile): Promise<void> {
    const tmpPath = AUTH_FILE_PATH + '.tmp';
    try {
      await writeFile(tmpPath, JSON.stringify(auth, null, 2), 'utf-8');
      await rename(tmpPath, AUTH_FILE_PATH);
      this.logger.debug('[CodexAuth] Auth file updated atomically');
    } catch (error) {
      // Write failed but we still have the fresh access_token in memory.
      // Return without throwing so this session works; the stale refresh_token
      // on disk will be retried next time.
      this.logger.warn(
        `[CodexAuth] Failed to write auth file: ${
          error instanceof Error ? error.message : String(error)
        }. In-memory token is still valid.`
      );
    }
  }
}
