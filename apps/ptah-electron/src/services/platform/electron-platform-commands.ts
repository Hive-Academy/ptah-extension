/**
 * Electron Platform Commands Implementation
 *
 * Stub/limited implementation for Electron:
 * - reloadWindow: Uses Electron app.relaunch() + app.exit()
 * - openTerminal: No-op (Electron has no integrated terminal)
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IPlatformCommands } from '@ptah-extension/rpc-handlers';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

interface ElectronWebviewBroadcaster {
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

@injectable()
export class ElectronPlatformCommands implements IPlatformCommands {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: ElectronWebviewBroadcaster,
  ) {}

  async reloadWindow(): Promise<void> {
    this.logger.info('[ElectronPlatformCommands] reloadWindow requested');
    try {
      // Reload the renderer (webContents) instead of restarting the entire
      // process. This gives a smooth ~1s reload vs a 3-5s cold restart.
      // Backend DI services stay alive — reload triggers (license set/clear,
      // settings import) already update backend state before scheduling this.
      const { BrowserWindow } = await import('electron');
      const win =
        BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      if (win) {
        win.webContents.reload();
      } else {
        // Fallback: full relaunch if no window is available
        this.logger.warn(
          '[ElectronPlatformCommands] No window found, falling back to app.relaunch()',
        );
        const { app } = await import('electron');
        app.relaunch();
        app.exit(0);
      }
    } catch (error) {
      this.logger.warn('[ElectronPlatformCommands] Failed to reload window', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  openTerminal(name: string, command: string): void {
    // Electron does not have an integrated terminal
    this.logger.warn(
      '[ElectronPlatformCommands] openTerminal is not supported in Electron',
      { name, command },
    );
  }

  async focusChat(): Promise<void> {
    try {
      await this.webviewManager.broadcastMessage(MESSAGE_TYPES.SWITCH_VIEW, {
        view: 'chat',
      });
    } catch (error) {
      this.logger.warn(
        '[ElectronPlatformCommands] focusChat broadcast failed',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}
