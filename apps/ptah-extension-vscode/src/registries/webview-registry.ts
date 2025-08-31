import * as vscode from 'vscode';
import { ServiceDependencies } from '../core/service-registry';
import { Logger } from '../core/logger';

/**
 * Webview Registry - Handles webview provider registration
 */
export class WebviewRegistry implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];

  constructor(private services: ServiceDependencies) {}

  /**
   * Register all webview providers
   */
  registerAll(): void {
    Logger.info('Registering webview providers...');

    // Register unified Angular webview for the main panel
    this.disposables.push(
      vscode.window.registerWebviewViewProvider('ptah.main', this.services.angularWebviewProvider, {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      })
    );

    Logger.info('Webview providers registered successfully');
  }

  /**
   * Get registered webview types
   */
  getRegisteredWebviews(): string[] {
    return ['ptah.main'];
  }

  /**
   * Switch webview to specific view
   */
  switchWebviewTo(view: 'chat' | 'command-builder' | 'analytics'): void {
    this.services.angularWebviewProvider.switchView(view);
  }

  /**
   * Dispose all webview providers
   */
  dispose(): void {
    Logger.info('Disposing webview registry...');
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
