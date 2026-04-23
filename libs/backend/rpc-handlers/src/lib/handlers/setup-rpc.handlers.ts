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
 * TASK_2025_203: Moved to @ptah-extension/rpc-handlers (replaced vscode.workspace.workspaceFolders with IWorkspaceProvider)
 */

import * as path from 'path';
import { injectable, inject, DependencyContainer } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  LicenseService,
  type LicenseStatus,
  ConfigManager,
} from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { CodeExecutionMCP } from '@ptah-extension/vscode-lm-tools';
import {
  PLATFORM_TOKENS,
  AgentPackDownloadService,
} from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
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
  NewProjectDiscoveryService,
  MasterPlanGenerationService,
  NewProjectStorageService,
} from '@ptah-extension/agent-generation';
import { SDK_TOKENS, PluginLoaderService } from '@ptah-extension/agent-sdk';
import type {
  MultiPhaseAnalysisResponse,
  SavedAnalysisMetadata,
  AgentCategory,
  WizardListAgentPacksParams,
  WizardListAgentPacksResult,
  WizardInstallPackAgentsParams,
  WizardInstallPackAgentsResult,
  WizardNewProjectSelectTypeParams,
  WizardNewProjectSelectTypeResult,
  WizardNewProjectSubmitAnswersParams,
  WizardNewProjectSubmitAnswersResult,
  WizardNewProjectGetPlanParams,
  WizardNewProjectGetPlanResult,
  WizardNewProjectApprovePlanParams,
  WizardNewProjectApprovePlanResult,
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
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject('DependencyContainer')
    private readonly container: DependencyContainer,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  /**
   * Safely resolve a service from the DI container with validation.
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
        `${serviceName} not available. Ensure the agent-generation module is properly initialized. Details: ${message}`,
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
        config.enabledPluginIds,
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
    this.registerListAgentPacks();
    this.registerInstallPackAgents();
    this.registerNewProjectSelectType();
    this.registerNewProjectSubmitAnswers();
    this.registerNewProjectGetPlan();
    this.registerNewProjectApprovePlan();

    this.logger.debug('Setup RPC handlers registered', {
      methods: [
        'setup-status:get-status',
        'setup-wizard:launch',
        'wizard:deep-analyze',
        'wizard:recommend-agents',
        'wizard:cancel-analysis',
        'wizard:list-analyses',
        'wizard:load-analysis',
        'wizard:list-agent-packs',
        'wizard:install-pack-agents',
        'wizard:new-project-select-type',
        'wizard:new-project-submit-answers',
        'wizard:new-project-get-plan',
        'wizard:new-project-approve-plan',
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

        const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
        if (!workspaceRoot) {
          throw new Error(
            'No workspace folder open. Please open a folder to configure agents.',
          );
        }

        const setupStatusService = this.resolveService<{
          getStatus: (workspacePath: string) => Promise<{
            isErr: () => boolean;
            value?: SetupStatusResponse;
            error?: Error;
          }>;
        }>(AGENT_GENERATION_TOKENS.SETUP_STATUS_SERVICE, 'SetupStatusService');

        const result = await setupStatusService.getStatus(workspaceRoot);

        if (result.isErr()) {
          this.logger.error('Failed to get setup status', result.error);
          throw new Error(
            result.error?.message || 'Failed to retrieve agent setup status',
          );
        }

        return result.value as SetupStatusResponse;
      },
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

        const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
        if (!workspaceRoot) {
          throw new Error(
            'No workspace folder open. Please open a folder first.',
          );
        }

        const setupWizardService = this.resolveService<{
          launchWizard: (workspacePath: string) => Promise<{
            isErr: () => boolean;
            error?: Error;
          }>;
        }>(AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE, 'SetupWizardService');

        const result = await setupWizardService.launchWizard(workspaceRoot);

        if (result.isErr()) {
          this.logger.error('Failed to launch setup wizard', result.error);
          throw new Error(
            result.error?.message || 'Failed to launch setup wizard',
          );
        }

        return { success: true };
      },
    );
  }

  /**
   * wizard:deep-analyze - Perform deep project analysis
   */
  private registerDeepAnalyze(): void {
    this.rpcHandler.registerMethod<
      { model?: string },
      MultiPhaseAnalysisResponse
    >('wizard:deep-analyze', async (params) => {
      this.logger.debug('RPC: wizard:deep-analyze called');

      const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        throw new Error(
          'No workspace folder open. Please open a folder to analyze.',
        );
      }

      let isPremium = false;
      let mcpServerRunning = false;
      let mcpPort: number | undefined;
      try {
        const licenseService = this.resolveService<LicenseService>(
          TOKENS.LICENSE_SERVICE,
          'LicenseService',
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
          'CodeExecutionMCP',
        );
        const actualPort = codeExecutionMcp.getPort();
        mcpServerRunning = actualPort !== null;
        mcpPort = actualPort ?? undefined;
      } catch (error) {
        this.logger.debug(
          'Could not resolve license/MCP services for analysis',
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }

      if (!isPremium || !mcpServerRunning) {
        throw new Error(
          'Premium license and MCP server required for workspace analysis.',
        );
      }

      const currentModel =
        params?.model ||
        this.configManager.get<string>('model.selected') ||
        'default';

      const pluginPaths = this.resolvePluginPaths(isPremium);

      const multiPhaseService = this.resolveService<{
        analyzeWorkspace: (
          workspacePath: string,
          options?: {
            model?: string;
            isPremium?: boolean;
            mcpServerRunning?: boolean;
            mcpPort?: number;
            pluginPaths?: string[];
          },
        ) => Promise<Result<MultiPhaseManifest, Error>>;
      }>(
        AGENT_GENERATION_TOKENS.MULTI_PHASE_ANALYSIS_SERVICE,
        'MultiPhaseAnalysisService',
      );

      const multiPhaseResult = await multiPhaseService.analyzeWorkspace(
        workspaceRoot,
        {
          model: currentModel,
          isPremium,
          mcpServerRunning,
          mcpPort,
          pluginPaths,
        },
      );

      if (multiPhaseResult.isErr() || !multiPhaseResult.value) {
        throw new Error(
          multiPhaseResult.error?.message ||
            'Multi-phase analysis failed. Please try again.',
        );
      }

      const manifest = multiPhaseResult.value;

      const storageService = this.resolveService<AnalysisStorageService>(
        AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE,
        'AnalysisStorageService',
      );

      const slugDir = storageService.getSlugDir(workspaceRoot, manifest.slug);

      const phaseContents: Record<string, string> = {};
      for (const [phaseId, phaseResult] of Object.entries(manifest.phases)) {
        if (phaseResult.status === 'completed') {
          const content = await storageService.readPhaseFile(
            slugDir,
            phaseResult.file,
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
   */
  private registerRecommendAgents(): void {
    this.rpcHandler.registerMethod<unknown, AgentRecommendation[]>(
      'wizard:recommend-agents',
      async (rawAnalysis) => {
        this.logger.debug('RPC: wizard:recommend-agents called');

        if (!rawAnalysis) {
          throw new Error(
            'Missing analysis input. Please run wizard:deep-analyze first.',
          );
        }

        const input = rawAnalysis as Record<string, unknown>;
        if (input['isMultiPhase'] === true) {
          this.logger.info(
            'Multi-phase analysis detected, returning all agents recommended',
          );

          const agentCatalog: Array<{
            id: string;
            name: string;
            description: string;
            category: AgentCategory;
          }> = [
            {
              id: 'project-manager',
              name: 'Project Manager',
              description:
                'Analyzes requirements, creates task descriptions, and validates delivery',
              category: 'planning',
            },
            {
              id: 'software-architect',
              name: 'Software Architect',
              description:
                'Investigates codebase, designs implementation plans, and defines architecture',
              category: 'planning',
            },
            {
              id: 'team-leader',
              name: 'Team Leader',
              description:
                'Decomposes plans into tasks, coordinates developers, and manages batches',
              category: 'planning',
            },
            {
              id: 'backend-developer',
              name: 'Backend Developer',
              description:
                'Implements APIs, database logic, business services, and server-side code',
              category: 'development',
            },
            {
              id: 'frontend-developer',
              name: 'Frontend Developer',
              description:
                'Implements UI components, handles state management, and builds responsive interfaces',
              category: 'development',
            },
            {
              id: 'devops-engineer',
              name: 'DevOps Engineer',
              description:
                'Manages CI/CD pipelines, containerization, deployment, and infrastructure',
              category: 'development',
            },
            {
              id: 'senior-tester',
              name: 'Senior Tester',
              description:
                'Creates comprehensive test suites, verifies implementations, and ensures quality',
              category: 'qa',
            },
            {
              id: 'code-style-reviewer',
              name: 'Code Style Reviewer',
              description:
                'Reviews code for formatting, naming conventions, and style consistency',
              category: 'qa',
            },
            {
              id: 'code-logic-reviewer',
              name: 'Code Logic Reviewer',
              description:
                'Reviews business logic, identifies bugs, and validates implementation correctness',
              category: 'qa',
            },
            {
              id: 'researcher-expert',
              name: 'Researcher Expert',
              description:
                'Investigates technologies, researches solutions, and provides technical guidance',
              category: 'specialist',
            },
            {
              id: 'modernization-detector',
              name: 'Modernization Detector',
              description:
                'Identifies outdated patterns, suggests improvements, and detects technical debt',
              category: 'specialist',
            },
            {
              id: 'technical-content-writer',
              name: 'Technical Content Writer',
              description:
                'Creates documentation, blog posts, video scripts, and marketing content',
              category: 'creative',
            },
            {
              id: 'ui-ux-designer',
              name: 'UI/UX Designer',
              description:
                'Designs user interfaces, creates visual specifications, and improves user experience',
              category: 'creative',
            },
          ];

          const recommendations: AgentRecommendation[] = agentCatalog.map(
            ({ id: agentId, name, description, category }) => ({
              agentId,
              agentName: name,
              category,
              relevanceScore: 100,
              recommended: true,
              matchedCriteria: [
                'Deep codebase analysis',
                'All agents recommended',
              ],
              description,
            }),
          );

          this.logger.info('All 13 agents recommended (multi-phase)', {
            totalAgents: recommendations.length,
          });

          return recommendations;
        }

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

        const analysis = normalizeAgentOutput(validationResult.data);

        this.logger.debug('Analysis input validated and normalized', {
          projectType: String(analysis.projectType),
          frameworkCount: analysis.frameworks.length,
          patternCount: analysis.architecturePatterns.length,
          hasKeyFileLocations: !!analysis.keyFileLocations,
        });

        type RecommendationServiceType = {
          calculateRecommendations: (
            analysis: DeepProjectAnalysis,
          ) => AgentRecommendation[];
        };

        let recommendationService: RecommendationServiceType;

        try {
          recommendationService =
            this.resolveService<RecommendationServiceType>(
              AGENT_GENERATION_TOKENS.AGENT_RECOMMENDATION_SERVICE,
              'AgentRecommendationService',
            );
        } catch {
          this.logger.debug(
            'AgentRecommendationService not registered via token, using direct class resolution',
          );
          recommendationService =
            this.resolveService<RecommendationServiceType>(
              AgentRecommendationService as unknown as symbol,
              'AgentRecommendationService (direct)',
            );
        }

        const recommendations =
          recommendationService.calculateRecommendations(analysis);

        this.logger.info('Agent recommendations calculated', {
          totalAgents: recommendations.length,
          recommendedCount: recommendations.filter((r) => r.recommended).length,
        });

        return recommendations;
      },
    );
  }

  /**
   * wizard:cancel-analysis - Cancel a running workspace analysis
   */
  private registerCancelAnalysis(): void {
    this.rpcHandler.registerMethod<void, { cancelled: boolean }>(
      'wizard:cancel-analysis',
      async () => {
        this.logger.debug('RPC: wizard:cancel-analysis called');

        let cancelled = false;

        try {
          const multiPhaseService = this.resolveService<{
            cancelAnalysis: () => void;
          }>(
            AGENT_GENERATION_TOKENS.MULTI_PHASE_ANALYSIS_SERVICE,
            'MultiPhaseAnalysisService',
          );

          multiPhaseService.cancelAnalysis();
          cancelled = true;
          this.logger.info('Multi-phase analysis cancellation requested');
        } catch (error) {
          this.logger.debug(
            'Could not cancel multi-phase analysis (may not be running)',
            {
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }

        try {
          const agenticService = this.resolveService<{
            cancelAnalysis: () => void;
          }>(
            AGENT_GENERATION_TOKENS.AGENTIC_ANALYSIS_SERVICE,
            'AgenticAnalysisService',
          );

          agenticService.cancelAnalysis();
          cancelled = true;
          this.logger.info('Agentic analysis cancellation requested');
        } catch (error) {
          this.logger.debug(
            'Could not cancel agentic analysis (may not be running)',
            {
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }

        return { cancelled };
      },
    );
  }

  /**
   * wizard:list-analyses - List saved analyses from .ptah/analysis/
   */
  private registerListAnalyses(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      { analyses: SavedAnalysisMetadata[] }
    >('wizard:list-analyses', async () => {
      this.logger.debug('RPC: wizard:list-analyses called');

      const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        return { analyses: [] };
      }

      const storageService = this.resolveService<AnalysisStorageService>(
        AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE,
        'AnalysisStorageService',
      );

      const analyses = await storageService.list(workspaceRoot);
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

      const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        throw new Error('No workspace folder open.');
      }

      const storageService = this.resolveService<AnalysisStorageService>(
        AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE,
        'AnalysisStorageService',
      );

      const safeFilename = path.basename(params.filename);
      return storageService.loadMultiPhase(workspaceRoot, safeFilename);
    });
  }

  /** Singleton AgentPackDownloadService — preserves deduplication and cache serialization */
  private agentPackService: AgentPackDownloadService | null = null;

  private getAgentPackService(): AgentPackDownloadService {
    if (!this.agentPackService) {
      this.agentPackService = new AgentPackDownloadService();
    }
    return this.agentPackService;
  }

  /**
   * wizard:list-agent-packs - List available community agent packs
   */
  private registerListAgentPacks(): void {
    this.rpcHandler.registerMethod<
      WizardListAgentPacksParams,
      WizardListAgentPacksResult
    >('wizard:list-agent-packs', async () => {
      this.logger.debug('RPC: wizard:list-agent-packs called');

      const packs = await this.getAgentPackService().listCuratedPacks();
      return { packs };
    });
  }

  /**
   * wizard:install-pack-agents - Install agents from a community pack
   */
  private registerInstallPackAgents(): void {
    this.rpcHandler.registerMethod<
      WizardInstallPackAgentsParams,
      WizardInstallPackAgentsResult
    >('wizard:install-pack-agents', async (params) => {
      this.logger.debug('RPC: wizard:install-pack-agents called', {
        source: params.source,
        agentFileCount: params.agentFiles.length,
      });

      // Validate source URL against curated pack list to prevent arbitrary downloads
      const packService = this.getAgentPackService();
      const curatedPacks = await packService.listCuratedPacks();
      const isAllowedSource = curatedPacks.some(
        (pack) => pack.source === params.source,
      );
      if (!isAllowedSource) {
        throw new Error(
          `Untrusted agent pack source: "${params.source}". Only curated sources are allowed.`,
        );
      }

      const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        throw new Error('No workspace folder open.');
      }

      const path = await import('path');
      const targetDir = path.join(workspaceRoot, '.claude', 'agents');

      return packService.downloadAgents(
        params.source,
        params.agentFiles,
        targetDir,
      );
    });
  }

  // ============================================================
  // New Project Wizard Handlers
  // ============================================================

  /**
   * wizard:new-project-select-type - Get question groups for a project type
   */
  private registerNewProjectSelectType(): void {
    this.rpcHandler.registerMethod<
      WizardNewProjectSelectTypeParams,
      WizardNewProjectSelectTypeResult
    >('wizard:new-project-select-type', async (params) => {
      this.logger.debug('RPC: wizard:new-project-select-type called', {
        projectType: params.projectType,
      });

      const discoveryService = this.resolveService<NewProjectDiscoveryService>(
        AGENT_GENERATION_TOKENS.NEW_PROJECT_DISCOVERY_SERVICE,
        'NewProjectDiscoveryService',
      );

      const groups = discoveryService.getQuestionGroups(params.projectType);
      return { groups };
    });
  }

  /**
   * wizard:new-project-submit-answers - Validate answers and generate master plan
   */
  private registerNewProjectSubmitAnswers(): void {
    this.rpcHandler.registerMethod<
      WizardNewProjectSubmitAnswersParams,
      WizardNewProjectSubmitAnswersResult
    >('wizard:new-project-submit-answers', async (params) => {
      this.logger.debug('RPC: wizard:new-project-submit-answers called', {
        projectType: params.projectType,
        projectName: params.projectName,
        answerCount: Object.keys(params.answers).length,
      });

      // 1. Resolve workspace root early (needed for storage check and plan save)
      const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        throw new Error(
          'No workspace folder open. Please open a folder first.',
        );
      }

      const storageService = this.resolveService<NewProjectStorageService>(
        AGENT_GENERATION_TOKENS.NEW_PROJECT_STORAGE_SERVICE,
        'NewProjectStorageService',
      );

      // 2. Handle existing plan: skip if idempotent retry, delete if force regeneration
      if (params.force) {
        await storageService.deletePlan(workspaceRoot);
        this.logger.info('Force regeneration requested, deleted existing plan');
      } else {
        const existingPlan = await storageService.loadPlan(workspaceRoot);
        if (existingPlan) {
          this.logger.info(
            'Existing master plan found on disk, skipping LLM regeneration',
            { projectName: existingPlan.projectName },
          );
          return { success: true };
        }
      }

      // 3. Validate answers
      const discoveryService = this.resolveService<NewProjectDiscoveryService>(
        AGENT_GENERATION_TOKENS.NEW_PROJECT_DISCOVERY_SERVICE,
        'NewProjectDiscoveryService',
      );

      const validation = discoveryService.validateAnswers(
        params.projectType,
        params.answers,
      );

      if (!validation.valid) {
        return {
          success: false,
          error: `Missing required fields: ${validation.missingFields.join(', ')}`,
        };
      }

      // 4. Generate master plan via LLM
      const generationService =
        this.resolveService<MasterPlanGenerationService>(
          AGENT_GENERATION_TOKENS.MASTER_PLAN_GENERATION_SERVICE,
          'MasterPlanGenerationService',
        );

      const plan = await generationService.generatePlan(
        params.projectType,
        params.answers,
        params.projectName,
        workspaceRoot,
      );

      // 5. Save plan to workspace
      await storageService.savePlan(workspaceRoot, plan);

      this.logger.info('New project master plan generated and saved', {
        projectName: plan.projectName,
        phaseCount: plan.phases.length,
        totalTasks: plan.phases.reduce((sum, p) => sum + p.tasks.length, 0),
      });

      return { success: true };
    });
  }

  /**
   * wizard:new-project-get-plan - Load previously generated master plan
   */
  private registerNewProjectGetPlan(): void {
    this.rpcHandler.registerMethod<
      WizardNewProjectGetPlanParams,
      WizardNewProjectGetPlanResult
    >('wizard:new-project-get-plan', async () => {
      this.logger.debug('RPC: wizard:new-project-get-plan called');

      const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        throw new Error('No workspace folder open.');
      }

      const storageService = this.resolveService<NewProjectStorageService>(
        AGENT_GENERATION_TOKENS.NEW_PROJECT_STORAGE_SERVICE,
        'NewProjectStorageService',
      );

      const plan = await storageService.loadPlan(workspaceRoot);

      if (!plan) {
        throw new Error(
          'No master plan found. Please submit answers first to generate a plan.',
        );
      }

      return { plan };
    });
  }

  /**
   * wizard:new-project-approve-plan - Finalize and persist the master plan
   */
  private registerNewProjectApprovePlan(): void {
    this.rpcHandler.registerMethod<
      WizardNewProjectApprovePlanParams,
      WizardNewProjectApprovePlanResult
    >('wizard:new-project-approve-plan', async (params) => {
      this.logger.debug('RPC: wizard:new-project-approve-plan called', {
        approved: params.approved,
      });

      if (!params.approved) {
        return { success: false, planPath: '' };
      }

      const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        throw new Error('No workspace folder open.');
      }

      const storageService = this.resolveService<NewProjectStorageService>(
        AGENT_GENERATION_TOKENS.NEW_PROJECT_STORAGE_SERVICE,
        'NewProjectStorageService',
      );

      // Load and re-save to confirm persistence (idempotent)
      const plan = await storageService.loadPlan(workspaceRoot);
      if (!plan) {
        throw new Error(
          'No master plan found to approve. Please generate a plan first.',
        );
      }

      const planPath = await storageService.savePlan(workspaceRoot, plan);

      this.logger.info('Master plan approved', {
        projectName: plan.projectName,
        planPath,
      });

      return { success: true, planPath };
    });
  }
}
