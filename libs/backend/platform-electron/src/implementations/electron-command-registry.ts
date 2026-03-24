/**
 * ElectronCommandRegistry — ICommandRegistry implementation for Electron.
 *
 * In-memory registry for command handlers. Commands can be bound to
 * Electron Menu items and keyboard shortcuts via the application menu.
 *
 * No Electron imports required — pure in-memory Map implementation.
 */

import type { ICommandRegistry } from '@ptah-extension/platform-core';
import type { IDisposable } from '@ptah-extension/platform-core';

export class ElectronCommandRegistry implements ICommandRegistry {
  private readonly commands = new Map<
    string,
    (...args: unknown[]) => unknown
  >();

  registerCommand(
    id: string,
    handler: (...args: unknown[]) => unknown
  ): IDisposable {
    this.commands.set(id, handler);
    return {
      dispose: () => {
        this.commands.delete(id);
      },
    };
  }

  async executeCommand<T = unknown>(
    id: string,
    ...args: unknown[]
  ): Promise<T> {
    const handler = this.commands.get(id);
    if (!handler) {
      throw new Error(`Command not found: ${id}`);
    }
    const result = await handler(...args);
    return result as T;
  }

  /**
   * Get all registered command IDs.
   * Used by the application menu to build dynamic menu items.
   */
  getRegisteredCommands(): string[] {
    return Array.from(this.commands.keys());
  }
}
