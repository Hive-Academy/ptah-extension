/**
 * Electron Setup Wizard Service
 *
 * Electron-specific implementation of ISetupWizardService that replaces the
 * VS Code SetupWizardService. Instead of creating a separate webview panel
 * (VS Code pattern), this service navigates the existing Angular SPA to the
 * wizard view via IPC broadcast.
 *
 * The Angular SPA already renders the wizard via AppStateManager.currentView()
 * === 'setup-wizard' (see app-shell.component.ts). In Electron, the SPA is
 * the main BrowserWindow, so we simply broadcast a switchView message.
 *
 * All wizard step transitions (scan, analyze, recommend, generate) are handled
 * by existing RPC handlers (SetupRpcHandlers, WizardGenerationRpcHandlers)
 * which are already registered in the Electron DI container.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { Result, MESSAGE_TYPES } from '@ptah-extension/shared';

/**
 * Minimal interface for the WebviewManager's broadcast capability.
 * Matches ElectronWebviewManagerAdapter.broadcastMessage() signature.
 */
interface WebviewBroadcaster {
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

/**
 * ISetupWizardService contract (matches setup-wizard.interface.ts exactly).
 * Defined locally to avoid import issues since the interface is not exported
 * from the @ptah-extension/agent-generation barrel.
 */
export interface ISetupWizardService {
  launchWizard(workspacePath: string): Promise<Result<void, Error>>;
  cancelWizard(
    sessionId: string,
    saveProgress: boolean,
  ): Promise<Result<void, Error>>;
  getCurrentSession(): null;
}

@injectable()
export class ElectronSetupWizardService implements ISetupWizardService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewBroadcaster,
  ) {}

  /**
   * Launch the setup wizard by navigating the Angular SPA to the wizard view.
   *
   * In VS Code, this creates a separate webview panel. In Electron, the Angular
   * SPA is already the main window, so we broadcast a switchView message that
   * AppStateManager handles to render the WizardViewComponent.
   *
   * @param workspacePath - Absolute path to the workspace root (validated)
   * @returns Result.ok on success, Result.err if no workspace path provided
   */
  async launchWizard(workspacePath: string): Promise<Result<void, Error>> {
    if (!workspacePath || !workspacePath.trim()) {
      this.logger.warn(
        '[ElectronSetupWizardService] Cannot launch wizard: no workspace folder open',
      );
      return Result.err(new Error('No workspace folder open'));
    }

    this.logger.info(
      '[ElectronSetupWizardService] Launching setup wizard via IPC navigation',
      { workspacePath },
    );

    try {
      await this.webviewManager.broadcastMessage(MESSAGE_TYPES.SWITCH_VIEW, {
        view: 'setup-wizard',
      });
    } catch (error) {
      this.logger.error(
        '[ElectronSetupWizardService] Failed to broadcast wizard launch',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return Result.err(
        error instanceof Error
          ? error
          : new Error('Failed to launch wizard view'),
      );
    }

    return Result.ok(undefined);
  }

  /**
   * Cancel the wizard and navigate back to the chat view.
   *
   * In VS Code, this closes the webview panel. In Electron, we broadcast
   * a switchView message to navigate back to chat.
   *
   * @param sessionId - The wizard session ID (unused in Electron, kept for interface compliance)
   * @param saveProgress - Whether to save progress (unused in Electron, kept for interface compliance)
   * @returns Result.ok always (navigation is best-effort)
   */
  async cancelWizard(
    sessionId: string,
    saveProgress: boolean,
  ): Promise<Result<void, Error>> {
    this.logger.info(
      '[ElectronSetupWizardService] Cancelling wizard, navigating to chat',
      { sessionId, saveProgress },
    );

    try {
      await this.webviewManager.broadcastMessage(MESSAGE_TYPES.SWITCH_VIEW, {
        view: 'orchestra-canvas',
      });
    } catch (error) {
      this.logger.error(
        '[ElectronSetupWizardService] Failed to broadcast wizard cancel',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return Result.err(
        error instanceof Error
          ? error
          : new Error('Failed to cancel wizard view'),
      );
    }

    return Result.ok(undefined);
  }

  /**
   * Get current wizard session. Returns null because Electron does not
   * manage wizard sessions at the service level (session state is managed
   * by WizardSessionManagerService via RPC).
   */
  getCurrentSession(): null {
    return null;
  }
}
