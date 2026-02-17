/**
 * Setup Wizard Service Interface
 *
 * Contract for the setup wizard service that manages webview lifecycle.
 * Step transitions and session management are handled by the Angular SPA via RPC.
 *
 * @module @ptah-extension/agent-generation/interfaces
 */

import { Result } from '@ptah-extension/shared';
import type * as vscode from 'vscode';

export interface ISetupWizardService {
  /**
   * Launch the setup wizard webview.
   */
  launchWizard(workspaceUri: vscode.Uri): Promise<Result<void, Error>>;

  /**
   * Cancel the current wizard session.
   */
  cancelWizard(
    sessionId: string,
    saveProgress: boolean
  ): Promise<Result<void, Error>>;

  /**
   * Get current wizard session (if active).
   */
  getCurrentSession(): null;
}
