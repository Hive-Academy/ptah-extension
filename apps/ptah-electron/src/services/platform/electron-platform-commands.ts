/**
 * Electron Platform Commands Implementation (TASK_2025_203)
 *
 * Stub/limited implementation for Electron:
 * - reloadWindow: Uses Electron app.relaunch() + app.exit()
 * - openTerminal: No-op (Electron has no integrated terminal)
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IPlatformCommands } from '@ptah-extension/rpc-handlers';

@injectable()
export class ElectronPlatformCommands implements IPlatformCommands {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  async reloadWindow(): Promise<void> {
    this.logger.info('[ElectronPlatformCommands] reloadWindow requested');
    // In Electron, we use the app module to relaunch
    try {
      // Dynamic import to avoid bundling issues
      const { app } = await import('electron');
      app.relaunch();
      app.exit(0);
    } catch (error) {
      this.logger.warn(
        '[ElectronPlatformCommands] Failed to relaunch Electron app',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  openTerminal(name: string, command: string): void {
    // Electron does not have an integrated terminal
    this.logger.warn(
      '[ElectronPlatformCommands] openTerminal is not supported in Electron',
      { name, command }
    );
  }
}
