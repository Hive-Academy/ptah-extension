/**
 * Setup Wizard Service Interface
 *
 * Contract for the setup wizard service that manages webview lifecycle.
 * Step transitions and session management are handled by the Angular SPA via RPC.
 *
 * @module @ptah-extension/agent-generation/interfaces
 */

import { Result } from '@ptah-extension/shared';

export interface ISetupWizardService {
  /**
   * Launch the setup wizard webview.
   *
   * @param workspacePath - Absolute path to the workspace root
   */
  launchWizard(workspacePath: string): Promise<Result<void, Error>>;

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
