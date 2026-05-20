/**
 * Workspace RPC Handlers
 *
 * Lifted from `apps/ptah-electron/src/services/rpc/handlers/workspace-rpc.handlers.ts`
 * into the shared `rpc-handlers` library so all hosts (Electron, CLI, and
 * any future desktop host) can serve the `workspace:*` surface uniformly.
 *
 * The previous Electron-specific implementation cast `IWorkspaceProvider`
 * to `ElectronWorkspaceProvider` for lifecycle methods and called
 * `await import('electron').dialog.showOpenDialog(...)` directly. Both have
 * been replaced with platform-agnostic abstractions:
 *
 * - **Lifecycle mutations** (`addFolder`, `removeFolder`, `setActiveFolder`,
 *   `getActiveFolder`) flow through `IWorkspaceLifecycleProvider`. Each
 *   platform's workspace provider must register the same instance under both
 *   `WORKSPACE_PROVIDER` and `WORKSPACE_LIFECYCLE_PROVIDER`.
 * - **Folder picker** flows through `IUserInteraction.showOpenDialog?`. The
 *   method is optional: CLI / headless hosts leave it undefined, in which case
 *   `workspace:addFolder` returns an error explaining no UI is available.
 *
 * Methods served:
 * - `workspace:getInfo`         — Read folders + active folder
 * - `workspace:addFolder`       — Open native picker, register the chosen folder
 * - `workspace:registerFolder`  — Register a known path (used by frontend tests + CLI)
 * - `workspace:removeFolder`    — Remove a folder + dispose its storage
 * - `workspace:switch`          — Switch active workspace + import sessions
 *
 * VS Code Note: VS Code's `VsCodeWorkspaceProvider` does not implement
 * `IWorkspaceLifecycleProvider`; the VS Code app excludes this handler via
 * `registerAllRpcHandlers(container, { exclude: [WorkspaceRpcHandlers] })`
 * and lists the `workspace:*` methods in its `ELECTRON_ONLY_METHODS` array
 * so verifier output stays clean.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS, WorkspaceContextManager } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { SessionImporterService } from '@ptah-extension/agent-sdk';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IWorkspaceProvider,
  IWorkspaceLifecycleProvider,
  IUserInteraction,
} from '@ptah-extension/platform-core';
import type { RpcMethodName } from '@ptah-extension/shared';

@injectable()
export class WorkspaceRpcHandlers {
  /**
   * RPC methods owned by this handler. Used by the SHARED_HANDLERS coverage
   * invariant in `register-all.ts`.
   */
  static readonly METHODS = [
    'workspace:getInfo',
    'workspace:addFolder',
    'workspace:registerFolder',
    'workspace:removeFolder',
    'workspace:switch',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.WORKSPACE_LIFECYCLE_PROVIDER)
    private readonly workspaceLifecycle: IWorkspaceLifecycleProvider,
    @inject(PLATFORM_TOKENS.USER_INTERACTION)
    private readonly userInteraction: IUserInteraction,
    @inject(TOKENS.WORKSPACE_CONTEXT_MANAGER)
    private readonly workspaceContextManager: WorkspaceContextManager,
    @inject(SDK_TOKENS.SDK_SESSION_IMPORTER)
    private readonly sessionImporter: SessionImporterService,
  ) {}

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
        const activeFolder = this.workspaceLifecycle.getActiveFolder();

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
        if (!this.userInteraction.showOpenDialog) {
          return {
            path: null,
            name: null,
            error:
              'No native folder picker is available on this host. Use workspace:registerFolder with an explicit path.',
          };
        }

        const filePaths = await this.userInteraction.showOpenDialog({
          properties: ['openDirectory'],
          title: 'Add Workspace Folder',
        });

        if (filePaths.length === 0) {
          return { path: null, name: null };
        }

        const folderPath = filePaths[0];
        const folderName = folderPath.split(/[/\\]/).pop() ?? folderPath;
        const createResult =
          await this.workspaceContextManager.createWorkspace(folderPath);
        if ('error' in createResult) {
          this.logger.error(
            '[RPC] workspace:addFolder - failed to create workspace context',
            { folderPath, error: createResult.error },
          );
          return {
            path: null,
            name: null,
            error: `Failed to create workspace context: ${createResult.error}`,
          };
        }

        this.workspaceLifecycle.addFolder(folderPath);

        this.logger.info('[RPC] workspace:addFolder', { folderPath });
        return { path: folderPath, name: folderName };
      } catch (error) {
        this.logger.error(
          '[RPC] workspace:addFolder failed',
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
          if ('error' in createResult) {
            return {
              success: false,
              path: folderPath,
              name: folderName,
              error: `Failed to create workspace context: ${createResult.error}`,
            };
          }

          this.workspaceLifecycle.addFolder(folderPath);

          this.logger.info('[RPC] workspace:registerFolder', { folderPath });
          return { success: true, path: folderPath, name: folderName };
        } catch (error) {
          this.logger.error(
            '[RPC] workspace:registerFolder failed',
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
          this.workspaceContextManager.removeWorkspace(params.path);
          this.workspaceLifecycle.removeFolder(params.path);

          this.logger.info('[RPC] workspace:removeFolder', {
            path: params.path,
          });
          return { success: true };
        } catch (error) {
          this.logger.error(
            '[RPC] workspace:removeFolder failed',
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
      async (params: { path: string; origin?: string } | undefined) => {
        if (!params?.path) {
          return { success: false, error: 'path is required' };
        }

        try {
          this.workspaceLifecycle.setPendingOrigin?.(params.origin ?? null);
          const encodedPath =
            await this.workspaceContextManager.switchWorkspace(params.path);
          if (!encodedPath) {
            this.workspaceLifecycle.setPendingOrigin?.(null);
            return {
              success: false,
              error: `Failed to switch workspace context for: ${params.path}`,
            };
          }

          this.workspaceLifecycle.setActiveFolder(params.path);
          try {
            const importCount = await this.sessionImporter.scanAndImport(
              params.path,
              50,
            );
            if (importCount > 0) {
              this.logger.info(
                `[RPC] workspace:switch imported ${importCount} session(s)`,
                { path: params.path },
              );
            }
          } catch (err: unknown) {
            this.logger.warn(
              '[RPC] workspace:switch session import failed (non-fatal)',
              { error: err instanceof Error ? err.message : String(err) },
            );
          }

          const folderName = params.path.split(/[/\\]/).pop() ?? 'Workspace';

          this.logger.info('[RPC] workspace:switch', {
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
          this.workspaceLifecycle.setPendingOrigin?.(null);
          this.logger.error(
            '[RPC] workspace:switch failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          return { success: false, error: String(error) };
        }
      },
    );
  }
}
