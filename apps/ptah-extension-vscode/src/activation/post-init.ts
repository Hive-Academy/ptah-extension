import * as vscode from 'vscode';
import {
  type Logger,
  type LicenseService,
  type LicenseStatus,
  TOKENS,
} from '@ptah-extension/vscode-core';
import { setPtahMcpPort } from '@ptah-extension/agent-sdk';
import { DIContainer } from '../di/container';
import { PtahExtension } from '../core/ptah-extension';

/**
 * Phase 3 of VS Code activation (TASK_2025_291 Wave C1).
 *
 * Covers:
 * - PtahExtension controller construction + initialize() + registerAll()
 * - Step 12: Conditional MCP server start (Pro-gated)
 * - Step 13: License status watcher + background revalidation interval
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

  // ========================================
  // STEP 12: CONDITIONAL MCP SERVER START (TASK_2025_121)
  // ========================================
  // MCP Server only starts for Pro tier users (Pro-only feature)
  if (licenseStatus.tier === 'pro' || licenseStatus.tier === 'trial_pro') {
    // PRO USER: Register MCP Server (Pro-only feature)
    // Non-blocking: MCP server failure should NOT crash the extension
    try {
      logger.info('Registering premium MCP server (Pro tier user)');
      const codeExecutionMCP = DIContainer.resolve(TOKENS.CODE_EXECUTION_MCP);
      const mcpPort = await (
        codeExecutionMCP as { start: () => Promise<number> }
      ).start();
      context.subscriptions.push(codeExecutionMCP as vscode.Disposable);
      // Update the runtime port so SDK query builders use the actual port
      // (may differ from default 51820 if fallback to OS-assigned port)
      setPtahMcpPort(mcpPort);
      logger.info(`Code Execution MCP Server started on port ${mcpPort}`);
    } catch (mcpError) {
      logger.warn('MCP server failed to start (non-blocking)', {
        error: mcpError instanceof Error ? mcpError.message : String(mcpError),
      });
    }
  } else {
    // COMMUNITY USER: Skip MCP Server (Pro-only feature)
    logger.info('Skipping MCP server (Community tier - Pro feature only)', {
      tier: licenseStatus.tier,
    });
  }

  // Note: MCP config (.mcp.json) writing removed - SDK tools are now native
  // and don't require external MCP server registration. The Code Execution
  // MCP server runs locally and Ptah tools (help, executeCode) are registered
  // directly with the SDK via mcpServers option in SdkAgentAdapter.

  // ========================================
  // STEP 13: LICENSE STATUS WATCHER
  // ========================================
  // Handle dynamic license changes (upgrade/expire)
  const licenseService = DIContainer.resolve<LicenseService>(
    TOKENS.LICENSE_SERVICE,
  );
  licenseService.on('license:verified', async (newStatus: LicenseStatus) => {
    logger.info('License status changed', { newStatus });
    // For simplicity, we show a message prompting user to reload window
    vscode.window
      .showInformationMessage(
        'License status updated! Reload window to apply changes.',
        'Reload Window',
      )
      .then((action) => {
        if (action === 'Reload Window') {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      });
  });

  licenseService.on('license:expired', (newStatus: LicenseStatus) => {
    logger.warn('License expired - extension will be blocked on reload', {
      newStatus,
    });
    vscode.window.showWarningMessage(
      'Your Ptah license has expired. Please renew your subscription to continue using the extension.',
    );

    // TASK_2025_160: Clean up CLI skills and agents on premium expiry
    try {
      const cliPluginSync = DIContainer.getContainer().resolve(
        TOKENS.CLI_PLUGIN_SYNC_SERVICE,
      ) as { cleanupAll: () => Promise<void> };
      cliPluginSync.cleanupAll().catch((err: unknown) => {
        logger.warn('CLI plugin cleanup on expiry failed (non-fatal)', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    } catch {
      // Service not initialized — nothing to clean up
    }
  });

  // Background revalidation (every 24 hours)
  const revalidationInterval = setInterval(
    () => licenseService.revalidate(),
    24 * 60 * 60 * 1000,
  );
  context.subscriptions.push({
    dispose: () => clearInterval(revalidationInterval),
  });

  // Show welcome message for first-time users
  const isFirstTime = context.globalState.get('ptah.firstActivation', true);
  if (isFirstTime) {
    await ptahExtension.showWelcome();
    await context.globalState.update('ptah.firstActivation', false);
  }

  return ptahExtension;
}
