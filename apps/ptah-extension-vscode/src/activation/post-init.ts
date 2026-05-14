import * as vscode from 'vscode';
import {
  type Logger,
  type LicenseService,
  type LicenseStatus,
  TOKENS,
  bindLicenseReactivity,
} from '@ptah-extension/vscode-core';
import { setPtahMcpPort } from '@ptah-extension/agent-sdk';
import {
  PLATFORM_TOKENS,
  ContentDownloadService,
} from '@ptah-extension/platform-core';
import { DIContainer } from '../di/container';
import { PtahExtension } from '../core/ptah-extension';
import { syncCliSkillsOnActivation } from './cli-skill-sync';
import { syncCliAgentsOnActivation } from './cli-agent-sync';

/**
 * Phase 3 of VS Code activation (TASK_2025_291 Wave C1).
 *
 * Covers:
 * - PtahExtension controller construction + initialize() + registerAll()
 * - Step 12: License-reactive MCP server start (replaces static tier snapshot)
 * - Step 13: License reactivity binder (license:verified / license:expired)
 *            + background revalidation interval
 * - First-time welcome message
 *
 * @returns The constructed PtahExtension so the caller can assign it to the
 *   module-level `ptahExtension` variable used by `deactivate()`.
 */
export async function registerPostInit(
  context: vscode.ExtensionContext,
  logger: Logger,
  licenseStatus: LicenseStatus,
  authInitialized: boolean,
): Promise<PtahExtension> {
  // Initialize main extension controller
  const ptahExtension = new PtahExtension(context);

  await ptahExtension.initialize();

  // Auth not configured is a normal state on first install — no popup needed.
  // Users can configure authentication via Ptah Settings > Authentication tab.
  if (!authInitialized) {
    // Auth not configured — normal on first install
  }

  // Register all providers, commands, and services
  await ptahExtension.registerAll();

  // Note: MCP config (.mcp.json) writing removed - SDK tools are now native
  // and don't require external MCP server registration. The Code Execution
  // MCP server runs locally and Ptah tools (help, executeCode) are registered
  // directly with the SDK via mcpServers option in SdkAgentAdapter.

  // ========================================
  // STEP 12 + 13: LICENSE REACTIVITY BINDER
  // ========================================
  // Replaces the static startupLicenseTier snapshot gating of Steps 12 and 13.
  // The binder:
  //   - Performs an initial dispatch based on current license state
  //   - Subscribes to license:verified → starts MCP, CLI syncs, invalidates FGS cache
  //   - Subscribes to license:expired  → stops MCP, cleans up CLI, invalidates FGS cache
  // This fixes the race where a user activates a license mid-session and
  // premium subsystems were never started (they read a stale community tier).
  try {
    const container = DIContainer.getContainer();

    // Resolve plugins path for skill sync callback.
    let pluginsPathForSync: string;
    try {
      const contentDownload = DIContainer.resolve<ContentDownloadService>(
        PLATFORM_TOKENS.CONTENT_DOWNLOAD,
      );
      pluginsPathForSync = contentDownload.getPluginsPath();
    } catch {
      const os = await import('os');
      const path = await import('path');
      pluginsPathForSync = path.join(os.homedir(), '.ptah', 'plugins');
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    const binderDisposable = bindLicenseReactivity({
      container,
      logger,
      onMcpPortChange: (port) => {
        setPtahMcpPort(port ?? 0);
      },
      notify: (kind) => {
        if (kind === 'verified') {
          vscode.window.showInformationMessage(
            'Ptah premium features activated.',
          );
        } else {
          vscode.window.showWarningMessage(
            'Your Ptah license has expired. Please renew your subscription to continue using premium features.',
          );
        }
      },
      syncCliSkills: () => {
        syncCliSkillsOnActivation(pluginsPathForSync, logger);
      },
      syncCliAgents: () => {
        if (workspaceRoot) {
          syncCliAgentsOnActivation(workspaceRoot, logger);
        }
      },
    });

    // Register binder disposal in extension context so it's cleaned up on deactivate.
    context.subscriptions.push(binderDisposable);

    logger.info('[post-init] License reactivity binder initialized');
  } catch (binderError: unknown) {
    logger.warn(
      '[post-init] License reactivity binder setup failed (non-fatal)',
      {
        error:
          binderError instanceof Error
            ? binderError.message
            : String(binderError),
      },
    );
  }

  // ========================================
  // Background revalidation (every 24 hours)
  // ========================================
  // The revalidate() call emits license:verified / license:expired events
  // which route through the bindLicenseReactivity binder above, keeping
  // subsystem state in sync on periodic checks.
  try {
    const licenseService = DIContainer.resolve<LicenseService>(
      TOKENS.LICENSE_SERVICE,
    );
    const revalidationInterval = setInterval(
      () => licenseService.revalidate(),
      24 * 60 * 60 * 1000,
    );
    context.subscriptions.push({
      dispose: () => clearInterval(revalidationInterval),
    });
  } catch (revalError: unknown) {
    logger.warn(
      '[post-init] Background revalidation setup failed (non-fatal)',
      {
        error:
          revalError instanceof Error ? revalError.message : String(revalError),
      },
    );
  }

  // Show welcome message for first-time users
  const isFirstTime = context.globalState.get('ptah.firstActivation', true);
  if (isFirstTime) {
    await ptahExtension.showWelcome();
    await context.globalState.update('ptah.firstActivation', false);
  }

  // licenseStatus is still used by the caller for initial UI state decisions —
  // keep the parameter signature intact.
  void licenseStatus;

  return ptahExtension;
}
