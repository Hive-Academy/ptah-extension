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
  ConfigManager,
} from '@ptah-extension/vscode-core';
import { CodeExecutionMCP } from '@ptah-extension/vscode-lm-tools';
import * as vscode from 'vscode';
import type {
  AgentRecommendation,
  DeepProjectAnalysis,
} from '@ptah-extension/agent-generation';
import {
  AGENT_GENERATION_TOKENS,
  ProjectAnalysisZodSchema,
  normalizeAgentOutput,
  AgentRecommendationService,
  AnalysisStorageService,
} from '@ptah-extension/agent-generation';
import { SDK_TOKENS, PluginLoaderService } from '@ptah-extension/agent-sdk';
import type {
  MultiPhaseAnalysisResponse,
  SavedAnalysisMetadata,
  AgentCategory,
} from '@ptah-extension/shared';
import { Result } from '@ptah-extension/shared';
import type { MultiPhaseManifest } from '@ptah-extension/agent-generation';

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
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
    private readonly pluginLoader: PluginLoaderService,
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
   * Resolve plugin paths for premium users.
   */
  private resolvePluginPaths(isPremium: boolean): string[] | undefined {
    if (!isPremium) return undefined;
    try {
      const config = this.pluginLoader.getWorkspacePluginConfig();
      if (!config.enabledPluginIds || config.enabledPluginIds.length === 0) {
        return undefined;
      }
      const paths = this.pluginLoader.resolvePluginPaths(
        config.enabledPluginIds
      );
      return paths.length > 0 ? paths : undefined;
    } catch (error) {
      this.logger.debug('Failed to resolve plugin paths for analysis', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
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
    this.registerListAnalyses();
    this.registerLoadAnalysis();

    this.logger.debug('Setup RPC handlers registered', {
      methods: [
        'setup-status:get-status',
        'setup-wizard:launch',
        'wizard:deep-analyze',
        'wizard:recommend-agents',
        'wizard:cancel-analysis',
        'wizard:list-analyses',
        'wizard:load-analysis',
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
   * Premium + MCP required. Uses MultiPhaseAnalysisService to execute
   * multi-phase workspace analysis. Returns MultiPhaseAnalysisResponse
   * with manifest + phase markdown contents.
   */
  private registerDeepAnalyze(): void {
    this.rpcHandler.registerMethod<
      { model?: string },
      MultiPhaseAnalysisResponse
    >('wizard:deep-analyze', async (params) => {
      this.logger.debug('RPC: wizard:deep-analyze called');

      // Get workspace folder
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new Error(
          'No workspace folder open. Please open a folder to analyze.'
        );
      }

      // Resolve license + MCP status
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
          'Could not resolve license/MCP services for analysis',
          {
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }

      // Premium + MCP required
      if (!isPremium || !mcpServerRunning) {
        throw new Error(
          'Premium license and MCP server required for workspace analysis.'
        );
      }

      // Resolve current model: prefer frontend selection, fall back to config
      const currentModel =
        params?.model ||
        this.configManager.getWithDefault<string>(
          'model.selected',
          'claude-sonnet-4-5-20250929'
        );

      // Resolve plugin paths for premium users
      const pluginPaths = this.resolvePluginPaths(isPremium);

      const multiPhaseService = this.resolveService<{
        analyzeWorkspace: (
          uri: vscode.Uri,
          options?: {
            model?: string;
            isPremium?: boolean;
            mcpServerRunning?: boolean;
            mcpPort?: number;
            pluginPaths?: string[];
          }
        ) => Promise<Result<MultiPhaseManifest, Error>>;
      }>(
        AGENT_GENERATION_TOKENS.MULTI_PHASE_ANALYSIS_SERVICE,
        'MultiPhaseAnalysisService'
      );

      const multiPhaseResult = await multiPhaseService.analyzeWorkspace(
        workspaceFolder.uri,
        {
          model: currentModel,
          isPremium,
          mcpServerRunning,
          mcpPort,
          pluginPaths,
        }
      );

      if (multiPhaseResult.isErr() || !multiPhaseResult.value) {
        throw new Error(
          multiPhaseResult.error?.message ||
            'Multi-phase analysis failed. Please try again.'
        );
      }

      const manifest = multiPhaseResult.value;

      // Read completed phase markdown files
      const storageService = this.resolveService<AnalysisStorageService>(
        AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE,
        'AnalysisStorageService'
      );

      const slugDir = storageService.getSlugDir(
        workspaceFolder.uri.fsPath,
        manifest.slug
      );

      const phaseContents: Record<string, string> = {};
      for (const [phaseId, phaseResult] of Object.entries(manifest.phases)) {
        if (phaseResult.status === 'completed') {
          const content = await storageService.readPhaseFile(
            slugDir,
            phaseResult.file
          );
          if (content) {
            phaseContents[phaseId] = content;
          }
        }
      }

      this.logger.info('Multi-phase analysis completed successfully', {
        slug: manifest.slug,
        totalDurationMs: manifest.totalDurationMs,
        completedPhases: Object.entries(manifest.phases)
          .filter(([, r]) => r.status === 'completed')
          .map(([id]) => id),
        phaseContentCount: Object.keys(phaseContents).length,
      });

      const response: MultiPhaseAnalysisResponse = {
        isMultiPhase: true,
        manifest: {
          slug: manifest.slug,
          analyzedAt: manifest.analyzedAt,
          model: manifest.model,
          totalDurationMs: manifest.totalDurationMs,
          phases: manifest.phases,
        },
        phaseContents,
        analysisDir: slugDir,
      };

      return response;
    });
  }

  /**
   * wizard:recommend-agents - Calculate agent recommendations
   *
   * Accepts a DeepProjectAnalysis (or multi-phase indicator) and returns
   * scored recommendations for all 13 agents.
   *
   * For multi-phase results: returns all agents with score=100 and
   * recommended=true since the analysis quality is in the markdown files
   * that agents will read during generation.
   *
   * For legacy results: validates with Zod schema and runs scoring.
   *
   * @remarks
   * TASK_2025_113 T3.3: Added comprehensive Zod input validation
   * TASK_2025_145: Use shared schema from analysis-schema.ts (SERIOUS-7, CRITICAL-1)
   * TASK_2025_154: Multi-phase path returns all 13 agents recommended
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

        // ---- Multi-phase path: all 13 agents recommended ----
        const input = rawAnalysis as Record<string, unknown>;
        if (input['isMultiPhase'] === true) {
          this.logger.info(
            'Multi-phase analysis detected, returning all agents recommended'
          );

          // Get all agents by running with a dummy analysis, then override scores
          const agentCatalog: Array<{ id: string; category: AgentCategory }> = [
            { id: 'project-manager', category: 'planning' },
            { id: 'software-architect', category: 'planning' },
            { id: 'team-leader', category: 'planning' },
            { id: 'backend-developer', category: 'development' },
            { id: 'frontend-developer', category: 'development' },
            { id: 'devops-engineer', category: 'development' },
            { id: 'senior-tester', category: 'qa' },
            { id: 'code-style-reviewer', category: 'qa' },
            { id: 'code-logic-reviewer', category: 'qa' },
            { id: 'researcher-expert', category: 'specialist' },
            { id: 'modernization-detector', category: 'specialist' },
            { id: 'technical-content-writer', category: 'creative' },
            { id: 'ui-ux-designer', category: 'creative' },
          ];

          const recommendations: AgentRecommendation[] = agentCatalog.map(
            ({ id: agentId, category }) => ({
              agentId,
              agentName: agentId
                .split('-')
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' '),
              category,
              relevanceScore: 100,
              recommended: true,
              matchedCriteria: [
                'Multi-phase analysis (all agents recommended)',
              ],
              description: `Agent for ${agentId.replace(/-/g, ' ')} tasks`,
            })
          );

          this.logger.info('All 13 agents recommended (multi-phase)', {
            totalAgents: recommendations.length,
          });

          return recommendations;
        }

        // ---- Legacy path: Zod validation + scoring ----
        const validationResult =
          ProjectAnalysisZodSchema.safeParse(rawAnalysis);

        if (!validationResult.success) {
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

        type RecommendationServiceType = {
          calculateRecommendations: (
            analysis: DeepProjectAnalysis
          ) => AgentRecommendation[];
        };

        let recommendationService: RecommendationServiceType;

        try {
          recommendationService =
            this.resolveService<RecommendationServiceType>(
              AGENT_GENERATION_TOKENS.AGENT_RECOMMENDATION_SERVICE,
              'AgentRecommendationService'
            );
        } catch {
          this.logger.debug(
            'AgentRecommendationService not registered via token, using direct class resolution'
          );
          recommendationService =
            this.resolveService<RecommendationServiceType>(
              AgentRecommendationService as unknown as symbol,
              'AgentRecommendationService (direct)'
            );
        }

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
   * wizard:cancel-analysis - Cancel a running workspace analysis
   *
   * TASK_2025_154 wiring: Cancels both MultiPhaseAnalysisService and
   * AgenticAnalysisService (whichever is active). Safe to call even
   * if no analysis is running (no-op in that case).
   */
  private registerCancelAnalysis(): void {
    this.rpcHandler.registerMethod<void, { cancelled: boolean }>(
      'wizard:cancel-analysis',
      async () => {
        this.logger.debug('RPC: wizard:cancel-analysis called');

        let cancelled = false;

        // Cancel multi-phase analysis (primary path)
        try {
          const multiPhaseService = this.resolveService<{
            cancelAnalysis: () => void;
          }>(
            AGENT_GENERATION_TOKENS.MULTI_PHASE_ANALYSIS_SERVICE,
            'MultiPhaseAnalysisService'
          );

          multiPhaseService.cancelAnalysis();
          cancelled = true;
          this.logger.info('Multi-phase analysis cancellation requested');
        } catch (error) {
          this.logger.debug(
            'Could not cancel multi-phase analysis (may not be running)',
            {
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }

        // Also cancel legacy agentic analysis (fallback path)
        try {
          const agenticService = this.resolveService<{
            cancelAnalysis: () => void;
          }>(
            AGENT_GENERATION_TOKENS.AGENTIC_ANALYSIS_SERVICE,
            'AgenticAnalysisService'
          );

          agenticService.cancelAnalysis();
          cancelled = true;
          this.logger.info('Agentic analysis cancellation requested');
        } catch (error) {
          this.logger.debug(
            'Could not cancel agentic analysis (may not be running)',
            {
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }

        return { cancelled };
      }
    );
  }

  // ============================================================
  // Analysis History Handlers (Persistent Analysis)
  // ============================================================

  /**
   * wizard:list-analyses - List saved analyses from .claude/analysis/
   */
  private registerListAnalyses(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      { analyses: SavedAnalysisMetadata[] }
    >('wizard:list-analyses', async () => {
      this.logger.debug('RPC: wizard:list-analyses called');

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        return { analyses: [] };
      }

      const storageService = this.resolveService<AnalysisStorageService>(
        AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE,
        'AnalysisStorageService'
      );

      const analyses = await storageService.list(workspaceFolder.uri.fsPath);
      return { analyses };
    });
  }

  /**
   * wizard:load-analysis - Load a specific saved multi-phase analysis
   */
  private registerLoadAnalysis(): void {
    this.rpcHandler.registerMethod<
      { filename: string },
      MultiPhaseAnalysisResponse
    >('wizard:load-analysis', async (params) => {
      this.logger.debug('RPC: wizard:load-analysis called', {
        filename: params.filename,
      });

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new Error('No workspace folder open.');
      }

      const storageService = this.resolveService<AnalysisStorageService>(
        AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE,
        'AnalysisStorageService'
      );

      return storageService.loadMultiPhase(
        workspaceFolder.uri.fsPath,
        params.filename
      );
    });
  }
}
