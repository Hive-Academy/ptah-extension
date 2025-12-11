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
import { AGENT_GENERATION_TOKENS } from '../di/tokens';
import { AgentGenerationOrchestratorService } from './orchestrator.service';

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
   * State transition lock to prevent concurrent step transitions.
   * Protects against race conditions from rapid user clicks.
   */
  private transitionLock = false;

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
    @inject(AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR)
    private readonly orchestrator: AgentGenerationOrchestratorService,
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

      // Create webview panel and verify creation succeeded
      const panel = await this.webviewManager.createWebviewPanel({
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

      // Verify panel was created successfully
      if (!panel) {
        this.logger.error('Failed to create wizard webview panel');
        this.currentSession = null; // Clean up failed session
        return Result.err(
          new Error('Failed to create wizard webview panel. Please try again.')
        );
      }

      // Register RPC message handlers
      panel.webview.onDidReceiveMessage(async (message: any) => {
        switch (message.type) {
          case 'setup-wizard:start':
            await this.handleStartMessage(panel, message);
            break;
          case 'setup-wizard:submit-selection':
            await this.handleSelectionMessage(panel, message);
            break;
          case 'setup-wizard:cancel':
            await this.handleCancelMessage(panel, message);
            break;
          default:
            this.logger.warn('Unknown wizard message type', {
              type: message.type,
            });
        }
      });

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

      // Re-launch webview at saved step and verify creation succeeded
      const panel = await this.webviewManager.createWebviewPanel({
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

      // Verify panel was created successfully
      if (!panel) {
        this.logger.error('Failed to create wizard webview panel for resume');
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

  /**
   * Send RPC response to webview.
   * Implements the RPC protocol expected by frontend WizardRpcService.
   *
   * @param panel - Webview panel to send response to
   * @param messageId - Original message ID for correlation
   * @param payload - Success payload (if any)
   * @param error - Error message (if any)
   * @private
   */
  private async sendResponse(
    panel: vscode.WebviewPanel,
    messageId: string,
    payload?: unknown,
    error?: string
  ): Promise<void> {
    try {
      await panel.webview.postMessage({
        type: 'rpc:response',
        messageId,
        payload,
        error,
      });
    } catch (err) {
      this.logger.error('Failed to send RPC response', {
        error: err,
        messageId,
        hasError: !!error,
      });
    }
  }

  /**
   * Emit progress event to webview.
   * Sends progress updates during long-running operations.
   *
   * @param panel - Webview panel to send progress to (null-safe)
   * @param eventType - Event type identifier
   * @param data - Event data payload
   * @private
   */
  private async emitProgress(
    panel: vscode.WebviewPanel | null,
    eventType: string,
    data: unknown
  ): Promise<void> {
    if (!panel) {
      this.logger.warn('Cannot emit progress: panel is null', { eventType });
      return;
    }

    try {
      await panel.webview.postMessage({
        type: eventType,
        data,
      });
    } catch (error) {
      this.logger.error('Failed to emit progress event', {
        error,
        eventType,
      });
    }
  }

  /**
   * Map frontend ProjectContext to backend AgentProjectContext.
   * Handles type differences between frontend and backend representations.
   *
   * @param frontendContext - Project context from frontend
   * @returns Backend AgentProjectContext
   * @private
   */
  private mapToAgentProjectContext(frontendContext: any): AgentProjectContext {
    // Frontend sends simplified ProjectContext, map to full AgentProjectContext
    return {
      rootPath: frontendContext.rootPath || frontendContext.workspacePath || '',
      projectType: frontendContext.projectType,
      frameworks: frontendContext.frameworks || [],
      monorepoType: frontendContext.monorepoType,
      relevantFiles: frontendContext.relevantFiles || [],
      techStack: {
        languages: frontendContext.techStack?.languages || [],
        frameworks: frontendContext.techStack?.frameworks || [],
        buildTools: frontendContext.techStack?.buildTools || [],
        testingFrameworks: frontendContext.techStack?.testingFrameworks || [],
        packageManager: frontendContext.techStack?.packageManager || 'npm',
      },
      codeConventions: frontendContext.codeConventions || {
        indentation: 'spaces',
        indentSize: 2,
        quoteStyle: 'single',
        semicolons: true,
        trailingComma: 'es5',
      },
    };
  }

  /**
   * Handle 'setup-wizard:start' RPC message.
   * Initiates workspace scanning and agent detection (Phase 1).
   *
   * @param panel - Webview panel
   * @param message - RPC message with messageId and payload
   * @private
   */
  private async handleStartMessage(
    panel: vscode.WebviewPanel,
    message: any
  ): Promise<void> {
    const { messageId, payload } = message;

    try {
      this.logger.info('Handling setup-wizard:start', { messageId });

      // Validate payload
      if (!payload?.projectContext) {
        await this.sendResponse(
          panel,
          messageId,
          undefined,
          'Missing project context in request'
        );
        return;
      }

      // Map frontend context to backend format
      const context = this.mapToAgentProjectContext(payload.projectContext);

      // Execute Phase 1: Workspace analysis with progress callbacks
      const result = await this.orchestrator.generateAgents(
        {
          workspaceUri: { fsPath: context.rootPath } as vscode.Uri,
          threshold: payload.threshold || 50,
        },
        async (progress) => {
          // Forward orchestrator progress to webview
          if (progress.phase === 'analysis') {
            await this.emitProgress(panel, 'setup-wizard:scan-progress', {
              filesScanned: progress.agentsProcessed || 0,
              totalFiles: progress.totalAgents || 0,
              detections: progress.detectedCharacteristics || [],
            });
          } else if (
            progress.phase === 'customization' ||
            progress.phase === 'rendering' ||
            progress.phase === 'writing'
          ) {
            await this.emitProgress(panel, 'setup-wizard:generation-progress', {
              phase: progress.phase,
              percent: progress.percentComplete,
              currentAgent: progress.currentOperation,
            });
          }
        }
      );

      // Send response
      if (result.isErr()) {
        await this.sendResponse(
          panel,
          messageId,
          undefined,
          result.error!.message
        );
      } else {
        await this.sendResponse(panel, messageId, {
          agents: result.value!.agents.map((agent) => ({
            id: agent.sourceTemplateId,
            name: agent.sourceTemplateId,
            version: agent.sourceTemplateVersion,
          })),
          summary: {
            totalAgents: result.value!.totalAgents,
            successful: result.value!.successful,
            failed: result.value!.failed,
            durationMs: result.value!.durationMs,
            warnings: result.value!.warnings,
          },
        });
      }
    } catch (error) {
      this.logger.error('Error in handleStartMessage', error as Error);
      await this.sendResponse(
        panel,
        messageId,
        undefined,
        (error as Error).message
      );
    }
  }

  /**
   * Handle 'setup-wizard:submit-selection' RPC message.
   * Processes user's agent selection and initiates generation (Phase 2-5).
   *
   * @param panel - Webview panel
   * @param message - RPC message with messageId and payload
   * @private
   */
  private async handleSelectionMessage(
    panel: vscode.WebviewPanel,
    message: any
  ): Promise<void> {
    const { messageId, payload } = message;

    try {
      this.logger.info('Handling setup-wizard:submit-selection', {
        messageId,
      });

      // Validate payload
      if (
        !payload?.selectedAgentIds ||
        !Array.isArray(payload.selectedAgentIds)
      ) {
        await this.sendResponse(
          panel,
          messageId,
          undefined,
          'Missing or invalid selected agent IDs'
        );
        return;
      }

      // Validate session
      if (!this.currentSession) {
        await this.sendResponse(
          panel,
          messageId,
          undefined,
          'No active wizard session'
        );
        return;
      }

      // Update session with selection
      this.currentSession.selectedAgentIds = payload.selectedAgentIds;

      // Execute Phase 2-5: Generate selected agents with progress
      const result = await this.orchestrator.generateAgents(
        {
          workspaceUri: {
            fsPath: this.currentSession.workspaceRoot,
          } as vscode.Uri,
          userOverrides: payload.selectedAgentIds,
          threshold: payload.threshold || 50,
          variableOverrides: payload.variableOverrides,
        },
        async (progress) => {
          // Forward generation progress to webview
          await this.emitProgress(panel, 'setup-wizard:generation-progress', {
            phase: progress.phase,
            percent: progress.percentComplete,
            currentAgent: progress.currentOperation,
          });
        }
      );

      // Send response
      if (result.isErr()) {
        await this.sendResponse(
          panel,
          messageId,
          undefined,
          result.error!.message
        );
      } else {
        // Update session with generation summary
        this.currentSession.generationSummary = {
          totalAgents: result.value!.totalAgents,
          successful: result.value!.successful,
          failed: result.value!.failed,
          durationMs: result.value!.durationMs,
          warnings: result.value!.warnings,
        };

        await this.sendResponse(panel, messageId, {
          summary: this.currentSession.generationSummary,
        });
      }
    } catch (error) {
      this.logger.error('Error in handleSelectionMessage', error as Error);
      await this.sendResponse(
        panel,
        messageId,
        undefined,
        (error as Error).message
      );
    }
  }

  /**
   * Handle 'setup-wizard:cancel' RPC message.
   * Cancels the wizard and optionally saves progress.
   *
   * @param panel - Webview panel
   * @param message - RPC message with messageId and payload
   * @private
   */
  private async handleCancelMessage(
    panel: vscode.WebviewPanel,
    message: any
  ): Promise<void> {
    const { messageId, payload } = message;

    try {
      this.logger.info('Handling setup-wizard:cancel', { messageId });

      // Validate session
      if (!this.currentSession) {
        await this.sendResponse(
          panel,
          messageId,
          undefined,
          'No active wizard session to cancel'
        );
        return;
      }

      const sessionId = this.currentSession.id;
      const saveProgress = payload?.saveProgress ?? false;

      // Cancel wizard
      const result = await this.cancelWizard(sessionId, saveProgress);

      // Send response
      if (result.isErr()) {
        await this.sendResponse(
          panel,
          messageId,
          undefined,
          result.error!.message
        );
      } else {
        await this.sendResponse(panel, messageId, {
          cancelled: true,
          sessionId,
          progressSaved: saveProgress,
        });
      }
    } catch (error) {
      this.logger.error('Error in handleCancelMessage', error as Error);
      await this.sendResponse(
        panel,
        messageId,
        undefined,
        (error as Error).message
      );
    }
  }
}
