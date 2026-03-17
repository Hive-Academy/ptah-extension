/**
 * Electron Workspace RPC Handlers
 *
 * Handles workspace management methods specific to Electron:
 * - workspace:getInfo - Get workspace folder information
 * - workspace:addFolder - Open native folder picker
 * - workspace:removeFolder - Remove a workspace folder
 * - workspace:switch - Switch active workspace folder
 *
 * TASK_2025_203 Batch 5: Extracted from inline registrations
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

@injectable()
export class ElectronWorkspaceRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider
  ) {}

  register(): void {
    this.registerGetInfo();
    this.registerAddFolder();
    this.registerRemoveFolder();
    this.registerSwitch();
  }

  private registerGetInfo(): void {
    this.rpcHandler.registerMethod('workspace:getInfo', async () => {
      try {
        const folders = this.workspaceProvider.getWorkspaceFolders();
        const root = this.workspaceProvider.getWorkspaceRoot();

        return {
          folders,
          root,
          name: root
            ? root.split(/[/\\]/).pop() ?? 'Workspace'
            : 'No Workspace',
        };
      } catch {
        return { folders: [], root: undefined, name: 'No Workspace' };
      }
    });
  }

  private registerAddFolder(): void {
    this.rpcHandler.registerMethod('workspace:addFolder', async () => {
      try {
        const { dialog } = await import('electron');
        const result = await dialog.showOpenDialog({
          properties: ['openDirectory'],
          title: 'Add Workspace Folder',
        });

        if (result.canceled || result.filePaths.length === 0) {
          return { path: null, name: null };
        }

        const folderPath = result.filePaths[0];
        const folderName = folderPath.split(/[/\\]/).pop() ?? folderPath;

        // Update workspace provider with new folder
        try {
          if (
            typeof (
              this.workspaceProvider as unknown as Record<string, unknown>
            )['addFolder'] === 'function'
          ) {
            (
              this.workspaceProvider as unknown as {
                addFolder(path: string): void;
              }
            ).addFolder(folderPath);
          }
        } catch {
          // Non-fatal: workspace provider may not support addFolder
        }

        this.logger.info('[Electron RPC] workspace:addFolder', { folderPath });
        return { path: folderPath, name: folderName };
      } catch (error) {
        this.logger.error(
          '[Electron RPC] workspace:addFolder failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return { path: null, name: null, error: String(error) };
      }
    });
  }

  private registerRemoveFolder(): void {
    this.rpcHandler.registerMethod(
      'workspace:removeFolder',
      async (params: { path: string } | undefined) => {
        if (!params?.path) {
          return { success: false, error: 'path is required' };
        }

        try {
          if (
            typeof (
              this.workspaceProvider as unknown as Record<string, unknown>
            )['removeFolder'] === 'function'
          ) {
            (
              this.workspaceProvider as unknown as {
                removeFolder(path: string): void;
              }
            ).removeFolder(params.path);
          }
          this.logger.info('[Electron RPC] workspace:removeFolder', {
            path: params.path,
          });
          return { success: true };
        } catch (error) {
          this.logger.error(
            '[Electron RPC] workspace:removeFolder failed',
            error instanceof Error ? error : new Error(String(error))
          );
          return { success: false, error: String(error) };
        }
      }
    );
  }

  private registerSwitch(): void {
    this.rpcHandler.registerMethod(
      'workspace:switch',
      async (params: { path: string } | undefined) => {
        if (!params?.path) {
          return { success: false, error: 'path is required' };
        }

        try {
          if (
            typeof (
              this.workspaceProvider as unknown as Record<string, unknown>
            )['setActiveFolder'] === 'function'
          ) {
            (
              this.workspaceProvider as unknown as {
                setActiveFolder(path: string): void;
              }
            ).setActiveFolder(params.path);
          }
          this.logger.info('[Electron RPC] workspace:switch', {
            path: params.path,
          });
          return { success: true };
        } catch (error) {
          this.logger.error(
            '[Electron RPC] workspace:switch failed',
            error instanceof Error ? error : new Error(String(error))
          );
          return { success: false, error: String(error) };
        }
      }
    );
  }
}
