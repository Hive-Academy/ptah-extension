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
 * - ApiKey → https://api.openai.com/v1
 * - OAuth → user-configured endpoint from settings, or https://chatgpt.com/backend-api/codex
 *
 * When an OAuth token expires, the user is directed to run `codex login`.
 *
 * Security: NEVER logs full tokens -- only length and first 4 characters.
 *
 * APPROVED EXCEPTION: This file does NOT import vscode — it reads credentials from
 * ~/.codex/auth.json using Node.js fs APIs. No platform abstraction needed.
 */

import { injectable, inject } from 'tsyringe';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { SdkError } from '../../errors';
import type { ICodexAuthService, CodexAuthFile } from './codex-provider.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Path to the Codex auth file */
const AUTH_FILE_PATH = join(homedir(), '.codex', 'auth.json');

/** Max age (ms) before considering token stale. OAuth tokens last ~1h; consider stale at 50 min. */
const TOKEN_MAX_AGE_MS = 50 * 60 * 1000;

/** Default Codex API endpoint for API key auth mode */
const DEFAULT_API_ENDPOINT_APIKEY = 'https://api.openai.com/v1';

/**
 * Default Codex API endpoint for OAuth (ChatGPT subscription) auth mode.
 * OAuth tokens from `codex login` are ChatGPT subscription tokens — they
 * authenticate against the ChatGPT backend API, NOT the public api.openai.com.
 * Using api.openai.com with OAuth tokens fails with 401 "Missing scopes: api.responses.write".
 */
const DEFAULT_API_ENDPOINT_OAUTH = 'https://chatgpt.com/backend-api/codex';

// ---------------------------------------------------------------------------
// Service Implementation
// ---------------------------------------------------------------------------

@injectable()
export class CodexAuthService implements ICodexAuthService {
  /** Cached auth file content to avoid repeated disk reads within short windows */
  private cachedAuth: CodexAuthFile | null = null;
  private cacheTimestamp = 0;

  /** Cache TTL: re-read auth file at most every 5 seconds */
  private static readonly CACHE_TTL_MS = 5_000;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
  ) {}

  /**
   * Get the API key from the auth file, checking both snake_case and
   * SCREAMING_CASE field names for compatibility.
   */
  private getApiKey(auth: CodexAuthFile): string | null {
    // Codex CLI writes snake_case; check both for safety
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
    // Explicit override from auth file always wins
    if (this.cachedAuth?.api_base_url) {
      return this.cachedAuth.api_base_url;
    }

    // API key mode uses the public OpenAI API endpoint
    const authMode = this.cachedAuth?.auth_mode;
    if (
      authMode === 'ApiKey' ||
      (this.cachedAuth && this.getApiKey(this.cachedAuth))
    ) {
      return DEFAULT_API_ENDPOINT_APIKEY;
    }

    // OAuth mode: read endpoint from settings, or use the ChatGPT backend default
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
   * Check if credentials are available and not stale.
   * Returns false if OAuth token needs re-login.
   *
   * For API key mode, returns true (API keys don't expire).
   * For OAuth mode, returns false if the token is stale (user must run `codex login`).
   */
  async ensureTokensFresh(): Promise<boolean> {
    this.cacheTimestamp = 0; // Force re-read from disk

    try {
      const auth = await this.readAuthFile();
      if (!auth) return false;

      // API keys never expire
      if (this.getApiKey(auth)) return true;

      // OAuth tokens: check presence only (we don't refresh anymore)
      if (!auth.tokens?.access_token) return false;

      if (this.isTokenStale(auth.last_refresh)) {
        this.logger.warn(
          '[CodexAuth] OAuth token appears expired. Run `codex login` to re-authenticate.',
        );
        return false;
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
   * Warns if OAuth token looks stale but still returns it (let the API reject it).
   */
  private async resolveAccessToken(): Promise<string | null> {
    try {
      const auth = await this.readAuthFile();
      if (!auth) return null;

      // API key takes priority -- never expires
      const apiKey = this.getApiKey(auth);
      if (apiKey) return apiKey;

      if (!auth.tokens?.access_token) return null;

      // Warn if token looks stale (but still return it -- let the API reject it)
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
}
