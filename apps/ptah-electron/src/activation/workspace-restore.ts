
import * as fs from 'fs';
import * as path from 'path';
import type { BrowserWindow } from 'electron';
import type { DependencyContainer } from 'tsyringe';
import {
  ElectronWorkspaceProvider,
  type ElectronStateStorage,
} from '@ptah-extension/platform-electron';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { WorkspaceContextManager } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { WorkspaceChangedPayload } from '@ptah-extension/shared';

export interface WorkspaceRestoreResult {
  startupWorkspaceRoot: string | undefined;
  flushWorkspacePersistence: (() => void) | null;
}

export async function restoreWorkspaces(
  container: DependencyContainer,
  initialFolders: string[] | undefined,
  gitWatcherRef: {
    current: { stop: () => void; switchWorkspace: (p: string) => void } | null;
  },
  getMainWindow: () => BrowserWindow | null,
): Promise<WorkspaceRestoreResult> {
  let startupWorkspaceRoot: string | undefined;
  let flushWorkspacePersistence: (() => void) | null = null;

  try {
    const globalStateStorage = container.resolve<IStateStorage>(
      PLATFORM_TOKENS.STATE_STORAGE,
    );
    const workspaceContextManager = container.resolve<WorkspaceContextManager>(
      TOKENS.WORKSPACE_CONTEXT_MANAGER,
    );
    const workspaceProviderForRestore =
      container.resolve<ElectronWorkspaceProvider>(
        PLATFORM_TOKENS.WORKSPACE_PROVIDER,
      );

    const persisted = globalStateStorage.get<{
      folders: string[];
      activeIndex: number;
    }>('ptah.workspaces');
    const cliWorkspacePath = initialFolders?.[0];

    if (persisted && persisted.folders && persisted.folders.length > 0) {
      const validFolders: string[] = [];
      for (const folder of persisted.folders) {
        try {
          await fs.promises.access(folder);
          validFolders.push(folder);
        } catch {
          console.warn(
            `[Ptah Electron] Skipping stale workspace path (no longer exists): ${folder}`,
          );
        }
      }

      if (validFolders.length > 0) {
        const activeIndex = Math.min(
          Math.max(persisted.activeIndex ?? 0, 0),
          validFolders.length - 1,
        );

        if (cliWorkspacePath) {
          const cliResolved = path.resolve(cliWorkspacePath);
          if (!validFolders.includes(cliResolved)) {
            validFolders.push(cliResolved);
          }
          await workspaceContextManager.restoreWorkspaces(
            validFolders,
            cliResolved,
          );
          workspaceProviderForRestore.setWorkspaceFolders(validFolders);
          workspaceProviderForRestore.setActiveFolder(cliResolved);
        } else {
          const activePath = validFolders[activeIndex];
          await workspaceContextManager.restoreWorkspaces(
            validFolders,
            activePath,
          );
          workspaceProviderForRestore.setWorkspaceFolders(validFolders);
          workspaceProviderForRestore.setActiveFolder(activePath);
        }

        console.log(
          `[Ptah Electron] Restored ${validFolders.length} workspace(s) from persisted state`,
        );
      }
    } else if (cliWorkspacePath) {
      console.log(
        '[Ptah Electron] No persisted workspaces; using CLI workspace',
      );
    } else {
      console.log(
        '[Ptah Electron] No persisted workspaces and no CLI arg — starting without workspace',
      );
    }
    startupWorkspaceRoot = workspaceProviderForRestore.getActiveFolder();
    let persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    const buildWorkspaceSnapshot = () => {
      const currentFolders = workspaceProviderForRestore.getWorkspaceFolders();
      const activeFolder = workspaceProviderForRestore.getActiveFolder();
      const activeIndex = activeFolder
        ? currentFolders.indexOf(activeFolder)
        : 0;
      return {
        folders: currentFolders,
        activeIndex: activeIndex >= 0 ? activeIndex : 0,
      };
    };

    const persistWorkspaceList = () => {
      globalStateStorage
        .update('ptah.workspaces', buildWorkspaceSnapshot())
        .catch((err: unknown) => {
          console.error(
            '[Ptah Electron] Failed to persist workspace list:',
            err instanceof Error ? err.message : String(err),
          );
        });
    };
    flushWorkspacePersistence = () => {
      if (persistDebounceTimer !== null) {
        clearTimeout(persistDebounceTimer);
        persistDebounceTimer = null;
      }
      try {
        (globalStateStorage as ElectronStateStorage).updateSync(
          'ptah.workspaces',
          buildWorkspaceSnapshot(),
        );
      } catch (err: unknown) {
        console.error(
          '[Ptah Electron] Sync workspace persist failed:',
          err instanceof Error ? err.message : String(err),
        );
      }
    };

    workspaceProviderForRestore.onDidChangeWorkspaceFolders(() => {
      const origin = workspaceProviderForRestore.pendingOrigin ?? null;
      workspaceProviderForRestore.pendingOrigin = null;

      if (persistDebounceTimer !== null) {
        clearTimeout(persistDebounceTimer);
      }
      persistDebounceTimer = setTimeout(() => {
        persistDebounceTimer = null;
        persistWorkspaceList();
      }, 500);
      const newActive = workspaceProviderForRestore.getActiveFolder();
      if (newActive) {
        gitWatcherRef.current?.switchWorkspace(newActive);

        const mainWindow = getMainWindow();
        if (mainWindow) {
          mainWindow.webContents.send('to-renderer', {
            type: MESSAGE_TYPES.WORKSPACE_CHANGED,
            payload: {
              workspaceInfo: {
                path: newActive,
                name: path.basename(newActive),
                type: 'workspace',
              },
              origin,
            } satisfies WorkspaceChangedPayload,
          });
        }
      } else {
        const mainWindow = getMainWindow();
        if (mainWindow) {
          mainWindow.webContents.send('to-renderer', {
            type: MESSAGE_TYPES.WORKSPACE_CHANGED,
            payload: {
              workspaceInfo: null,
              origin,
            } satisfies WorkspaceChangedPayload,
          });
        }
      }
    });
  } catch (error) {
    console.warn(
      '[Ptah Electron] Workspace restoration failed (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  }

  return { startupWorkspaceRoot, flushWorkspacePersistence };
}
