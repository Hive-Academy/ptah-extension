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
} from '@ptah-extension/platform-core';

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

    return {
      label: result.label,
      description: result.description,
      detail: result.detail,
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
    task: (progress: IProgress) => Promise<T>
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
      async (vsProgress) => {
        return task({
          report(value) {
            vsProgress.report(value);
          },
        });
      }
    );
  }
}
