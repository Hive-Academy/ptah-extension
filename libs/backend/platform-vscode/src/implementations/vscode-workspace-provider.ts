/**
 * VscodeWorkspaceProvider — IWorkspaceProvider implementation using VS Code APIs.
 */

import * as vscode from 'vscode';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  IEvent,
  ConfigurationChangeEvent,
} from '@ptah-extension/platform-core';
import { createEvent } from '@ptah-extension/platform-core';

export class VscodeWorkspaceProvider implements IWorkspaceProvider {
  public readonly onDidChangeConfiguration: IEvent<ConfigurationChangeEvent>;
  public readonly onDidChangeWorkspaceFolders: IEvent<void>;

  private disposables: vscode.Disposable[] = [];

  constructor() {
    const [configEvent, fireConfig] = createEvent<ConfigurationChangeEvent>();
    this.onDidChangeConfiguration = configEvent;

    const [folderEvent, fireFolders] = createEvent<void>();
    this.onDidChangeWorkspaceFolders = folderEvent;

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        fireConfig({
          affectsConfiguration: (section: string) =>
            e.affectsConfiguration(section),
        });
      })
    );

    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        fireFolders(undefined as never);
      })
    );
  }

  getWorkspaceFolders(): string[] {
    return vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
  }

  getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  getConfiguration<T>(
    section: string,
    key: string,
    defaultValue?: T
  ): T | undefined {
    const config = vscode.workspace.getConfiguration(section);
    return config.get<T>(key, defaultValue as T);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
