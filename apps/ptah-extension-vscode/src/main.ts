import * as vscode from 'vscode';
import { PtahExtension } from './core/ptah-extension';
import { Logger } from './core/logger';

let ptahExtension: PtahExtension | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  try {
    Logger.info('Activating Ptah extension...');

    // Initialize main extension controller
    ptahExtension = new PtahExtension(context);
    await ptahExtension.initialize();

    // Register all providers, commands, and services
    await ptahExtension.registerAll();

    Logger.info('Ptah extension activated successfully');

    // Show welcome message for first-time users
    const isFirstTime = context.globalState.get('ptah.firstActivation', true);
    if (isFirstTime) {
      await ptahExtension.showWelcome();
      await context.globalState.update('ptah.firstActivation', false);
    }
  } catch (error) {
    Logger.error('Failed to activate Ptah extension', error);
    vscode.window.showErrorMessage(
      `Ptah activation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

export function deactivate(): void {
  Logger.info('Deactivating Ptah extension');
  ptahExtension?.dispose();
  ptahExtension = undefined;
}
