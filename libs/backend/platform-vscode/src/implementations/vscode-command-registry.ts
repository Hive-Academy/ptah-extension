/**
 * VscodeCommandRegistry — ICommandRegistry implementation using VS Code commands API.
 */

import * as vscode from 'vscode';
import type { ICommandRegistry } from '@ptah-extension/platform-core';
import type { IDisposable } from '@ptah-extension/platform-core';

export class VscodeCommandRegistry implements ICommandRegistry {
  registerCommand(
    id: string,
    handler: (...args: unknown[]) => unknown
  ): IDisposable {
    const disposable = vscode.commands.registerCommand(id, handler);
    return { dispose: () => disposable.dispose() };
  }

  async executeCommand<T = unknown>(
    id: string,
    ...args: unknown[]
  ): Promise<T> {
    return vscode.commands.executeCommand<T>(id, ...args);
  }
}
