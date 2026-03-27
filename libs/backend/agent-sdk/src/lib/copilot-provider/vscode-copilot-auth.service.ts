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
} from '@ptah-extension/platform-core';
import { CopilotAuthService } from './copilot-auth.service';

@injectable()
export class VscodeCopilotAuthService extends CopilotAuthService {
  constructor(
    @inject(TOKENS.LOGGER) logger: Logger,
    @inject(PLATFORM_TOKENS.PLATFORM_INFO) platformInfo: IPlatformInfo,
    @inject(PLATFORM_TOKENS.USER_INTERACTION) userInteraction: IUserInteraction,
  ) {
    super(logger, platformInfo, userInteraction);
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
