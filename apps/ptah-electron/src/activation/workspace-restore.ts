// Phase 2.5 Workspace Restoration helper, extracted from bootstrap.ts to
// keep that file within its line budget. Restores persisted workspace
// folders from global state, applies the CLI arg priority rule, and
// wires the onDidChangeWorkspaceFolders subscription (debounced persist
// + git-watcher switching via the mutable gitWatcherRef).

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
      // Filter out stale paths that no longer exist on disk
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
        // Clamp activeIndex to valid range
        const activeIndex = Math.min(
          Math.max(persisted.activeIndex ?? 0, 0),
          validFolders.length - 1,
        );

        if (cliWorkspacePath) {
          // CLI arg takes priority: ensure it's in the list, make it active
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
          // No CLI arg: use persisted active index
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
      // No persisted workspaces, but CLI arg provided. Container setup already
      // created the initial workspace context (container.ts Phase 1.6).
      console.log(
        '[Ptah Electron] No persisted workspaces; using CLI workspace',
      );
    } else {
      console.log(
        '[Ptah Electron] No persisted workspaces and no CLI arg — starting without workspace',
      );
    }

    // Capture the active workspace for the startup config (exposed via preload)
    startupWorkspaceRoot = workspaceProviderForRestore.getActiveFolder();

    // --- Workspace list persistence on change (Task 2.3) ---
    // Debounced at 500ms to avoid rapid writes during bulk operations.
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

    // Synchronous flush for the will-quit handler.
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
      // Read-and-clear the pending origin token stamped by registerSwitch()
      // before any async or debounce logic so it cannot be consumed by a
      // later unrelated event (TASK_2026_115 §1.5).
      const origin = workspaceProviderForRestore.pendingOrigin ?? null;
      workspaceProviderForRestore.pendingOrigin = null;

      if (persistDebounceTimer !== null) {
        clearTimeout(persistDebounceTimer);
      }
      persistDebounceTimer = setTimeout(() => {
        persistDebounceTimer = null;
        persistWorkspaceList();
      }, 500);

      // Notify git watcher of workspace changes. The gitWatcher is created later
      // (wireRuntime Phase 4.8) and assigned to gitWatcherRef.current by the
      // orchestrator — this closure reads the current value each time it fires.
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
