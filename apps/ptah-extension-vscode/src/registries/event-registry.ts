import * as vscode from 'vscode';
import { ServiceDependencies } from '../core/service-registry';
import { Logger } from '../core/logger';

/**
 * Event Registry - Handles VS Code event registration and handling
 */
export class EventRegistry implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];

  constructor(private services: ServiceDependencies) {}

  /**
   * Register all VS Code event handlers
   */
  registerAll(): void {
    Logger.info('Registering event handlers...');

    // Workspace events
    this.registerWorkspaceEvents();

    // Document events
    this.registerDocumentEvents();

    // Window events
    this.registerWindowEvents();

    Logger.info(`Registered ${this.disposables.length} event handlers`);
  }

  /**
   * Register workspace-related events
   */
  private registerWorkspaceEvents(): void {
    // Handle workspace folder changes
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders((event) => {
        Logger.info(`Workspace folders changed: +${event.added.length}, -${event.removed.length}`);
        this.services.contextManager.refreshContext();
      })
    );

    // Handle configuration changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('ptah')) {
          Logger.info('Ptah configuration changed');
          // Handle configuration changes if needed
        }
      })
    );
  }

  /**
   * Register document-related events
   */
  private registerDocumentEvents(): void {
    // Handle document changes
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        // Update context if the changed file is included
        const filePath = event.document.uri.fsPath;
        if (this.services.contextManager.isFileIncluded(filePath)) {
          this.services.contextManager.updateFileContent(filePath, event.document.getText());
        }
      })
    );

    // Handle document saves
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        const filePath = document.uri.fsPath;
        if (this.services.contextManager.isFileIncluded(filePath)) {
          // Could trigger auto-sync or notification
        }
      })
    );

    // Handle document opens
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((document) => {
        // Could suggest adding to context if relevant
      })
    );

    // Handle document closes
    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument((document) => {
        // Clean up if needed
      })
    );
  }

  /**
   * Register window-related events
   */
  private registerWindowEvents(): void {
    // Handle active editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          // Could update context or provide suggestions
        }
      })
    );

    // Handle visible editors changes
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        // Could update UI state based on visible editors
      })
    );

    // Handle terminal creation
    this.disposables.push(
      vscode.window.onDidOpenTerminal((terminal) => {
        // Could provide terminal integration features
      })
    );
  }

  /**
   * Dispose all event handlers
   */
  dispose(): void {
    Logger.info('Disposing event registry...');
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
