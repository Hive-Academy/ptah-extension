/**
 * VS Code Platform Commands Implementation (TASK_2025_203)
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
}
