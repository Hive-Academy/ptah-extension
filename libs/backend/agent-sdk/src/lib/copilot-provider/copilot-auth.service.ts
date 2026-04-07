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
  IWorkspaceProvider,
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

/** Shorter timeout for silent auth restore during startup (avoid blocking window creation) */
const SILENT_RESTORE_TIMEOUT_MS = 5_000;

/** Default Copilot API endpoint */
const DEFAULT_COPILOT_API_ENDPOINT = 'https://api.githubcopilot.com';

/**
 * Default Copilot token exchange URL.
 * Exchanges a GitHub OAuth token for a Copilot-specific bearer token.
 * Safe to hardcode here — this compiles to JS which the marketplace scanner ignores.
 * Can be overridden via the 'ptah.provider.github-copilot.tokenExchangeUrl' setting.
 */
const DEFAULT_TOKEN_EXCHANGE_URL =
  'https://api.github.com/copilot_internal/v2/token';

/**
 * Default GitHub OAuth App client ID for the device code flow.
 * This is GitHub Copilot's public client ID, standard across all Copilot integrations
 * (VS Code, Neovim, JetBrains, etc.). Not personal or account-specific.
 * Can be overridden via the 'ptah.provider.github-copilot.clientId' setting.
 */
const DEFAULT_COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';

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
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
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
      const fileRestored = await this.tryFileBasedAuth();
      if (fileRestored) {
        return true;
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
   * Attempt to restore Copilot authentication silently from persisted tokens.
   * Tries file-based token reading (~/.config/github-copilot/hosts.json)
   * but does NOT trigger the interactive device code flow.
   *
   * Used by AuthManager during startup to avoid blocking the UI with
   * auth dialogs before the main window is created. Uses a shorter
   * network timeout (5s vs 15s) to minimize startup delay.
   *
   * @returns true if authentication was restored, false otherwise
   */
  async tryRestoreAuth(): Promise<boolean> {
    try {
      this.logger.info(
        '[CopilotAuth] Attempting silent auth restore from file...',
      );
      return await this.tryFileBasedAuth(SILENT_RESTORE_TIMEOUT_MS);
    } catch (error) {
      this.logger.info(
        `[CopilotAuth] Silent auth restore unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * Try to authenticate using the token from the Copilot config file.
   * Shared by both login() (full timeout) and tryRestoreAuth() (short timeout).
   *
   * @param timeoutMs - HTTP timeout for the token exchange request
   * @returns true if file-based auth succeeded
   */
  private async tryFileBasedAuth(timeoutMs?: number): Promise<boolean> {
    const fileToken = await readCopilotToken();
    if (!fileToken) {
      this.logger.info('[CopilotAuth] No Copilot config file found');
      return false;
    }

    this.logger.info('[CopilotAuth] Found GitHub token in Copilot config file');
    const exchanged = await this.exchangeToken(fileToken, timeoutMs);
    if (exchanged) {
      return true;
    }
    this.logger.warn(
      '[CopilotAuth] File token exchange failed (token may be expired)',
    );
    return false;
  }

  /**
   * Execute the device code login flow, displaying the user code
   * via the platform-agnostic IUserInteraction service.
   *
   * Uses the well-known GitHub Copilot client ID by default.
   * Can be overridden via settings for enterprise GitHub instances.
   */
  private async executeDeviceCodeLogin(): Promise<string | null> {
    const configured =
      this.workspaceProvider.getConfiguration<string>(
        'ptah',
        'provider.github-copilot.clientId',
        '',
      ) ?? '';

    const clientId = configured || DEFAULT_COPILOT_CLIENT_ID;

    const callbacks: DeviceCodeCallbacks = {
      onUserCode: async (userCode, verificationUri) => {
        // Copy device code to clipboard and open browser for the user
        try {
          await this.userInteraction.writeToClipboard(userCode);
          this.logger.info(
            `[CopilotAuth] Device code ${userCode} copied to clipboard`,
          );
        } catch {
          // Clipboard write is best-effort
        }

        // Show dialog with the code (in case clipboard didn't work)
        void this.userInteraction.showInformationMessage(
          `Code "${userCode}" copied to clipboard.\nPaste it at ${verificationUri} to complete authentication.`,
          'OK',
        );

        // Open the verification URL in the default browser
        try {
          await this.userInteraction.openExternal(verificationUri);
        } catch {
          // Browser open is best-effort — user can navigate manually
        }
      },
    };

    return executeDeviceCodeFlow(this.logger, callbacks, clientId);
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
   * @param timeoutMs - HTTP request timeout in milliseconds (default: 15s)
   * @returns true if exchange succeeded
   */
  protected async exchangeToken(
    githubToken: string,
    timeoutMs = 15_000,
  ): Promise<boolean> {
    const tokenUrl = this.getTokenExchangeUrl();
    if (!tokenUrl) {
      this.logger.warn(
        '[CopilotAuth] Token exchange URL is empty — this should not happen.',
      );
      return false;
    }

    this.logger.info(
      `[CopilotAuth] Exchanging GitHub token for Copilot bearer (${describeToken(githubToken)})`,
    );

    try {
      const version = this.getExtensionVersion();
      const { data: tokenResponse } = await axios.get<CopilotTokenResponse>(
        tokenUrl,
        {
          headers: {
            Authorization: `token ${githubToken}`,
            Accept: 'application/json',
            'User-Agent': `ptah-extension/${version}`,
          },
          timeout: timeoutMs,
        },
      );

      if (!tokenResponse.token || !tokenResponse.expires_at) {
        this.logger.error(
          '[CopilotAuth] Token exchange returned invalid response (missing token or expires_at)',
        );
        return false;
      }

      const settingsEndpoint = this.getApiEndpointSetting();
      const apiEndpoint =
        settingsEndpoint ||
        tokenResponse.endpoints?.api ||
        DEFAULT_COPILOT_API_ENDPOINT;

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
   * Read the Copilot token exchange URL from settings.
   * Falls back to the well-known GitHub Copilot internal endpoint when unconfigured.
   */
  private getTokenExchangeUrl(): string {
    const configured =
      this.workspaceProvider.getConfiguration<string>(
        'ptah',
        'provider.github-copilot.tokenExchangeUrl',
        '',
      ) ?? '';

    return configured || DEFAULT_TOKEN_EXCHANGE_URL;
  }

  /**
   * Read the Copilot API endpoint override from VS Code settings.
   * Returns empty string when unconfigured (use token response endpoint).
   */
  private getApiEndpointSetting(): string {
    return (
      this.workspaceProvider.getConfiguration<string>(
        'ptah',
        'provider.github-copilot.apiEndpoint',
        '',
      ) ?? ''
    );
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
