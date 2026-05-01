/**
 * VS Code-Enhanced Copilot Auth Service
 *
 * Extends the platform-agnostic CopilotAuthService with VS Code's
 * built-in GitHub authentication provider for seamless OAuth login.
 *
 * Priority:
 * 1. vscode.authentication.getSession() (VS Code native - best UX)
 * 2. File-based token from ~/.config/github-copilot/hosts.json (base class)
 * 3. GitHub device code flow (base class fallback)
 *
 * TASK_2025_224: Created as VS Code-specific subclass to keep the base
 * CopilotAuthService platform-agnostic for Electron support.
 */
import * as vscode from 'vscode';
import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IPlatformInfo,
  IUserInteraction,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { CopilotAuthService } from './copilot-auth.service';

@injectable()
export class VscodeCopilotAuthService extends CopilotAuthService {
  constructor(
    @inject(TOKENS.LOGGER) logger: Logger,
    @inject(PLATFORM_TOKENS.PLATFORM_INFO) platformInfo: IPlatformInfo,
    @inject(PLATFORM_TOKENS.USER_INTERACTION) userInteraction: IUserInteraction,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    workspaceProvider: IWorkspaceProvider,
  ) {
    super(logger, platformInfo, userInteraction, workspaceProvider);
  }

  /**
   * Override login to try VS Code native GitHub auth first.
   *
   * VS Code's built-in GitHub authentication provider gives the best UX:
   * seamless OAuth dialog without needing to copy device codes.
   * Falls back to the base class strategy (file + device code) on failure.
   */
  override async login(): Promise<boolean> {
    try {
      // Try VS Code native auth first (best UX - seamless OAuth dialog)
      this.logger.info(
        '[VscodeCopilotAuth] Trying VS Code native GitHub auth...',
      );
      const session = await this.getVscodeGitHubSession(true);
      if (session) {
        this.logger.info(
          `[VscodeCopilotAuth] VS Code GitHub session obtained (account: ${session.account.label})`,
        );
        const exchanged = await this.exchangeToken(session.accessToken);
        if (exchanged) return true;
      }
    } catch (error) {
      this.logger.warn(
        `[VscodeCopilotAuth] VS Code native auth failed, falling back to base: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Fallback to base class (file + device code flow)
    return super.login();
  }

  /**
   * Override tryRestoreAuth to also try VS Code native auth silently.
   *
   * In VS Code, we can silently check for an existing GitHub session via
   * vscode.authentication.getSession(false) without prompting the user.
   * This is faster than file-based restore and covers users who previously
   * authenticated through VS Code's GitHub auth provider.
   */
  override async tryRestoreAuth(): Promise<boolean> {
    // Try VS Code native auth silently first (no prompt, createIfNone=false)
    try {
      const session = await this.getVscodeGitHubSession(false);
      if (session) {
        this.logger.info(
          '[VscodeCopilotAuth] Silent restore via VS Code GitHub session',
        );
        const exchanged = await this.exchangeToken(session.accessToken);
        if (exchanged) return true;
      }
    } catch (error) {
      this.logger.debug(
        `[VscodeCopilotAuth] Silent VS Code session check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Fallback to base class (file-based token)
    return super.tryRestoreAuth();
  }

  /**
   * Override token refresh to use VS Code native auth as a refresh source.
   *
   * The base class only tries cached token exchange + file-based refresh.
   * In VS Code, we can silently obtain a fresh GitHub session via
   * vscode.authentication.getSession(false) without prompting the user.
   */
  protected override async doRefreshToken(): Promise<boolean> {
    // Try base class refresh first (cached token + file)
    const baseResult = await super.doRefreshToken();
    if (baseResult) return true;

    // VS Code-specific: try getting a fresh GitHub session silently (no prompt)
    try {
      const session = await this.getVscodeGitHubSession(false);
      if (session) {
        this.logger.info(
          '[VscodeCopilotAuth] Refreshing via VS Code GitHub session',
        );
        return this.exchangeToken(session.accessToken);
      }
    } catch {
      // VS Code auth unavailable during refresh
    }

    this.authState = null;
    return false;
  }

  /**
   * Override headers to send the correct Editor-Version for VS Code.
   *
   * GitHub Copilot servers expect `vscode/X.Y.Z` as the Editor-Version
   * header from VS Code clients. The base class sends `ptah/X.Y.Z`.
   */
  override async getHeaders(): Promise<Record<string, string>> {
    const headers = await super.getHeaders();
    headers['Editor-Version'] = `vscode/${vscode.version}`;
    return headers;
  }

  /**
   * Obtain a GitHub authentication session from VS Code.
   * Tries the 'copilot' scope first, falls back to 'read:user' if that fails.
   *
   * @param createIfNone - If true, prompt the user to sign in if not already
   */
  private async getVscodeGitHubSession(
    createIfNone: boolean,
  ): Promise<vscode.AuthenticationSession | undefined> {
    // Try 'copilot' scope first
    try {
      const session = await vscode.authentication.getSession(
        'github',
        ['copilot'],
        { createIfNone },
      );
      if (session) return session;
    } catch {
      // Fall through to read:user
    }

    // Fallback to 'read:user' scope
    try {
      return await vscode.authentication.getSession('github', ['read:user'], {
        createIfNone,
      });
    } catch {
      return undefined;
    }
  }
}
