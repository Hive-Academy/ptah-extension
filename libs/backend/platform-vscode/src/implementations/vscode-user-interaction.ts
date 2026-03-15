/**
 * VscodeUserInteraction — IUserInteraction implementation using VS Code window APIs.
 */

import * as vscode from 'vscode';
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

export class VscodeUserInteraction implements IUserInteraction {
  async showErrorMessage(
    message: string,
    ...actions: string[]
  ): Promise<string | undefined> {
    return vscode.window.showErrorMessage(message, ...actions);
  }

  async showWarningMessage(
    message: string,
    ...actions: string[]
  ): Promise<string | undefined> {
    return vscode.window.showWarningMessage(message, ...actions);
  }

  async showInformationMessage(
    message: string,
    ...actions: string[]
  ): Promise<string | undefined> {
    return vscode.window.showInformationMessage(message, ...actions);
  }

  async showQuickPick(
    items: QuickPickItem[],
    options?: QuickPickOptions
  ): Promise<QuickPickItem | undefined> {
    const vsItems: vscode.QuickPickItem[] = items.map((item) => ({
      label: item.label,
      description: item.description,
      detail: item.detail,
      picked: item.picked,
      alwaysShow: item.alwaysShow,
    }));

    const vsOptions: vscode.QuickPickOptions = {
      title: options?.title,
      placeHolder: options?.placeHolder,
      canPickMany: options?.canPickMany,
      ignoreFocusOut: options?.ignoreFocusOut,
    };

    const result = await vscode.window.showQuickPick(vsItems, vsOptions);
    if (!result) return undefined;

    // Preserve all QuickPickItem fields from the result
    const vsResult = result as vscode.QuickPickItem;
    return {
      label: vsResult.label,
      description: vsResult.description,
      detail: vsResult.detail,
      picked: vsResult.picked,
      alwaysShow: vsResult.alwaysShow,
    };
  }

  async showInputBox(options?: InputBoxOptions): Promise<string | undefined> {
    return vscode.window.showInputBox({
      title: options?.title,
      prompt: options?.prompt,
      placeHolder: options?.placeHolder,
      value: options?.value,
      password: options?.password,
      ignoreFocusOut: options?.ignoreFocusOut,
      validateInput: options?.validateInput,
    });
  }

  async withProgress<T>(
    options: ProgressOptions,
    task: (progress: IProgress, token: ICancellationToken) => Promise<T>
  ): Promise<T> {
    const locationMap: Record<string, vscode.ProgressLocation> = {
      notification: vscode.ProgressLocation.Notification,
      window: vscode.ProgressLocation.Window,
      statusbar: vscode.ProgressLocation.Window,
    };

    return vscode.window.withProgress(
      {
        location:
          locationMap[options.location ?? 'notification'] ??
          vscode.ProgressLocation.Notification,
        title: options.title,
        cancellable: options.cancellable,
      },
      async (vsProgress, vsToken) => {
        // Wrap VS Code CancellationToken into platform ICancellationToken
        const [onCancellationRequested, fireCancellation] = createEvent<void>();
        const tokenDisposable = vsToken.onCancellationRequested(() =>
          fireCancellation(undefined as unknown as void)
        );

        const token: ICancellationToken = {
          get isCancellationRequested() {
            return vsToken.isCancellationRequested;
          },
          onCancellationRequested,
        };

        try {
          return await task(
            { report: (value) => vsProgress.report(value) },
            token
          );
        } finally {
          tokenDisposable.dispose();
        }
      }
    );
  }
}
