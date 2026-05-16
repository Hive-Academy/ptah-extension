/**
 * Setup RPC Handlers
 *
 * Handles setup-related RPC methods:
 * - setup-status:get-status - Get agent configuration status
 * - setup-wizard:launch - Launch setup wizard webview
 * - wizard:deep-analyze - Perform deep project analysis
 * - wizard:recommend-agents - Calculate agent recommendations
 */

import * as path from 'path';
import { injectable, inject, DependencyContainer } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  RpcUserError,
  TOKENS,
  LicenseService,
  type LicenseStatus,
} from '@ptah-extension/vscode-core';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import type { ModelSettings } from '@ptah-extension/settings-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { CodeExecutionMCP } from '@ptah-extension/vscode-lm-tools';
import {
  PLATFORM_TOKENS,
  AgentPackDownloadService,
} from '@ptah-extension/platform-core';
import type {
  IWorkspaceProvider,
  IPlatformCommands,
  IFileSystemProvider,
  IMemoryWriter,
  MemoryWriteRequest,
} from '@ptah-extension/platform-core';
import { deriveWorkspaceFingerprint } from '@ptah-extension/memory-curator';
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
import {
  SDK_TOKENS,
  PluginLoaderService,
  SkillJunctionService,
} from '@ptah-extension/agent-sdk';
import type {
  MultiPhaseAnalysisResponse,
  SavedAnalysisMetadata,
  AgentCategory,
  WizardListAgentPacksParams,
  WizardListAgentPacksResult,
  WizardInstallPackAgentsParams,
  WizardInstallPackAgentsResult,
  WizardStartNewProjectChatParams,
  WizardStartNewProjectChatResult,
} from '@ptah-extension/shared';
import { MESSAGE_TYPES, Result } from '@ptah-extension/shared';
import type { MultiPhaseManifest } from '@ptah-extension/agent-generation';
import type { RpcMethodName } from '@ptah-extension/shared';
import type { WebviewBroadcaster } from '../harness/streaming';
import { isAuthorizedWorkspace } from '../utils/workspace-authorization';

/**
 * Plugin id of the SaaS workspace initializer skill pack — auto-enabled when
 * `wizard:start-new-project-chat` runs so the seeded chat session has
 * `saas-workspace-initializer` discoverable in `.claude/skills/`.
 */
const SAAS_WORKSPACE_INITIALIZER_PLUGIN_ID = 'ptah-nx-saas';

/**
 * Verbatim seed prompt posted as the first user turn after the wizard hands
 * off to the chat view. The skill name and Stage A wording are load-bearing —
 * the saas-workspace-initializer skill keys off them.
 */
const NEW_PROJECT_CHAT_SEED_PROMPT =
  "I'm starting a new SaaS project. Use the saas-workspace-initializer skill " +
  'to drive Stage A — discovery, write the roadmap to .ptah/roadmap.md, then ' +
  'scaffold the foundation. Stop after foundation; remaining roadmap items ' +
  'run in separate sessions.';

/** ViewType of the wizard webview panel — must match SetupWizardService. */
const WIZARD_VIEW_TYPE = 'ptah.setupWizard';

/**
 * Local interface for the wizard webview lifecycle service we need
 * (just `disposeWebview`). Resolved dynamically because it is registered
 * in `agent-generation`.
 */
interface WizardWebviewLifecycleLike {
  disposeWebview(viewType: string): void;
}

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
  static readonly METHODS = [
    'setup-status:get-status',
    'setup-wizard:launch',
    'wizard:deep-analyze',
    'wizard:recommend-agents',
    'wizard:cancel-analysis',
    'wizard:list-analyses',
    'wizard:load-analysis',
    'wizard:list-agent-packs',
    'wizard:install-pack-agents',
    'wizard:start-new-project-chat',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SETTINGS_TOKENS.MODEL_SETTINGS)
    private readonly modelSettings: ModelSettings,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
    private readonly pluginLoader: PluginLoaderService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.DI_CONTAINER)
    private readonly container: DependencyContainer,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(TOKENS.PLATFORM_COMMANDS)
    private readonly platformCommands: IPlatformCommands,
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
    this.registerStartNewProjectChat();

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
        'wizard:start-new-project-chat',
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
          throw new RpcUserError(
            'No workspace folder open. Please open a folder to configure agents.',
            'WORKSPACE_NOT_OPEN',
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
          throw new RpcUserError(
            'No workspace folder open. Please open a folder first.',
            'WORKSPACE_NOT_OPEN',
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
      { model?: string; workspacePath?: string },
      MultiPhaseAnalysisResponse
    >('wizard:deep-analyze', async (params) => {
      this.logger.debug('RPC: wizard:deep-analyze called');

      const workspaceRoot =
        params?.workspacePath || this.workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        throw new RpcUserError(
          'No workspace folder open. Please open a folder to analyze.',
          'WORKSPACE_NOT_OPEN',
        );
      }
      if (
        params?.workspacePath &&
        !isAuthorizedWorkspace(params.workspacePath, this.workspaceProvider)
      ) {
        throw new RpcUserError(
          'Access denied: workspace path is not an open folder.',
          'UNAUTHORIZED_WORKSPACE',
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
        params?.model || this.modelSettings.selectedModel.get() || 'default';

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

      // Seed memory from finalized analysis (non-blocking, non-fatal).
      // MUST run after phaseContents is built so seed content can pull from
      // phase markdown. MUST run before `return response` so the seed observes
      // the same data the frontend sees. NO exception escapes `seedWizardMemory`
      // — analysis response always reaches the RPC caller.
      try {
        await this.seedWizardMemory(workspaceRoot, manifest, phaseContents);
      } catch (error) {
        this.logger.warn('[SetupWizard] Memory seeding failed (non-fatal)', {
          error: error instanceof Error ? error.message : String(error),
          stage: 'outer-guard',
          workspaceRoot,
        });
      }

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
      { workspacePath?: string },
      { analyses: SavedAnalysisMetadata[] }
    >('wizard:list-analyses', async (params) => {
      this.logger.debug('RPC: wizard:list-analyses called');

      const workspaceRoot =
        params?.workspacePath || this.workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        return { analyses: [] };
      }
      if (
        params?.workspacePath &&
        !isAuthorizedWorkspace(params.workspacePath, this.workspaceProvider)
      ) {
        throw new RpcUserError(
          'Access denied: workspace path is not an open folder.',
          'UNAUTHORIZED_WORKSPACE',
        );
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
      { filename: string; workspacePath?: string },
      MultiPhaseAnalysisResponse
    >('wizard:load-analysis', async (params) => {
      this.logger.debug('RPC: wizard:load-analysis called', {
        filename: params.filename,
      });

      const workspaceRoot =
        params?.workspacePath || this.workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        throw new RpcUserError(
          'No workspace folder open.',
          'WORKSPACE_NOT_OPEN',
        );
      }
      if (
        params?.workspacePath &&
        !isAuthorizedWorkspace(params.workspacePath, this.workspaceProvider)
      ) {
        throw new RpcUserError(
          'Access denied: workspace path is not an open folder.',
          'UNAUTHORIZED_WORKSPACE',
        );
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

      const workspaceRoot =
        params?.workspacePath || this.workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        throw new RpcUserError(
          'No workspace folder open.',
          'WORKSPACE_NOT_OPEN',
        );
      }
      if (
        params?.workspacePath &&
        !isAuthorizedWorkspace(params.workspacePath, this.workspaceProvider)
      ) {
        throw new RpcUserError(
          'Access denied: workspace path is not an open folder.',
          'UNAUTHORIZED_WORKSPACE',
        );
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
  // New Project Chat Handoff
  // ============================================================

  /**
   * wizard:start-new-project-chat — hand the New Project flow off to the
   * chat view with the saas-workspace-initializer skill primed.
   *
   * Steps:
   *   1. Ensure the `ptah-nx-saas` plugin is enabled in the workspace plugin
   *      config (via PluginLoaderService.saveWorkspacePluginConfig).
   *   2. If the plugin set changed, refresh `.claude/skills/` junctions via
   *      SkillJunctionService.createJunctions(...).
   *   3. Focus the chat view (IPlatformCommands.focusChat — VS Code uses
   *      `ptah.main.focus`, Electron broadcasts SWITCH_VIEW, CLI is no-op).
   *   4. Broadcast SETUP_WIZARD_START_NEW_PROJECT_CHAT to the webview with
   *      the verbatim seed prompt — the frontend creates a chat tab and
   *      issues `chat:start` with the prompt as the first user turn.
   *   5. Dispose the wizard webview panel (mirrors wizard:cancel cleanup).
   */
  private registerStartNewProjectChat(): void {
    this.rpcHandler.registerMethod<
      WizardStartNewProjectChatParams,
      WizardStartNewProjectChatResult
    >('wizard:start-new-project-chat', async () => {
      this.logger.debug('RPC: wizard:start-new-project-chat called');

      try {
        // ---- Step 1: enable ptah-nx-saas plugin if not already enabled ----
        const config = this.pluginLoader.getWorkspacePluginConfig();
        const enabled = new Set(config.enabledPluginIds);
        let pluginConfigChanged = false;
        if (!enabled.has(SAAS_WORKSPACE_INITIALIZER_PLUGIN_ID)) {
          enabled.add(SAAS_WORKSPACE_INITIALIZER_PLUGIN_ID);
          await this.pluginLoader.saveWorkspacePluginConfig({
            enabledPluginIds: Array.from(enabled),
            disabledSkillIds: config.disabledSkillIds,
          });
          pluginConfigChanged = true;
          this.logger.info(
            '[wizard:start-new-project-chat] Enabled ptah-nx-saas plugin for workspace',
          );
        }

        // ---- Step 2: refresh skill junctions when plugin set changed ----
        if (pluginConfigChanged) {
          try {
            const skillJunction = this.resolveService<SkillJunctionService>(
              SDK_TOKENS.SDK_SKILL_JUNCTION,
              'SkillJunctionService',
            );
            const refreshedConfig =
              this.pluginLoader.getWorkspacePluginConfig();
            const pluginPaths = this.pluginLoader.resolvePluginPaths(
              refreshedConfig.enabledPluginIds,
            );
            const junctionResult = skillJunction.createJunctions(
              pluginPaths,
              refreshedConfig.disabledSkillIds,
            );
            this.logger.debug(
              '[wizard:start-new-project-chat] Skill junctions refreshed',
              {
                created: junctionResult.created,
                skipped: junctionResult.skipped,
                removed: junctionResult.removed,
                errorCount: junctionResult.errors.length,
              },
            );
          } catch (error: unknown) {
            this.logger.warn(
              '[wizard:start-new-project-chat] Failed to refresh skill junctions (non-fatal)',
              {
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        }

        // ---- Step 3: focus the chat view via the platform port ----
        try {
          await this.platformCommands.focusChat();
        } catch (error: unknown) {
          this.logger.warn(
            '[wizard:start-new-project-chat] focusChat failed (non-fatal)',
            {
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }

        // ---- Step 4: broadcast the seed-message envelope to the webview ----
        try {
          const webviewManager = this.resolveService<WebviewBroadcaster>(
            TOKENS.WEBVIEW_MANAGER,
            'WebviewManager',
          );
          await webviewManager.broadcastMessage(
            MESSAGE_TYPES.SETUP_WIZARD_START_NEW_PROJECT_CHAT,
            { prompt: NEW_PROJECT_CHAT_SEED_PROMPT },
          );
        } catch (error: unknown) {
          // Without a webview broadcaster (e.g. CLI) the seed turn cannot be
          // delivered automatically — surface as a soft failure so callers
          // can retry, but do not throw.
          this.logger.warn(
            '[wizard:start-new-project-chat] Failed to broadcast seed prompt',
            {
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }

        // ---- Step 5: dispose the wizard webview panel ----
        try {
          const wizardLifecycle =
            this.resolveService<WizardWebviewLifecycleLike>(
              AGENT_GENERATION_TOKENS.WIZARD_WEBVIEW_LIFECYCLE,
              'WizardWebviewLifecycleService',
            );
          wizardLifecycle.disposeWebview(WIZARD_VIEW_TYPE);
        } catch (error: unknown) {
          this.logger.debug(
            '[wizard:start-new-project-chat] Wizard panel dispose skipped (non-fatal)',
            {
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }

        return { success: true };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          '[wizard:start-new-project-chat] Failed to hand off to chat',
          error instanceof Error ? error : new Error(message),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(message),
          {
            errorSource: 'SetupRpcHandlers.registerStartNewProjectChat',
          },
        );
        return { success: false, error: message };
      }
    });
  }

  // ============================================================
  // Wizard memory seeding
  // ============================================================

  /**
   * Seed three memory entries (project-profile, code-conventions, key-files)
   * from a finalized multi-phase analysis. Non-blocking and non-fatal — the
   * caller awaits this but any failure is logged and swallowed so the wizard
   * analysis response always reaches the RPC caller.
   *
   * Layered safety (plan §3.8):
   *  1. Resolution guard — `resolveMemoryWriterOrNull()` returns null when no
   *     adapter is registered (current VS Code state) → log skip + return.
   *  2. Fingerprint guard — try/catch around `deriveWorkspaceFingerprint`.
   *  3. Per-seed try/catch — each upsert is independent.
   */
  private async seedWizardMemory(
    workspaceRoot: string,
    manifest: MultiPhaseManifest,
    phaseContents: Record<string, string>,
  ): Promise<void> {
    const writer = this.resolveMemoryWriterOrNull();
    if (!writer) {
      this.logger.info(
        '[SetupWizard] Memory seeding skipped (store unavailable)',
      );
      return;
    }

    let fingerprintResult: Awaited<
      ReturnType<typeof deriveWorkspaceFingerprint>
    >;
    try {
      const fs = this.resolveService<IFileSystemProvider>(
        PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER,
        'IFileSystemProvider',
      );
      fingerprintResult = await deriveWorkspaceFingerprint(workspaceRoot, fs);
    } catch (error: unknown) {
      this.logger.warn('[SetupWizard] Memory seeding failed (non-fatal)', {
        error: error instanceof Error ? error.message : String(error),
        stage: 'fingerprint',
      });
      return;
    }

    if (fingerprintResult.source === 'path') {
      this.logger.info(
        '[SetupWizard] Workspace fingerprint falling back to path; memories will not survive moves',
        { workspaceRoot },
      );
    }

    const seeds: ReadonlyArray<MemoryWriteRequest> = [
      {
        workspaceFingerprint: fingerprintResult.fp,
        workspaceRoot,
        subject: 'project-profile',
        content: this.buildProjectProfileContent(manifest, phaseContents),
        tier: 'core',
        kind: 'preference',
        pinned: true,
        salience: 1.0,
        decayRate: 0,
      },
      {
        workspaceFingerprint: fingerprintResult.fp,
        workspaceRoot,
        subject: 'code-conventions',
        content: this.buildCodeConventionsContent(manifest, phaseContents),
        tier: 'core',
        kind: 'preference',
        pinned: true,
        salience: 1.0,
        decayRate: 0,
      },
      {
        workspaceFingerprint: fingerprintResult.fp,
        workspaceRoot,
        subject: 'key-files',
        content: this.buildKeyFilesContent(manifest, phaseContents),
        tier: 'recall',
        kind: 'entity',
        pinned: false,
        salience: 0.6,
        decayRate: 0.01,
      },
    ];

    let inserted = 0;
    let replaced = 0;
    let unchanged = 0;
    for (const req of seeds) {
      try {
        const result = await writer.upsert(req);
        if (result.status === 'inserted') inserted++;
        else if (result.status === 'replaced') replaced++;
        else unchanged++;
      } catch (error: unknown) {
        this.logger.warn('[SetupWizard] Memory seeding failed (non-fatal)', {
          error: error instanceof Error ? error.message : String(error),
          subject: req.subject,
          workspaceRoot,
        });
        // Continue to next seed; one failure does not abort the others.
      }
    }

    this.logger.info(
      `[SetupWizard] Seeded ${inserted + replaced + unchanged} memory entries for workspace ${workspaceRoot}`,
      {
        inserted,
        replaced,
        unchanged,
        fingerprintSource: fingerprintResult.source,
      },
    );
  }

  /**
   * Resolve the IMemoryWriter port lazily. Returns null when no adapter is
   * registered (graceful no-op for VS Code without SQLite today).
   */
  private resolveMemoryWriterOrNull(): IMemoryWriter | null {
    try {
      return this.container.resolve<IMemoryWriter>(
        PLATFORM_TOKENS.MEMORY_WRITER,
      );
    } catch {
      return null;
    }
  }

  // ----- Content builders (plan §3.6) ---------------------------------------
  // Multi-phase output is LLM-authored markdown — not structured JSON. The
  // builders use tolerant regex/section extraction with safe fallbacks; if a
  // section is missing they emit `(not detected)` rather than throw.

  private buildProjectProfileContent(
    manifest: MultiPhaseManifest,
    phaseContents: Record<string, string>,
  ): string {
    const md = phaseContents['project-profile'] ?? '';
    const slug = manifest.slug;
    const sourceLine = `Source: .ptah/analysis/${slug}/project-profile.md`;

    if (!md) {
      const out =
        `## Project Profile\n` +
        `Type: (not detected)\n` +
        `Frameworks: (not detected)\n` +
        `Monorepo: (not detected)\n` +
        `Tech stack: (not detected)\n` +
        `Architecture patterns: (not detected)\n` +
        sourceLine;
      return capUtf8(out, 1500);
    }

    // H1 → Type
    const h1 = /^#\s+(.+?)\s*$/m.exec(md);
    const typeLine = h1 ? h1[1].trim() : '(not detected)';

    // Bold-prefix lines: **Frameworks**: …
    const grabBoldLine = (label: string): string | null => {
      const re = new RegExp(
        `^\\s*[*-]?\\s*\\*\\*${label}\\*\\*\\s*:\\s*(.+?)\\s*$`,
        'mi',
      );
      const m = re.exec(md);
      return m ? m[1].trim() : null;
    };

    const frameworksRaw = grabBoldLine('Frameworks');
    const monorepoRaw = grabBoldLine('Monorepo');
    const techStackRaw =
      grabBoldLine('Tech Stack') ?? grabBoldLine('Tech stack');

    const frameworksLine = truncateList(frameworksRaw) ?? '(not detected)';
    const monorepoLine = monorepoRaw ?? 'none';
    const techStackLine = truncateList(techStackRaw) ?? '(not detected)';

    // First paragraph after `## Architecture` → Architecture patterns
    let archLine = '(not detected)';
    const archHeadMatch =
      /^##\s+Architecture\b[^\n]*\n+([\s\S]*?)(?:\n#{1,6}\s|$)/m.exec(md);
    if (archHeadMatch) {
      const body = archHeadMatch[1].trim();
      // First non-empty paragraph
      const firstPara = body.split(/\n\s*\n/)[0]?.trim() ?? '';
      if (firstPara) {
        const oneLine = firstPara.replace(/\s+/g, ' ').trim();
        archLine = oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine;
      }
    }

    const out =
      `## Project Profile\n` +
      `Type: ${typeLine}\n` +
      `Frameworks: ${frameworksLine}\n` +
      `Monorepo: ${monorepoLine}\n` +
      `Tech stack: ${techStackLine}\n` +
      `Architecture patterns: ${archLine}\n` +
      sourceLine;

    return capUtf8(out, 1500);
  }

  private buildCodeConventionsContent(
    manifest: MultiPhaseManifest,
    phaseContents: Record<string, string>,
  ): string {
    // Search quality-audit first, then architecture-assessment.
    const candidates: Array<{ phase: string; file: string; md: string }> = [
      {
        phase: 'quality-audit',
        file: manifest.phases['quality-audit']?.file ?? '03-quality-audit.md',
        md: phaseContents['quality-audit'] ?? '',
      },
      {
        phase: 'architecture-assessment',
        file:
          manifest.phases['architecture-assessment']?.file ??
          '02-architecture-assessment.md',
        md: phaseContents['architecture-assessment'] ?? '',
      },
    ];

    for (const c of candidates) {
      if (!c.md) continue;
      const section = extractH2Section(c.md, [
        'Code Conventions',
        'Coding Standards',
      ]);
      if (!section) continue;
      const bullets = extractBullets(section, 12, 80);
      if (bullets.length === 0) continue;
      const out =
        `## Code Conventions\n` +
        bullets.map((b) => `- ${b}`).join('\n') +
        `\nSource: .ptah/analysis/${manifest.slug}/${c.file}`;
      return capUtf8(out, 1500);
    }

    const fallback =
      `## Code Conventions\n` +
      `(not detected — see analysis files)\n` +
      `Source: .ptah/analysis/${manifest.slug}/`;
    return capUtf8(fallback, 1500);
  }

  private buildKeyFilesContent(
    manifest: MultiPhaseManifest,
    phaseContents: Record<string, string>,
  ): string {
    // Categorisation heuristics — order-stable.
    type Category =
      | 'Entry points'
      | 'Configs'
      | 'Tests'
      | 'Routes'
      | 'Components'
      | 'Services'
      | 'Models';

    const buckets: Record<Category, Set<string>> = {
      'Entry points': new Set(),
      Configs: new Set(),
      Tests: new Set(),
      Routes: new Set(),
      Components: new Set(),
      Services: new Set(),
      Models: new Set(),
    };

    // A token counts as path-like if it either contains a slash or matches a
    // bare well-known config filename (package.json, tsconfig*.json, etc.)
    // that conventionally lives at the workspace root.
    const isBareConfigName = (s: string): boolean =>
      /^(package\.json|tsconfig[^\s]*\.json|nx\.json|jest\.config[^\s]*|webpack\.config[^\s]*|vite\.config[^\s]*|astro\.config[^\s]*|eslint\.config[^\s]*|\.eslintrc[^\s]*|\.prettierrc[^\s]*|docker-compose[^\s]*\.ya?ml|electron-builder\.ya?ml|tailwind\.config[^\s]*|content-manifest\.json|agent-pack-manifest\.json|skills-lock\.json|\.mcp\.json)$/i.test(
        s,
      );

    const isPathLike = (s: string): boolean =>
      (/[/\\]/.test(s) || isBareConfigName(s)) &&
      // looks like a relative-ish path with at least one path component
      /^[A-Za-z0-9._@/\\-]{2,}$/.test(s) &&
      // not a URL
      !/^https?:/i.test(s);

    const classify = (p: string): Category | null => {
      const lower = p.toLowerCase();
      if (
        /(^|[/\\])(main|index|server|app|bootstrap|entry|preload)\.(ts|tsx|js|mjs|cjs|py|go|rs|java)$/i.test(
          p,
        )
      ) {
        return 'Entry points';
      }
      if (
        /(^|[/\\])(package\.json|tsconfig[^\s]*\.json|nx\.json|jest\.config[^\s]*|webpack\.config[^\s]*|vite\.config[^\s]*|astro\.config[^\s]*|eslint\.config[^\s]*|\.eslintrc[^\s]*|\.prettierrc[^\s]*|docker-compose[^\s]*\.ya?ml|prisma[/\\]schema\.prisma|electron-builder\.ya?ml|tailwind\.config[^\s]*)$/i.test(
          p,
        )
      ) {
        return 'Configs';
      }
      if (
        /(^|[/\\])(__tests__|tests?|e2e|spec)([/\\]|$)/.test(lower) ||
        /\.(spec|test|e2e)\.(ts|tsx|js|jsx)$/.test(lower)
      ) {
        return 'Tests';
      }
      if (
        /(^|[/\\])(routes?|api|controllers?)([/\\]|$)/.test(lower) ||
        /\.controller\.(ts|js)$/.test(lower) ||
        /\.routes?\.(ts|js)$/.test(lower)
      ) {
        return 'Routes';
      }
      if (
        /\.component\.(ts|tsx|jsx)$/.test(lower) ||
        /(^|[/\\])components?([/\\]|$)/.test(lower)
      ) {
        return 'Components';
      }
      if (
        /\.service\.(ts|js)$/.test(lower) ||
        /(^|[/\\])services?([/\\]|$)/.test(lower)
      ) {
        return 'Services';
      }
      if (
        /\.(model|entity|schema|dto)\.(ts|js)$/.test(lower) ||
        /(^|[/\\])(models?|entities|schemas?|dtos?)([/\\]|$)/.test(lower)
      ) {
        return 'Models';
      }
      return null;
    };

    const consume = (raw: string): void => {
      const trimmed = raw
        .trim()
        .replace(/[`'",;]+$/g, '')
        .replace(/^[`'",]+/, '');
      if (!trimmed || !isPathLike(trimmed)) return;
      const cat = classify(trimmed);
      if (cat) buckets[cat].add(trimmed);
    };

    for (const md of Object.values(phaseContents)) {
      if (!md) continue;
      // Declare regexes inside the loop so each iteration gets a fresh
      // lastIndex=0 — avoids the stateful-g-flag gotcha across phase strings.
      const fenceRe = /```(?:text|json|yaml|yml)?\n([\s\S]*?)```/gi;
      const bulletPathRe = /^\s*[-*]\s+`([^`\n]+)`/gm;
      // Fenced code blocks
      let m: RegExpExecArray | null;
      while ((m = fenceRe.exec(md)) !== null) {
        const block = m[1];
        for (const line of block.split(/\r?\n/)) {
          // Permit list-y blocks (` ├── name`, `- path`, plain `path`)
          const tokens = line
            .replace(/^[\s│├└─*-]+/, '')
            .split(/\s+#|\s{2,}|\s+\/\//)[0]
            ?.trim();
          if (tokens) consume(tokens);
        }
      }
      // Inline `- \`path\`` bullets
      let b: RegExpExecArray | null;
      while ((b = bulletPathRe.exec(md)) !== null) {
        consume(b[1]);
      }
    }

    const order: Category[] = [
      'Entry points',
      'Configs',
      'Tests',
      'Routes',
      'Components',
      'Services',
      'Models',
    ];

    const sectionLines: string[] = [];
    for (const cat of order) {
      const set = buckets[cat];
      if (set.size === 0) continue;
      const all = Array.from(set);
      const head = all.slice(0, 16);
      const more = all.length - head.length;
      const list = head.join(', ') + (more > 0 ? `, +${more} more` : '');
      sectionLines.push(`${cat}: ${list}`);
    }

    if (sectionLines.length === 0) {
      return capUtf8(`## Key File Locations\n(none detected)`, 2048);
    }

    const out =
      `## Key File Locations\n` +
      sectionLines.join('\n') +
      `\nSource: .ptah/analysis/${manifest.slug}/`;
    return capUtf8(out, 2048);
  }
}

// ---------------------------------------------------------------------------
// Local helpers — kept in this file because they are only used by the wizard
// memory-seed content builders above and have no reuse value elsewhere.
// ---------------------------------------------------------------------------

/**
 * Truncate a string to fit within `maxBytes` UTF-8 bytes. Adds an ellipsis
 * marker when truncation actually occurs.
 */
function capUtf8(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s, 'utf8') <= maxBytes) return s;
  // Conservative cut: reduce by characters until under cap, leaving a marker.
  const marker = '\n…(truncated)';
  const markerBytes = Buffer.byteLength(marker, 'utf8');
  let cut = s.length;
  while (
    cut > 0 &&
    Buffer.byteLength(s.slice(0, cut), 'utf8') + markerBytes > maxBytes
  ) {
    cut -= 32;
  }
  return s.slice(0, Math.max(0, cut)) + marker;
}

/**
 * Truncate a comma- or pipe-separated list to first 8 items, append `+N more`
 * when truncated. Returns null if input is null/empty.
 */
function truncateList(raw: string | null): string | null {
  if (!raw) return null;
  // Split on commas, but tolerate ` and ` joiners and pipes.
  const parts = raw
    .split(/\s*(?:,|\||;| and )\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const head = parts.slice(0, 8);
  const more = parts.length - head.length;
  return head.join(', ') + (more > 0 ? `, +${more} more` : '');
}

/**
 * Extract the body of the first matching `## <name>` section from a markdown
 * document. Body ends at the next `#{1,6} ` heading or end-of-file.
 */
function extractH2Section(md: string, names: readonly string[]): string | null {
  for (const name of names) {
    const re = new RegExp(
      `^##\\s+${escapeRegExp(name)}\\s*$([\\s\\S]*?)(?=^#{1,6}\\s|(?![\\s\\S]))`,
      'mi',
    );
    const m = re.exec(md);
    if (m) return m[1];
  }
  return null;
}

function extractBullets(
  body: string,
  maxBullets: number,
  maxLineChars: number,
): string[] {
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    let text = m[1].trim();
    if (text.length === 0) continue;
    if (text.length > maxLineChars) {
      text = text.slice(0, maxLineChars - 1) + '…';
    }
    out.push(text);
    if (out.length >= maxBullets) break;
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
