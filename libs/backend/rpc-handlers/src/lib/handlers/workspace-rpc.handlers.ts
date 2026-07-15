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
import {
  AUTH_PROVIDERS_TOKENS,
  type ProviderProxyPool,
} from '@ptah-extension/auth-providers';
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

  /**
   * Skip a deferred session import when the same workspace path was imported
   * within this window. Guards rapid A↔B↔A switching from rescanning on every
   * switch. In-memory only.
   */
  private static readonly IMPORT_RECENCY_MS = 60_000;

  /**
   * Backoff window after a deferred import FAILS for a path. A persistently
   * failing path (permissions error, corrupt JSONL) would otherwise be
   * rescanned on every switch because the success-recency guard never engages.
   * Shorter than the success window so a transient failure self-heals soon.
   */
  private static readonly IMPORT_FAILURE_BACKOFF_MS = 15_000;

  /**
   * Completion timestamps of the most recent deferred session import per
   * normalized workspace path. Feeds the recency guard in
   * {@link deferSessionImport}.
   */
  private readonly lastImportCompletedAt = new Map<string, number>();

  /**
   * Timestamps of the most recent deferred import FAILURE per normalized
   * workspace path. Feeds the failure-backoff guard in
   * {@link deferSessionImport} so a broken path is not rescanned on every
   * switch. Cleared on a subsequent successful import.
   */
  private readonly lastImportFailedAt = new Map<string, number>();

  /**
   * Normalized workspace paths whose deferred import is currently running.
   * Prevents a second concurrent scan for the same path before the first
   * finishes (rapid re-switches during a slow scan).
   */
  private readonly importsInFlight = new Set<string>();

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
    @inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_PROXY_POOL)
    private readonly providerProxyPool: ProviderProxyPool,
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

          // Phase 3: tear down any per-workspace isolated provider proxies so a
          // removed/closed workspace does not leak its translation/OAuth proxy
          // servers. Never throws (disposeForScope swallows per-entry errors).
          await this.providerProxyPool.disposeForScope(params.path);

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

          // Session import is intentionally OFF the switch critical path: the
          // RPC responds immediately and the scan runs fire-and-forget. When
          // the import saves/prunes anything the SessionMetadataStore emits
          // `metadataChanged`, which is pushed to the webview as
          // SESSION_METADATA_CHANGED and refreshes the session list — so a
          // list fetched before the import finished self-heals without the
          // switch ever blocking on file I/O + SQLite.
          //
          // Defensive isolation: deferSessionImport is fire-and-forget and
          // must never turn a successful switch into `success:false`.
          // `scanAndImport` is async so a synchronous throw is not possible
          // today, but a future refactor could introduce one — wrap the call
          // so any synchronous throw stays non-fatal to the switch response,
          // matching the async failure path's non-fatal contract.
          try {
            this.deferSessionImport(params.path);
          } catch (importErr: unknown) {
            this.logger.warn(
              '[RPC] workspace:switch deferSessionImport threw synchronously (non-fatal)',
              {
                error:
                  importErr instanceof Error
                    ? importErr.message
                    : String(importErr),
              },
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

  /**
   * Import Claude sessions for a workspace OFF the `workspace:switch` critical
   * path.
   *
   * `SessionImporterService.scanAndImport` does blocking file I/O + SQLite
   * work (directory scan, up to 50 JSONL reads, title-only prune). Awaiting it
   * inside the RPC made every switch wait on that work. Here it runs
   * fire-and-forget; the resulting `metadataChanged` push refreshes the
   * renderer's session list when anything actually changed.
   *
   * Three in-memory guards keep repeated switching cheap:
   * - **recency** — skip the scan when this path was imported within
   *   {@link WorkspaceRpcHandlers.IMPORT_RECENCY_MS}.
   * - **failure-backoff** — skip when this path's last import FAILED within
   *   {@link WorkspaceRpcHandlers.IMPORT_FAILURE_BACKOFF_MS}, so a broken path
   *   is not rescanned on every switch.
   * - **in-flight** — skip when a previous scan for this path has not resolved
   *   yet, so rapid re-switches during a slow scan do not stack.
   *
   * Both are per-process only: a fresh process re-imports on the first switch,
   * and the separate boot-time import (app activation) is unaffected because
   * it calls `scanAndImport` directly, not through this handler.
   */
  private deferSessionImport(workspacePath: string): void {
    const key = workspacePath.replace(/\\/g, '/').toLowerCase();

    const lastCompleted = this.lastImportCompletedAt.get(key);
    if (
      lastCompleted !== undefined &&
      Date.now() - lastCompleted < WorkspaceRpcHandlers.IMPORT_RECENCY_MS
    ) {
      this.logger.debug(
        '[RPC] workspace:switch skipping session import (imported recently)',
        { path: workspacePath },
      );
      return;
    }

    const lastFailed = this.lastImportFailedAt.get(key);
    if (
      lastFailed !== undefined &&
      Date.now() - lastFailed < WorkspaceRpcHandlers.IMPORT_FAILURE_BACKOFF_MS
    ) {
      this.logger.debug(
        '[RPC] workspace:switch skipping session import (failed recently)',
        { path: workspacePath },
      );
      return;
    }

    if (this.importsInFlight.has(key)) {
      this.logger.debug(
        '[RPC] workspace:switch skipping session import (already in flight)',
        { path: workspacePath },
      );
      return;
    }

    this.importsInFlight.add(key);
    void this.sessionImporter
      .scanAndImport(workspacePath, 50)
      .then((importCount) => {
        this.lastImportCompletedAt.set(key, Date.now());
        this.lastImportFailedAt.delete(key);
        if (importCount > 0) {
          this.logger.info(
            `[RPC] workspace:switch imported ${importCount} session(s)`,
            { path: workspacePath },
          );
        }
      })
      .catch((err: unknown) => {
        // Stamp the failure so a persistently-broken path backs off instead of
        // rescanning on every switch (the success-recency guard never engages
        // for a path that never completes).
        this.lastImportFailedAt.set(key, Date.now());
        this.logger.warn(
          '[RPC] workspace:switch session import failed (non-fatal)',
          { error: err instanceof Error ? err.message : String(err) },
        );
      })
      .finally(() => {
        this.importsInFlight.delete(key);
      });
  }
}
