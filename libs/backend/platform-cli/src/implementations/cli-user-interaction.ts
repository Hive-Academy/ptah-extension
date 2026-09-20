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
import {
  createEvent,
  killProcessTree,
} from '@ptah-extension/platform-core';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import type { IOAuthUrlOpener } from '../interfaces/oauth-url-opener.interface';

const CHILD_OPERATION_TIMEOUT_MS = 5_000;

/**
 * Resolve a system helper to a fixed location instead of letting the OS search
 * `PATH`. A bare name is resolved through `PATH`, so any writable directory
 * ahead of the real one can interpose its own executable and receive whatever
 * we hand the child — a URL, or the clipboard payload (`typescript:S4036`).
 *
 * The bare name remains as a fallback: on Linux these helpers have no single
 * fixed home across distributions, so an absolute path that does not exist must
 * not break a working launcher.
 */
function resolveSystemBinary(candidates: string[], fallback: string): string {
  return candidates.find((candidate) => existsSync(candidate)) ?? fallback;
}

function systemRoot(): string {
  return (
    process.env['SystemRoot'] ?? process.env['windir'] ?? String.raw`C:\Windows`
  );
}
function reapAfterTimeout(child: ChildProcess): void {
  const whenSpawned = Promise.resolve(child.pid ?? null);
  void whenSpawned.then((pid) => {
    if (pid && !child.killed) {
      void killProcessTree(pid);
    }
  });
}

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
      let child: ChildProcess;

      if (platform === 'win32') {
        child = spawn(
          resolveSystemBinary(
            [String.raw`${systemRoot()}\System32\cmd.exe`],
            'cmd',
          ),
          ['/c', 'start', '', url],
          { stdio: 'ignore' },
        );
      } else if (platform === 'darwin') {
        child = spawn(resolveSystemBinary(['/usr/bin/open'], 'open'), [url], {
          detached: true,
          stdio: 'ignore',
        });
      } else {
        child = spawn(
          resolveSystemBinary(
            ['/usr/bin/xdg-open', '/bin/xdg-open'],
            'xdg-open',
          ),
          [url],
          { detached: true, stdio: 'ignore' },
        );
      }

      let settled = false;
      const settle = (opened: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(opened);
      };
      child.on('close', (code) => settle(code === 0));
      child.on('error', () => settle(false));
      const timer = setTimeout(() => {
        reapAfterTimeout(child);
        settle(false);
      }, CHILD_OPERATION_TIMEOUT_MS);
      timer.unref?.();
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

      let args: string[] = [];

      if (platform === 'win32') {
        command = resolveSystemBinary(
          [String.raw`${systemRoot()}\System32\clip.exe`],
          'clip',
        );
      } else if (platform === 'darwin') {
        command = resolveSystemBinary(['/usr/bin/pbcopy'], 'pbcopy');
      } else {
        command = resolveSystemBinary(
          ['/usr/bin/xclip', '/bin/xclip'],
          'xclip',
        );
        args = ['-selection', 'clipboard'];
      }

      // No `shell: true`. The arguments are passed as an array, so the
      // clipboard payload can never be reinterpreted by a shell.
      const child = spawn(command, args, {
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      child.stdin.write(text);
      child.stdin.end();
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      child.on('close', settle);
      child.on('error', settle);
      const timer = setTimeout(() => {
        reapAfterTimeout(child);
        settle();
      }, CHILD_OPERATION_TIMEOUT_MS);
      timer.unref?.();
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
      report: () => {},
    };

    return task(progress, token);
  }
}
