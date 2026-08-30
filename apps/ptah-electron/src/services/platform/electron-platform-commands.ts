/**
 * Electron Platform Commands Implementation
 *
 * Stub/limited implementation for Electron:
 * - reloadWindow: reloads the focused window, or app.relaunch() + app.quit()
 * - openTerminal: No-op (Electron has no integrated terminal)
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IPlatformCommands } from '@ptah-extension/rpc-handlers';
import { MESSAGE_TYPES, resolveEnvironment } from '@ptah-extension/shared';

/** Let the RPC response land before the window reloads out from under it. */
const RELOAD_DEFER_MS = 500;

interface ElectronWebviewBroadcaster {
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

@injectable()
export class ElectronPlatformCommands implements IPlatformCommands {
  /** Resolved URLs for the current environment (dev vs production). */
  private readonly urls = resolveEnvironment(
    process.env['NODE_ENV'] === 'development',
  ).urls;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: ElectronWebviewBroadcaster,
  ) {}

  async reloadWindow(): Promise<void> {
    this.logger.info('[ElectronPlatformCommands] reloadWindow requested');
    try {
      const { BrowserWindow } = await import('electron');
      const win =
        BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      if (win) {
        win.webContents.reload();
      } else {
        this.logger.warn(
          '[ElectronPlatformCommands] No window found, falling back to app.relaunch()',
        );
        const { app } = await import('electron');
        app.relaunch();
        // `quit`, never `exit`. `app.exit()` emits neither `before-quit` nor
        // `will-quit`, so it skips the entire LIFO teardown chain in
        // `main.ts` — the CLI agent subprocesses, the provider proxy leases,
        // the SQLite handle, the settings flush (TASK_2026_326). A relaunch
        // that strands its own children is worse than a slower relaunch.
        app.quit();
      }
    } catch (error) {
      this.logger.warn('[ElectronPlatformCommands] Failed to reload window', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  openTerminal(name: string, command: string): void {
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

  /**
   * Electron has no command registry, so each id the webview may send is
   * implemented here. Ids with no implementation report `handled: false`
   * rather than throwing — the caller turns that into a precise error.
   *
   * Moved verbatim from the Electron-only CommandRpcHandlers, which is why
   * this reads as a switch rather than a lookup: it is the same set of
   * commands the VS Code extension registers, mapped onto desktop equivalents.
   */
  async executeCommand(
    command: string,
  ): Promise<{ handled: boolean; error?: string }> {
    if (command === 'workbench.action.reloadWindow') {
      this.logger.info('[ElectronPlatformCommands] reloading window');
      // Deferred so the RPC response reaches the renderer before it goes away.
      setTimeout(() => void this.reloadWindow(), RELOAD_DEFER_MS);
      return { handled: true };
    }

    switch (command) {
      case 'ptah.openPricing':
        await this.openExternal(this.urls.PRICING_URL);
        return { handled: true };

      case 'ptah.openSignup':
        await this.openExternal(this.urls.SIGNUP_URL + '?source=electron');
        return { handled: true };

      case 'ptah.openOrchestraCanvas':
        await this.webviewManager.broadcastMessage(MESSAGE_TYPES.SWITCH_VIEW, {
          view: 'orchestra-canvas',
        });
        this.logger.info(
          '[ElectronPlatformCommands] Orchestra Canvas opened via SWITCH_VIEW',
        );
        return { handled: true };

      default:
        this.logger.debug('[ElectronPlatformCommands] unsupported command', {
          command,
        });
        return {
          handled: false,
          error: `Command not available in Electron: ${command}`,
        };
    }
  }

  private async openExternal(url: string): Promise<void> {
    const { shell } = await import('electron');
    await shell.openExternal(url);
    this.logger.debug('[ElectronPlatformCommands] opened external URL', {
      url,
    });
  }
}
