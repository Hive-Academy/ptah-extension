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
 */

import { injectable, inject, DependencyContainer } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
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
   * Register all setup RPC methods
   */
  register(): void {
    this.registerGetStatus();
    this.registerLaunchWizard();
    this.registerDeepAnalyze();
    this.registerRecommendAgents();

    this.logger.debug('Setup RPC handlers registered', {
      methods: [
        'setup-status:get-status',
        'setup-wizard:launch',
        'wizard:deep-analyze',
        'wizard:recommend-agents',
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

        // Resolve SetupStatusService from DI container
        const setupStatusService = this.container.resolve(
          AGENT_GENERATION_TOKENS.SETUP_STATUS_SERVICE
        ) as {
          getStatus: (uri: vscode.Uri) => Promise<{
            isErr: () => boolean;
            value?: SetupStatusResponse;
            error?: Error;
          }>;
        };

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

        // Resolve SetupWizardService from DI container
        const setupWizardService = this.container.resolve(
          AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE
        ) as {
          launchWizard: (uri: vscode.Uri) => Promise<{
            isErr: () => boolean;
            error?: Error;
          }>;
        };

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
   * Conducts comprehensive analysis of the workspace including:
   * - Architecture pattern detection
   * - Key file location discovery
   * - Language distribution analysis
   * - Code health assessment
   * - Code convention detection
   * - Test coverage estimation
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

        // Resolve SetupWizardService from DI container
        const setupWizardService = this.container.resolve(
          AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE
        ) as {
          performDeepAnalysis: (uri: vscode.Uri) => Promise<{
            isErr: () => boolean;
            isOk: () => boolean;
            value?: DeepProjectAnalysis;
            error?: Error;
          }>;
        };

        // Perform deep analysis
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

        this.logger.info('Deep analysis completed successfully', {
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
   */
  private registerRecommendAgents(): void {
    this.rpcHandler.registerMethod<DeepProjectAnalysis, AgentRecommendation[]>(
      'wizard:recommend-agents',
      async (analysis) => {
        this.logger.debug('RPC: wizard:recommend-agents called');

        // Validate input
        if (!analysis) {
          throw new Error(
            'Missing analysis input. Please run wizard:deep-analyze first.'
          );
        }

        // Validate required fields
        if (analysis.projectType === undefined) {
          throw new Error(
            'Invalid analysis: missing projectType field.'
          );
        }

        // Dynamically import agent-generation library (lazy loading)
        const { AGENT_GENERATION_TOKENS, AgentRecommendationService } = await import(
          '@ptah-extension/agent-generation'
        );

        // Try to resolve from container first, fallback to direct instantiation
        let recommendationService: { calculateRecommendations: (analysis: DeepProjectAnalysis) => AgentRecommendation[] };

        try {
          recommendationService = this.container.resolve(
            AGENT_GENERATION_TOKENS.AGENT_RECOMMENDATION_SERVICE
          ) as { calculateRecommendations: (analysis: DeepProjectAnalysis) => AgentRecommendation[] };
        } catch {
          // If not registered in container, create new instance with logger
          this.logger.debug('AgentRecommendationService not in container, creating instance');
          recommendationService = this.container.resolve(AgentRecommendationService);
        }

        // Calculate recommendations
        const recommendations = recommendationService.calculateRecommendations(analysis);

        this.logger.info('Agent recommendations calculated', {
          totalAgents: recommendations.length,
          recommendedCount: recommendations.filter((r) => r.recommended).length,
        });

        return recommendations;
      }
    );
  }
}
