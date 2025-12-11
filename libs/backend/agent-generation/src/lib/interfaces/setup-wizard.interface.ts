/**
 * Setup Wizard Service Interface
 *
 * Contract for the setup wizard service that orchestrates the 6-step agent generation flow.
 * Manages webview lifecycle, RPC message handling, wizard state tracking, and
 * cancellation/resume capabilities.
 *
 * @module @ptah-extension/agent-generation/interfaces
 */

import { Result } from '@ptah-extension/shared';
import type * as vscode from 'vscode';
import {
  WizardSession,
  WizardStep,
  AgentSelectionUpdate,
  ResumeWizardRequest,
} from '../types/wizard.types';

/**
 * Setup Wizard Service Interface
 *
 * Responsibilities:
 * - Manage wizard step transitions (Welcome → Scan → Review → Select → Generate → Complete)
 * - Handle RPC messages between webview and extension backend
 * - Track wizard session state and progress
 * - Provide cancellation and resume capabilities
 * - Emit progress events for UI updates
 *
 * Pattern: Webview Provider + RPC Message Handler
 *
 * @example
 * ```typescript
 * const wizard = container.resolve<ISetupWizardService>(AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE);
 *
 * // Launch wizard for current workspace
 * const result = await wizard.launchWizard(vscode.workspace.workspaceFolders[0].uri);
 * if (result.isErr()) {
 *   vscode.window.showErrorMessage(`Failed to launch wizard: ${result.error.message}`);
 * }
 * ```
 */
export interface ISetupWizardService {
  /**
   * Launch the setup wizard webview.
   *
   * Creates a webview panel, initializes wizard session, and registers RPC handlers.
   * If a previous session exists for the same workspace, offers to resume it.
   *
   * @param workspaceUri - Workspace root URI to analyze
   * @returns Result with void on success, or Error if launch fails
   *
   * @throws Never throws - all errors returned via Result.err()
   *
   * @example
   * ```typescript
   * const result = await wizard.launchWizard(vscode.workspace.workspaceFolders[0].uri);
   * if (result.isOk()) {
   *   logger.info('Wizard launched successfully');
   * }
   * ```
   */
  launchWizard(workspaceUri: vscode.Uri): Promise<Result<void, Error>>;

  /**
   * Handle wizard step transition.
   *
   * Validates step data, triggers corresponding backend operation,
   * and returns the next step to navigate to.
   *
   * @param sessionId - Current wizard session ID
   * @param currentStep - Current step identifier
   * @param stepData - Data collected from current step
   * @returns Result with next WizardStep, or Error if transition fails
   *
   * @example
   * ```typescript
   * const result = await wizard.handleStepTransition(
   *   session.id,
   *   'review',
   *   { confirmed: true }
   * );
   * if (result.isOk()) {
   *   const nextStep = result.value; // 'select'
   * }
   * ```
   */
  handleStepTransition(
    sessionId: string,
    currentStep: WizardStep,
    stepData: Record<string, unknown>
  ): Promise<Result<WizardStep, Error>>;

  /**
   * Cancel the current wizard session.
   *
   * Optionally saves progress for later resumption.
   * Cleans up webview and session state.
   *
   * @param sessionId - Session ID to cancel
   * @param saveProgress  - Whether to save session state for resume
   * @returns Result with void on success, or Error if cancellation fails
   *
   * @example
   * ```typescript
   * // Cancel and save progress
   * const result = await wizard.cancelWizard(session.id, true);
   * ```
   */
  cancelWizard(
    sessionId: string,
    saveProgress: boolean
  ): Promise<Result<void, Error>>;

  /**
   * Resume a previously saved wizard session.
   *
   * Loads saved session state, validates workspace matches,
   * and restores wizard to saved step.
   *
   * @param request - Resume request with session ID and workspace
   * @returns Result with resumed WizardSession, or Error if resume fails
   *
   * @example
   * ```typescript
   * const result = await wizard.resumeWizard({
   *   sessionId: 'wizard-123',
   *   workspaceRoot: '/path/to/workspace'
   * });
   * if (result.isOk()) {
   *   const session = result.value;
   *   logger.info(`Resumed wizard at step: ${session.currentStep}`);
   * }
   * ```
   */
  resumeWizard(
    request: ResumeWizardRequest
  ): Promise<Result<WizardSession, Error>>;

  /**
   * Handle agent selection update from user.
   *
   * Updates session with user-selected agents and validates selection.
   *
   * @param update - Agent selection update with session ID and selected agents
   * @returns Result with void on success, or Error if update fails
   *
   * @example
   * ```typescript
   * const result = await wizard.handleAgentSelectionUpdate({
   *   sessionId: session.id,
   *   selectedAgentIds: ['backend-developer', 'frontend-developer'],
   *   options: { threshold: 70 }
   * });
   * ```
   */
  handleAgentSelectionUpdate(
    update: AgentSelectionUpdate
  ): Promise<Result<void, Error>>;

  /**
   * Get current wizard session (if active).
   *
   * @returns Current wizard session, or null if no active session
   *
   * @example
   * ```typescript
   * const session = wizard.getCurrentSession();
   * if (session) {
   *   logger.info(`Current wizard step: ${session.currentStep}`);
   * }
   * ```
   */
  getCurrentSession(): WizardSession | null;
}
