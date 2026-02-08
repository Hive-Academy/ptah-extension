/**
 * Setup RPC Handlers
 *
 * Handles setup-related RPC methods:
 * - setup-status:get-status - Get agent configuration status
 * - setup-wizard:launch - Launch setup wizard webview
 * - wizard:deep-analyze - Perform deep project analysis
 * - wizard:recommend-agents - Calculate agent recommendations
 *
 * TASK_2025_074: Extracted from monolithic RpcMethodRegistrationService
 * TASK_2025_069: Setup wizard integration
 * TASK_2025_111: Added deep analysis and recommendation handlers
 * TASK_2025_145: Use shared ProjectAnalysisZodSchema + normalizeAgentOutput (SERIOUS-7, CRITICAL-1)
 */

import { injectable, inject, DependencyContainer } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  LicenseService,
  type LicenseStatus,
  type WebviewManager,
} from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { CodeExecutionMCP } from '@ptah-extension/vscode-lm-tools';
import * as vscode from 'vscode';
import type {
  DeepProjectAnalysis,
  AgentRecommendation,
} from '@ptah-extension/agent-generation';

/**
 * SetupStatus response type for setup-status:get-status RPC method
 */
interface SetupStatusResponse {
  isConfigured: boolean;
  agentCount: number;
  lastModified: string | null;
  projectAgents: string[];
  userAgents: string[];
}

/**
 * RPC handlers for setup operations
 */
@injectable()
export class SetupRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    private readonly container: DependencyContainer
  ) {}

  /**
   * Safely resolve a service from the DI container with validation.
   *
   * Provides consistent error handling and logging for dynamic service resolution.
   * Throws descriptive errors when resolution fails, including the service name
   * and original error details for debugging.
   *
   * @param token - The DI token (symbol or string) identifying the service
   * @param serviceName - Human-readable name for error messages
   * @returns The resolved service instance
   * @throws Error if service is not registered or resolves to null/undefined
   *
   * @remarks
   * TASK_2025_113 T5.5: Added for standardized runtime validation of dynamic service resolution
   */
  private resolveService<T>(token: symbol | string, serviceName: string): T {
    try {
      const service = this.container.resolve(token);

      if (service === null || service === undefined) {
        throw new Error(`${serviceName} resolved to null/undefined`);
      }

      return service as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to resolve ${serviceName}`, { error: message });
      throw new Error(
        `${serviceName} not available. Ensure the agent-generation module is properly initialized. Details: ${message}`
      );
    }
  }

  /**
   * Register all setup RPC methods
   */
  register(): void {
    this.registerGetStatus();
    this.registerLaunchWizard();
    this.registerDeepAnalyze();
    this.registerRecommendAgents();
    this.registerCancelAnalysis();

    this.logger.debug('Setup RPC handlers registered', {
      methods: [
        'setup-status:get-status',
        'setup-wizard:launch',
        'wizard:deep-analyze',
        'wizard:recommend-agents',
        'wizard:cancel-analysis',
      ],
    });
  }

  /**
   * setup-status:get-status - Get agent configuration status
   */
  private registerGetStatus(): void {
    this.rpcHandler.registerMethod<void, SetupStatusResponse>(
      'setup-status:get-status',
      async () => {
        this.logger.debug('RPC: setup-status:get-status called');

        // Get workspace folder
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          throw new Error(
            'No workspace folder open. Please open a folder to configure agents.'
          );
        }

        // Dynamically import agent-generation library (lazy loading)
        const { AGENT_GENERATION_TOKENS } = await import(
          '@ptah-extension/agent-generation'
        );

        // Resolve SetupStatusService from DI container with validation
        const setupStatusService = this.resolveService<{
          getStatus: (uri: vscode.Uri) => Promise<{
            isErr: () => boolean;
            value?: SetupStatusResponse;
            error?: Error;
          }>;
        }>(AGENT_GENERATION_TOKENS.SETUP_STATUS_SERVICE, 'SetupStatusService');

        // Get status
        const result = await setupStatusService.getStatus(workspaceFolder.uri);

        // Handle error result
        if (result.isErr()) {
          this.logger.error('Failed to get setup status', result.error);
          throw new Error(
            result.error?.message || 'Failed to retrieve agent setup status'
          );
        }

        // Return the status data
        return result.value as SetupStatusResponse;
      }
    );
  }

  /**
   * setup-wizard:launch - Launch setup wizard webview
   */
  private registerLaunchWizard(): void {
    this.rpcHandler.registerMethod<void, { success: boolean }>(
      'setup-wizard:launch',
      async () => {
        this.logger.debug('RPC: setup-wizard:launch called');

        // Get workspace folder
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          throw new Error(
            'No workspace folder open. Please open a folder first.'
          );
        }

        // Dynamically import agent-generation library (lazy loading)
        const { AGENT_GENERATION_TOKENS } = await import(
          '@ptah-extension/agent-generation'
        );

        // Resolve SetupWizardService from DI container with validation
        const setupWizardService = this.resolveService<{
          launchWizard: (uri: vscode.Uri) => Promise<{
            isErr: () => boolean;
            error?: Error;
          }>;
        }>(AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE, 'SetupWizardService');

        // Launch wizard
        const result = await setupWizardService.launchWizard(
          workspaceFolder.uri
        );

        // Handle error result
        if (result.isErr()) {
          this.logger.error('Failed to launch setup wizard', result.error);
          throw new Error(
            result.error?.message || 'Failed to launch setup wizard'
          );
        }

        // Return success
        return { success: true };
      }
    );
  }

  /**
   * wizard:deep-analyze - Perform deep project analysis
   *
   * Uses agentic analysis (Claude Agent SDK + MCP tools) as the primary path,
   * with automatic fallback to the hardcoded DeepProjectAnalysisService.
   *
   * Agentic analysis provides:
   * - Intelligent, LLM-driven workspace investigation
   * - Real-time progress streaming to frontend
   * - Sub-agent delegation for large projects
   *
   * Fallback triggers when:
   * - SDK is not initialized or unavailable
   * - Agent session fails to start
   * - Response parsing/validation fails
   * - Any unexpected error occurs
   */
  private registerDeepAnalyze(): void {
    this.rpcHandler.registerMethod<void, DeepProjectAnalysis>(
      'wizard:deep-analyze',
      async () => {
        this.logger.debug('RPC: wizard:deep-analyze called');

        // Get workspace folder
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          throw new Error(
            'No workspace folder open. Please open a folder to analyze.'
          );
        }

        // Dynamically import agent-generation library (lazy loading)
        const { AGENT_GENERATION_TOKENS } = await import(
          '@ptah-extension/agent-generation'
        );

        // Resolve license + MCP status (same pattern as ChatRpcHandlers)
        let isPremium = false;
        let mcpServerRunning = false;
        let mcpPort: number | undefined;
        try {
          const licenseService = this.resolveService<LicenseService>(
            TOKENS.LICENSE_SERVICE,
            'LicenseService'
          );
          const licenseStatus: LicenseStatus =
            await licenseService.verifyLicense();
          isPremium =
            licenseStatus.valid &&
            (licenseStatus.plan?.isPremium === true ||
              licenseStatus.tier === 'pro' ||
              licenseStatus.tier === 'trial_pro');

          const codeExecutionMcp = this.resolveService<CodeExecutionMCP>(
            TOKENS.CODE_EXECUTION_MCP,
            'CodeExecutionMCP'
          );
          const actualPort = codeExecutionMcp.getPort();
          mcpServerRunning = actualPort !== null;
          mcpPort = actualPort ?? undefined;
        } catch (error) {
          this.logger.debug(
            'Could not resolve license/MCP services for agentic analysis',
            {
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }

        // Try agentic analysis first
        try {
          const agenticService = this.resolveService<{
            analyzeWorkspace: (
              uri: vscode.Uri,
              options?: {
                timeout?: number;
                model?: string;
                isPremium?: boolean;
                mcpServerRunning?: boolean;
                mcpPort?: number;
              }
            ) => Promise<{
              isOk: () => boolean;
              value?: DeepProjectAnalysis;
              error?: Error;
            }>;
          }>(
            AGENT_GENERATION_TOKENS.AGENTIC_ANALYSIS_SERVICE,
            'AgenticAnalysisService'
          );

          const agenticResult = await agenticService.analyzeWorkspace(
            workspaceFolder.uri,
            { isPremium, mcpServerRunning, mcpPort }
          );

          if (agenticResult.isOk() && agenticResult.value) {
            this.logger.info('Agentic analysis completed successfully', {
              projectType:
                agenticResult.value.projectType?.toString() || 'unknown',
              patternCount:
                agenticResult.value.architecturePatterns?.length || 0,
            });
            return agenticResult.value;
          }

          this.logger.warn(
            'Agentic analysis returned error, falling back to hardcoded',
            {
              error: agenticResult.error?.message || 'Unknown error',
            }
          );
        } catch (error) {
          this.logger.warn('Agentic analysis unavailable, using fallback', {
            error: error instanceof Error ? error.message : String(error),
          });
        }

        // Broadcast fallback transition to frontend (best-effort)
        try {
          const webviewManager = this.resolveService<WebviewManager>(
            TOKENS.WEBVIEW_MANAGER,
            'WebviewManager'
          );
          webviewManager.broadcastMessage(
            MESSAGE_TYPES.SETUP_WIZARD_SCAN_PROGRESS,
            {
              filesScanned: 0,
              totalFiles: 0,
              detections: [],
              agentReasoning: 'Switching to quick analysis mode...',
              currentPhase: undefined,
              completedPhases: [],
            }
          );
        } catch {
          /* best-effort broadcast */
        }

        // Fallback: Use existing hardcoded DeepProjectAnalysisService
        const setupWizardService = this.resolveService<{
          performDeepAnalysis: (uri: vscode.Uri) => Promise<{
            isErr: () => boolean;
            isOk: () => boolean;
            value?: DeepProjectAnalysis;
            error?: Error;
          }>;
        }>(AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE, 'SetupWizardService');

        // Broadcast that quick analysis is starting (best-effort)
        try {
          const webviewManager = this.resolveService<WebviewManager>(
            TOKENS.WEBVIEW_MANAGER,
            'WebviewManager'
          );
          webviewManager.broadcastMessage(
            MESSAGE_TYPES.SETUP_WIZARD_SCAN_PROGRESS,
            {
              filesScanned: 0,
              totalFiles: 0,
              detections: [],
              agentReasoning: 'Running quick project analysis...',
            }
          );
        } catch {
          /* best-effort broadcast */
        }

        const result = await setupWizardService.performDeepAnalysis(
          workspaceFolder.uri
        );

        // Handle error result
        if (result.isErr()) {
          this.logger.error('Failed to perform deep analysis', result.error);
          throw new Error(
            result.error?.message || 'Failed to perform deep project analysis'
          );
        }

        this.logger.info('Deep analysis completed successfully (fallback)', {
          projectType: result.value?.projectType?.toString() || 'unknown',
          patternCount: result.value?.architecturePatterns?.length || 0,
        });

        // Return the analysis data
        return result.value as DeepProjectAnalysis;
      }
    );
  }

  /**
   * wizard:recommend-agents - Calculate agent recommendations
   *
   * Accepts a DeepProjectAnalysis and returns scored recommendations
   * for all 13 agents based on project characteristics.
   *
   * Input is validated using the shared ProjectAnalysisZodSchema and normalized
   * via normalizeAgentOutput for proper enum mapping.
   *
   * @remarks
   * TASK_2025_113 T3.3: Added comprehensive Zod input validation
   * TASK_2025_145: Use shared schema from analysis-schema.ts (SERIOUS-7, CRITICAL-1)
   */
  private registerRecommendAgents(): void {
    this.rpcHandler.registerMethod<unknown, AgentRecommendation[]>(
      'wizard:recommend-agents',
      async (rawAnalysis) => {
        this.logger.debug('RPC: wizard:recommend-agents called');

        // Validate input exists
        if (!rawAnalysis) {
          throw new Error(
            'Missing analysis input. Please run wizard:deep-analyze first.'
          );
        }

        // Dynamically import the shared schema and normalizer (lazy loading)
        const {
          ProjectAnalysisZodSchema,
          normalizeAgentOutput,
          AGENT_GENERATION_TOKENS,
          AgentRecommendationService,
        } = await import('@ptah-extension/agent-generation');

        // Validate input structure with shared Zod schema
        const validationResult =
          ProjectAnalysisZodSchema.safeParse(rawAnalysis);

        if (!validationResult.success) {
          // Format error messages with field paths for debugging
          const errors = validationResult.error.issues
            .map((e) => `${String(e.path.join('.'))}: ${e.message}`)
            .join('; ');

          this.logger.error('Invalid analysis input', {
            errors,
            receivedKeys: Object.keys(rawAnalysis as object),
          });

          throw new Error(`Invalid analysis input: ${errors}`);
        }

        // Normalize validated data into properly typed DeepProjectAnalysis
        const analysis = normalizeAgentOutput(validationResult.data);

        this.logger.debug('Analysis input validated and normalized', {
          projectType: String(analysis.projectType),
          frameworkCount: analysis.frameworks.length,
          patternCount: analysis.architecturePatterns.length,
          hasKeyFileLocations: !!analysis.keyFileLocations,
        });

        // Define the service interface type for reuse
        type RecommendationServiceType = {
          calculateRecommendations: (
            analysis: DeepProjectAnalysis
          ) => AgentRecommendation[];
        };

        // Try to resolve from container first, fallback to direct instantiation
        let recommendationService: RecommendationServiceType;

        try {
          // First attempt: resolve via token with validation
          recommendationService =
            this.resolveService<RecommendationServiceType>(
              AGENT_GENERATION_TOKENS.AGENT_RECOMMENDATION_SERVICE,
              'AgentRecommendationService'
            );
        } catch {
          // If token resolution fails, fallback to direct class resolution
          this.logger.debug(
            'AgentRecommendationService not registered via token, using direct class resolution'
          );
          recommendationService =
            this.resolveService<RecommendationServiceType>(
              AgentRecommendationService as unknown as symbol,
              'AgentRecommendationService (direct)'
            );
        }

        // Calculate recommendations using normalized analysis
        const recommendations =
          recommendationService.calculateRecommendations(analysis);

        this.logger.info('Agent recommendations calculated', {
          totalAgents: recommendations.length,
          recommendedCount: recommendations.filter((r) => r.recommended).length,
        });

        return recommendations;
      }
    );
  }

  /**
   * wizard:cancel-analysis - Cancel a running agentic workspace analysis
   *
   * Aborts the active AbortController in AgenticAnalysisService, which
   * terminates the SDK query stream. Safe to call even if no analysis
   * is running (no-op in that case).
   *
   * TASK_2025_145 SERIOUS-6: Ensures "Cancel Scan" button actually stops
   * the backend SDK query, not just the frontend state.
   */
  private registerCancelAnalysis(): void {
    this.rpcHandler.registerMethod<void, { cancelled: boolean }>(
      'wizard:cancel-analysis',
      async () => {
        this.logger.debug('RPC: wizard:cancel-analysis called');

        // Dynamically import agent-generation library (lazy loading)
        const { AGENT_GENERATION_TOKENS } = await import(
          '@ptah-extension/agent-generation'
        );

        try {
          // Resolve AgenticAnalysisService and call cancelAnalysis()
          const agenticService = this.resolveService<{
            cancelAnalysis: () => void;
          }>(
            AGENT_GENERATION_TOKENS.AGENTIC_ANALYSIS_SERVICE,
            'AgenticAnalysisService'
          );

          agenticService.cancelAnalysis();

          this.logger.info('Agentic analysis cancellation requested');
          return { cancelled: true };
        } catch (error) {
          this.logger.warn('Could not cancel agentic analysis', {
            error: error instanceof Error ? error.message : String(error),
          });
          // Return success anyway -- the analysis may have already completed
          return { cancelled: false };
        }
      }
    );
  }
}
