/**
 * VscodeWorkspaceLifecycleProvider — IWorkspaceLifecycleProvider implementation
 * using the VS Code workspace API.
 *
 * VS Code owns workspace folder mutation via `vscode.workspace.updateWorkspaceFolders`.
 * This adapter bridges that API onto `IWorkspaceLifecycleProvider` so the shared
 * `WorkspaceRpcHandlers` can serve `workspace:*` methods inside the VS Code host.
 *
 * Design notes:
 *
 *  - Folder list: maintained as an in-memory shadow of `vscode.workspace.workspaceFolders`
 *    and kept in sync via `onDidChangeWorkspaceFolders`. Direct mutations update
 *    the shadow synchronously AND enqueue the change via VS Code's API. The
 *    `onDidChangeWorkspaceFolders` handler fires `fireFoldersChange` exactly once
 *    per mutation.
 *
 *  - Active folder: maintained in memory.
 *
 *  - Events: `onDidChangeWorkspaceFolders` is propagated from the VS Code event so
 *    observers receive it on both programmatic mutations and external changes.
 *    `setActiveFolder` fires the event directly (VS Code has no equivalent API).
 *
 * TASK_2026_118 Phase 5.
 */

import * as vscode from 'vscode';
import type { IWorkspaceLifecycleProvider } from '@ptah-extension/platform-core';
import type { IEvent } from '@ptah-extension/platform-core';
import { createEvent } from '@ptah-extension/platform-core';

export class VscodeWorkspaceLifecycleProvider implements IWorkspaceLifecycleProvider {
  public readonly onDidChangeWorkspaceFolders: IEvent<void>;

  private activeFolder: string | undefined;
  private readonly fireFoldersChange: (data: void) => void;
  private readonly disposables: vscode.Disposable[] = [];

  /** Shadow of vscode.workspace.workspaceFolders for synchronous access. */
  private shadowFolders: string[];

  constructor() {
    const [folderEvent, fireFolders] = createEvent<void>();
    this.onDidChangeWorkspaceFolders = folderEvent;
    this.fireFoldersChange = fireFolders;

    // Initialise shadow from the currently open workspace.
    this.shadowFolders = this.readVscodeFolders();
    if (this.shadowFolders.length > 0) {
      this.activeFolder = this.shadowFolders[0];
    }

    // Mirror VS Code's own workspace folder changes (both external mutations
    // and our own updateWorkspaceFolders calls).
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.shadowFolders = this.readVscodeFolders();
        // Promote active folder if it is no longer present.
        if (
          this.activeFolder !== undefined &&
          !this.shadowFolders.includes(this.activeFolder)
        ) {
          this.activeFolder = this.shadowFolders[0];
        } else if (
          this.activeFolder === undefined &&
          this.shadowFolders.length > 0
        ) {
          this.activeFolder = this.shadowFolders[0];
        }
        this.fireFoldersChange(undefined as unknown as void);
      }),
    );
  }

  /**
   * Add a folder to the VS Code workspace.
   * Deduplicates by string identity. Fires `onDidChangeWorkspaceFolders` via
   * the VS Code event (synchronous in tests, async in production).
   */
  addFolder(folderPath: string): void {
    if (this.shadowFolders.includes(folderPath)) {
      return; // already present — no-op
    }
    const insertIndex = this.shadowFolders.length;
    // Update shadow optimistically so `getCurrentFolderPaths()` is consistent.
    this.shadowFolders = [...this.shadowFolders, folderPath];
    if (this.shadowFolders.length === 1) {
      this.activeFolder = folderPath;
    }
    // Tell VS Code; this will fire onDidChangeWorkspaceFolders which calls
    // fireFoldersChange exactly once via the subscriber above.
    vscode.workspace.updateWorkspaceFolders(insertIndex, 0, {
      uri: vscode.Uri.file(folderPath),
    });
  }

  /**
   * Remove a folder from the VS Code workspace.
   * No-ops if the path is not currently open.
   */
  removeFolder(folderPath: string): void {
    const index = this.shadowFolders.indexOf(folderPath);
    if (index === -1) {
      return; // not present — no-op
    }
    // Update shadow optimistically.
    this.shadowFolders = this.shadowFolders.filter((f) => f !== folderPath);
    if (this.activeFolder === folderPath) {
      this.activeFolder = this.shadowFolders[0];
    }
    // Tell VS Code; event will call fireFoldersChange.
    vscode.workspace.updateWorkspaceFolders(index, 1);
  }

  /**
   * Set the active (primary) workspace folder.
   * No-ops if `folderPath` is not currently open.
   * Fires `onDidChangeWorkspaceFolders` directly (VS Code has no equivalent API).
   */
  setActiveFolder(folderPath: string): void {
    if (!this.shadowFolders.includes(folderPath)) {
      return; // unknown path — no-op per contract
    }
    if (this.activeFolder === folderPath) {
      return; // already active — no-op
    }
    this.activeFolder = folderPath;
    this.fireFoldersChange(undefined as unknown as void);
  }

  /**
   * Get the currently active workspace folder path, or `undefined` if none.
   */
  getActiveFolder(): string | undefined {
    return this.activeFolder;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private readVscodeFolders(): string[] {
    return vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
  }
}
