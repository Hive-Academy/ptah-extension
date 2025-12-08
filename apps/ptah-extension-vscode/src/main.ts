// CRITICAL: reflect-metadata MUST be imported first for TSyringe to work
import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
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
    };
    const authInitialized = await sdkAdapter.initialize();

    if (!authInitialized) {
      logger.warn('SDK authentication not configured - showing onboarding UI');
    } else {
      logger.info('SDK authentication initialized successfully');
    }
    console.log(
      '[Activate] Step 3.8: SDK authentication initialization complete'
    );

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
    // NOTE: CONFIGURATION_PROVIDER is now registered in DIContainer.setup()
    // It was moved there to fix dependency injection order (ConfigOrchestrationService depends on it)
    console.log(
      '[Activate] Step 6: Late-binding adapters registered (analytics removed)'
    );

    // Register all providers, commands, and services
    console.log('[Activate] Step 7: Calling ptahExtension.registerAll()...');
    await ptahExtension.registerAll();
    console.log('[Activate] Step 7: ptahExtension.registerAll() complete');

    // Start Code Execution MCP Server
    console.log('[Activate] Step 8: Starting Code Execution MCP Server...');
    const codeExecutionMCP = DIContainer.resolve(TOKENS.CODE_EXECUTION_MCP);
    const mcpPort = await (
      codeExecutionMCP as { start: () => Promise<number> }
    ).start();
    context.subscriptions.push(codeExecutionMCP as vscode.Disposable);
    logger.info(`Code Execution MCP Server started on port ${mcpPort}`);
    console.log(
      `[Activate] Step 8: Code Execution MCP Server started (port ${mcpPort})`
    );

    // Write Ptah MCP server to .mcp.json file
    console.log('[Activate] Step 9: Writing MCP config to .mcp.json...');

    try {
      const mcpConfigManager = DIContainer.resolve(
        TOKENS.MCP_CONFIG_MANAGER_SERVICE
      );

      await (
        mcpConfigManager as {
          ensurePtahMCPConfig: (port: number) => Promise<void>;
        }
      ).ensurePtahMCPConfig(mcpPort);

      logger.info('MCP server registered in .mcp.json', {
        context: 'Extension Activation',
        status: 'registered',
        port: mcpPort,
        url: `http://localhost:${mcpPort}`,
      });
      console.log('[Activate] Step 9: MCP server registered in .mcp.json');
    } catch (error) {
      logger.error(
        'Failed to write MCP config (non-blocking)',
        error instanceof Error ? error : new Error(String(error))
      );
      console.warn(
        '[Activate] Step 9: MCP config write failed (non-blocking)',
        error
      );
      // Don't block extension activation if MCP config fails
    }

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
