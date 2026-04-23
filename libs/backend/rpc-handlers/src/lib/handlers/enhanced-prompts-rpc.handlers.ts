/**
 * Enhanced Prompts RPC Handlers
 *
 * Handles RPC methods for the Enhanced Prompts feature:
 * - enhancedPrompts:getStatus - Get current status
 * - enhancedPrompts:runWizard - Execute the wizard to generate prompts
 * - enhancedPrompts:setEnabled - Toggle the feature on/off
 * - enhancedPrompts:regenerate - Force regenerate the prompt
 * - enhancedPrompts:getPromptContent - Get generated prompt content for preview
 * - enhancedPrompts:download - Download generated prompt as .md file
 *
 * TASK_2025_137: Intelligent Prompt Generation System
 * TASK_2025_149 Batch 5: Added getPromptContent and download handlers
 * TASK_2025_203: Moved to @ptah-extension/rpc-handlers (replaced vscode APIs with platform abstractions)
 */

/**
 * Timeout for license verification to prevent hanging requests (10 seconds)
 */
const LICENSE_VERIFICATION_TIMEOUT_MS = 10 * 1000;

import { injectable, inject, DependencyContainer } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  LicenseService,
} from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import {
  EnhancedPromptsService,
  SDK_TOKENS,
  PluginLoaderService,
} from '@ptah-extension/agent-sdk';
import type {
  PromptDesignerInput,
  EnhancedPromptsSdkConfig,
} from '@ptah-extension/agent-sdk';
import { CodeExecutionMCP } from '@ptah-extension/vscode-lm-tools';
import type {
  EnhancedPromptsGetStatusParams,
  EnhancedPromptsGetStatusResponse,
  EnhancedPromptsRunWizardParams,
  EnhancedPromptsRunWizardResponse,
  EnhancedPromptsSetEnabledParams,
  EnhancedPromptsSetEnabledResponse,
  EnhancedPromptsRegenerateParams,
  EnhancedPromptsRegenerateResponse,
  AnalysisStreamPayload,
} from '@ptah-extension/shared';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { ISaveDialogProvider } from '@ptah-extension/platform-core';

/**
 * RPC handlers for Enhanced Prompts operations
 *
 * TASK_2025_137: Premium feature for intelligent prompt generation
 *
 * Exposes Enhanced Prompts functionality to the frontend:
 * - Status checking (for settings display)
 * - Wizard execution (from empty chat screen)
 * - Toggle on/off (from settings)
 * - Regenerate prompt (from settings)
 *
 * Security:
 * - Generated prompt content is NEVER exposed (IP protection)
 * - Premium feature gating via LicenseService
 */
/**
 * Local interface for webview broadcasting.
 *
 * Uses `string` for message type instead of `StrictMessageType` because
 * 'setup-wizard:enhance-stream' is not a member of the StrictMessageType union.
 * The underlying WebviewManager.broadcastMessage implementation accepts any
 * message type via postMessage, so this is safe at runtime.
 */
interface WebviewBroadcaster {
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

@injectable()
export class EnhancedPromptsRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE)
    private readonly enhancedPromptsService: EnhancedPromptsService,
    @inject(TOKENS.LICENSE_SERVICE)
    private readonly licenseService: LicenseService,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
    private readonly pluginLoader: PluginLoaderService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(TOKENS.SAVE_DIALOG_PROVIDER)
    private readonly saveDialogProvider: ISaveDialogProvider,
    @inject('DependencyContainer')
    private readonly container: DependencyContainer,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  /**
   * Register all Enhanced Prompts RPC methods
   */
  register(): void {
    this.registerGetStatus();
    this.registerRunWizard();
    this.registerSetEnabled();
    this.registerRegenerate();
    this.registerGetPromptContent();
    this.registerDownload();

    this.logger.debug('Enhanced Prompts RPC handlers registered', {
      methods: [
        'enhancedPrompts:getStatus',
        'enhancedPrompts:runWizard',
        'enhancedPrompts:setEnabled',
        'enhancedPrompts:regenerate',
        'enhancedPrompts:getPromptContent',
        'enhancedPrompts:download',
      ],
    });
  }

  /**
   * enhancedPrompts:getStatus - Get current Enhanced Prompts status
   *
   * Returns whether Enhanced Prompts is enabled, whether a prompt has been
   * generated, and the detected technology stack.
   *
   * Does NOT return the actual prompt content (security).
   */
  private registerGetStatus(): void {
    this.rpcHandler.registerMethod<
      EnhancedPromptsGetStatusParams,
      EnhancedPromptsGetStatusResponse
    >('enhancedPrompts:getStatus', async (params) => {
      try {
        const rawPath = params?.workspacePath;

        if (!rawPath) {
          return {
            enabled: false,
            hasGeneratedPrompt: false,
            generatedAt: null,
            detectedStack: null,
            cacheValid: false,
            error: 'Workspace path is required',
          };
        }

        // Resolve relative paths to actual workspace folder path
        const workspacePath = this.resolveWorkspacePath(rawPath);

        this.logger.debug('RPC: enhancedPrompts:getStatus called', {
          workspacePath,
        });

        const status =
          await this.enhancedPromptsService.getStatus(workspacePath);

        return {
          enabled: status.enabled,
          hasGeneratedPrompt: status.hasGeneratedPrompt,
          generatedAt: status.generatedAt,
          detectedStack: status.detectedStack,
          cacheValid: status.cacheValid,
          invalidationReason: status.invalidationReason,
        };
      } catch (error) {
        this.logger.error(
          'RPC: enhancedPrompts:getStatus failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'EnhancedPromptsRpcHandlers.registerGetStatus' },
        );

        return {
          enabled: false,
          hasGeneratedPrompt: false,
          generatedAt: null,
          detectedStack: null,
          cacheValid: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });
  }

  /**
   * enhancedPrompts:runWizard - Execute the Enhanced Prompts wizard
   *
   * Requires premium license. Analyzes the workspace and generates
   * project-specific guidance using the PromptDesignerAgent.
   *
   * Flow:
   * 1. Verify premium license
   * 2. Analyze workspace
   * 3. Generate prompt via PromptDesignerAgent
   * 4. Cache and enable Enhanced Prompts
   * 5. Return success status
   */
  private registerRunWizard(): void {
    this.rpcHandler.registerMethod<
      EnhancedPromptsRunWizardParams,
      EnhancedPromptsRunWizardResponse
    >('enhancedPrompts:runWizard', async (params) => {
      try {
        const rawPath = params?.workspacePath;

        if (!rawPath) {
          return {
            success: false,
            error: 'Workspace path is required',
          };
        }

        // Resolve relative paths (e.g. '.') to actual workspace folder path
        const workspacePath = this.resolveWorkspacePath(rawPath);

        this.logger.info('RPC: enhancedPrompts:runWizard started', {
          workspacePath,
          rawPath: rawPath !== workspacePath ? rawPath : undefined,
        });

        // Verify premium license with timeout to prevent hanging
        const licenseStatus = await this.verifyLicenseWithTimeout();
        if (!licenseStatus) {
          return {
            success: false,
            error:
              'License verification timed out. Please check your network connection and try again.',
          };
        }

        const isPremium =
          licenseStatus.tier === 'pro' || licenseStatus.tier === 'trial_pro';

        if (!isPremium) {
          return {
            success: false,
            error:
              'Enhanced Prompts is a premium feature. Please upgrade to Pro.',
          };
        }

        // Pass full wizard analysis data directly to enhanced prompts
        let preComputedInput: PromptDesignerInput | undefined;
        if (params.analysisData) {
          preComputedInput = {
            workspacePath,
            projectType: params.analysisData.projectType,
            framework: params.analysisData.frameworks?.[0],
            isMonorepo: !!params.analysisData.monorepoType,
            monorepoType: params.analysisData.monorepoType,
            dependencies: [],
            devDependencies: [],
            sampleFilePaths: [
              ...(params.analysisData.keyFileLocations?.entryPoints ?? []),
              ...(params.analysisData.keyFileLocations?.configs ?? []),
              ...(params.analysisData.keyFileLocations?.apiRoutes ?? []).slice(
                0,
                3,
              ),
              ...(params.analysisData.keyFileLocations?.components ?? []).slice(
                0,
                3,
              ),
              ...(params.analysisData.keyFileLocations?.services ?? []).slice(
                0,
                3,
              ),
            ].slice(0, 15),
            languages: params.analysisData.languageDistribution?.length
              ? params.analysisData.languageDistribution
                  .sort((a, b) => b.percentage - a.percentage)
                  .map((l) => l.language)
              : params.analysisData.languages,
            // Quality data flows from agentic analysis (Step 1) via analysisData.
            // When quality data is present, pass it through to avoid re-running
            // the separate ProjectIntelligenceService quality assessment pipeline.
            includeQualityGuidance:
              params.analysisData.qualityScore !== undefined,
            ...(params.analysisData.qualityScore !== undefined && {
              qualityAssessment: {
                score: params.analysisData.qualityScore,
                antiPatterns: [],
                gaps: (params.analysisData.qualityIssues ?? []).map(
                  (issue: {
                    area: string;
                    severity: string;
                    description: string;
                    recommendation: string;
                  }) => ({
                    area: issue.area,
                    priority: issue.severity as 'high' | 'medium' | 'low',
                    description: issue.description,
                    recommendation: issue.recommendation,
                  }),
                ),
                strengths: params.analysisData.qualityStrengths ?? [],
                sampledFiles: [],
                analysisTimestamp: Date.now(),
                analysisDurationMs: 0,
              },
              prescriptiveGuidance: params.analysisData.qualityRecommendations
                ?.length
                ? {
                    summary: params.analysisData.qualityRecommendations
                      .slice(0, 3)
                      .map((r: { issue: string }) => r.issue)
                      .join('; '),
                    recommendations:
                      params.analysisData.qualityRecommendations.map(
                        (r: {
                          priority: number;
                          category: string;
                          issue: string;
                          solution: string;
                        }) => ({
                          priority: r.priority,
                          category: r.category,
                          issue: r.issue,
                          solution: r.solution,
                        }),
                      ),
                    totalTokens: 0,
                    wasTruncated: false,
                  }
                : undefined,
            }),
          };

          this.logger.info(
            'Built PromptDesignerInput from wizard analysis for enhanced prompts',
            {
              projectType: preComputedInput.projectType,
              framework: preComputedInput.framework,
              isMonorepo: preComputedInput.isMonorepo,
            },
          );
        }

        // Create stream event broadcaster for enhanced prompts pipeline
        const onStreamEvent = this.createEnhanceStreamBroadcaster();

        // Resolve MCP status for SDK config (pass frontend model override)
        const sdkConfig = this.resolveSdkConfig(
          isPremium,
          onStreamEvent,
          params.model,
        );

        // Run the wizard (pass analysisDir for multi-phase enrichment)
        const result = await this.enhancedPromptsService.runWizard(
          workspacePath,
          params.config,
          undefined,
          preComputedInput,
          sdkConfig,
          params.analysisDir,
        );

        if (result.success && result.state) {
          this.logger.info('RPC: enhancedPrompts:runWizard completed', {
            workspacePath,
            detectedStack: result.state.detectedStack,
          });

          return {
            success: true,
            generatedAt: result.state.generatedAt,
            detectedStack: result.state.detectedStack,
            summary: result.summary ?? null,
          };
        }

        return {
          success: false,
          error: result.error || 'Failed to generate enhanced prompt',
        };
      } catch (error) {
        this.logger.error(
          'RPC: enhancedPrompts:runWizard failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'EnhancedPromptsRpcHandlers.registerRunWizard' },
        );

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });
  }

  /**
   * enhancedPrompts:setEnabled - Toggle Enhanced Prompts on/off
   *
   * Allows users to enable or disable Enhanced Prompts via settings.
   * When disabled, sessions will use the default claude_code preset.
   */
  private registerSetEnabled(): void {
    this.rpcHandler.registerMethod<
      EnhancedPromptsSetEnabledParams,
      EnhancedPromptsSetEnabledResponse
    >('enhancedPrompts:setEnabled', async (params) => {
      try {
        const { workspacePath: rawPath, enabled } = params || {};

        if (!rawPath) {
          return {
            success: false,
            error: 'Workspace path is required',
          };
        }

        const workspacePath = this.resolveWorkspacePath(rawPath);

        if (typeof enabled !== 'boolean') {
          return {
            success: false,
            error: 'Enabled flag is required',
          };
        }

        this.logger.info('RPC: enhancedPrompts:setEnabled', {
          workspacePath,
          enabled,
        });

        await this.enhancedPromptsService.setEnabled(workspacePath, enabled);

        return {
          success: true,
          enabled,
        };
      } catch (error) {
        this.logger.error(
          'RPC: enhancedPrompts:setEnabled failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'EnhancedPromptsRpcHandlers.registerSetEnabled' },
        );

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });
  }

  /**
   * enhancedPrompts:regenerate - Force regenerate the enhanced prompt
   *
   * Requires premium license. Invalidates the existing cache and
   * runs the wizard again to generate fresh guidance.
   *
   * Use cases:
   * - Project structure changed significantly
   * - User wants updated guidance
   * - Cache invalidated due to config changes
   */
  private registerRegenerate(): void {
    this.rpcHandler.registerMethod<
      EnhancedPromptsRegenerateParams,
      EnhancedPromptsRegenerateResponse
    >('enhancedPrompts:regenerate', async (params) => {
      try {
        const rawPath = params?.workspacePath;

        if (!rawPath) {
          return {
            success: false,
            error: 'Workspace path is required',
          };
        }

        // Resolve relative paths to actual workspace folder path
        const workspacePath = this.resolveWorkspacePath(rawPath);

        this.logger.info('RPC: enhancedPrompts:regenerate started', {
          workspacePath,
          force: params.force,
        });

        // Verify premium license with timeout to prevent hanging
        const licenseStatus = await this.verifyLicenseWithTimeout();
        if (!licenseStatus) {
          return {
            success: false,
            error:
              'License verification timed out. Please check your network connection and try again.',
          };
        }

        const isPremium =
          licenseStatus.tier === 'pro' || licenseStatus.tier === 'trial_pro';

        if (!isPremium) {
          return {
            success: false,
            error:
              'Enhanced Prompts is a premium feature. Please upgrade to Pro.',
          };
        }

        // Create stream event broadcaster for enhanced prompts regeneration
        const onStreamEvent = this.createEnhanceStreamBroadcaster();

        // Resolve MCP status for SDK config
        const sdkConfig = this.resolveSdkConfig(isPremium, onStreamEvent);

        // Regenerate
        const result = await this.enhancedPromptsService.regenerate(
          workspacePath,
          {
            force: params.force ?? true,
            config: params.config,
          },
          undefined,
          sdkConfig,
        );

        if (result.success && result.status) {
          this.logger.info('RPC: enhancedPrompts:regenerate completed', {
            workspacePath,
          });

          return {
            success: true,
            status: result.status,
          };
        }

        return {
          success: false,
          error: result.error || 'Failed to regenerate enhanced prompt',
        };
      } catch (error) {
        this.logger.error(
          'RPC: enhancedPrompts:regenerate failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'EnhancedPromptsRpcHandlers.registerRegenerate' },
        );

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });
  }

  /**
   * enhancedPrompts:getPromptContent - Get generated prompt content for preview
   *
   * Returns the full generated prompt content for a workspace, or null
   * if no prompt has been generated or enhanced prompts is disabled.
   *
   * TASK_2025_149 Batch 5: Added for prompt content preview in settings UI
   */
  private registerGetPromptContent(): void {
    this.rpcHandler.registerMethod<
      { workspacePath: string },
      { content: string | null; error?: string }
    >('enhancedPrompts:getPromptContent', async (params) => {
      try {
        const rawPath = params?.workspacePath;

        if (!rawPath) {
          return {
            content: null,
            error: 'Workspace path is required',
          };
        }

        const workspacePath = this.resolveWorkspacePath(rawPath);

        this.logger.debug('RPC: enhancedPrompts:getPromptContent called', {
          workspacePath,
        });

        const content =
          await this.enhancedPromptsService.getFullCombinedPromptContent(
            workspacePath,
          );

        return { content };
      } catch (error) {
        this.logger.error(
          'RPC: enhancedPrompts:getPromptContent failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          {
            errorSource: 'EnhancedPromptsRpcHandlers.registerGetPromptContent',
          },
        );

        return {
          content: null,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });
  }

  /**
   * enhancedPrompts:download - Download generated prompt as a .md file
   *
   * Gets the prompt content for the workspace, shows a native VS Code
   * save dialog with .md filter, and writes the content to the selected
   * file path.
   *
   * TASK_2025_149 Batch 5: Added for prompt download in settings UI
   */
  private registerDownload(): void {
    this.rpcHandler.registerMethod<
      { workspacePath: string },
      { success: boolean; filePath?: string; error?: string }
    >('enhancedPrompts:download', async (params) => {
      try {
        const rawPath = params?.workspacePath;

        if (!rawPath) {
          return {
            success: false,
            error: 'Workspace path is required',
          };
        }

        const workspacePath = this.resolveWorkspacePath(rawPath);

        this.logger.debug('RPC: enhancedPrompts:download called', {
          workspacePath,
        });

        const content =
          await this.enhancedPromptsService.getFullCombinedPromptContent(
            workspacePath,
          );

        if (!content) {
          return {
            success: false,
            error:
              'No enhanced prompt content available. Generate enhanced prompts first.',
          };
        }

        const contentBytes = Buffer.from(content, 'utf-8');
        const filePath = await this.saveDialogProvider.showSaveAndWrite({
          defaultFilename: 'enhanced-prompt.md',
          filters: { Markdown: ['md'] },
          title: 'Save Enhanced Prompt',
          content: contentBytes,
        });

        if (!filePath) {
          return {
            success: false,
            error: 'Save cancelled by user',
          };
        }

        this.logger.info('RPC: enhancedPrompts:download completed', {
          filePath,
          contentLength: content.length,
        });

        return {
          success: true,
          filePath,
        };
      } catch (error) {
        this.logger.error(
          'RPC: enhancedPrompts:download failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'EnhancedPromptsRpcHandlers.registerDownload' },
        );

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });
  }

  /**
   * Create a stream event broadcaster for the enhance pipeline.
   *
   * Resolves WebviewManager from DI container (best-effort) and returns
   * a callback that broadcasts AnalysisStreamPayload events to the frontend
   * via 'setup-wizard:enhance-stream' messages.
   *
   * Extracted to avoid duplicating this closure in registerRunWizard() and
   * registerRegenerate().
   */
  private createEnhanceStreamBroadcaster(): (
    event: AnalysisStreamPayload,
  ) => void {
    let webviewManager: WebviewBroadcaster | null = null;
    try {
      if (this.container.isRegistered(TOKENS.WEBVIEW_MANAGER)) {
        webviewManager = this.container.resolve<WebviewBroadcaster>(
          TOKENS.WEBVIEW_MANAGER,
        );
      }
    } catch {
      this.logger.debug(
        'Could not resolve WebviewManager for enhance stream broadcasting',
      );
    }

    return (event: AnalysisStreamPayload): void => {
      try {
        if (!webviewManager) return;
        webviewManager
          .broadcastMessage('setup-wizard:enhance-stream', event)
          .catch((broadcastError) => {
            this.logger.warn('Failed to broadcast enhance stream event', {
              error:
                broadcastError instanceof Error
                  ? broadcastError.message
                  : String(broadcastError),
            });
          });
      } catch {
        // Swallow synchronous errors to avoid crashing enhance pipeline
      }
    };
  }

  /**
   * Resolve SDK config for internal query execution.
   * Resolves MCP server status from CodeExecutionMCP service.
   *
   * @param isPremium - Whether user has premium license
   * @param onStreamEvent - Optional callback for real-time stream events
   */
  private resolveSdkConfig(
    isPremium: boolean,
    onStreamEvent?: (event: AnalysisStreamPayload) => void,
    model?: string,
  ): EnhancedPromptsSdkConfig {
    let mcpServerRunning = false;
    let mcpPort: number | undefined;

    try {
      if (this.container.isRegistered(TOKENS.CODE_EXECUTION_MCP)) {
        const codeExecutionMcp = this.container.resolve<CodeExecutionMCP>(
          TOKENS.CODE_EXECUTION_MCP,
        );
        const actualPort = codeExecutionMcp.getPort();
        mcpServerRunning = actualPort !== null;
        mcpPort = actualPort ?? undefined;
      }
    } catch {
      this.logger.debug('Could not resolve CodeExecutionMCP for SDK config');
    }

    // Resolve plugin paths for premium users
    let pluginPaths: string[] | undefined;
    if (isPremium) {
      try {
        const config = this.pluginLoader.getWorkspacePluginConfig();
        if (config.enabledPluginIds && config.enabledPluginIds.length > 0) {
          const paths = this.pluginLoader.resolvePluginPaths(
            config.enabledPluginIds,
          );
          if (paths.length > 0) {
            pluginPaths = paths;
          }
        }
      } catch {
        this.logger.debug(
          'Failed to resolve plugin paths for enhanced prompts',
        );
      }
    }

    return {
      isPremium,
      mcpServerRunning,
      mcpPort,
      onStreamEvent,
      model: model || undefined,
      pluginPaths,
    };
  }

  /**
   * Resolve workspace path from frontend value.
   * The frontend may send '.' or './' since it doesn't have access to the
   * real filesystem path. We resolve these to the actual workspace folder.
   * TASK_2025_203: Uses IWorkspaceProvider instead of vscode.workspace.workspaceFolders
   */
  private resolveWorkspacePath(rawPath: string): string {
    if (rawPath === '.' || rawPath === './') {
      return this.workspaceProvider.getWorkspaceRoot() ?? rawPath;
    }
    return rawPath;
  }

  /**
   * Verify license with timeout to prevent hanging requests
   *
   * Uses Promise.race to enforce a timeout on license verification.
   * Returns null if verification times out, allowing caller to handle gracefully.
   */
  private async verifyLicenseWithTimeout(): Promise<Awaited<
    ReturnType<LicenseService['verifyLicense']>
  > | null> {
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => {
        this.logger.warn('RPC: License verification timed out', {
          timeoutMs: LICENSE_VERIFICATION_TIMEOUT_MS,
        });
        resolve(null);
      }, LICENSE_VERIFICATION_TIMEOUT_MS);
    });

    return Promise.race([this.licenseService.verifyLicense(), timeoutPromise]);
  }
}
