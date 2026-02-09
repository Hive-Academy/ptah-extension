/**
 * Setup Wizard Service (Facade)
 * TASK_2025_115: Refactored to delegate to focused child services
 *
 * Orchestrates the 6-step setup wizard UI flow for intelligent agent generation.
 * Manages webview lifecycle, RPC message handling, wizard state tracking, and
 * provides cancellation/resume capabilities.
 *
 * This service acts as a facade, coordinating between:
 * - WizardWebviewLifecycleService: Panel creation and lifecycle management
 * - WizardSessionManagerService: Session CRUD and persistence
 * - WizardStepMachineService: Step state machine and transitions
 * - DeepProjectAnalysisService: Architecture detection and code analysis
 *
 * Note: Old postMessage handlers (handleStartMessage, handleSelectionMessage,
 * handleCancelMessage) removed in TASK_2025_148. The Angular SPA now communicates
 * via RPC handlers registered in WizardGenerationRpcHandlers.
 *
 * Pattern: Facade
 * Reference: apps/ptah-extension-vscode/src/webview/ patterns
 *
 * @module @ptah-extension/agent-generation/services
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import type * as vscode from 'vscode';
import { ISetupWizardService } from '../interfaces/setup-wizard.interface';
import {
  WizardSession,
  WizardStep,
  AgentSelectionUpdate,
  ResumeWizardRequest,
} from '../types/wizard.types';
// Note: AgentProjectContext and GenerationSummary are used indirectly via child services
import { DeepProjectAnalysis } from '../types/analysis.types';
import { AGENT_GENERATION_TOKENS } from '../di/tokens';
import {
  WizardWebviewLifecycleService,
  WizardSessionManagerService,
  WizardStepMachineService,
  DeepProjectAnalysisService,
} from './wizard';

/**
 * Setup Wizard Service - Backend orchestration for agent generation wizard
 *
 * Responsibilities:
 * - Coordinate webview lifecycle via WizardWebviewLifecycleService
 * - Manage wizard sessions via WizardSessionManagerService
 * - Handle step transitions via WizardStepMachineService
 * - Perform deep analysis via DeepProjectAnalysisService
 *
 * @example
 * ```typescript
 * const wizard = container.resolve(SetupWizardService);
 * const result = await wizard.launchWizard(workspaceUri);
 * if (result.isErr()) {
 *   logger.error('Wizard launch failed', result.error);
 * }
 * ```
 */
@injectable()
export class SetupWizardService implements ISetupWizardService {
  /**
   * Current active wizard session.
   * Only one wizard can be active at a time.
   */
  private currentSession: WizardSession | null = null;

  /**
   * State transition lock to prevent concurrent step transitions.
   * Protects against race conditions from rapid user clicks.
   */
  private transitionLock = false;

  /**
   * Launch lock to prevent concurrent wizard launch attempts.
   * Protects against race conditions from rapid command invocations.
   */
  private isLaunching = false;

  /**
   * Webview panel view type identifier.
   * Must match the viewType registered in package.json.
   */
  private readonly WIZARD_VIEW_TYPE = 'ptah.setupWizard';

  constructor(
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
    @inject(AGENT_GENERATION_TOKENS.WIZARD_WEBVIEW_LIFECYCLE)
    private readonly webviewLifecycle: WizardWebviewLifecycleService,
    @inject(AGENT_GENERATION_TOKENS.WIZARD_SESSION_MANAGER)
    private readonly sessionManager: WizardSessionManagerService,
    @inject(AGENT_GENERATION_TOKENS.WIZARD_STEP_MACHINE)
    private readonly stepMachine: WizardStepMachineService,
    @inject(AGENT_GENERATION_TOKENS.DEEP_PROJECT_ANALYSIS)
    private readonly deepAnalysis: DeepProjectAnalysisService
  ) {
    this.logger.debug('SetupWizardService initialized (facade pattern)');
  }

  /**
   * Launch the setup wizard webview.
   *
   * Implementation:
   * 1. Check for existing saved session (offer resume)
   * 2. Create wizard session via sessionManager
   * 3. Create webview panel via webviewLifecycle
   * 4. Initialize wizard state
   *
   * @param workspaceUri - Workspace root URI to analyze
   * @returns Result with void on success, or Error if launch fails
   */
  async launchWizard(workspaceUri: vscode.Uri): Promise<Result<void, Error>> {
    // Prevent concurrent launches
    if (this.isLaunching) {
      this.logger.warn(
        'Wizard launch already in progress, ignoring duplicate request'
      );
      return Result.ok(undefined);
    }

    try {
      this.isLaunching = true;

      // Validate workspace root is not empty
      const workspaceRoot = workspaceUri.fsPath;
      if (!workspaceRoot || workspaceRoot.trim() === '') {
        this.logger.error('Cannot launch wizard: No workspace folder open');
        const vscode = await import('vscode');
        vscode.window.showErrorMessage(
          'Setup Wizard requires an open workspace folder. Please open a project folder first.'
        );
        return Result.err(new Error('No workspace folder open'));
      }

      this.logger.info('Launching setup wizard', {
        workspace: workspaceRoot,
      });

      // Check for existing session in same workspace
      if (this.currentSession) {
        if (this.currentSession.workspaceRoot === workspaceUri.fsPath) {
          this.logger.warn(
            'Wizard already active for this workspace, revealing existing panel'
          );
          // Reveal existing webview
          const panel = this.webviewLifecycle.getPanel(this.WIZARD_VIEW_TYPE);
          if (panel) {
            panel.reveal();
            return Result.ok(undefined);
          }
        } else {
          // Different workspace - cancel current session
          this.logger.warn(
            'Cancelling wizard for different workspace to start new one'
          );
          await this.cancelWizard(this.currentSession.id, true);
        }
      }

      // Check for saved session to resume via sessionManager
      const savedState = await this.sessionManager.loadSavedState(
        workspaceUri.fsPath
      );
      if (savedState && this.sessionManager.isSessionValid(savedState)) {
        // Offer resume in UI (webview will handle this)
        this.logger.info('Found saved wizard session, offering resume');
      }

      // Create new wizard session via sessionManager
      this.currentSession = this.sessionManager.createSession(
        workspaceUri.fsPath
      );

      this.logger.debug('Created wizard session', {
        sessionId: this.currentSession.id,
        workspace: this.currentSession.workspaceRoot,
      });

      // Create webview panel via webviewLifecycle
      // Note: Message handlers removed (TASK_2025_148) - wizard now uses Angular SPA RPC
      const panel = await this.webviewLifecycle.createWizardPanel(
        'Ptah Setup Wizard',
        this.WIZARD_VIEW_TYPE,
        []
      );

      if (!panel) {
        this.currentSession = null; // Clean up failed session
        return Result.err(
          new Error('Failed to create wizard webview panel. Please try again.')
        );
      }

      this.logger.info('Wizard launched successfully', {
        sessionId: this.currentSession.id,
      });

      return Result.ok(undefined);
    } catch (error) {
      this.logger.error('Failed to launch wizard', error as Error);
      return Result.err(
        new Error(`Wizard launch failed: ${(error as Error).message}`)
      );
    } finally {
      // Always release launch lock
      this.isLaunching = false;
    }
  }

  /**
   * Handle wizard step transition.
   *
   * Validates step data, triggers backend operation, and determines next step.
   * Delegates step validation and transition logic to WizardStepMachineService.
   *
   * @param sessionId - Current wizard session ID
   * @param currentStep - Current step identifier
   * @param stepData - Data collected from current step
   * @returns Result with next WizardStep, or Error if transition fails
   */
  async handleStepTransition(
    sessionId: string,
    currentStep: WizardStep,
    stepData: Record<string, unknown>
  ): Promise<Result<WizardStep, Error>> {
    // Acquire state transition lock
    if (this.transitionLock) {
      this.logger.warn(
        'Step transition already in progress, rejecting request'
      );
      return Result.err(
        new Error('Step transition already in progress. Please wait.')
      );
    }

    this.transitionLock = true;

    try {
      // Validate session
      if (!this.currentSession || this.currentSession.id !== sessionId) {
        return Result.err(new Error('Invalid or expired wizard session'));
      }

      // Validate step matches via stepMachine
      if (
        !this.stepMachine.validateTransition(
          this.currentSession.currentStep,
          currentStep
        )
      ) {
        return Result.err(
          new Error(
            `Step mismatch: expected ${this.currentSession.currentStep}, got ${currentStep}`
          )
        );
      }

      this.logger.debug('Handling step transition', {
        sessionId,
        currentStep,
        stepData,
      });

      // Extract step-specific data via stepMachine
      // Note: extractStepData returns a plain object, not a Result type
      const extractedData = this.stepMachine.extractStepData(
        currentStep,
        stepData
      );

      // Apply extracted data to session
      if (extractedData.projectContext) {
        this.currentSession.projectContext = extractedData.projectContext;
      }
      if (extractedData.selectedAgentIds) {
        this.currentSession.selectedAgentIds = extractedData.selectedAgentIds;
      }
      if (extractedData.generationSummary) {
        this.currentSession.generationSummary = extractedData.generationSummary;
      }

      // Get next step via stepMachine
      const nextStep = this.stepMachine.getNextStep(currentStep);

      // Update session state
      this.currentSession.currentStep = nextStep;

      this.logger.info('Step transition successful', {
        sessionId,
        from: currentStep,
        to: nextStep,
      });

      return Result.ok(nextStep);
    } catch (error) {
      this.logger.error('Step transition failed', error as Error);
      return Result.err(
        new Error(`Step transition failed: ${(error as Error).message}`)
      );
    } finally {
      // Always release lock, even if error occurs
      this.transitionLock = false;
    }
  }

  /**
   * Cancel the current wizard session.
   *
   * Implementation:
   * 1. Validate session exists
   * 2. Optionally save session state via sessionManager
   * 3. Clean up webview via webviewLifecycle
   * 4. Clear session
   *
   * @param sessionId - Session ID to cancel
   * @param saveProgress - Whether to save session state for resume
   * @returns Result with void on success, or Error if cancellation fails
   */
  async cancelWizard(
    sessionId: string,
    saveProgress: boolean
  ): Promise<Result<void, Error>> {
    try {
      if (!this.currentSession || this.currentSession.id !== sessionId) {
        return Result.err(new Error('Invalid or expired wizard session'));
      }

      this.logger.info('Cancelling wizard', {
        sessionId,
        saveProgress,
        currentStep: this.currentSession.currentStep,
      });

      // Save progress if requested via sessionManager
      if (saveProgress) {
        await this.sessionManager.saveSessionState(this.currentSession);
      }

      // Clean up resources
      this.cleanup();

      this.logger.info('Wizard cancelled successfully');

      return Result.ok(undefined);
    } catch (error) {
      this.logger.error('Failed to cancel wizard', error as Error);
      this.cleanup(); // Ensure cleanup on errors
      return Result.err(
        new Error(`Wizard cancellation failed: ${(error as Error).message}`)
      );
    }
  }

  /**
   * Resume a previously saved wizard session.
   *
   * Implementation:
   * 1. Load saved session state via sessionManager
   * 2. Validate workspace matches
   * 3. Validate session not expired via sessionManager
   * 4. Restore wizard to saved step via sessionManager
   * 5. Re-launch webview via webviewLifecycle
   *
   * @param request - Resume request with session ID and workspace
   * @returns Result with resumed WizardSession, or Error if resume fails
   */
  async resumeWizard(
    request: ResumeWizardRequest
  ): Promise<Result<WizardSession, Error>> {
    try {
      this.logger.info('Resuming wizard', {
        sessionId: request.sessionId,
        workspace: request.workspaceRoot,
      });

      // Load saved state via sessionManager
      const savedState = await this.sessionManager.loadSavedState(
        request.workspaceRoot
      );

      if (!savedState) {
        return Result.err(new Error('No saved wizard session found'));
      }

      if (savedState.sessionId !== request.sessionId) {
        return Result.err(new Error('Session ID mismatch'));
      }

      if (!this.sessionManager.isSessionValid(savedState)) {
        return Result.err(new Error('Saved session expired or invalid'));
      }

      // Restore session via sessionManager
      this.currentSession = this.sessionManager.restoreSession(savedState);

      // Create webview panel via webviewLifecycle
      // Note: Message handlers removed (TASK_2025_148) - wizard now uses Angular SPA RPC
      const panel = await this.webviewLifecycle.createWizardPanel(
        'Ptah Setup Wizard (Resumed)',
        this.WIZARD_VIEW_TYPE,
        [],
        {
          resumedSession: {
            sessionId: this.currentSession.id,
            currentStep: this.currentSession.currentStep,
            projectContext: this.currentSession.projectContext,
            selectedAgentIds: this.currentSession.selectedAgentIds,
          },
        }
      );

      if (!panel) {
        this.currentSession = null; // Clean up failed session
        return Result.err(
          new Error('Failed to create wizard webview panel. Please try again.')
        );
      }

      this.logger.info('Wizard resumed successfully', {
        sessionId: this.currentSession.id,
        step: this.currentSession.currentStep,
      });

      return Result.ok(this.currentSession);
    } catch (error) {
      this.logger.error('Failed to resume wizard', error as Error);
      this.cleanup(); // Ensure cleanup on errors
      return Result.err(
        new Error(`Wizard resume failed: ${(error as Error).message}`)
      );
    }
  }

  /**
   * Handle agent selection update from user.
   *
   * Updates session with user-selected agents and validates selection.
   *
   * @param update - Agent selection update with session ID and selected agents
   * @returns Result with void on success, or Error if update fails
   */
  async handleAgentSelectionUpdate(
    update: AgentSelectionUpdate
  ): Promise<Result<void, Error>> {
    try {
      if (!this.currentSession || this.currentSession.id !== update.sessionId) {
        return Result.err(new Error('Invalid or expired wizard session'));
      }

      this.logger.debug('Updating agent selection', {
        sessionId: update.sessionId,
        selectedCount: update.selectedAgentIds.length,
      });

      // Validate selection not empty
      if (update.selectedAgentIds.length === 0) {
        return Result.err(
          new Error('Agent selection cannot be empty (at least 1 required)')
        );
      }

      // Update session
      this.currentSession.selectedAgentIds = update.selectedAgentIds;

      this.logger.info('Agent selection updated', {
        sessionId: update.sessionId,
        selectedAgents: update.selectedAgentIds,
      });

      return Result.ok(undefined);
    } catch (error) {
      this.logger.error('Failed to update agent selection', error as Error);
      return Result.err(
        new Error(`Agent selection update failed: ${(error as Error).message}`)
      );
    }
  }

  /**
   * Get current wizard session (if active).
   *
   * @returns Current wizard session, or null if no active session
   */
  getCurrentSession(): WizardSession | null {
    return this.currentSession ?? null;
  }

  /**
   * Perform deep project analysis using VS Code APIs.
   *
   * Delegates to DeepProjectAnalysisService for comprehensive workspace analysis.
   *
   * @param workspaceUri - Workspace root URI to analyze
   * @returns Result with DeepProjectAnalysis on success, or Error if analysis fails
   */
  async performDeepAnalysis(
    workspaceUri: vscode.Uri
  ): Promise<Result<DeepProjectAnalysis, Error>> {
    return this.deepAnalysis.performDeepAnalysis(workspaceUri);
  }

  /**
   * Clean up wizard resources.
   * Made idempotent - safe to call multiple times.
   *
   * @private
   */
  private cleanup(): void {
    // Make idempotent - return early if already cleaned up
    if (!this.currentSession) {
      this.logger.debug('Cleanup called but no active session, skipping');
      return;
    }

    this.logger.debug('Cleaning up wizard resources', {
      sessionId: this.currentSession.id,
    });

    // Dispose webview via webviewLifecycle
    this.webviewLifecycle.disposeWebview(this.WIZARD_VIEW_TYPE);

    // Clear session state
    this.currentSession = null;
    this.transitionLock = false;

    this.logger.debug('Wizard cleanup complete');
  }
}
