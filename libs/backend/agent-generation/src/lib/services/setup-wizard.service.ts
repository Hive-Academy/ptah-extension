/**
 * Setup Wizard Service
 *
 * Orchestrates the 6-step setup wizard UI flow for intelligent agent generation.
 * Manages webview lifecycle, RPC message handling, wizard state tracking, and
 * provides cancellation/resume capabilities.
 *
 * Pattern: Webview Provider + RPC Message Handler
 * Reference: apps/ptah-extension-vscode/src/webview/ patterns
 *
 * @module @ptah-extension/agent-generation/services
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS, WebviewManager } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import type * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { ISetupWizardService } from '../interfaces/setup-wizard.interface';
import {
  WizardSession,
  WizardStep,
  WizardState,
  AgentSelectionUpdate,
  ResumeWizardRequest,
} from '../types/wizard.types';
import { AgentProjectContext, GenerationSummary } from '../types/core.types';

/**
 * Discriminated union type for step-specific data.
 * Ensures type-safe access to step data based on current wizard step.
 */
type StepData =
  | { step: 'welcome' }
  | { step: 'scan'; projectContext: AgentProjectContext }
  | { step: 'review' }
  | { step: 'select'; selectedAgentIds: string[] }
  | { step: 'generate'; generationSummary: GenerationSummary }
  | { step: 'complete' };

/**
 * Setup Wizard Service - Backend orchestration for agent generation wizard
 *
 * Responsibilities:
 * - Create and manage webview panel for wizard UI
 * - Register RPC message handlers for wizard actions
 * - Track wizard session state and progress
 * - Coordinate with AgentGenerationOrchestratorService for backend operations
 * - Support cancellation and resume workflows
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
   * Webview panel view type identifier.
   * Must match the viewType registered in package.json.
   */
  private readonly WIZARD_VIEW_TYPE = 'ptah.setupWizard';

  /**
   * Session state storage key for persistence.
   */
  private readonly SESSION_STATE_KEY = 'wizard-session-state';

  /**
   * Maximum session age before expiry (24 hours in milliseconds).
   */
  private readonly MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000;

  constructor(
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext,
    // Note: Orchestrator will be injected when implementing integration batches
    // For now, service is self-contained for unit testing
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger
  ) {
    this.logger.debug('SetupWizardService initialized');
  }

  /**
   * Launch the setup wizard webview.
   *
   * Implementation:
   * 1. Check for existing saved session (offer resume)
   * 2. Create wizard session
   * 3. Create webview panel with configuration
   * 4. Register RPC message handlers
   * 5. Initialize wizard state
   *
   * @param workspaceUri - Workspace root URI to analyze
   * @returns Result with void on success, or Error if launch fails
   */
  async launchWizard(workspaceUri: vscode.Uri): Promise<Result<void, Error>> {
    try {
      this.logger.info('Launching setup wizard', {
        workspace: workspaceUri.fsPath,
      });

      // Check for existing session in same workspace
      if (this.currentSession) {
        if (this.currentSession.workspaceRoot === workspaceUri.fsPath) {
          this.logger.warn(
            'Wizard already active for this workspace, revealing existing panel'
          );
          // Reveal existing webview
          const panel = this.webviewManager.getWebviewPanel(
            this.WIZARD_VIEW_TYPE
          );
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

      // Check for saved session to resume
      const savedState = await this.loadSavedState(workspaceUri.fsPath);
      if (savedState && this.isSessionValid(savedState)) {
        // Offer resume in UI (webview will handle this)
        this.logger.info('Found saved wizard session, offering resume');
      }

      // Create new wizard session
      this.currentSession = {
        id: uuidv4(),
        workspaceRoot: workspaceUri.fsPath,
        currentStep: 'welcome',
        startedAt: new Date(),
      };

      this.logger.debug('Created wizard session', {
        sessionId: this.currentSession.id,
        workspace: this.currentSession.workspaceRoot,
      });

      // Create webview panel
      void this.webviewManager.createWebviewPanel({
        viewType: this.WIZARD_VIEW_TYPE,
        title: 'Ptah Setup Wizard',
        showOptions: {
          viewColumn: 1,
          preserveFocus: false,
        },
        options: {
          enableScripts: true,
          retainContextWhenHidden: true,
        },
      });

      // Register RPC handlers via webview's onDidReceiveMessage
      // The WebviewManager already sets up the message listener
      // We just need to handle messages sent to our view type
      // This will be implemented in integration batches when wiring to RPC system

      this.logger.info('Wizard launched successfully', {
        sessionId: this.currentSession.id,
      });

      return Result.ok(undefined);
    } catch (error) {
      this.logger.error('Failed to launch wizard', error as Error);
      return Result.err(
        new Error(`Wizard launch failed: ${(error as Error).message}`)
      );
    }
  }

  /**
   * Handle wizard step transition.
   *
   * Validates step data, triggers backend operation, and determines next step.
   *
   * Implementation:
   * 1. Validate session exists and matches
   * 2. Validate step data for current step
   * 3. Execute step-specific backend operation
   * 4. Update session state
   * 5. Determine and return next step
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
    try {
      // Validate session
      if (!this.currentSession || this.currentSession.id !== sessionId) {
        return Result.err(new Error('Invalid or expired wizard session'));
      }

      if (this.currentSession.currentStep !== currentStep) {
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

      // Execute step-specific logic and determine next step
      let nextStep: WizardStep;

      switch (currentStep) {
        case 'welcome':
          // Welcome → Scan
          // Start workspace analysis in next step
          nextStep = 'scan';
          break;

        case 'scan':
          // Scan → Review
          // Analysis complete, show results
          // Validate and extract project context (type-safe access via bracket notation)
          if ('projectContext' in stepData && stepData['projectContext']) {
            const fullContext = stepData[
              'projectContext'
            ] as AgentProjectContext;
            // Convert AgentProjectContext to WizardSession.projectContext (simplified format)
            this.currentSession.projectContext = {
              projectType: fullContext.projectType.toString(),
              frameworks: fullContext.frameworks.map((f) => f.toString()),
              monorepoType: fullContext.monorepoType?.toString(),
              techStack: fullContext.techStack.frameworks,
            };
          }
          nextStep = 'review';
          break;

        case 'review':
          // Review → Select
          // User confirmed analysis, proceed to agent selection
          nextStep = 'select';
          break;

        case 'select':
          // Select → Generate
          // User confirmed agent selection, start generation
          // Validate and extract selected agent IDs (type-safe access via bracket notation)
          if ('selectedAgentIds' in stepData && stepData['selectedAgentIds']) {
            this.currentSession.selectedAgentIds = stepData[
              'selectedAgentIds'
            ] as string[];
          }
          nextStep = 'generate';
          break;

        case 'generate':
          // Generate → Complete
          // Generation complete, show summary
          // Validate and extract generation summary (type-safe access via bracket notation)
          if (
            'generationSummary' in stepData &&
            stepData['generationSummary']
          ) {
            const fullSummary = stepData[
              'generationSummary'
            ] as GenerationSummary;
            // Convert GenerationSummary to WizardSession.generationSummary (simplified format)
            this.currentSession.generationSummary = {
              totalAgents: fullSummary.totalAgents,
              successful: fullSummary.successful,
              failed: fullSummary.failed,
              durationMs: fullSummary.durationMs,
              warnings: fullSummary.warnings,
            };
          }
          nextStep = 'complete';
          break;

        case 'complete':
          // Complete → (wizard ends)
          // No automatic transition, user closes wizard
          nextStep = 'complete';
          break;

        default:
          return Result.err(new Error(`Unknown wizard step: ${currentStep}`));
      }

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
    }
  }

  /**
   * Cancel the current wizard session.
   *
   * Implementation:
   * 1. Validate session exists
   * 2. Optionally save session state for resume
   * 3. Clean up webview
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

      // Save progress if requested
      if (saveProgress) {
        await this.saveSessionState(this.currentSession);
      }

      // Dispose webview
      this.webviewManager.disposeWebview(this.WIZARD_VIEW_TYPE);

      // Clear session
      this.currentSession = null;

      this.logger.info('Wizard cancelled successfully');

      return Result.ok(undefined);
    } catch (error) {
      this.logger.error('Failed to cancel wizard', error as Error);
      return Result.err(
        new Error(`Wizard cancellation failed: ${(error as Error).message}`)
      );
    }
  }

  /**
   * Resume a previously saved wizard session.
   *
   * Implementation:
   * 1. Load saved session state
   * 2. Validate workspace matches
   * 3. Validate session not expired
   * 4. Restore wizard to saved step
   * 5. Re-launch webview
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

      // Load saved state
      const savedState = await this.loadSavedState(request.workspaceRoot);

      if (!savedState) {
        return Result.err(new Error('No saved wizard session found'));
      }

      if (savedState.sessionId !== request.sessionId) {
        return Result.err(new Error('Session ID mismatch'));
      }

      if (!this.isSessionValid(savedState)) {
        return Result.err(new Error('Saved session expired or invalid'));
      }

      // Restore session
      this.currentSession = {
        id: savedState.sessionId,
        workspaceRoot: savedState.workspaceRoot,
        currentStep: savedState.currentStep,
        startedAt: savedState.lastActivity, // Use last activity as resumed start time
        projectContext: savedState.projectContext,
        selectedAgentIds: savedState.selectedAgentIds,
      };

      // Re-launch webview at saved step
      void this.webviewManager.createWebviewPanel({
        viewType: this.WIZARD_VIEW_TYPE,
        title: 'Ptah Setup Wizard (Resumed)',
        showOptions: {
          viewColumn: 1,
          preserveFocus: false,
        },
        options: {
          enableScripts: true,
          retainContextWhenHidden: true,
        },
      });

      this.logger.info('Wizard resumed successfully', {
        sessionId: this.currentSession.id,
        step: this.currentSession.currentStep,
      });

      return Result.ok(this.currentSession);
    } catch (error) {
      this.logger.error('Failed to resume wizard', error as Error);
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
   * Save wizard session state for resume capability.
   *
   * @param session - Wizard session to save
   * @private
   */
  private async saveSessionState(session: WizardSession): Promise<void> {
    const state: WizardState = {
      sessionId: session.id,
      currentStep: session.currentStep,
      workspaceRoot: session.workspaceRoot,
      lastActivity: new Date(),
      projectContext: session.projectContext,
      selectedAgentIds: session.selectedAgentIds,
    };

    // Save to workspace state (persists across VS Code restarts)
    await this.context.workspaceState.update(this.SESSION_STATE_KEY, state);

    this.logger.debug('Saved wizard session state', {
      sessionId: session.id,
      step: session.currentStep,
    });
  }

  /**
   * Load saved wizard session state for a workspace.
   *
   * @param workspaceRoot - Workspace root to load state for
   * @returns Saved wizard state, or undefined if none exists
   * @private
   */
  private async loadSavedState(
    workspaceRoot: string
  ): Promise<WizardState | undefined> {
    const state = this.context.workspaceState.get<WizardState>(
      this.SESSION_STATE_KEY
    );

    if (!state) {
      return undefined;
    }

    // Validate workspace matches
    if (state.workspaceRoot !== workspaceRoot) {
      this.logger.warn('Saved session workspace mismatch, ignoring');
      return undefined;
    }

    this.logger.debug('Loaded saved wizard state', {
      sessionId: state.sessionId,
      step: state.currentStep,
    });

    return state;
  }

  /**
   * Validate wizard session state is still valid (not expired).
   *
   * @param state - Wizard state to validate
   * @returns True if session is valid and can be resumed
   * @private
   */
  private isSessionValid(state: WizardState): boolean {
    // Check session age
    const ageMs = Date.now() - state.lastActivity.getTime();
    if (ageMs > this.MAX_SESSION_AGE_MS) {
      this.logger.warn('Wizard session expired', {
        sessionId: state.sessionId,
        ageHours: Math.round(ageMs / (60 * 60 * 1000)),
      });
      return false;
    }

    // Session is valid
    return true;
  }
}
