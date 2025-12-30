// CRITICAL: reflect-metadata MUST be imported first for TSyringe to work
import 'reflect-metadata';

import type {
  Logger,
  LicenseService,
  LicenseStatus,
} from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import * as vscode from 'vscode';
import { PtahExtension } from './core/ptah-extension';
import { DIContainer } from './di/container';

let ptahExtension: PtahExtension | undefined;

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  console.log('===== PTAH ACTIVATION START =====');
  try {
    // Initialize centralized DI Container with ALL services
    console.log('[Activate] Step 1: Setting up DI Container...');
    DIContainer.setup(context);
    console.log('[Activate] Step 1: DI Container setup complete');

    // Get logger from DI container
    console.log('[Activate] Step 2: Resolving Logger...');
    const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
    logger.info('Activating Ptah extension...');
    console.log('[Activate] Step 2: Logger resolved');

    // Register RPC Methods (Phase 2 - TASK_2025_021)
    // Extracted to RpcMethodRegistrationService for clean separation
    console.log('[Activate] Step 3.6: Registering RPC methods...');
    const rpcMethodRegistration = DIContainer.resolve(
      TOKENS.RPC_METHOD_REGISTRATION_SERVICE
    ) as { registerAll: () => void };
    rpcMethodRegistration.registerAll();
    console.log('[Activate] Step 3.6: RPC methods registered');

    // Initialize autocomplete discovery watchers (TASK_2025_019 Phase 2)
    // NOTE: MCP discovery service was planned but never implemented - only agent and command discovery exist
    console.log('[Activate] Step 3.7: Initializing autocomplete watchers...');
    const agentDiscovery = DIContainer.resolve(
      TOKENS.AGENT_DISCOVERY_SERVICE
    ) as { initializeWatchers: () => void };
    const commandDiscovery = DIContainer.resolve(
      TOKENS.COMMAND_DISCOVERY_SERVICE
    ) as { initializeWatchers: () => void };
    agentDiscovery.initializeWatchers();
    commandDiscovery.initializeWatchers();
    logger.info('Autocomplete discovery watchers initialized (2 services)');
    console.log('[Activate] Step 3.7: Autocomplete watchers initialized');

    // Step 3.8: Initialize SDK authentication (TASK_2025_057 Batch 1)
    console.log('[Activate] Step 3.8: Initializing SDK authentication...');
    const sdkAdapter = DIContainer.resolve(TOKENS.SDK_AGENT_ADAPTER) as {
      initialize: () => Promise<boolean>;
      preloadSdk: () => Promise<void>;
    };
    const authInitialized = await sdkAdapter.initialize();

    if (!authInitialized) {
      logger.warn('SDK authentication not configured - showing onboarding UI');
    } else {
      logger.info('SDK authentication initialized successfully');

      // Pre-load SDK in background (non-blocking) to speed up first chat
      // This shifts ~100-200ms import cost from first user interaction to activation
      console.log('[Activate] Step 3.8.1: Pre-loading SDK in background...');
      sdkAdapter.preloadSdk().catch((err) => {
        logger.warn('SDK preload failed (will retry on first use)', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    console.log(
      '[Activate] Step 3.8: SDK authentication initialization complete'
    );

    // Step 3.9: DELETED in TASK_2025_092
    // SdkRpcHandlers was dead code - only used for permission emitter initialization
    // Permission emitter now initialized directly in SdkPermissionHandler constructor
    // (resolved as part of registerSdkServices in DIContainer.setup)

    // Step 3.10: Import existing Claude Code sessions (TASK_2025_091)
    console.log('[Activate] Step 3.10: Importing existing sessions...');
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspacePath) {
      try {
        const { SDK_TOKENS } = require('@ptah-extension/agent-sdk');
        const sessionImporter = DIContainer.getContainer().resolve(
          SDK_TOKENS.SDK_SESSION_IMPORTER
        ) as {
          scanAndImport: (path: string, limit?: number) => Promise<number>;
        };
        const imported = await sessionImporter.scanAndImport(workspacePath, 5);
        if (imported > 0) {
          logger.info(`Imported ${imported} existing Claude Code sessions`);
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
    console.log('[Activate] Step 3.10: Session import complete');

    // Initialize main extension controller
    console.log('[Activate] Step 4: Creating PtahExtension instance...');
    ptahExtension = new PtahExtension(context);
    console.log('[Activate] Step 4: PtahExtension instance created');

    console.log('[Activate] Step 5: Calling ptahExtension.initialize()...');
    await ptahExtension.initialize();
    console.log('[Activate] Step 5: ptahExtension.initialize() complete');

    // Show onboarding UI if authentication not configured (TASK_2025_057 Batch 1)
    if (!authInitialized) {
      console.log('[Activate] Step 5.5: Showing authentication onboarding...');
      await ptahExtension.showAuthenticationOnboarding();
      console.log('[Activate] Step 5.5: Authentication onboarding displayed');
    }

    // Register late-binding adapters (require PtahExtension initialization)
    console.log('[Activate] Step 6: Registering late-binding adapters...');
    // NOTE: Most late-binding adapters removed in TASK_2025_023 purge
    console.log(
      '[Activate] Step 6: Late-binding adapters registered (analytics removed)'
    );

    // Register all providers, commands, and services
    console.log('[Activate] Step 7: Calling ptahExtension.registerAll()...');
    await ptahExtension.registerAll();
    console.log('[Activate] Step 7: ptahExtension.registerAll() complete');

    // ========================================
    // NEW STEP 7.5: LICENSE VERIFICATION
    // ========================================
    console.log('[Activate] Step 7.5: Verifying license...');
    const licenseService = DIContainer.resolve<LicenseService>(
      TOKENS.LICENSE_SERVICE
    );
    const licenseStatus: LicenseStatus = await licenseService.verifyLicense();

    if (licenseStatus.valid && licenseStatus.tier !== 'free') {
      logger.info('Premium license verified', {
        tier: licenseStatus.tier,
        expiresAt: licenseStatus.expiresAt,
      });
    } else {
      logger.info('Free tier user (no premium features)', {
        reason: licenseStatus.reason || 'no_license',
      });
    }
    console.log(
      `[Activate] Step 7.5: License verified (tier: ${licenseStatus.tier})`
    );

    // ========================================
    // MODIFIED STEP 8: CONDITIONAL MCP SERVER START
    // ========================================
    console.log('[Activate] Step 8: Conditional MCP Server registration...');

    if (licenseStatus.valid && licenseStatus.tier !== 'free') {
      // PREMIUM USER: Register MCP Server
      logger.info('Registering premium MCP server (licensed user)');
      const codeExecutionMCP = DIContainer.resolve(TOKENS.CODE_EXECUTION_MCP);
      const mcpPort = await (
        codeExecutionMCP as { start: () => Promise<number> }
      ).start();
      context.subscriptions.push(codeExecutionMCP as vscode.Disposable);
      logger.info(`Code Execution MCP Server started on port ${mcpPort}`);
      console.log(
        `[Activate] Step 8: Premium MCP Server started (port ${mcpPort})`
      );
    } else {
      // FREE USER: Skip MCP Server Registration
      logger.info('Skipping premium MCP server (free tier user)');
      console.log('[Activate] Step 8: MCP Server skipped (free tier)');
    }

    // Note: MCP config (.mcp.json) writing removed - SDK tools are now native
    // and don't require external MCP server registration. The Code Execution
    // MCP server runs locally and Ptah tools (help, executeCode) are registered
    // directly with the SDK via mcpServers option in SdkAgentAdapter.

    // ========================================
    // NEW STEP 9: LICENSE STATUS WATCHER
    // ========================================
    console.log('[Activate] Step 9: Setting up license status watcher...');

    // Handle dynamic license changes (upgrade/expire)
    licenseService.on('license:verified', async (status: LicenseStatus) => {
      logger.info('License upgraded - registering premium features', {
        status,
      });
      // Note: Dynamic registration requires checking if MCP is already running
      // For simplicity, we show a message prompting user to reload window
      vscode.window
        .showInformationMessage(
          'Premium license activated! Reload window to enable premium features.',
          'Reload Window'
        )
        .then((action) => {
          if (action === 'Reload Window') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        });
    });

    licenseService.on('license:expired', (status: LicenseStatus) => {
      logger.warn('License expired - premium features disabled', { status });
      vscode.window.showWarningMessage(
        'Your Ptah premium license has expired. Reload window to disable premium features.'
      );
    });

    console.log('[Activate] Step 9: License status watcher initialized');

    // Background revalidation (every 24 hours)
    const revalidationInterval = setInterval(
      () => licenseService.revalidate(),
      24 * 60 * 60 * 1000
    );
    context.subscriptions.push({
      dispose: () => clearInterval(revalidationInterval),
    });

    logger.info('Ptah extension activated successfully');
    console.log('===== PTAH ACTIVATION COMPLETE =====');

    // Show welcome message for first-time users
    const isFirstTime = context.globalState.get('ptah.firstActivation', true);
    if (isFirstTime) {
      await ptahExtension.showWelcome();
      await context.globalState.update('ptah.firstActivation', false);
    }
  } catch (error) {
    console.error('===== PTAH ACTIVATION FAILED =====');
    console.error('[Activate] Error details:', error);
    console.error(
      '[Activate] Error stack:',
      error instanceof Error ? error.stack : 'No stack trace'
    );
    const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
    logger.error(
      'Failed to activate Ptah extension',
      error instanceof Error ? error : new Error(String(error))
    );
    vscode.window.showErrorMessage(
      `Ptah activation failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

export function deactivate(): void {
  const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
  logger.info('Deactivating Ptah extension');

  // NOTE: We intentionally do NOT remove ptah from .mcp.json on deactivation.
  // The MCP config must persist so that resumed Claude sessions can find
  // the permission-prompt-tool. The port gets updated on next activation.

  ptahExtension?.dispose();
  ptahExtension = undefined;
  DIContainer.clear();
}
