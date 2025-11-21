// CRITICAL: reflect-metadata MUST be imported first for TSyringe to work
import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import * as vscode from 'vscode';
import { AnalyticsDataCollectorAdapter } from './adapters/analytics-data-collector.adapter';
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

    // Initialize MessageHandlerService to start event routing
    console.log('[Activate] Step 3: Initializing MessageHandlerService...');
    const messageHandler = DIContainer.resolve(TOKENS.MESSAGE_HANDLER_SERVICE);
    (messageHandler as { initialize: () => void }).initialize();
    logger.info('MessageHandlerService initialized and subscribed to EventBus');
    console.log('[Activate] Step 3: MessageHandlerService initialized');

    // Initialize main extension controller
    console.log('[Activate] Step 4: Creating PtahExtension instance...');
    ptahExtension = new PtahExtension(context);
    console.log('[Activate] Step 4: PtahExtension instance created');

    console.log('[Activate] Step 5: Calling ptahExtension.initialize()...');
    await ptahExtension.initialize();
    console.log('[Activate] Step 5: ptahExtension.initialize() complete');

    // Register late-binding adapters (require PtahExtension initialization)
    console.log('[Activate] Step 6: Registering late-binding adapters...');
    const container = DIContainer.getContainer();

    // NOTE: CONFIGURATION_PROVIDER is now registered in DIContainer.setup()
    // It was moved there to fix dependency injection order (ConfigOrchestrationService depends on it)

    // AnalyticsDataCollector adapter
    const analyticsDataCollector = ptahExtension.getAnalyticsDataCollector();
    if (!analyticsDataCollector) {
      const error = 'AnalyticsDataCollector not initialized in PtahExtension';
      console.error('[Activate] ERROR:', error);
      throw new Error(error);
    }
    const analyticsCollectorAdapter = new AnalyticsDataCollectorAdapter(
      analyticsDataCollector
    );
    container.register(TOKENS.ANALYTICS_DATA_COLLECTOR, {
      useValue: analyticsCollectorAdapter,
    });
    logger.info('AnalyticsDataCollector adapter registered');
    console.log('[Activate] AnalyticsDataCollector adapter registered');
    console.log('[Activate] Step 6: Late-binding adapters registered');

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
    logger.error('Failed to activate Ptah extension', error);
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
