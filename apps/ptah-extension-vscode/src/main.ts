// CRITICAL: reflect-metadata MUST be imported first for TSyringe to work
import 'reflect-metadata';

import type { ConfigManager, Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import * as vscode from 'vscode';
import { AnalyticsDataCollectorAdapter } from './adapters/analytics-data-collector.adapter';
import { ConfigurationProviderAdapter } from './adapters/configuration-provider.adapter';
import { PtahExtension } from './core/ptah-extension';
import { DIContainer } from './di/container';

let ptahExtension: PtahExtension | undefined;

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  try {
    // Initialize centralized DI Container with ALL services
    DIContainer.setup(context);

    // Get logger from DI container
    const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
    logger.info('Activating Ptah extension...');

    // Initialize MessageHandlerService to start event routing
    const messageHandler = DIContainer.resolve(TOKENS.MESSAGE_HANDLER_SERVICE);
    (messageHandler as { initialize: () => void }).initialize();
    logger.info('MessageHandlerService initialized and subscribed to EventBus');

    // Initialize main extension controller
    ptahExtension = new PtahExtension(context);
    await ptahExtension.initialize();

    // Register late-binding adapters (require PtahExtension initialization)
    const container = DIContainer.getContainer();

    // ConfigurationProvider adapter
    const configManager = DIContainer.resolve<ConfigManager>(
      TOKENS.CONFIG_MANAGER
    );
    const configProviderAdapter = new ConfigurationProviderAdapter(
      configManager
    );
    container.register(TOKENS.CONFIGURATION_PROVIDER, {
      useValue: configProviderAdapter,
    });
    logger.info('ConfigurationProvider adapter registered');

    // AnalyticsDataCollector adapter
    const analyticsDataCollector = ptahExtension.getAnalyticsDataCollector();
    if (!analyticsDataCollector) {
      throw new Error(
        'AnalyticsDataCollector not initialized in PtahExtension'
      );
    }
    const analyticsCollectorAdapter = new AnalyticsDataCollectorAdapter(
      analyticsDataCollector
    );
    container.register(TOKENS.ANALYTICS_DATA_COLLECTOR, {
      useValue: analyticsCollectorAdapter,
    });
    logger.info('AnalyticsDataCollector adapter registered');

    // Register all providers, commands, and services
    await ptahExtension.registerAll();

    logger.info('Ptah extension activated successfully');

    // Show welcome message for first-time users
    const isFirstTime = context.globalState.get('ptah.firstActivation', true);
    if (isFirstTime) {
      await ptahExtension.showWelcome();
      await context.globalState.update('ptah.firstActivation', false);
    }
  } catch (error) {
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
