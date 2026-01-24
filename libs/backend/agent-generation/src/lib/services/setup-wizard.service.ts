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
import {
  Logger,
  TOKENS,
  WebviewManager,
  WebviewMessageHandlerService,
  type IWebviewHtmlGenerator,
} from '@ptah-extension/vscode-core';
import { Result, MESSAGE_TYPES } from '@ptah-extension/shared';
import type * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { ISetupWizardService } from '../interfaces/setup-wizard.interface';
import {
  WizardSession,
  WizardStep,
  WizardState,
  AgentSelectionUpdate,
  ResumeWizardRequest,
  // Typed message interfaces (TASK_2025_078)
  WizardStartMessage,
  WizardSelectionMessage,
  WizardCancelMessage,
  FrontendProjectContext,
} from '../types/wizard.types';
import { AgentProjectContext, GenerationSummary } from '../types/core.types';
import {
  DeepProjectAnalysis,
  ArchitecturePattern,
  ArchitecturePatternName,
  KeyFileLocations,
  LanguageStats,
  DiagnosticSummary,
  CodeConventions,
  TestCoverageEstimate,
} from '../types/analysis.types';
import { AGENT_GENERATION_TOKENS } from '../di/tokens';
import { AgentGenerationOrchestratorService } from './orchestrator.service';
import {
  ProjectType,
  Framework,
  MonorepoType,
} from '@ptah-extension/workspace-intelligence';
// NOTE: StepData type REMOVED in TASK_2025_078
// Was unused discriminated union - using typed message interfaces instead

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
   * Launch lock to prevent concurrent wizard launch attempts.
   * Protects against race conditions from rapid command invocations.
   */
  private isLaunching = false;

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
    private readonly logger: Logger,
    @inject(TOKENS.WEBVIEW_HTML_GENERATOR)
    private readonly htmlGenerator: IWebviewHtmlGenerator,
    @inject(TOKENS.WEBVIEW_MESSAGE_HANDLER)
    private readonly messageHandler: WebviewMessageHandlerService
  ) {
    this.logger.debug('SetupWizardService initialized');
  }

  /**
   * Create wizard webview panel with message handlers.
   * Extracted helper to avoid duplication between launchWizard and resumeWizard.
   * (TASK_2025_078 - DRY improvement)
   *
   * @param title - Panel title
   * @param initialData - Initial data to pass to webview (including resumed session state)
   * @returns Panel on success, null on failure
   * @private
   */
  private async createWizardPanel(
    title: string,
    initialData?: {
      resumedSession?: {
        sessionId: string;
        currentStep: WizardStep;
        // Use Record type for flexibility - saved state may have simplified context
        projectContext?: Record<string, unknown>;
        selectedAgentIds?: string[];
      };
    }
  ): Promise<vscode.WebviewPanel | null> {
    // Create webview panel
    const panel = await this.webviewManager.createWebviewPanel({
      viewType: this.WIZARD_VIEW_TYPE,
      title,
      showOptions: {
        viewColumn: 1,
        preserveFocus: false,
      },
      options: {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    });

    if (!panel) {
      this.logger.error('Failed to create wizard webview panel');
      return null;
    }

    // Register message handlers (CRITICAL: before setting HTML)
    this.messageHandler.setupMessageListener({
      webviewId: this.WIZARD_VIEW_TYPE,
      webview: panel.webview,
      customHandlers: [
        async (message) => {
          switch (message.type) {
            case 'setup-wizard:start':
              await this.handleStartMessage(
                panel,
                message as WizardStartMessage
              );
              return true;
            case 'setup-wizard:submit-selection':
              await this.handleSelectionMessage(
                panel,
                message as WizardSelectionMessage
              );
              return true;
            case 'setup-wizard:cancel':
              await this.handleCancelMessage(
                panel,
                message as WizardCancelMessage
              );
              return true;
            default:
              return false;
          }
        },
      ],
      onReady: () => {
        this.logger.info('Wizard webview ready signal received');
      },
    });

    // Set webview HTML content
    panel.webview.html = this.htmlGenerator.generateAngularWebviewContent(
      panel.webview,
      {
        workspaceInfo: this.htmlGenerator.buildWorkspaceInfo() as Record<
          string,
          unknown
        >,
        initialView: 'setup-wizard',
        ...initialData,
      }
    );

    return panel;
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

      // Use consolidated panel creation helper (DRY - TASK_2025_078)
      const panel = await this.createWizardPanel('Ptah Setup Wizard');

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

      // Use consolidated panel creation helper (DRY - TASK_2025_078)
      const panel = await this.createWizardPanel(
        'Ptah Setup Wizard (Resumed)',
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
   * This method conducts a comprehensive analysis of the workspace including:
   * - Architecture pattern detection (DDD, Layered, Microservices, etc.)
   * - Key file location discovery (configs, entry points, tests)
   * - Language distribution analysis
   * - Code health assessment via diagnostics
   * - Code convention detection
   * - Test coverage estimation
   *
   * Used by the MCP-powered setup wizard for intelligent agent recommendations.
   *
   * @param workspaceUri - Workspace root URI to analyze
   * @returns Result with DeepProjectAnalysis on success, or Error if analysis fails
   *
   * @example
   * ```typescript
   * const result = await wizardService.performDeepAnalysis(workspaceUri);
   * if (result.isOk()) {
   *   const analysis = result.value;
   *   console.log(`Found ${analysis.architecturePatterns.length} patterns`);
   * }
   * ```
   */
  async performDeepAnalysis(
    workspaceUri: vscode.Uri
  ): Promise<Result<DeepProjectAnalysis, Error>> {
    try {
      this.logger.info('Starting deep project analysis', {
        workspace: workspaceUri.fsPath,
      });

      // Dynamic import to avoid circular dependencies
      const vscode = await import('vscode');

      // Step 1: Get basic workspace analysis from orchestrator
      const basicResult = await this.orchestrator.analyzeWorkspace({
        workspaceUri,
        threshold: 50,
      });

      let projectType: (typeof ProjectType)[keyof typeof ProjectType] =
        ProjectType.Unknown;
      let frameworks: (typeof Framework)[keyof typeof Framework][] = [];
      let monorepoType:
        | (typeof MonorepoType)[keyof typeof MonorepoType]
        | undefined;

      if (basicResult.isOk() && basicResult.value) {
        projectType = basicResult.value.projectType;
        frameworks = basicResult.value.frameworks;
        monorepoType = basicResult.value.monorepoType;
      }

      // Step 2: Detect architecture patterns via folder structure
      const architecturePatterns = await this.detectArchitecturePatterns(
        workspaceUri,
        vscode
      );

      // Step 3: Find key configuration files
      const configFiles = await vscode.workspace.findFiles(
        '**/*.config.{ts,js,json}',
        '**/node_modules/**',
        50
      );
      const packageJsonFiles = await vscode.workspace.findFiles(
        '**/package.json',
        '**/node_modules/**',
        20
      );

      // Step 4: Get workspace symbols for structure understanding
      let symbols: vscode.SymbolInformation[] = [];
      try {
        const symbolResult = await vscode.commands.executeCommand<
          vscode.SymbolInformation[]
        >('vscode.executeWorkspaceSymbolProvider', '');
        if (symbolResult) {
          symbols = symbolResult;
        }
      } catch (error) {
        this.logger.warn('Failed to get workspace symbols', error as Error);
      }

      // Step 5: Get diagnostics for code health
      const diagnostics = vscode.languages.getDiagnostics();

      // Step 6: Extract key file locations
      const keyFileLocations = await this.extractKeyLocations(
        workspaceUri,
        configFiles,
        symbols,
        vscode
      );

      // Step 7: Calculate language distribution
      const languageDistribution = await this.calculateLanguageDistribution(
        workspaceUri,
        vscode
      );

      // Step 8: Summarize diagnostics
      const existingIssues = this.summarizeDiagnostics(diagnostics);

      // Step 9: Detect code conventions
      const codeConventions = await this.detectCodeConventions(
        workspaceUri,
        vscode
      );

      // Step 10: Estimate test coverage
      const testCoverage = await this.estimateTestCoverage(
        workspaceUri,
        vscode
      );

      const analysis: DeepProjectAnalysis = {
        projectType,
        frameworks,
        monorepoType,
        architecturePatterns,
        keyFileLocations,
        languageDistribution,
        existingIssues,
        codeConventions,
        testCoverage,
      };

      this.logger.info('Deep project analysis complete', {
        projectType: projectType.toString(),
        frameworkCount: frameworks.length,
        patternCount: architecturePatterns.length,
        errorCount: existingIssues.errorCount,
        hasTests: testCoverage.hasTests,
      });

      return Result.ok(analysis);
    } catch (error) {
      this.logger.error('Deep project analysis failed', error as Error);
      return Result.err(
        new Error(`Deep analysis failed: ${(error as Error).message}`)
      );
    }
  }

  /**
   * Detect architecture patterns based on folder structure and file organization.
   *
   * Analyzes the workspace for common architectural patterns including:
   * - DDD (Domain-Driven Design): domain/, entities/, aggregates/, value-objects/
   * - Layered: controllers/, services/, repositories/
   * - Microservices: apps/, services/ with separate package.json
   * - Hexagonal: ports/, adapters/, application/, domain/
   * - Clean Architecture: use-cases/, entities/, interfaces/
   * - Feature-Sliced: features/, shared/, entities/, pages/
   *
   * @param workspaceUri - Workspace root URI
   * @param vscode - VS Code API module
   * @returns Array of detected architecture patterns with confidence scores
   * @private
   */
  private async detectArchitecturePatterns(
    workspaceUri: vscode.Uri,
    vscode: typeof import('vscode')
  ): Promise<ArchitecturePattern[]> {
    const patterns: ArchitecturePattern[] = [];

    // Check for DDD patterns
    const domainFolders = await vscode.workspace.findFiles(
      '**/domain/**/*.ts',
      '**/node_modules/**',
      10
    );
    const entitiesFolders = await vscode.workspace.findFiles(
      '**/entities/**/*.ts',
      '**/node_modules/**',
      10
    );
    const aggregatesFolders = await vscode.workspace.findFiles(
      '**/aggregates/**/*.ts',
      '**/node_modules/**',
      5
    );
    const valueObjectsFolders = await vscode.workspace.findFiles(
      '**/value-objects/**/*.ts',
      '**/node_modules/**',
      5
    );

    const dddEvidence: string[] = [];
    if (domainFolders.length > 0) {
      dddEvidence.push(...domainFolders.slice(0, 3).map((f) => f.fsPath));
    }
    if (entitiesFolders.length > 0) {
      dddEvidence.push(...entitiesFolders.slice(0, 3).map((f) => f.fsPath));
    }
    if (aggregatesFolders.length > 0) {
      dddEvidence.push(...aggregatesFolders.slice(0, 2).map((f) => f.fsPath));
    }
    if (valueObjectsFolders.length > 0) {
      dddEvidence.push(...valueObjectsFolders.slice(0, 2).map((f) => f.fsPath));
    }

    if (dddEvidence.length >= 3) {
      const confidence = Math.min(95, 50 + dddEvidence.length * 8);
      patterns.push({
        name: 'DDD' as ArchitecturePatternName,
        confidence,
        evidence: dddEvidence,
        description:
          'Domain-Driven Design pattern detected with domain entities and value objects',
      });
    }

    // Check for Layered architecture
    const layeredPatterns = [
      'controllers',
      'services',
      'repositories',
      'models',
    ];
    const layeredResults = await Promise.all(
      layeredPatterns.map(async (layer) => {
        const files = await vscode.workspace.findFiles(
          `**/${layer}/**/*.ts`,
          '**/node_modules/**',
          5
        );
        return { layer, hasFiles: files.length > 0, files };
      })
    );

    const layeredEvidence = layeredResults
      .filter((r) => r.hasFiles)
      .flatMap((r) => r.files.slice(0, 2).map((f) => f.fsPath));

    const layeredCount = layeredResults.filter((r) => r.hasFiles).length;
    if (layeredCount >= 3) {
      patterns.push({
        name: 'Layered' as ArchitecturePatternName,
        confidence: Math.min(90, 60 + layeredCount * 10),
        evidence: layeredEvidence,
        description:
          'Layered architecture with controllers, services, and repositories',
      });
    }

    // Check for Microservices pattern
    const appsFolder = await vscode.workspace.findFiles(
      'apps/*/package.json',
      '**/node_modules/**',
      10
    );
    const servicesFolder = await vscode.workspace.findFiles(
      'services/*/package.json',
      '**/node_modules/**',
      10
    );

    if (appsFolder.length >= 2 || servicesFolder.length >= 2) {
      const microservicesEvidence = [
        ...appsFolder.slice(0, 3).map((f) => f.fsPath),
        ...servicesFolder.slice(0, 3).map((f) => f.fsPath),
      ];
      patterns.push({
        name: 'Microservices' as ArchitecturePatternName,
        confidence: Math.min(
          85,
          55 + (appsFolder.length + servicesFolder.length) * 5
        ),
        evidence: microservicesEvidence,
        description:
          'Microservices architecture with multiple service packages',
      });
    }

    // Check for Hexagonal/Ports & Adapters
    const portsFiles = await vscode.workspace.findFiles(
      '**/ports/**/*.ts',
      '**/node_modules/**',
      5
    );
    const adaptersFiles = await vscode.workspace.findFiles(
      '**/adapters/**/*.ts',
      '**/node_modules/**',
      5
    );

    if (portsFiles.length > 0 && adaptersFiles.length > 0) {
      patterns.push({
        name: 'Hexagonal' as ArchitecturePatternName,
        confidence: Math.min(
          85,
          60 + (portsFiles.length + adaptersFiles.length) * 5
        ),
        evidence: [
          ...portsFiles.slice(0, 2).map((f) => f.fsPath),
          ...adaptersFiles.slice(0, 2).map((f) => f.fsPath),
        ],
        description: 'Hexagonal architecture with ports and adapters',
      });
    }

    // Check for Clean Architecture
    const useCasesFiles = await vscode.workspace.findFiles(
      '**/use-cases/**/*.ts',
      '**/node_modules/**',
      5
    );

    if (
      useCasesFiles.length > 0 &&
      (entitiesFolders.length > 0 || domainFolders.length > 0)
    ) {
      patterns.push({
        name: 'Clean-Architecture' as ArchitecturePatternName,
        confidence: Math.min(80, 55 + useCasesFiles.length * 5),
        evidence: [
          ...useCasesFiles.slice(0, 3).map((f) => f.fsPath),
          ...entitiesFolders.slice(0, 2).map((f) => f.fsPath),
        ],
        description: 'Clean Architecture with use cases and entities layers',
      });
    }

    // Check for Component-Based (frontend)
    const componentsFiles = await vscode.workspace.findFiles(
      '**/components/**/*.{ts,tsx,vue,svelte}',
      '**/node_modules/**',
      10
    );

    if (componentsFiles.length >= 5) {
      patterns.push({
        name: 'Component-Based' as ArchitecturePatternName,
        confidence: Math.min(85, 50 + componentsFiles.length * 3),
        evidence: componentsFiles.slice(0, 5).map((f) => f.fsPath),
        description: 'Component-based architecture for frontend development',
      });
    }

    // Sort by confidence descending
    patterns.sort((a, b) => b.confidence - a.confidence);

    this.logger.debug('Architecture patterns detected', {
      patternCount: patterns.length,
      patterns: patterns.map((p) => ({
        name: p.name,
        confidence: p.confidence,
      })),
    });

    return patterns;
  }

  /**
   * Extract key file locations from workspace analysis.
   *
   * @param workspaceUri - Workspace root URI
   * @param configFiles - Pre-discovered config files
   * @param symbols - Workspace symbols
   * @param vscode - VS Code API module
   * @returns Structured key file locations
   * @private
   */
  private async extractKeyLocations(
    workspaceUri: vscode.Uri,
    configFiles: vscode.Uri[],
    symbols: vscode.SymbolInformation[],
    vscode: typeof import('vscode')
  ): Promise<KeyFileLocations> {
    // Find entry points
    const entryPointPatterns = [
      '**/main.ts',
      '**/index.ts',
      '**/app.ts',
      '**/server.ts',
    ];
    const entryPointFiles: string[] = [];
    for (const pattern of entryPointPatterns) {
      const files = await vscode.workspace.findFiles(
        pattern,
        '**/node_modules/**',
        5
      );
      entryPointFiles.push(...files.map((f) => f.fsPath));
    }

    // Find test directories
    const testDirs: string[] = [];
    const testPatterns = [
      '**/__tests__/**/*.ts',
      '**/test/**/*.ts',
      '**/tests/**/*.ts',
    ];
    for (const pattern of testPatterns) {
      const files = await vscode.workspace.findFiles(
        pattern,
        '**/node_modules/**',
        10
      );
      // Extract unique directories
      files.forEach((f) => {
        const dirMatch = f.fsPath.match(/.*[/\\](__tests__|tests?)[/\\]/i);
        if (dirMatch) {
          const dir = f.fsPath.substring(
            0,
            dirMatch.index! + dirMatch[0].length
          );
          if (!testDirs.includes(dir)) {
            testDirs.push(dir);
          }
        }
      });
    }

    // Find API routes
    const apiRouteFiles = await vscode.workspace.findFiles(
      '**/{routes,controllers,api}/**/*.ts',
      '**/node_modules/**',
      20
    );

    // Find component directories
    const componentFiles = await vscode.workspace.findFiles(
      '**/components/**/*.{ts,tsx,vue,svelte}',
      '**/node_modules/**',
      20
    );

    // Find service directories
    const serviceFiles = await vscode.workspace.findFiles(
      '**/services/**/*.ts',
      '**/node_modules/**',
      20
    );

    // Find model/entity directories
    const modelFiles = await vscode.workspace.findFiles(
      '**/{models,entities,domain}/**/*.ts',
      '**/node_modules/**',
      20
    );

    // Find repository directories
    const repoFiles = await vscode.workspace.findFiles(
      '**/repositories/**/*.ts',
      '**/node_modules/**',
      10
    );

    // Find utility directories
    const utilFiles = await vscode.workspace.findFiles(
      '**/{utils,helpers,common}/**/*.ts',
      '**/node_modules/**',
      10
    );

    return {
      entryPoints: [...new Set(entryPointFiles)].slice(0, 10),
      configs: configFiles.map((f) => f.fsPath).slice(0, 20),
      testDirectories: [...new Set(testDirs)].slice(0, 10),
      apiRoutes: apiRouteFiles.map((f) => f.fsPath).slice(0, 15),
      components: componentFiles.map((f) => f.fsPath).slice(0, 15),
      services: serviceFiles.map((f) => f.fsPath).slice(0, 15),
      models: modelFiles.map((f) => f.fsPath).slice(0, 15),
      repositories: repoFiles.map((f) => f.fsPath).slice(0, 10),
      utilities: utilFiles.map((f) => f.fsPath).slice(0, 10),
    };
  }

  /**
   * Calculate language distribution in the workspace.
   *
   * @param workspaceUri - Workspace root URI
   * @param vscode - VS Code API module
   * @returns Array of language statistics
   * @private
   */
  private async calculateLanguageDistribution(
    workspaceUri: vscode.Uri,
    vscode: typeof import('vscode')
  ): Promise<LanguageStats[]> {
    const languageCounts: Record<string, number> = {};

    // Count TypeScript files
    const tsFiles = await vscode.workspace.findFiles(
      '**/*.ts',
      '**/node_modules/**',
      1000
    );
    languageCounts['TypeScript'] = tsFiles.length;

    // Count JavaScript files
    const jsFiles = await vscode.workspace.findFiles(
      '**/*.js',
      '**/node_modules/**',
      1000
    );
    languageCounts['JavaScript'] = jsFiles.length;

    // Count TSX files (React)
    const tsxFiles = await vscode.workspace.findFiles(
      '**/*.tsx',
      '**/node_modules/**',
      1000
    );
    languageCounts['TSX'] = tsxFiles.length;

    // Count JSX files (React)
    const jsxFiles = await vscode.workspace.findFiles(
      '**/*.jsx',
      '**/node_modules/**',
      1000
    );
    languageCounts['JSX'] = jsxFiles.length;

    // Count Vue files
    const vueFiles = await vscode.workspace.findFiles(
      '**/*.vue',
      '**/node_modules/**',
      500
    );
    languageCounts['Vue'] = vueFiles.length;

    // Count Python files
    const pyFiles = await vscode.workspace.findFiles(
      '**/*.py',
      '**/node_modules/**',
      500
    );
    languageCounts['Python'] = pyFiles.length;

    // Count HTML files
    const htmlFiles = await vscode.workspace.findFiles(
      '**/*.html',
      '**/node_modules/**',
      500
    );
    languageCounts['HTML'] = htmlFiles.length;

    // Count CSS/SCSS/LESS files
    const cssFiles = await vscode.workspace.findFiles(
      '**/*.{css,scss,less}',
      '**/node_modules/**',
      500
    );
    languageCounts['CSS'] = cssFiles.length;

    // Count JSON files
    const jsonFiles = await vscode.workspace.findFiles(
      '**/*.json',
      '**/node_modules/**',
      500
    );
    languageCounts['JSON'] = jsonFiles.length;

    // Calculate total and percentages
    const total = Object.values(languageCounts).reduce(
      (sum, count) => sum + count,
      0
    );

    if (total === 0) {
      return [];
    }

    const stats: LanguageStats[] = Object.entries(languageCounts)
      .filter(([_, count]) => count > 0)
      .map(([language, fileCount]) => ({
        language,
        fileCount,
        percentage: Math.round((fileCount / total) * 1000) / 10, // One decimal place
      }))
      .sort((a, b) => b.fileCount - a.fileCount);

    return stats;
  }

  /**
   * Summarize VS Code diagnostics into aggregate counts.
   *
   * @param diagnostics - Array of [URI, Diagnostic[]] tuples from getDiagnostics
   * @returns Summarized diagnostic information
   * @private
   */
  private summarizeDiagnostics(
    diagnostics: [vscode.Uri, vscode.Diagnostic[]][]
  ): DiagnosticSummary {
    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    const errorsByType: Record<string, number> = {};
    const warningsByType: Record<string, number> = {};
    const errorMessages: Map<string, number> = new Map();

    // Dynamic import for vscode types
    const DiagnosticSeverity = {
      Error: 0,
      Warning: 1,
      Information: 2,
      Hint: 3,
    };

    for (const [uri, fileDiagnostics] of diagnostics) {
      // Skip node_modules
      if (uri.fsPath.includes('node_modules')) {
        continue;
      }

      for (const diag of fileDiagnostics) {
        const source = diag.source || 'unknown';

        switch (diag.severity) {
          case DiagnosticSeverity.Error: {
            errorCount++;
            errorsByType[source] = (errorsByType[source] || 0) + 1;
            // Track error messages
            const errorMsg = diag.message.substring(0, 100);
            errorMessages.set(errorMsg, (errorMessages.get(errorMsg) || 0) + 1);
            break;
          }
          case DiagnosticSeverity.Warning: {
            warningCount++;
            warningsByType[source] = (warningsByType[source] || 0) + 1;
            break;
          }
          case DiagnosticSeverity.Information:
          case DiagnosticSeverity.Hint:
            infoCount++;
            break;
        }
      }
    }

    // Get top errors
    const topErrors = Array.from(errorMessages.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([message, count]) => ({
        message,
        count,
        source: Object.keys(errorsByType)[0] || 'unknown',
      }));

    return {
      errorCount,
      warningCount,
      infoCount,
      errorsByType,
      warningsByType,
      topErrors: topErrors.length > 0 ? topErrors : undefined,
    };
  }

  /**
   * Detect code conventions from project configuration files.
   *
   * @param workspaceUri - Workspace root URI
   * @param vscode - VS Code API module
   * @returns Detected code conventions
   * @private
   */
  private async detectCodeConventions(
    workspaceUri: vscode.Uri,
    vscode: typeof import('vscode')
  ): Promise<CodeConventions> {
    // Default conventions
    const conventions: CodeConventions = {
      indentation: 'spaces',
      indentSize: 2,
      quoteStyle: 'single',
      semicolons: true,
      trailingComma: 'es5',
    };

    try {
      // Try to read .prettierrc or prettier.config.js
      const prettierConfigs = await vscode.workspace.findFiles(
        '{.prettierrc,.prettierrc.json,.prettierrc.js,prettier.config.js}',
        '**/node_modules/**',
        1
      );

      if (prettierConfigs.length > 0) {
        conventions.usePrettier = true;
        try {
          const content = await vscode.workspace.fs.readFile(
            prettierConfigs[0]
          );
          const configText = Buffer.from(content).toString('utf8');
          // Parse JSON config
          if (
            prettierConfigs[0].fsPath.endsWith('.json') ||
            prettierConfigs[0].fsPath.endsWith('.prettierrc')
          ) {
            try {
              const config = JSON.parse(configText);
              if (config.tabWidth) conventions.indentSize = config.tabWidth;
              if (config.useTabs) conventions.indentation = 'tabs';
              if (config.singleQuote !== undefined)
                conventions.quoteStyle = config.singleQuote
                  ? 'single'
                  : 'double';
              if (config.semi !== undefined)
                conventions.semicolons = config.semi;
              if (config.trailingComma)
                conventions.trailingComma = config.trailingComma;
              if (config.printWidth)
                conventions.maxLineLength = config.printWidth;
            } catch {
              // Not valid JSON, skip
            }
          }
        } catch {
          // Could not read file, continue with defaults
        }
      }

      // Check for ESLint
      const eslintConfigs = await vscode.workspace.findFiles(
        '{.eslintrc,.eslintrc.json,.eslintrc.js,eslint.config.js}',
        '**/node_modules/**',
        1
      );
      if (eslintConfigs.length > 0) {
        conventions.useEslint = true;
      }

      // Check for additional tools
      const additionalTools: string[] = [];
      const stylelintConfig = await vscode.workspace.findFiles(
        '.stylelintrc*',
        '**/node_modules/**',
        1
      );
      if (stylelintConfig.length > 0) additionalTools.push('stylelint');

      const biomeConfig = await vscode.workspace.findFiles(
        'biome.json',
        '**/node_modules/**',
        1
      );
      if (biomeConfig.length > 0) additionalTools.push('biome');

      if (additionalTools.length > 0) {
        conventions.additionalTools = additionalTools;
      }
    } catch (error) {
      this.logger.warn('Error detecting code conventions', error as Error);
    }

    return conventions;
  }

  /**
   * Estimate test coverage based on file analysis.
   *
   * @param workspaceUri - Workspace root URI
   * @param vscode - VS Code API module
   * @returns Test coverage estimation
   * @private
   */
  private async estimateTestCoverage(
    workspaceUri: vscode.Uri,
    vscode: typeof import('vscode')
  ): Promise<TestCoverageEstimate> {
    // Count source files (non-test)
    const sourceFiles = await vscode.workspace.findFiles(
      '**/*.{ts,tsx,js,jsx}',
      '{**/node_modules/**,**/*.spec.*,**/*.test.*,**/__tests__/**,**/test/**}',
      2000
    );

    // Count test files
    const specFiles = await vscode.workspace.findFiles(
      '**/*.spec.{ts,tsx,js,jsx}',
      '**/node_modules/**',
      500
    );
    const testFiles = await vscode.workspace.findFiles(
      '**/*.test.{ts,tsx,js,jsx}',
      '**/node_modules/**',
      500
    );
    const testDirFiles = await vscode.workspace.findFiles(
      '**/__tests__/**/*.{ts,tsx,js,jsx}',
      '**/node_modules/**',
      500
    );

    const totalTestFiles =
      specFiles.length + testFiles.length + testDirFiles.length;
    const hasTests = totalTestFiles > 0;

    // Detect test framework from config or dependencies
    let testFramework: string | undefined;

    // Check for Jest
    const jestConfig = await vscode.workspace.findFiles(
      '{jest.config.*,jest.preset.js}',
      '**/node_modules/**',
      1
    );
    if (jestConfig.length > 0) {
      testFramework = 'jest';
    }

    // Check for Vitest
    const vitestConfig = await vscode.workspace.findFiles(
      'vitest.config.*',
      '**/node_modules/**',
      1
    );
    if (vitestConfig.length > 0) {
      testFramework = 'vitest';
    }

    // Check for Mocha
    const mochaConfig = await vscode.workspace.findFiles(
      '.mocharc*',
      '**/node_modules/**',
      1
    );
    if (mochaConfig.length > 0) {
      testFramework = 'mocha';
    }

    // Check for E2E tests
    const cypressFiles = await vscode.workspace.findFiles(
      '{cypress/**/*.{ts,js},cypress.config.*}',
      '**/node_modules/**',
      5
    );
    const playwrightFiles = await vscode.workspace.findFiles(
      '{playwright/**/*.{ts,js},playwright.config.*}',
      '**/node_modules/**',
      5
    );
    const e2eFiles = await vscode.workspace.findFiles(
      '**/e2e/**/*.{ts,js}',
      '**/node_modules/**',
      10
    );

    const hasE2eTests =
      cypressFiles.length > 0 ||
      playwrightFiles.length > 0 ||
      e2eFiles.length > 0;

    // Check for integration tests
    const integrationFiles = await vscode.workspace.findFiles(
      '**/*.integration.{ts,js,spec.ts,test.ts}',
      '**/node_modules/**',
      10
    );
    const hasIntegrationTests = integrationFiles.length > 0;

    // Calculate estimated coverage
    const sourceFileCount = sourceFiles.length;
    const testFileCount = totalTestFiles;
    const testToSourceRatio =
      sourceFileCount > 0 ? testFileCount / sourceFileCount : 0;

    // Estimate percentage (heuristic: good ratio is ~0.3)
    // Cap at 100%, scale non-linearly
    const percentage = Math.min(
      100,
      Math.round(testToSourceRatio * 250) // 0.4 ratio = 100%
    );

    return {
      percentage,
      hasTests,
      testFramework,
      hasUnitTests: hasTests,
      hasIntegrationTests,
      hasE2eTests,
      testFileCount,
      sourceFileCount,
      testToSourceRatio: Math.round(testToSourceRatio * 100) / 100,
    };
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

    // Dispose webview if exists
    try {
      this.webviewManager.disposeWebview(this.WIZARD_VIEW_TYPE);
    } catch (error) {
      this.logger.warn(
        'Error disposing webview during cleanup',
        error as Error
      );
    }

    // Clear session state
    this.currentSession = null;
    this.transitionLock = false;

    this.logger.debug('Wizard cleanup complete');
  }

  /**
   * Save wizard session state for resume capability.
   *
   * **Workspace State Persistence:**
   * This method persists wizard progress using VS Code's workspace state API,
   * enabling users to resume interrupted setup sessions.
   *
   * **What Data is Persisted:**
   * - Session ID (unique identifier)
   * - Current wizard step (welcome, scan, analysis, select, generate, complete)
   * - Workspace root path (validates session belongs to current workspace)
   * - Last activity timestamp (for session expiry validation)
   * - Project context (detected project type, frameworks, tech stack)
   * - Selected agent IDs (user's agent selection for generation)
   *
   * **Storage Location:**
   * - Stored in VS Code's workspace state (workspace-specific, not global)
   * - Key: 'wizard-session-state'
   * - Persists across VS Code restarts (until workspace is deleted)
   * - Isolated per workspace (different workspaces have independent sessions)
   *
   * **When Persistence Occurs:**
   * - On wizard cancellation (if user opts to save progress)
   * - Before any long-running operation (as checkpoint)
   * - NOT persisted on successful wizard completion (session is cleared)
   *
   * **Cleanup Strategy:**
   * - Sessions expire after 24 hours (MAX_SESSION_AGE_MS)
   * - Expired sessions are rejected during resume attempt (see isSessionValid)
   * - Manual cleanup: User can clear workspace state via VS Code commands
   * - Automatic cleanup: On workspace deletion or extension uninstall
   *
   * **Resume Flow:**
   * 1. User launches wizard in workspace
   * 2. Service checks for saved state (loadSavedState)
   * 3. If valid state exists, offer resume option in UI
   * 4. If user accepts, restore session and skip to saved step
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
   * **Workspace State Retrieval:**
   * Retrieves previously saved wizard session state from VS Code workspace storage.
   * Validates that the saved state belongs to the current workspace before returning.
   *
   * **Workspace Isolation:**
   * - Each workspace has its own saved state (isolated storage)
   * - Opening wizard in different workspace will NOT load other workspace's state
   * - Workspace root path validation prevents cross-workspace state leakage
   *
   * **Return Behavior:**
   * - Returns saved state if exists AND workspace matches
   * - Returns undefined if no saved state exists
   * - Returns undefined if saved state is for different workspace
   *
   * **Usage in Resume Flow:**
   * ```typescript
   * const savedState = await this.loadSavedState(workspaceUri.fsPath);
   * if (savedState && this.isSessionValid(savedState)) {
   *   // Offer resume option in UI
   * }
   * ```
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
   * **Session Expiry Policy:**
   * - Sessions expire after 24 hours (MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000)
   * - Expiry is based on last activity timestamp (saved during cancelWizard)
   * - Expired sessions cannot be resumed (user must start fresh wizard)
   *
   * **Why 24 Hours?**
   * - Balances user convenience (resume next day) with data staleness
   * - Prevents resuming with outdated workspace analysis
   * - Reduces risk of corrupted state from workspace changes
   *
   * **Validation Checks:**
   * 1. Session age < 24 hours (primary check)
   * 2. Future: Could add workspace integrity checks (file count, git commit hash)
   *
   * **Expiry Handling:**
   * ```typescript
   * if (!this.isSessionValid(savedState)) {
   *   // Clear expired state
   *   await this.context.workspaceState.update(SESSION_STATE_KEY, undefined);
   *   // User must start fresh wizard
   *   return Result.err(new Error('Saved session expired'));
   * }
   * ```
   *
   * @param state - Wizard state to validate
   * @returns True if session is valid and can be resumed
   * @private
   */
  private isSessionValid(state: WizardState): boolean {
    // FIX (TASK_2025_078): Handle Date deserialization from JSON
    // workspaceState.get() returns lastActivity as string, not Date object
    const lastActivityDate =
      state.lastActivity instanceof Date
        ? state.lastActivity
        : new Date(state.lastActivity);

    // Check session age
    const ageMs = Date.now() - lastActivityDate.getTime();
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
        type: MESSAGE_TYPES.RPC_RESPONSE,
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
   * NOTE: Frontend sends string types, backend expects enums from workspace-intelligence.
   * We use type assertions because the frontend guarantees valid values.
   *
   * @param frontendContext - Project context from frontend
   * @returns Backend AgentProjectContext
   * @private
   */
  private mapToAgentProjectContext(
    frontendContext: FrontendProjectContext
  ): AgentProjectContext {
    // Frontend sends simplified ProjectContext, map to full AgentProjectContext
    // Type assertions needed: frontend sends strings, backend expects enums
    return {
      rootPath: frontendContext.rootPath || frontendContext.workspacePath || '',
      // Cast string to ProjectType enum - frontend validates values match enum
      projectType:
        frontendContext.projectType as unknown as AgentProjectContext['projectType'],
      // Cast string array to Framework enum array
      frameworks: (frontendContext.frameworks ||
        []) as unknown as AgentProjectContext['frameworks'],
      // Cast string to MonorepoType enum (or undefined)
      monorepoType:
        frontendContext.monorepoType as unknown as AgentProjectContext['monorepoType'],
      // Frontend doesn't send full IndexedFile objects, use empty array
      relevantFiles: [] as AgentProjectContext['relevantFiles'],
      techStack: {
        languages: frontendContext.techStack?.languages || [],
        frameworks: frontendContext.techStack?.frameworks || [],
        buildTools: frontendContext.techStack?.buildTools || [],
        testingFrameworks: frontendContext.techStack?.testingFrameworks || [],
        packageManager: frontendContext.techStack?.packageManager || 'npm',
      },
      codeConventions: {
        indentation: frontendContext.codeConventions?.indentation ?? 'spaces',
        indentSize: frontendContext.codeConventions?.indentSize ?? 2,
        quoteStyle: frontendContext.codeConventions?.quoteStyle ?? 'single',
        semicolons: frontendContext.codeConventions?.semicolons ?? true,
        trailingComma: frontendContext.codeConventions?.trailingComma ?? 'es5',
      },
    };
  }

  /**
   * Handle 'setup-wizard:start' RPC message.
   * Initiates workspace scanning and agent detection (Phase 1).
   *
   * @param panel - Webview panel
   * @param message - Typed RPC message with messageId and payload
   * @private
   */
  private async handleStartMessage(
    panel: vscode.WebviewPanel,
    message: WizardStartMessage
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

      // Send response - use proper Result unwrapping
      if (result.isErr()) {
        const errorMessage =
          result.error?.message ?? 'Unknown error during generation';
        await this.sendResponse(panel, messageId, undefined, errorMessage);
      } else {
        const value = result.value;
        if (value) {
          await this.sendResponse(panel, messageId, {
            agents: value.agents.map((agent) => ({
              id: agent.sourceTemplateId,
              name: agent.sourceTemplateId,
              version: agent.sourceTemplateVersion,
            })),
            summary: {
              totalAgents: value.totalAgents,
              successful: value.successful,
              failed: value.failed,
              durationMs: value.durationMs,
              warnings: value.warnings,
            },
          });
        }
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
   * @param message - Typed RPC message with messageId and payload
   * @private
   */
  private async handleSelectionMessage(
    panel: vscode.WebviewPanel,
    message: WizardSelectionMessage
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

      // Send response - use proper Result unwrapping
      if (result.isErr()) {
        const errorMessage =
          result.error?.message ?? 'Unknown generation error';
        await this.sendResponse(panel, messageId, undefined, errorMessage);
      } else {
        const value = result.value;
        if (value) {
          // Update session with generation summary
          this.currentSession.generationSummary = {
            totalAgents: value.totalAgents,
            successful: value.successful,
            failed: value.failed,
            durationMs: value.durationMs,
            warnings: value.warnings,
          };

          await this.sendResponse(panel, messageId, {
            summary: this.currentSession.generationSummary,
          });
        }
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
   * @param message - Typed RPC message with messageId and payload
   * @private
   */
  private async handleCancelMessage(
    panel: vscode.WebviewPanel,
    message: WizardCancelMessage
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

      // Send response - use proper Result unwrapping
      if (result.isErr()) {
        const errorMessage =
          result.error?.message ?? 'Unknown cancellation error';
        await this.sendResponse(panel, messageId, undefined, errorMessage);
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
