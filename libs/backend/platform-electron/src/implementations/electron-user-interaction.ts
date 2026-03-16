/**
 * ElectronUserInteraction — IUserInteraction implementation for Electron.
 *
 * Simple dialogs (error/warning/info) use Electron's native dialog.showMessageBox().
 * Complex dialogs (QuickPick, InputBox) delegate to the renderer process via IPC,
 * where they are displayed using existing Angular/DaisyUI components.
 *
 * Progress is forwarded to renderer for display in the Angular UI.
 *
 * All Electron APIs (dialog, BrowserWindow, ipcMain) are injected via constructor
 * to avoid top-level 'electron' imports and keep the library testable.
 */

import type { IUserInteraction } from '@ptah-extension/platform-core';
import type {
  QuickPickItem,
  QuickPickOptions,
  InputBoxOptions,
  ProgressOptions,
  IProgress,
  ICancellationToken,
} from '@ptah-extension/platform-core';
import { createEvent } from '@ptah-extension/platform-core';

/** Minimal Electron dialog interface — avoids importing 'electron' at module level */
export interface ElectronDialogApi {
  showMessageBox(
    window: ElectronBrowserWindowApi | null,
    options: {
      type: string;
      message: string;
      buttons: string[];
      title?: string;
    }
  ): Promise<{ response: number }>;
}

/** Minimal BrowserWindow interface for IPC communication */
export interface ElectronBrowserWindowApi {
  webContents: {
    send(channel: string, ...args: unknown[]): void;
  };
}

/** Minimal ipcMain interface for receiving renderer responses */
interface IpcMainLike {
  once(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => void
  ): void;
}

export class ElectronUserInteraction implements IUserInteraction {
  private ipcMain: IpcMainLike | null = null;

  constructor(
    private readonly dialog: ElectronDialogApi,
    private readonly getWindow: () => ElectronBrowserWindowApi | null
  ) {
    // Lazy-load ipcMain to avoid top-level electron import
    // This will be available in the Electron runtime but not in tests
    try {
      this.ipcMain = require('electron').ipcMain;
    } catch {
      // Not in Electron runtime (e.g., tests) — IPC features will return undefined
      this.ipcMain = null;
    }
  }

  async showErrorMessage(
    message: string,
    ...actions: string[]
  ): Promise<string | undefined> {
    const win = this.getWindow();
    const result = await this.dialog.showMessageBox(win, {
      type: 'error',
      message,
      buttons: actions.length ? actions : ['OK'],
    });
    return actions.length ? actions[result.response] : undefined;
  }

  async showWarningMessage(
    message: string,
    ...actions: string[]
  ): Promise<string | undefined> {
    const win = this.getWindow();
    const result = await this.dialog.showMessageBox(win, {
      type: 'warning',
      message,
      buttons: actions.length ? actions : ['OK'],
    });
    return actions.length ? actions[result.response] : undefined;
  }

  async showInformationMessage(
    message: string,
    ...actions: string[]
  ): Promise<string | undefined> {
    const win = this.getWindow();
    const result = await this.dialog.showMessageBox(win, {
      type: 'info',
      message,
      buttons: actions.length ? actions : ['OK'],
    });
    return actions.length ? actions[result.response] : undefined;
  }

  async showQuickPick(
    items: QuickPickItem[],
    options?: QuickPickOptions
  ): Promise<QuickPickItem | undefined> {
    // Delegate to renderer via IPC — renderer shows Angular-based quick pick
    const win = this.getWindow();
    if (!win || !this.ipcMain) return undefined;

    const ipc = this.ipcMain;
    return new Promise<QuickPickItem | undefined>((resolve) => {
      const channel = `quick-pick-response-${Date.now()}`;

      ipc?.once(channel, (_event: unknown, ...args: unknown[]) => {
        const selectedIndex = args[0] as number | null;
        if (
          selectedIndex === null ||
          selectedIndex === undefined ||
          selectedIndex < 0
        ) {
          resolve(undefined);
        } else {
          resolve(items[selectedIndex]);
        }
      });

      win.webContents.send('show-quick-pick', {
        items,
        options,
        responseChannel: channel,
      });
    });
  }

  async showInputBox(options?: InputBoxOptions): Promise<string | undefined> {
    // Delegate to renderer via IPC
    const win = this.getWindow();
    if (!win || !this.ipcMain) return undefined;

    const ipc2 = this.ipcMain;
    return new Promise<string | undefined>((resolve) => {
      const channel = `input-box-response-${Date.now()}`;

      ipc2?.once(channel, (_event: unknown, ...args: unknown[]) => {
        const value = args[0] as string | null;
        resolve(value ?? undefined);
      });

      win.webContents.send('show-input-box', {
        options,
        responseChannel: channel,
      });
    });
  }

  async withProgress<T>(
    options: ProgressOptions,
    task: (progress: IProgress, token: ICancellationToken) => Promise<T>
  ): Promise<T> {
    const win = this.getWindow();
    const progressId = `progress-${Date.now()}`;

    // Create cancellation support
    const [onCancellationRequested, fireCancellation] = createEvent<void>();
    let isCancelled = false;

    if (options.cancellable && this.ipcMain) {
      this.ipcMain.once(`cancel-progress-${progressId}`, () => {
        isCancelled = true;
        fireCancellation(undefined as unknown as void);
      });
    }

    const token: ICancellationToken = {
      get isCancellationRequested() {
        return isCancelled;
      },
      onCancellationRequested,
    };

    const progress: IProgress = {
      report: (value) => {
        win?.webContents.send('progress-update', {
          id: progressId,
          ...options,
          ...value,
        });
      },
    };

    // Notify renderer that progress started
    win?.webContents.send('progress-start', {
      id: progressId,
      title: options.title,
      cancellable: options.cancellable,
    });

    try {
      return await task(progress, token);
    } finally {
      win?.webContents.send('progress-end', { id: progressId });
    }
  }
}
