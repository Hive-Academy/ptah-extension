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
 * TASK_2025_208 Batch 2, Task 2.1: Wire WorkspaceContextManager for
 *   proper workspace lifecycle management. Removed duck-typing casts
 *   in favor of real typed method calls on ElectronWorkspaceProvider.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { SessionImporterService } from '@ptah-extension/agent-sdk';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { ElectronWorkspaceProvider } from '@ptah-extension/platform-electron';
import type { WorkspaceContextManager } from '../../workspace-context-manager';

@injectable()
export class WorkspaceRpcHandlers {
  private readonly workspaceContextManager: WorkspaceContextManager;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(TOKENS.WORKSPACE_CONTEXT_MANAGER)
    workspaceContextManager: WorkspaceContextManager,
    @inject(SDK_TOKENS.SDK_SESSION_IMPORTER)
    private readonly sessionImporter: SessionImporterService,
  ) {
    this.workspaceContextManager = workspaceContextManager;
  }

  /**
   * Cast IWorkspaceProvider to ElectronWorkspaceProvider for lifecycle methods.
   * In the Electron app, the workspace provider is always an ElectronWorkspaceProvider.
   */
  private get electronProvider(): ElectronWorkspaceProvider {
    return this.workspaceProvider as unknown as ElectronWorkspaceProvider;
  }

  register(): void {
    this.registerGetInfo();
    this.registerAddFolder();
    this.registerRegisterFolder();
    this.registerRemoveFolder();
    this.registerSwitch();
  }

  private registerGetInfo(): void {
    this.rpcHandler.registerMethod('workspace:getInfo', async () => {
      try {
        const folders = this.workspaceProvider.getWorkspaceFolders();
        const root = this.workspaceProvider.getWorkspaceRoot();
        const activeFolder = this.electronProvider.getActiveFolder();

        return {
          folders,
          root,
          activeFolder,
          name: root
            ? (root.split(/[/\\]/).pop() ?? 'Workspace')
            : 'No Workspace',
        };
      } catch {
        return {
          folders: [],
          root: undefined,
          activeFolder: undefined,
          name: 'No Workspace',
        };
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

        // CRITICAL ORDER: Create workspace context FIRST, then add to provider.
        // If context creation fails, the provider stays clean (no folder added).
        const createResult =
          await this.workspaceContextManager.createWorkspace(folderPath);
        if (!createResult.success) {
          this.logger.error(
            '[Electron RPC] workspace:addFolder - failed to create workspace context',
            { folderPath, error: createResult.error },
          );
          return {
            path: null,
            name: null,
            error: `Failed to create workspace context: ${createResult.error}`,
          };
        }

        this.electronProvider.addFolder(folderPath);

        // Session import is handled by workspace:switch (called by frontend auto-switch).
        // No fire-and-forget import here — it would write to the wrong workspace storage
        // since addFolder creates but does not activate the workspace context.

        this.logger.info('[Electron RPC] workspace:addFolder', { folderPath });
        return { path: folderPath, name: folderName };
      } catch (error) {
        this.logger.error(
          '[Electron RPC] workspace:addFolder failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        return { path: null, name: null, error: String(error) };
      }
    });
  }

  private registerRegisterFolder(): void {
    this.rpcHandler.registerMethod(
      'workspace:registerFolder',
      async (params: { path: string } | undefined) => {
        if (!params?.path) {
          return {
            success: false,
            path: '',
            name: '',
            error: 'path is required',
          };
        }

        try {
          const folderPath = params.path;
          const folderName = folderPath.split(/[/\\]/).pop() ?? folderPath;

          const createResult =
            await this.workspaceContextManager.createWorkspace(folderPath);
          if (!createResult.success) {
            return {
              success: false,
              path: folderPath,
              name: folderName,
              error: `Failed to create workspace context: ${createResult.error}`,
            };
          }

          this.electronProvider.addFolder(folderPath);

          this.logger.info('[Electron RPC] workspace:registerFolder', {
            folderPath,
          });
          return { success: true, path: folderPath, name: folderName };
        } catch (error) {
          this.logger.error(
            '[Electron RPC] workspace:registerFolder failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          return {
            success: false,
            path: params.path,
            name: '',
            error: String(error),
          };
        }
      },
    );
  }

  private registerRemoveFolder(): void {
    this.rpcHandler.registerMethod(
      'workspace:removeFolder',
      async (params: { path: string } | undefined) => {
        if (!params?.path) {
          return { success: false, error: 'path is required' };
        }

        try {
          // Remove workspace storage first, then remove from the provider's folder list.
          this.workspaceContextManager.removeWorkspace(params.path);
          this.electronProvider.removeFolder(params.path);

          this.logger.info('[Electron RPC] workspace:removeFolder', {
            path: params.path,
          });
          return { success: true };
        } catch (error) {
          this.logger.error(
            '[Electron RPC] workspace:removeFolder failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          return { success: false, error: String(error) };
        }
      },
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
          // Switch workspace context (creates lazily if needed),
          // then update the provider's active folder.
          const encodedPath =
            await this.workspaceContextManager.switchWorkspace(params.path);
          if (!encodedPath) {
            return {
              success: false,
              error: `Failed to switch workspace context for: ${params.path}`,
            };
          }

          this.electronProvider.setActiveFolder(params.path);

          // Import existing Claude sessions for the switched workspace.
          // Awaited so sessions are available when the frontend reloads the session list.
          try {
            const importCount = await this.sessionImporter.scanAndImport(
              params.path,
              50,
            );
            if (importCount > 0) {
              this.logger.info(
                `[Electron RPC] workspace:switch imported ${importCount} session(s)`,
                { path: params.path },
              );
            }
          } catch (err: unknown) {
            this.logger.warn(
              '[Electron RPC] workspace:switch session import failed (non-fatal)',
              { error: err instanceof Error ? err.message : String(err) },
            );
          }

          const folderName = params.path.split(/[/\\]/).pop() ?? 'Workspace';

          this.logger.info('[Electron RPC] workspace:switch', {
            path: params.path,
            encodedPath,
          });
          return {
            success: true,
            path: params.path,
            name: folderName,
            encodedPath,
          };
        } catch (error) {
          this.logger.error(
            '[Electron RPC] workspace:switch failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          return { success: false, error: String(error) };
        }
      },
    );
  }
}
