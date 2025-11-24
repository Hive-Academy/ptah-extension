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
    console.log('[Activate] Step 3.7: Initializing autocomplete watchers...');
    const agentDiscovery = DIContainer.resolve(
      TOKENS.AGENT_DISCOVERY_SERVICE
    ) as any;
    const mcpDiscovery = DIContainer.resolve(
      TOKENS.MCP_DISCOVERY_SERVICE
    ) as any;
    const commandDiscovery = DIContainer.resolve(
      TOKENS.COMMAND_DISCOVERY_SERVICE
    ) as any;
    agentDiscovery.initializeWatchers();
    mcpDiscovery.initializeWatchers();
    commandDiscovery.initializeWatchers();
    logger.info('Autocomplete discovery watchers initialized (3 services)');
    console.log('[Activate] Step 3.7: Autocomplete watchers initialized');

    // Initialize main extension controller
    console.log('[Activate] Step 4: Creating PtahExtension instance...');
    ptahExtension = new PtahExtension(context);
    console.log('[Activate] Step 4: PtahExtension instance created');

    console.log('[Activate] Step 5: Calling ptahExtension.initialize()...');
    await ptahExtension.initialize();
    console.log('[Activate] Step 5: ptahExtension.initialize() complete');

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

    // Register Language Model Tools with VS Code
    console.log('[Activate] Step 8: Registering Language Model Tools...');
    const lmToolsService = DIContainer.resolve(
      TOKENS.LM_TOOLS_REGISTRATION_SERVICE
    );
    (
      lmToolsService as {
        registerAll: (context: vscode.ExtensionContext) => void;
      }
    ).registerAll(context);
    logger.info('Language Model Tools registered (6 tools)');
    console.log('[Activate] Step 8: Language Model Tools registered');

    // Start Code Execution MCP Server
    console.log('[Activate] Step 9: Starting Code Execution MCP Server...');
    const codeExecutionMCP = DIContainer.resolve(TOKENS.CODE_EXECUTION_MCP);
    const mcpPort = await (
      codeExecutionMCP as { start: () => Promise<number> }
    ).start();
    context.subscriptions.push(codeExecutionMCP as vscode.Disposable);
    logger.info(`Code Execution MCP Server started on port ${mcpPort}`);
    console.log(
      `[Activate] Step 9: Code Execution MCP Server started (port ${mcpPort})`
    );

    // Register Ptah MCP server with Claude CLI (one-time)
    console.log(
      '[Activate] Step 10: Registering MCP server with Claude CLI...'
    );
    try {
      const mcpRegistration = DIContainer.resolve(
        TOKENS.MCP_REGISTRATION_SERVICE
      );
      await (
        mcpRegistration as { registerPtahMCPServer: () => Promise<void> }
      ).registerPtahMCPServer();

      logger.info('MCP server registered with Claude CLI', {
        context: 'Extension Activation',
        status: 'registered',
        scope: 'local',
        url: 'http://localhost:${PTAH_MCP_PORT}',
      });
      console.log('[Activate] Step 10: MCP server registered with Claude CLI');
    } catch (error) {
      // Fix: Logger.error now takes 2 params: (message, errorOrContext)
      logger.error(
        'Failed to register MCP server (non-blocking)',
        error instanceof Error ? error : new Error(String(error))
      );
      console.warn(
        '[Activate] Step 10: MCP registration failed (non-blocking)',
        error
      );
      // Don't block extension activation if MCP registration fails
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
  ptahExtension?.dispose();
  ptahExtension = undefined;
  DIContainer.clear();
}
