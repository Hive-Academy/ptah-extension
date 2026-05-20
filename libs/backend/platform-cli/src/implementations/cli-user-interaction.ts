/**
 * CliUserInteraction — IUserInteraction implementation for CLI.
 *
 * For v1: Console-based implementations of all user interaction methods.
 * Error/warning/info messages are logged to stderr/stdout.
 * QuickPick returns the first item; InputBox returns empty string.
 * withProgress runs the task directly without progress display.
 *
 * These stubs will be upgraded to TUI-based interaction
 * via callback registration (setQuickPickHandler, setInputBoxHandler).
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
import { spawn } from 'child_process';
import type { IOAuthUrlOpener } from '../interfaces/oauth-url-opener.interface';

export class CliUserInteraction implements IUserInteraction {
  constructor(private readonly oauthOpener: IOAuthUrlOpener | null = null) {}

  async openExternal(url: string): Promise<boolean> {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        return false;
      }
    } catch {
      return false;
    }
    return new Promise<boolean>((resolve) => {
      const platform = process.platform;
      let child;

      if (platform === 'win32') {
        child = spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
      } else if (platform === 'darwin') {
        child = spawn('open', [url], { stdio: 'ignore' });
      } else {
        child = spawn('xdg-open', [url], { stdio: 'ignore' });
      }

      child.on('close', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
    });
  }

  async openOAuthUrl(params: {
    provider: 'copilot' | 'codex' | 'claude' | string;
    verificationUri: string;
    userCode?: string;
  }): Promise<{ opened: boolean; code?: string }> {
    if (this.oauthOpener) {
      return this.oauthOpener.openOAuthUrl(params);
    }
    return { opened: false };
  }

  async writeToClipboard(text: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const platform = process.platform;
      let command: string;

      if (platform === 'win32') {
        command = 'clip';
      } else if (platform === 'darwin') {
        command = 'pbcopy';
      } else {
        command = 'xclip -selection clipboard';
      }

      const child = require('child_process').spawn(command, {
        shell: true,
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      child.stdin.write(text);
      child.stdin.end();
      child.on('close', () => resolve());
      child.on('error', () => resolve());
    });
  }

  async showErrorMessage(
    message: string,
    ...actions: string[]
  ): Promise<string | undefined> {
    console.error(`[ERROR] ${message}`);
    if (actions.length > 0) {
      console.error(`  Actions: ${actions.join(', ')}`);
    }
    return undefined;
  }

  async showWarningMessage(
    message: string,
    ...actions: string[]
  ): Promise<string | undefined> {
    console.warn(`[WARN] ${message}`);
    if (actions.length > 0) {
      console.warn(`  Actions: ${actions.join(', ')}`);
    }
    return undefined;
  }

  async showInformationMessage(
    message: string,
    ...actions: string[]
  ): Promise<string | undefined> {
    console.log(`[INFO] ${message}`);
    if (actions.length > 0) {
      console.log(`  Actions: ${actions.join(', ')}`);
    }
    return undefined;
  }

  async showQuickPick(
    items: QuickPickItem[],
    _options?: QuickPickOptions,
  ): Promise<QuickPickItem | undefined> {
    return items.length > 0 ? items[0] : undefined;
  }

  async showInputBox(_options?: InputBoxOptions): Promise<string | undefined> {
    return undefined;
  }

  async withProgress<T>(
    _options: ProgressOptions,
    task: (progress: IProgress, token: ICancellationToken) => Promise<T>,
  ): Promise<T> {
    const [onCancellationRequested] = createEvent<void>();

    const token: ICancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested,
    };

    const progress: IProgress = {
      report: () => {
      },
    };

    return task(progress, token);
  }
}
