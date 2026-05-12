import * as vscode from 'vscode';
import type { Logger, LicenseStatus } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  type SettingsExportService,
  type SettingsImportService,
} from '@ptah-extension/agent-sdk';
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
import type { CodeSymbolIndexer } from '@ptah-extension/workspace-intelligence';
import { DIContainer } from '../di/container';
import { SettingsCommands } from '../commands/settings-commands';
import { activateSkillJunctions, initPluginLoader } from './plugin-activation';
import { syncCliSkillsOnActivation } from './cli-skill-sync';
import { syncCliAgentsOnActivation } from './cli-agent-sync';

/**
 * Phase 2 of VS Code activation (TASK_2025_291 Wave C1).
 *
 * Covers Steps 7.1.4 through 8.1:
 * - 7.1.4: Content download from GitHub (non-blocking)
 * - 7.1.5: Plugin loader initialization
 * - 7.1.5.1: Skill junction creation
 * - 7.1.6: CLI skill sync (Pro-only, fire-and-forget)
 * - 7.1.7: CLI agent sync on activation (Pro-only, fire-and-forget)
 * - 7.2: Pricing pre-fetch (fire-and-forget)
 * - 7.3: Proactive CLI detection (fire-and-forget)
 * - 8: Session import from existing Claude sessions
 * - 8.1: Settings export/import commands registration
 */
export async function wireRuntimeVscode(
  context: vscode.ExtensionContext,
  logger: Logger,
  licenseStatus: LicenseStatus,
): Promise<void> {
  // Step 7.1.4: Ensure plugin/template content from GitHub (non-blocking)
  // TASK_2025_248: Plugins and templates are no longer bundled in the VSIX.
  // ContentDownloadService downloads them to ~/.ptah/ on first launch and
  // keeps them up-to-date by comparing the manifest contentHash.
  const contentDownload = DIContainer.resolve<ContentDownloadService>(
    PLATFORM_TOKENS.CONTENT_DOWNLOAD,
  );
  contentDownload.ensureContent().then((result) => {
    if (!result?.success) {
      console.warn(
        '[Activate] Content download failed (non-blocking):',
        result?.error ?? 'Unknown error',
      );
    }
  });

  // Step 7.1.5: Initialize plugin loader with extension path (TASK_2025_153)
  initPluginLoader(contentDownload.getPluginsPath(), logger);
  // Step 7.1.5.1: Create workspace skill junctions (TASK_2025_201)
  activateSkillJunctions(contentDownload.getPluginsPath(), logger);
  // Step 7.1.6: CLI Skill Sync (TASK_2025_160)
  // Sync Ptah plugin skills to installed CLI agent directories (Copilot, Gemini)
  // Premium-only, non-blocking, fire-and-forget
  if (licenseStatus.tier === 'pro' || licenseStatus.tier === 'trial_pro') {
    syncCliSkillsOnActivation(contentDownload.getPluginsPath(), logger);
  } else {
    logger.debug('CLI skill sync skipped (Community tier - Pro feature only)');
  }
  // Step 7.1.7: CLI Agent Sync on Activation (TASK_2025_268)
  // Distribute existing .claude/agents/*.md to all installed CLI targets.
  // Ensures agents are present after fresh install without re-running the wizard.
  // Premium-only, non-blocking, fire-and-forget. Uses content-hash dedup to avoid
  // redundant writes when agent files have not changed since last activation.
  if (licenseStatus.tier === 'pro' || licenseStatus.tier === 'trial_pro') {
    const agentSyncWorkspaceRoot =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (agentSyncWorkspaceRoot) {
      syncCliAgentsOnActivation(agentSyncWorkspaceRoot, logger);
    }
  } else {
    logger.debug('CLI agent sync skipped (Community tier - Pro feature only)');
  }
  // Step 7.2: Pre-fetch model pricing from OpenRouter (non-blocking, no auth needed)
  // OpenRouter's /api/v1/models endpoint is publicly accessible and returns
  // pricing data for 200+ models. This replaces hardcoded pricing with live data.
  try {
    const providerModels = DIContainer.getContainer().resolve(
      SDK_TOKENS.SDK_PROVIDER_MODELS,
    ) as { prefetchPricing: () => Promise<number> };
    // Fire-and-forget: prefetchPricing handles errors internally
    providerModels.prefetchPricing();
  } catch (prefetchError) {
    // Synchronous errors from require()/resolve() only
    logger.debug('Pricing pre-fetch setup failed', {
      error:
        prefetchError instanceof Error
          ? prefetchError.message
          : String(prefetchError),
    });
  }
  // Step 7.3: Proactive CLI detection (non-blocking, warms cache for agent orchestration)
  // TASK_2025_157: Detect installed CLI agents (Gemini, Codex) early so settings UI is instant
  try {
    const cliDetection = DIContainer.getContainer().resolve(
      TOKENS.CLI_DETECTION_SERVICE,
    ) as {
      detectAll: () => Promise<
        Array<{ cli: string; installed: boolean; version?: string }>
      >;
      refreshCliTokens: () => Promise<void>;
    };
    // Fire-and-forget: detectAll caches results internally,
    // then refresh OAuth tokens (Codex) so model lists work on first use
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

        // Background token refresh for CLIs that use OAuth (Codex)
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
  // Step 8: Import existing Claude sessions (TASK_2025_091)
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
  // Step 8.1: Register Settings Export/Import commands (TASK_2025_210)
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

  // Step 9: Code symbol indexer cold-start (TASK_2026_THOTH_CODE_INDEX).
  // Fire-and-forget workspace index + onDidSaveTextDocument handler for
  // incremental re-indexing. Non-fatal — SQLite may be unavailable.
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
        // Fire-and-forget full workspace index — must NOT block activation.
        void symbolIndexer.indexWorkspace(workspaceRoot).catch((err) => {
          logger.warn(
            '[wire-runtime] CodeSymbolIndexer.indexWorkspace failed (non-fatal)',
            {
              error: err instanceof Error ? err.message : String(err),
            },
          );
        });
      }

      // Incremental re-index on file save — debounced 500ms to prevent
      // concurrent delete+insert races on rapid saves.
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

  // Note: ptah.resetDatabase is intentionally NOT registered in the VS Code
  // extension host. The persistence-sqlite layer is excluded from VS Code's
  // RPC registration (see rpc-method-registration.service.ts ELECTRON_ONLY_METHODS),
  // so the underlying db:reset RPC would always return Method-Not-Found.
  // Reset Database is an Electron-app-only feature (Help > Database menu).
}
