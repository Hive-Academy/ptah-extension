/**
 * VS Code Platform Auth Provider Implementation (TASK_2025_203)
 *
 * Implements IPlatformAuthProvider using VS Code authentication API:
 * - getGitHubUsername: vscode.authentication.getSession('github', ...)
 */

import { injectable } from 'tsyringe';
import * as vscode from 'vscode';
import type { IPlatformAuthProvider } from '@ptah-extension/rpc-handlers';

@injectable()
export class VsCodePlatformAuth implements IPlatformAuthProvider {
  async getGitHubUsername(): Promise<string | undefined> {
    try {
      const session = await vscode.authentication.getSession(
        'github',
        ['copilot'],
        { createIfNone: false }
      );
      return session?.account.label;
    } catch {
      // Fallback: try read:user scope
      try {
        const session = await vscode.authentication.getSession(
          'github',
          ['read:user'],
          { createIfNone: false }
        );
        return session?.account.label;
      } catch {
        return undefined;
      }
    }
  }
}
