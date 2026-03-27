/**
 * Copilot Authentication Service - Platform-Agnostic
 *
 * Handles GitHub OAuth login via file-based token reading or device code flow,
 * exchanges the GitHub token for a Copilot bearer token, and manages
 * token lifecycle with auto-refresh.
 *
 * Auth resolution priority (base class):
 * 1. File-based token from ~/.config/github-copilot/hosts.json
 * 2. GitHub Device Code OAuth flow (RFC 8628)
 *
 * VS Code subclass (VscodeCopilotAuthService) adds:
 * 0. vscode.authentication.getSession() (highest priority, best UX)
 *
 * Pattern source: CodexAuthService (codex-auth.service.ts)
 * Security: NEVER logs full tokens — only length and first 4 characters.
 *
 * TASK_2025_224: Rewritten to remove all vscode imports.
 * Previously used vscode.authentication, vscode.extensions, vscode.version.
 */

import { injectable, inject } from 'tsyringe';
import axios from 'axios';
import { join } from 'node:path';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IPlatformInfo,
  IUserInteraction,
} from '@ptah-extension/platform-core';
import type {
  ICopilotAuthService,
  CopilotAuthState,
  CopilotTokenResponse,
} from './copilot-provider.types';
import { readCopilotToken, writeCopilotToken } from './copilot-file-auth';
import {
  executeDeviceCodeFlow,
  type DeviceCodeCallbacks,
} from './copilot-device-code-auth';

/** Token refresh buffer: refresh 5 minutes before actual expiry */
const TOKEN_REFRESH_BUFFER_SECONDS = 5 * 60;

/** Default Copilot API endpoint */
const DEFAULT_COPILOT_API_ENDPOINT = 'https://api.githubcopilot.com';

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
  protected authState: CopilotAuthState | null = null;

  /** In-flight refresh promise for deduplication */
  private refreshPromise: Promise<boolean> | null = null;

  /** Lazily resolved extension version for User-Agent headers */
  private extensionVersion: string | null = null;

  constructor(
    @inject(TOKENS.LOGGER) protected readonly logger: Logger,
    @inject(PLATFORM_TOKENS.PLATFORM_INFO)
    private readonly platformInfo: IPlatformInfo,
    @inject(PLATFORM_TOKENS.USER_INTERACTION)
    private readonly userInteraction: IUserInteraction,
  ) {}

  /**
   * Get the extension version from package.json at the extension path.
   * Cached after first read.
   */
  private getExtensionVersion(): string {
    if (this.extensionVersion) {
      return this.extensionVersion;
    }

    try {
      const pkg = require(
        join(this.platformInfo.extensionPath, 'package.json'),
      );
      this.extensionVersion = (pkg?.version as string) ?? '0.0.0';
    } catch {
      this.extensionVersion = '0.0.0';
    }

    return this.extensionVersion;
  }

  /**
   * Initiate GitHub OAuth login and exchange for a Copilot bearer token.
   *
   * Strategy (platform-agnostic):
   * 1. Try reading token from Copilot config file (~/.config/github-copilot/hosts.json)
   * 2. Fall back to GitHub Device Code OAuth flow (RFC 8628)
   *
   * The VscodeCopilotAuthService subclass adds VS Code native auth as highest priority.
   *
   * @returns true if authentication succeeded, false otherwise
   */
  async login(): Promise<boolean> {
    try {
      this.logger.info('[CopilotAuth] Starting authentication...');

      // Strategy 1: Try reading token from Copilot config file
      const fileToken = await readCopilotToken();
      if (fileToken) {
        this.logger.info(
          '[CopilotAuth] Found GitHub token in Copilot config file',
        );
        const exchanged = await this.exchangeToken(fileToken);
        if (exchanged) {
          return true;
        }
        this.logger.warn(
          '[CopilotAuth] File token exchange failed, falling back to device code flow',
        );
      }

      // Strategy 2: GitHub Device Code flow
      this.logger.info(
        '[CopilotAuth] Starting GitHub device code OAuth flow...',
      );
      const deviceToken = await this.executeDeviceCodeLogin();
      if (!deviceToken) {
        return false;
      }

      const exchanged = await this.exchangeToken(deviceToken);
      if (exchanged) {
        // Persist token to disk so the user doesn't need to re-authenticate
        // on app restart (especially important for Electron users).
        // writeCopilotToken is best-effort — failure is logged but doesn't
        // break the auth flow.
        try {
          await writeCopilotToken(deviceToken);
          this.logger.info(
            '[CopilotAuth] Device code token persisted to hosts.json',
          );
        } catch (persistError) {
          this.logger.warn(
            `[CopilotAuth] Failed to persist device code token: ${persistError instanceof Error ? persistError.message : String(persistError)}`,
          );
        }
      }
      return exchanged;
    } catch (error) {
      this.logger.error(
        `[CopilotAuth] Login failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * Execute the device code login flow, displaying the user code
   * via the platform-agnostic IUserInteraction service.
   */
  private async executeDeviceCodeLogin(): Promise<string | null> {
    const callbacks: DeviceCodeCallbacks = {
      onUserCode: (userCode, verificationUri) => {
        // Show the user code to the user via platform-agnostic UI
        this.userInteraction.showInformationMessage(
          `GitHub Copilot: Enter code ${userCode} at ${verificationUri}`,
          'Copy Code',
        );
      },
    };

    return executeDeviceCodeFlow(this.logger, callbacks);
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
        '[CopilotAuth] Token expiring soon, attempting auto-refresh...',
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
        'Not authenticated with GitHub Copilot. Call login() first.',
      );
    }

    const version = this.getExtensionVersion();
    return {
      Authorization: `Bearer ${state.bearerToken}`,
      'Content-Type': 'application/json',
      'Openai-Intent': 'conversation-edits',
      'User-Agent': `ptah-extension/${version}`,
      'Editor-Version': `ptah/${version}`,
      'Editor-Plugin-Version': `ptah/${version}`,
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
  // Protected helpers (accessible by VscodeCopilotAuthService subclass)
  // ---------------------------------------------------------------------------

  /**
   * Exchange a GitHub OAuth token for a Copilot bearer token.
   * Calls the undocumented Copilot internal token endpoint.
   *
   * Protected so VscodeCopilotAuthService can call it after obtaining
   * a GitHub token via VS Code's native authentication provider.
   *
   * @param githubToken - GitHub OAuth access token
   * @returns true if exchange succeeded
   */
  protected async exchangeToken(githubToken: string): Promise<boolean> {
    this.logger.info(
      `[CopilotAuth] Exchanging GitHub token for Copilot bearer (${describeToken(githubToken)})`,
    );

    try {
      const version = this.getExtensionVersion();
      const { data: tokenResponse } = await axios.get<CopilotTokenResponse>(
        COPILOT_TOKEN_URL,
        {
          headers: {
            Authorization: `token ${githubToken}`,
            Accept: 'application/json',
            'User-Agent': `ptah-extension/${version}`,
          },
          timeout: 15_000,
        },
      );

      if (!tokenResponse.token || !tokenResponse.expires_at) {
        this.logger.error(
          '[CopilotAuth] Token exchange returned invalid response (missing token or expires_at)',
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
        `[CopilotAuth] Bearer token obtained (${describeToken(tokenResponse.token)}, ` +
          `expires in ${Math.floor(expiresIn / 60)}m, endpoint: ${apiEndpoint})`,
      );
      return true;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        const body =
          typeof error.response.data === 'string'
            ? error.response.data
            : JSON.stringify(error.response.data);
        this.logger.error(
          `[CopilotAuth] Token exchange failed: HTTP ${error.response.status} — ${body}`,
        );

        if (error.response.status === 401) {
          this.logger.error(
            '[CopilotAuth] GitHub token may be invalid or expired',
          );
        } else if (error.response.status === 403) {
          this.logger.error(
            '[CopilotAuth] GitHub Copilot subscription may not be active. ' +
              'Ensure your GitHub account has an active Copilot subscription.',
          );
        }
        return false;
      }
      this.logger.error(
        `[CopilotAuth] Token exchange request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

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
   * If the GitHub token itself is invalid, tries to read a fresh token from file.
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

  protected async doRefreshToken(): Promise<boolean> {
    if (!this.authState) return false;

    this.logger.info('[CopilotAuth] Refreshing Copilot bearer token...');

    // Try re-exchanging the cached GitHub token first
    const success = await this.exchangeToken(this.authState.githubToken);
    if (success) {
      return true;
    }

    // Cached GitHub token may be stale — try reading a fresh one from file
    this.logger.info(
      '[CopilotAuth] Cached GitHub token may be stale, trying file-based refresh...',
    );
    const fileToken = await readCopilotToken();
    if (!fileToken) {
      this.logger.warn(
        '[CopilotAuth] No token available for refresh (file not found or empty)',
      );
      this.authState = null;
      return false;
    }

    const refreshed = await this.exchangeToken(fileToken);
    if (!refreshed) {
      this.logger.warn(
        '[CopilotAuth] File-based token refresh also failed, clearing auth state',
      );
      this.authState = null;
    }
    return refreshed;
  }
}
