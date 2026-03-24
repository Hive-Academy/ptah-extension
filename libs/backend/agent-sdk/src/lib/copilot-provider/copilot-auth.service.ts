/**
 * Copilot Authentication Service - TASK_2025_186 Batch 1
 *
 * Handles GitHub OAuth login via VS Code's built-in authentication,
 * exchanges the GitHub token for a Copilot bearer token, and manages
 * token lifecycle with auto-refresh.
 *
 * Security: NEVER logs full tokens — only length and first 4 characters.
 */

import { injectable, inject } from 'tsyringe';
// APPROVED EXCEPTION: vscode import required — CopilotAuthService uses VS Code-specific APIs
// (vscode.authentication, vscode.extensions, vscode.version) that have no platform-agnostic
// equivalent. GitHub Copilot integration is inherently VS Code-only. See TASK_2025_199.
import * as vscode from 'vscode';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type {
  ICopilotAuthService,
  CopilotAuthState,
  CopilotTokenResponse,
} from './copilot-provider.types';

/** Token refresh buffer: refresh 5 minutes before actual expiry */
const TOKEN_REFRESH_BUFFER_SECONDS = 5 * 60;

/** Default Copilot API endpoint */
const DEFAULT_COPILOT_API_ENDPOINT = 'https://api.githubcopilot.com';

/** Lazily resolved extension version for User-Agent headers */
function getExtensionVersion(): string {
  const ext = vscode.extensions.getExtension(
    'ptah-extensions.ptah-extension-vscode'
  );
  return ext?.packageJSON?.version ?? '0.0.0';
}

/** Copilot token exchange endpoint */
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';

/**
 * Safely describes a token for logging — never exposes the full value.
 * Returns format: "length=42, prefix=ghp_abc1..."
 */
function describeToken(token: string): string {
  return `length=${token.length}, prefix=${token.substring(0, 4)}...`;
}

@injectable()
export class CopilotAuthService implements ICopilotAuthService {
  /** Cached authentication state (in-memory only) */
  private authState: CopilotAuthState | null = null;

  /** In-flight refresh promise for deduplication */
  private refreshPromise: Promise<boolean> | null = null;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Initiate GitHub OAuth login and exchange for a Copilot bearer token.
   *
   * Uses VS Code's built-in GitHub authentication provider. If the user
   * is not signed in, VS Code will prompt them. The obtained GitHub token
   * is then exchanged for a Copilot-specific bearer token.
   *
   * @returns true if authentication succeeded, false otherwise
   */
  async login(): Promise<boolean> {
    try {
      this.logger.info(
        '[CopilotAuth] Starting GitHub authentication for Copilot...'
      );

      const session = await this.getGitHubSession(true);
      if (!session) {
        this.logger.warn(
          '[CopilotAuth] GitHub authentication was cancelled or failed'
        );
        return false;
      }

      this.logger.info(
        `[CopilotAuth] GitHub session obtained (account: ${session.account.label})`
      );

      const exchanged = await this.exchangeToken(session.accessToken);
      if (!exchanged) {
        return false;
      }

      this.logger.info('[CopilotAuth] Copilot authentication successful');
      return true;
    } catch (error) {
      this.logger.error(
        `[CopilotAuth] Login failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }

  /**
   * Check whether a valid (non-expired) Copilot bearer token is available.
   * Attempts auto-refresh if the token is about to expire.
   */
  async isAuthenticated(): Promise<boolean> {
    if (!this.authState) {
      return false;
    }

    // Check if token needs refresh (expired or within buffer)
    if (this.isTokenExpiringSoon()) {
      this.logger.info(
        '[CopilotAuth] Token expiring soon, attempting auto-refresh...'
      );
      const refreshed = await this.refreshToken();
      return refreshed;
    }

    return true;
  }

  /**
   * Get the current auth state, refreshing if needed.
   * Returns null if not authenticated.
   */
  async getAuthState(): Promise<CopilotAuthState | null> {
    if (!this.authState) {
      return null;
    }

    // Auto-refresh if expiring soon
    if (this.isTokenExpiringSoon()) {
      const refreshed = await this.refreshToken();
      if (!refreshed) {
        return null;
      }
    }

    return this.authState;
  }

  /**
   * Get the HTTP headers required for Copilot API requests.
   * Includes authorization, content-type, and Copilot-specific headers.
   *
   * @throws Error if not authenticated
   */
  async getHeaders(): Promise<Record<string, string>> {
    const state = await this.getAuthState();
    if (!state) {
      throw new Error(
        'Not authenticated with GitHub Copilot. Call login() first.'
      );
    }

    return {
      Authorization: `Bearer ${state.bearerToken}`,
      'Content-Type': 'application/json',
      'Openai-Intent': 'conversation-edits',
      'User-Agent': `ptah-extension/${getExtensionVersion()}`,
      'Editor-Version': `vscode/${vscode.version}`,
      'Editor-Plugin-Version': `ptah/${getExtensionVersion()}`,
      'Copilot-Integration-Id': 'vscode-chat',
      'x-initiator': 'user',
    };
  }

  /**
   * Clear cached auth state (logout).
   * Does not revoke the GitHub session — only clears the Copilot bearer token.
   */
  async logout(): Promise<void> {
    this.authState = null;
    this.logger.info('[CopilotAuth] Logged out, cached state cleared');
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Obtain a GitHub authentication session from VS Code.
   * Tries the 'copilot' scope first, falls back to 'read:user' if that fails.
   *
   * @param createIfNone - If true, prompt the user to sign in if not already
   */
  private async getGitHubSession(
    createIfNone: boolean
  ): Promise<vscode.AuthenticationSession | undefined> {
    // Try 'copilot' scope first (required for Copilot API access)
    try {
      const session = await vscode.authentication.getSession(
        'github',
        ['copilot'],
        { createIfNone }
      );
      if (session) {
        return session;
      }
    } catch (error) {
      this.logger.warn(
        `[CopilotAuth] 'copilot' scope failed, trying 'read:user' fallback: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // Fallback to 'read:user' scope
    try {
      const session = await vscode.authentication.getSession(
        'github',
        ['read:user'],
        { createIfNone }
      );
      return session;
    } catch (error) {
      this.logger.error(
        `[CopilotAuth] GitHub authentication failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return undefined;
    }
  }

  /**
   * Exchange a GitHub OAuth token for a Copilot bearer token.
   * Calls the undocumented Copilot internal token endpoint.
   *
   * @param githubToken - GitHub OAuth access token
   * @returns true if exchange succeeded
   */
  private async exchangeToken(githubToken: string): Promise<boolean> {
    this.logger.info(
      `[CopilotAuth] Exchanging GitHub token for Copilot bearer (${describeToken(
        githubToken
      )})`
    );

    try {
      const response = await fetch(COPILOT_TOKEN_URL, {
        method: 'GET',
        headers: {
          Authorization: `token ${githubToken}`,
          Accept: 'application/json',
          'User-Agent': `ptah-extension/${getExtensionVersion()}`,
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        const body = await response.text();
        this.logger.error(
          `[CopilotAuth] Token exchange failed: HTTP ${response.status} — ${body}`
        );

        if (response.status === 401) {
          this.logger.error(
            '[CopilotAuth] GitHub token may be invalid or expired'
          );
        } else if (response.status === 403) {
          this.logger.error(
            '[CopilotAuth] GitHub Copilot subscription may not be active. ' +
              'Ensure your GitHub account has an active Copilot subscription.'
          );
        }
        return false;
      }

      const tokenResponse: CopilotTokenResponse = await response.json();

      if (!tokenResponse.token || !tokenResponse.expires_at) {
        this.logger.error(
          '[CopilotAuth] Token exchange returned invalid response (missing token or expires_at)'
        );
        return false;
      }

      const apiEndpoint =
        tokenResponse.endpoints?.api ?? DEFAULT_COPILOT_API_ENDPOINT;

      this.authState = {
        githubToken,
        bearerToken: tokenResponse.token,
        expiresAt: tokenResponse.expires_at,
        apiEndpoint,
      };

      const expiresIn =
        tokenResponse.expires_at - Math.floor(Date.now() / 1000);
      this.logger.info(
        `[CopilotAuth] Bearer token obtained (${describeToken(
          tokenResponse.token
        )}, ` +
          `expires in ${Math.floor(expiresIn / 60)}m, endpoint: ${apiEndpoint})`
      );
      return true;
    } catch (error) {
      this.logger.error(
        `[CopilotAuth] Token exchange request failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }

  /**
   * Check if the current bearer token is expired or expiring within the refresh buffer.
   */
  private isTokenExpiringSoon(): boolean {
    if (!this.authState) return true;
    const nowSeconds = Math.floor(Date.now() / 1000);
    return this.authState.expiresAt - nowSeconds < TOKEN_REFRESH_BUFFER_SECONDS;
  }

  /**
   * Attempt to refresh the Copilot bearer token using the cached GitHub token.
   * If the GitHub token itself is invalid, tries to get a new GitHub session.
   */
  private async refreshToken(): Promise<boolean> {
    if (!this.authState) return false;

    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefreshToken().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  private async doRefreshToken(): Promise<boolean> {
    if (!this.authState) return false;

    this.logger.info('[CopilotAuth] Refreshing Copilot bearer token...');

    const success = await this.exchangeToken(this.authState.githubToken);
    if (success) {
      return true;
    }

    this.logger.info(
      '[CopilotAuth] Cached GitHub token may be stale, requesting fresh session...'
    );
    const session = await this.getGitHubSession(false);
    if (!session) {
      this.logger.warn(
        '[CopilotAuth] No active GitHub session available for refresh'
      );
      this.authState = null;
      return false;
    }

    return this.exchangeToken(session.accessToken);
  }
}
