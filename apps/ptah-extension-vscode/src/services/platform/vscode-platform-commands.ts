/**
 * VS Code Platform Commands Implementation.
 *
 * Implements IPlatformCommands using VS Code APIs:
 * - reloadWindow: vscode.commands.executeCommand('workbench.action.reloadWindow')
 * - openTerminal: vscode.window.createTerminal()
 */

import { injectable } from 'tsyringe';
import * as vscode from 'vscode';
import type { IPlatformCommands } from '@ptah-extension/rpc-handlers';

@injectable()
export class VsCodePlatformCommands implements IPlatformCommands {
  async reloadWindow(): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }

  openTerminal(name: string, command: string): void {
    const terminal = vscode.window.createTerminal({ name });
    terminal.sendText(command, true);
    terminal.show();
  }

  async focusChat(): Promise<void> {
    await vscode.commands.executeCommand('ptah.main.focus');
  }

  /**
   * Forward to VS Code's command registry. Anything registered — by Ptah or
   * by the editor — is reachable, so the caller's allowlist is what keeps a
   * webview from running arbitrary commands.
   */
  async executeCommand(
    command: string,
    args?: readonly unknown[],
  ): Promise<{ handled: boolean; error?: string }> {
    await vscode.commands.executeCommand(command, ...(args ?? []));
    return { handled: true };
  }
}
