import * as vscode from 'vscode';
import type { Logger, LicenseStatus } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  type SettingsExportService,
  type SettingsImportService,
} from '@ptah-extension/agent-sdk';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers';
import {
  PLATFORM_TOKENS,
  ContentDownloadService,
} from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import { CODE_SYMBOL_INDEXER } from '@ptah-extension/workspace-intelligence';
import type {
  CodeSymbolIndexer,
  WorkspaceFileIndexService,
} from '@ptah-extension/workspace-intelligence';
import { DIContainer } from '../di/container';
import { SettingsCommands } from '../commands/settings-commands';
import {
  initPluginLoader,
  mirrorUserLayer,
  reconcileHarness,
  reconcileUserLayer,
  subscribeHarnessToWorkspaceChanges,
} from './plugin-activation';

/**
 * Runtime wiring after license verification: content download, plugin
 * loader, CLI skill/agent sync, pricing pre-fetch, proactive CLI
 * detection, session import, and settings export/import commands.
 */
export async function wireRuntimeVscode(
  context: vscode.ExtensionContext,
  logger: Logger,
  licenseStatus: LicenseStatus,
): Promise<void> {
  const contentDownload = DIContainer.resolve<ContentDownloadService>(
    PLATFORM_TOKENS.CONTENT_DOWNLOAD,
  );
  initPluginLoader(contentDownload.getPluginsPath(), logger);
  const userLayerWorkspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  await mirrorUserLayer(userLayerWorkspaceRoot, logger);
  // Pre-network, so a warm start detects divergence and reaps deleted upstreams
  // with no download at all. The post-download callback runs the same pass
  // again against the refreshed sources; this one is what makes an offline or
  // fully-cached start still notice a clone the user edited (defect 8).
  await reconcileUserLayer(userLayerWorkspaceRoot, logger);
  contentDownload
    .ensureContent()
    .then(async (result) => {
      if (!result?.success) {
        console.warn(
          '[Activate] Content download failed (non-blocking):',
          result?.error ?? 'Unknown error',
        );
      }
      await mirrorUserLayer(userLayerWorkspaceRoot, logger);
      // Unconditional: the `!result.fromCache` gate that used to sit here is
      // defect 8. A cached download still needs the sweep, because what changed
      // may be the CLONE (a user edit) or the upstream's absence, neither of
      // which the download result knows anything about.
      await reconcileUserLayer(userLayerWorkspaceRoot, logger);
      // Re-reconcile against the post-download user layer. The pass below this
      // block runs before the network is done — so on a cold first run it sees
      // an empty user layer and copies nothing, and on a content update it
      // copies the previous revision. Both leave the workspace without skills
      // until the NEXT activation (TASK_2026_278). Running this for cached
      // downloads too is deliberate: that branch is exactly where the re-run is
      // a cheap hash-compare no-op.
      await reconcileHarness(logger, 'content-download-complete');
    })
    .catch((err: unknown) => {
      logger.warn('Post-download reconcile failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  // First pass, not awaiting the network, so a warm start has skills
  // immediately. `downloadPending` only changes how an empty user layer is
  // REPORTED (`pending-download` vs `sources-missing`); the callback above
  // corrects the content once it lands.
  await reconcileHarness(logger, 'activation', { downloadPending: true });
  context.subscriptions.push(subscribeHarnessToWorkspaceChanges(logger));
  void licenseStatus;
  try {
    const providerModels = DIContainer.getContainer().resolve(
      AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS,
    ) as { prefetchPricing: () => Promise<number> };
    providerModels.prefetchPricing();
  } catch (prefetchError) {
    logger.debug('Pricing pre-fetch setup failed', {
      error:
        prefetchError instanceof Error
          ? prefetchError.message
          : String(prefetchError),
    });
  }
  try {
    const cliDetection = DIContainer.getContainer().resolve(
      TOKENS.CLI_DETECTION_SERVICE,
    ) as {
      detectAll: () => Promise<
        Array<{ cli: string; installed: boolean; version?: string }>
      >;
      refreshCliTokens: () => Promise<void>;
    };
    cliDetection
      .detectAll()
      .then(async (results) => {
        const installed = results.filter((r) => r.installed);
        logger.info(
          `CLI detection complete: ${installed.length}/${results.length} CLIs found`,
          {
            clis: installed.map((r) => `${r.cli}@${r.version || 'unknown'}`),
          },
        );
        if (installed.some((r) => r.cli === 'codex')) {
          try {
            await cliDetection.refreshCliTokens();
          } catch (refreshErr) {
            logger.debug('CLI token refresh failed (non-blocking)', {
              error:
                refreshErr instanceof Error
                  ? refreshErr.message
                  : String(refreshErr),
            });
          }
        }
      })
      .catch((err) => {
        logger.debug('CLI detection failed (non-blocking)', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
  } catch (cliDetectError) {
    logger.debug('CLI detection setup failed (non-blocking)', {
      error:
        cliDetectError instanceof Error
          ? cliDetectError.message
          : String(cliDetectError),
    });
  }
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspacePath) {
    try {
      const sessionImporter = DIContainer.getContainer().resolve(
        SDK_TOKENS.SDK_SESSION_IMPORTER,
      ) as {
        scanAndImport: (path: string, limit?: number) => Promise<number>;
      };
      const imported = await sessionImporter.scanAndImport(workspacePath, 50);
      if (imported > 0) {
        logger.info(`Imported ${imported} existing Claude sessions`);
      }
    } catch (importError) {
      logger.debug('Session import skipped (no existing sessions or error)', {
        error:
          importError instanceof Error
            ? importError.message
            : String(importError),
      });
    }
  }
  try {
    const settingsExportService = DIContainer.getContainer().resolve(
      SDK_TOKENS.SDK_SETTINGS_EXPORT,
    ) as SettingsExportService;
    const settingsImportService = DIContainer.getContainer().resolve(
      SDK_TOKENS.SDK_SETTINGS_IMPORT,
    ) as SettingsImportService;

    const settingsCommands = new SettingsCommands(
      settingsExportService,
      settingsImportService,
      logger,
    );
    settingsCommands.registerCommands(context);
  } catch (settingsError) {
    logger.debug('Settings commands registration failed (non-blocking)', {
      error:
        settingsError instanceof Error
          ? settingsError.message
          : String(settingsError),
    });
  }
  try {
    const sqliteOk =
      DIContainer.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION) &&
      DIContainer.resolve<SqliteConnectionService>(
        PERSISTENCE_TOKENS.SQLITE_CONNECTION,
      ).isOpen;

    if (sqliteOk && DIContainer.isRegistered(CODE_SYMBOL_INDEXER)) {
      const symbolIndexer =
        DIContainer.resolve<CodeSymbolIndexer>(CODE_SYMBOL_INDEXER);

      const workspaceRoot =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

      if (workspaceRoot) {
        void symbolIndexer.indexWorkspace(workspaceRoot).catch((err) => {
          logger.warn(
            '[wire-runtime] CodeSymbolIndexer.indexWorkspace failed (non-fatal)',
            {
              error: err instanceof Error ? err.message : String(err),
            },
          );
        });
      }
      const allowedExts = new Set(['.ts', '.tsx', '.js', '.jsx']);
      const reindexDebounce = new Map<string, ReturnType<typeof setTimeout>>();
      const saveWatcher = vscode.workspace.onDidSaveTextDocument((doc) => {
        const fsPath = doc.uri.fsPath;
        const lastDot = fsPath.lastIndexOf('.');
        const ext = lastDot >= 0 ? fsPath.slice(lastDot) : '';
        if (allowedExts.has(ext)) {
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
          if (root) {
            const existingTimer = reindexDebounce.get(fsPath);
            if (existingTimer) clearTimeout(existingTimer);
            reindexDebounce.set(
              fsPath,
              setTimeout(() => {
                reindexDebounce.delete(fsPath);
                void symbolIndexer
                  .reindexFile(fsPath, root)
                  .catch((err: unknown) => {
                    logger.warn(
                      '[wire-runtime] reindexFile failed (non-fatal)',
                      {
                        error: err instanceof Error ? err.message : String(err),
                      },
                    );
                  });
              }, 500),
            );
          }
        }
      });
      context.subscriptions.push(saveWatcher);

      logger.info(
        '[wire-runtime] Code symbol indexer wired (index + save-handler)',
      );
    }
  } catch (err) {
    logger.warn(
      '[wire-runtime] Code symbol indexer wiring skipped (non-fatal)',
      {
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }

  // Live in-memory file index that powers `@`-mention autocomplete. Build it
  // eagerly (non-blocking) so the first `@` search is instant and the index
  // stays fresh via its file watcher. Lazy-builds on first query otherwise.
  try {
    if (DIContainer.isRegistered(TOKENS.WORKSPACE_FILE_INDEX_SERVICE)) {
      const fileIndex = DIContainer.resolve<WorkspaceFileIndexService>(
        TOKENS.WORKSPACE_FILE_INDEX_SERVICE,
      );
      const workspaceRoot =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      if (workspaceRoot) {
        void fileIndex.start(workspaceRoot).catch((err: unknown) => {
          logger.warn(
            '[wire-runtime] WorkspaceFileIndex.start failed (non-fatal)',
            { error: err instanceof Error ? err.message : String(err) },
          );
        });
        context.subscriptions.push({ dispose: () => fileIndex.dispose() });
      }
    }
  } catch (err) {
    logger.warn(
      '[wire-runtime] Workspace file index wiring skipped (non-fatal)',
      { error: err instanceof Error ? err.message : String(err) },
    );
  }
}
