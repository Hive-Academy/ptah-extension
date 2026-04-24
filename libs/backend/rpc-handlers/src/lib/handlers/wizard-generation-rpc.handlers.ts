/**
 * Wizard Generation RPC Handlers
 *
 * Handles RPC methods for the setup wizard generation pipeline:
 * - wizard:submit-selection - Submit agent selection and trigger generation
 * - wizard:cancel - Cancel active generation or wizard session
 * - wizard:retry-item - Retry a single failed generation item
 *
 * TASK_2025_148: Wire Setup Wizard Generation Pipeline via RPC
 * TASK_2025_203: Moved to @ptah-extension/rpc-handlers (replaced vscode.workspace.workspaceFolders with IWorkspaceProvider)
 *
 * Design decisions:
 * - Uses lazy DI resolution via container (same as SetupRpcHandlers)
 * - Concurrent generation guard prevents multiple simultaneous generations
 * - Progress callback errors are caught to prevent crashing the generation pipeline
 * - Cancel is safe to call when no generation is running (no-op)
 * - Uses local WebviewBroadcaster interface to avoid StrictMessageType constraint
 *   since 'setup-wizard:generation-progress' is not in StrictMessageType union
 */

import { injectable, inject, DependencyContainer } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  LicenseService,
} from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import { SDK_TOKENS, PluginLoaderService } from '@ptah-extension/agent-sdk';
import { CodeExecutionMCP } from '@ptah-extension/vscode-lm-tools';
import type {
  WizardSubmitSelectionParams,
  WizardSubmitSelectionResponse,
  WizardCancelParams,
  WizardCancelResponse,
  WizardRetryItemParams,
  WizardRetryItemResponse,
  GenerationProgressPayload,
  GenerationCompletePayload,
  GenerationStreamPayload,
  CliTarget,
} from '@ptah-extension/shared';
import type {
  GenerationSummary,
  OrchestratorGenerationOptions,
} from '@ptah-extension/agent-generation';
import { CliDetectionService } from '@ptah-extension/agent-sdk';
import { Result } from '@ptah-extension/shared';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

/**
 * Progress update callback payload from AgentGenerationOrchestratorService.
 * Defined locally because this type is not barrel-exported from agent-generation.
 * Mirrors the GenerationProgress interface in orchestrator.service.ts.
 */
interface GenerationProgress {
  phase:
    | 'analysis'
    | 'selection'
    | 'customization'
    | 'rendering'
    | 'writing'
    | 'complete';
  percentComplete: number;
  currentOperation?: string;
  agentsProcessed?: number;
  totalAgents?: number;
  detectedCharacteristics?: string[];
}

// OrchestratorGenerationOptions imported from @ptah-extension/agent-generation barrel

/**
 * Local interface for webview broadcasting.
 *
 * Uses `string` for message type instead of `StrictMessageType` because
 * 'setup-wizard:generation-progress' and 'setup-wizard:generation-complete'
 * are not members of the StrictMessageType union. The underlying
 * WebviewManager.broadcastMessage implementation accepts any message type
 * via postMessage, so this is safe at runtime.
 */
interface WebviewBroadcaster {
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

/**
 * Interface for the SetupWizardService methods we need.
 * Uses structural typing to avoid importing the concrete class.
 */
interface SetupWizardServiceInterface {
  getCurrentSession(): { id: string } | null;
  cancelWizard(
    sessionId: string,
    saveProgress: boolean,
  ): Promise<Result<void, Error>>;
}

/**
 * Interface for the AgentGenerationOrchestratorService methods we need.
 * Uses structural typing to avoid importing the concrete class.
 */
interface OrchestratorServiceInterface {
  generateAgents(
    options: OrchestratorGenerationOptions,
    progressCallback?: (progress: GenerationProgress) => void,
  ): Promise<Result<GenerationSummary, Error>>;
}

/**
 * Interface for the EnhancedPromptsService methods we need.
 * Uses structural typing to avoid importing the concrete class.
 */
interface EnhancedPromptsServiceInterface {
  getEnhancedPromptContent(workspacePath: string): Promise<string | null>;
}

/**
 * RPC handlers for setup wizard generation operations.
 *
 * TASK_2025_148: Connects the frontend Angular SPA to the backend
 * AgentGenerationOrchestratorService via RPC, replacing the old
 * postMessage-based webview panel handlers.
 *
 * TASK_2025_154: Added multi-phase analysis RPC handlers.
 *
 * Concurrency: Only one generation can run at a time. The `isGenerating`
 * flag prevents concurrent submissions and is always reset in finally blocks.
 */
@injectable()
export class WizardGenerationRpcHandlers {
  /**
   * Concurrent generation guard.
   * Prevents multiple simultaneous agent generation runs.
   */
  private isGenerating = false;

  /**
   * Stored options from the last successful generation submission.
   * Reused by the retry handler to preserve rich context (analysis, SDK config, etc.).
   */
  private lastGenerationOptions: OrchestratorGenerationOptions | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
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
      this.logger.debug('Failed to resolve plugin paths for generation', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

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
      this.logger.error(`Failed to resolve ${serviceName}`, {
        error: message,
      });
      throw new Error(
        `${serviceName} not available. Ensure the agent-generation module is properly initialized. Details: ${message}`,
      );
    }
  }

  /**
   * Register all wizard generation RPC methods.
   *
   * TASK_2025_154 wiring: Removed wizard:start-multi-phase-analysis and
   * wizard:cancel-multi-phase-analysis — these are now integrated into
   * wizard:deep-analyze and wizard:cancel-analysis in SetupRpcHandlers.
   */
  register(): void {
    this.registerSubmitSelection();
    this.registerCancel();
    this.registerRetryItem();

    this.logger.debug('Wizard generation RPC handlers registered', {
      methods: [
        'wizard:submit-selection',
        'wizard:cancel',
        'wizard:retry-item',
      ],
    });
  }

  /**
   * wizard:submit-selection - Submit agent selection and trigger generation.
   *
   * Validates the selected agent IDs, resolves the orchestrator and webview
   * manager, then runs the 5-phase generation pipeline. Progress is broadcast
   * to the frontend via 'setup-wizard:generation-progress' messages.
   *
   * Edge cases handled:
   * - Empty selectedAgentIds: returns error immediately
   * - Concurrent submissions: rejects with error if already generating
   * - No workspace folder: returns error
   * - Progress callback errors: caught and logged, do not crash generation
   * - Orchestrator errors: caught and returned as { success: false, error }
   */
  private registerSubmitSelection(): void {
    this.rpcHandler.registerMethod<
      WizardSubmitSelectionParams,
      WizardSubmitSelectionResponse
    >('wizard:submit-selection', async (params) => {
      // Validate selectedAgentIds is non-empty
      if (!params?.selectedAgentIds?.length) {
        this.logger.warn(
          'RPC: wizard:submit-selection called with empty agent selection',
        );
        return {
          success: false,
          error: 'No agents selected. Please select at least one agent.',
        };
      }

      // Concurrent generation guard
      if (this.isGenerating) {
        this.logger.warn(
          'RPC: wizard:submit-selection rejected - generation already in progress',
        );
        return {
          success: false,
          error:
            'Agent generation is already in progress. Please wait for it to complete or cancel it first.',
        };
      }

      // Get workspace folder
      const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        return {
          success: false,
          error:
            'No workspace folder open. Please open a folder to generate agents.',
        };
      }

      const startTime = Date.now();
      this.isGenerating = true;

      try {
        this.logger.info('RPC: wizard:submit-selection started', {
          agentCount: params.selectedAgentIds.length,
          agents: params.selectedAgentIds,
          workspace: workspaceRoot,
        });

        // Resolve orchestrator from DI container
        const orchestrator = this.resolveService<OrchestratorServiceInterface>(
          AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR,
          'AgentGenerationOrchestratorService',
        );

        // Resolve WebviewManager for progress broadcasting (best-effort)
        let webviewManager: WebviewBroadcaster | null = null;
        try {
          webviewManager = this.resolveService<WebviewBroadcaster>(
            TOKENS.WEBVIEW_MANAGER,
            'WebviewManager',
          );
        } catch {
          this.logger.warn(
            'WebviewManager not available for progress broadcasting. ' +
              'Generation will proceed without progress updates.',
          );
        }

        // Resolve enhanced prompt content (best-effort, non-blocking)
        let enhancedPromptContent: string | undefined;
        try {
          const enhancedPromptsService =
            this.resolveService<EnhancedPromptsServiceInterface>(
              SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE,
              'EnhancedPromptsService',
            );
          const content =
            await enhancedPromptsService.getEnhancedPromptContent(
              workspaceRoot,
            );
          if (content) {
            enhancedPromptContent = content;
            this.logger.info(
              'Enhanced prompt content resolved for generation pipeline',
              {
                contentLength: content.length,
              },
            );
          }
        } catch {
          this.logger.warn(
            'EnhancedPromptsService not available. ' +
              'Generation will proceed without enhanced prompt context.',
          );
        }

        // Pass analysis data to generation pipeline
        // Multi-phase: use analysisDir (markdown files on disk)
        // Legacy: use preComputedAnalysis (JSON blob)
        const preComputedAnalysis = params.analysisData ?? undefined;
        const analysisDir = params.analysisDir ?? undefined;
        if (analysisDir) {
          this.logger.info(
            'Passing multi-phase analysisDir to generation pipeline',
            { analysisDir },
          );
        } else if (preComputedAnalysis) {
          this.logger.info(
            'Passing full wizard analysis to generation pipeline',
            {
              projectType: preComputedAnalysis.projectType,
              frameworkCount: preComputedAnalysis.frameworks?.length ?? 0,
            },
          );
        }

        // Resolve license + MCP status for SDK config
        let isPremium = false;
        let mcpServerRunning = false;
        let mcpPort: number | undefined;
        try {
          const licenseService = this.resolveService<LicenseService>(
            TOKENS.LICENSE_SERVICE,
            'LicenseService',
          );
          const licenseStatus = await licenseService.verifyLicense();
          isPremium =
            licenseStatus.tier === 'pro' || licenseStatus.tier === 'trial_pro';

          const codeExecutionMcp = this.resolveService<CodeExecutionMCP>(
            TOKENS.CODE_EXECUTION_MCP,
            'CodeExecutionMCP',
          );
          const actualPort = codeExecutionMcp.getPort();
          mcpServerRunning = actualPort !== null;
          mcpPort = actualPort ?? undefined;
        } catch (error) {
          this.logger.debug(
            'Could not resolve license/MCP services for generation',
            {
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }

        // Detect installed CLI targets for multi-CLI agent generation (TASK_2025_160, TASK_2025_268)
        // Only premium users get cross-CLI sync; includes all supported CLI targets.
        // cursor support added in TASK_2025_267.
        let targetClis: CliTarget[] | undefined;
        if (isPremium) {
          try {
            const cliDetection = this.resolveService<CliDetectionService>(
              TOKENS.CLI_DETECTION_SERVICE,
              'CliDetectionService',
            );
            const installedClis = await cliDetection.detectAll();
            const cliTargets = installedClis
              .filter(
                (c) =>
                  (c.cli === 'copilot' ||
                    c.cli === 'gemini' ||
                    c.cli === 'codex' ||
                    c.cli === 'cursor') &&
                  c.installed,
              )
              .map((c) => c.cli as CliTarget);
            if (cliTargets.length > 0) {
              targetClis = cliTargets;
              this.logger.info(
                'CLI targets detected for multi-CLI generation',
                { targetClis },
              );
            }
          } catch (cliError) {
            this.logger.debug(
              'CLI detection failed for generation (non-fatal)',
              {
                error:
                  cliError instanceof Error
                    ? cliError.message
                    : String(cliError),
              },
            );
          }
        }

        // Stream event broadcaster -- broadcasts real-time generation events
        // (text deltas, tool calls, thinking) to the frontend for live transcript
        const onStreamEvent = (event: GenerationStreamPayload): void => {
          try {
            if (!webviewManager) return;
            webviewManager
              .broadcastMessage('setup-wizard:generation-stream', event)
              .catch((broadcastError) => {
                this.logger.warn(
                  'Failed to broadcast generation stream event',
                  {
                    error:
                      broadcastError instanceof Error
                        ? broadcastError.message
                        : String(broadcastError),
                  },
                );
              });
          } catch {
            // Swallow synchronous errors to avoid crashing generation pipeline
          }
        };

        // Resolve model from frontend selection (consistent with chat:start pattern)
        const currentModel = params.model || undefined;

        // Resolve plugin paths for premium users
        const pluginPaths = this.resolvePluginPaths(isPremium);

        // Build orchestrator options
        const options: OrchestratorGenerationOptions = {
          workspacePath: workspaceRoot,
          userOverrides: params.selectedAgentIds,
          threshold: params.threshold,
          variableOverrides: params.variableOverrides,
          enhancedPromptContent,
          preComputedAnalysis,
          isPremium,
          mcpServerRunning,
          mcpPort,
          onStreamEvent,
          model: currentModel,
          analysisDir,
          pluginPaths,
          targetClis,
        };

        // Store options for retry handler to reuse rich context
        this.lastGenerationOptions = options;

        // Progress callback - broadcasts progress to frontend
        const progressCallback = (progress: GenerationProgress): void => {
          // CRITICAL: Wrap in try/catch to prevent broadcasting errors
          // from crashing the generation pipeline
          try {
            if (!webviewManager) {
              return;
            }

            const payload: GenerationProgressPayload = {
              progress: {
                phase:
                  progress.phase === 'writing' ? 'rendering' : progress.phase,
                percentComplete: progress.percentComplete,
                currentAgent: progress.currentOperation,
              },
            };

            // Fire-and-forget broadcast. Do not await to avoid blocking
            // the generation pipeline. Errors are caught by the .catch handler.
            webviewManager
              .broadcastMessage('setup-wizard:generation-progress', payload)
              .catch((broadcastError) => {
                this.logger.warn('Failed to broadcast generation progress', {
                  error:
                    broadcastError instanceof Error
                      ? broadcastError.message
                      : String(broadcastError),
                  phase: progress.phase,
                  percentComplete: progress.percentComplete,
                });
              });
          } catch (callbackError) {
            // This catch handles synchronous errors in the callback body
            this.logger.warn('Error in generation progress callback', {
              error:
                callbackError instanceof Error
                  ? callbackError.message
                  : String(callbackError),
              phase: progress.phase,
            });
          }
        };

        // Fire-and-forget: Run generation pipeline in the background.
        // Return the RPC response immediately so the frontend can transition
        // to the generation progress step. Progress/completion are sent via broadcasts.
        this.runGenerationInBackground(
          orchestrator,
          options,
          progressCallback,
          webviewManager,
          startTime,
        );

        return { success: true };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: wizard:submit-selection unexpected error',
          error instanceof Error ? error : new Error(errorMessage),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(errorMessage),
          {
            errorSource: 'WizardGenerationRpcHandlers.registerSubmitSelection',
          },
        );
        this.isGenerating = false;
        return {
          success: false,
          error: `Agent generation failed: ${errorMessage}`,
        };
      }
    });
  }

  /**
   * Run the generation pipeline in the background.
   * Broadcasts progress and completion/failure to the frontend via webview messages.
   * Resets the isGenerating flag when done.
   */
  private runGenerationInBackground(
    orchestrator: OrchestratorServiceInterface,
    options: OrchestratorGenerationOptions,
    progressCallback: (progress: GenerationProgress) => void,
    webviewManager: WebviewBroadcaster | null,
    startTime: number,
  ): void {
    // Cap background generation at 10 minutes. Without this, a stuck LLM call
    // leaves isGenerating=true forever, blocking all future wizard submissions
    // until extension reload.
    const GENERATION_TIMEOUT_MS = 10 * 60 * 1000;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new Error(
            `Agent generation exceeded ${GENERATION_TIMEOUT_MS / 60_000}-minute timeout`,
          ),
        );
      }, GENERATION_TIMEOUT_MS);
    });

    Promise.race([
      orchestrator.generateAgents(options, progressCallback),
      timeoutPromise,
    ])
      .then((result) => {
        const durationMs = Date.now() - startTime;

        if (result.isOk()) {
          const summary = result.value as GenerationSummary;
          this.logger.info('RPC: wizard:submit-selection completed', {
            successful: summary.successful,
            failed: summary.failed,
            durationMs,
          });

          if (webviewManager) {
            const completePayload: GenerationCompletePayload = {
              success: true,
              generatedCount: summary.successful,
              duration: durationMs,
              errors:
                summary.warnings.length > 0 ? summary.warnings : undefined,
              warnings:
                summary.warnings.length > 0 ? summary.warnings : undefined,
              enhancedPromptsUsed: summary.enhancedPromptsUsed,
            };

            webviewManager
              .broadcastMessage(
                'setup-wizard:generation-complete',
                completePayload,
              )
              .catch((broadcastError) => {
                this.logger.warn('Failed to broadcast generation complete', {
                  error:
                    broadcastError instanceof Error
                      ? broadcastError.message
                      : String(broadcastError),
                });
              });
          }
        } else {
          const errorMessage =
            result.error?.message || 'Agent generation failed';
          this.logger.error('RPC: wizard:submit-selection failed', {
            error: errorMessage,
            durationMs,
          });

          if (webviewManager) {
            const failPayload: GenerationCompletePayload = {
              success: false,
              generatedCount: 0,
              duration: durationMs,
              errors: [errorMessage],
            };

            webviewManager
              .broadcastMessage('setup-wizard:generation-complete', failPayload)
              .catch((broadcastError) => {
                this.logger.warn('Failed to broadcast generation failure', {
                  error:
                    broadcastError instanceof Error
                      ? broadcastError.message
                      : String(broadcastError),
                });
              });
          }
        }
      })
      .catch((error) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: wizard:submit-selection unexpected error',
          error instanceof Error ? error : new Error(errorMessage),
        );

        if (webviewManager) {
          webviewManager
            .broadcastMessage('setup-wizard:generation-complete', {
              success: false,
              generatedCount: 0,
              duration: Date.now() - startTime,
              errors: [`Agent generation failed: ${errorMessage}`],
            })
            .catch(() => {
              // Swallow broadcast errors
            });
        }
      })
      .finally(() => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        this.isGenerating = false;
      });
  }

  /**
   * wizard:cancel - Cancel active generation or wizard session.
   *
   * Safe to call even when no generation is running (returns { cancelled: false }).
   * When generation is running, resets the isGenerating flag and cancels
   * the wizard session via SetupWizardService.
   *
   * Edge cases handled:
   * - No active session: returns { cancelled: false } (safe no-op)
   * - SetupWizardService unavailable: logs warning, still resets generation flag
   * - Cancel during generation: resets isGenerating flag to unlock future submissions
   */
  private registerCancel(): void {
    this.rpcHandler.registerMethod<WizardCancelParams, WizardCancelResponse>(
      'wizard:cancel',
      async (params) => {
        this.logger.debug('RPC: wizard:cancel called', {
          saveProgress: params?.saveProgress,
          isCurrentlyGenerating: this.isGenerating,
        });

        const saveProgress = params?.saveProgress ?? true;

        try {
          // Resolve SetupWizardService to access session management
          const setupWizardService =
            this.resolveService<SetupWizardServiceInterface>(
              AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE,
              'SetupWizardService',
            );

          // Get current session
          const currentSession = setupWizardService.getCurrentSession();

          if (!currentSession) {
            this.logger.debug(
              'RPC: wizard:cancel - no active session to cancel',
            );

            // Still reset the generation flag if it was stuck
            if (this.isGenerating) {
              this.isGenerating = false;
              this.logger.info(
                'RPC: wizard:cancel - reset stuck isGenerating flag',
              );
            }

            return { cancelled: false };
          }

          // Cancel the wizard session
          const cancelResult = await setupWizardService.cancelWizard(
            currentSession.id,
            saveProgress,
          );

          // Reset generation flag to unlock future submissions
          this.isGenerating = false;

          if (cancelResult.isErr()) {
            this.logger.error('Failed to cancel wizard session', {
              sessionId: currentSession.id,
              error: cancelResult.error?.message,
            });

            // Return cancelled: true anyway since we reset the flag
            // The session may have already completed
            return {
              cancelled: true,
              sessionId: currentSession.id,
              progressSaved: saveProgress,
            };
          }

          this.logger.info('RPC: wizard:cancel completed', {
            sessionId: currentSession.id,
            progressSaved: saveProgress,
          });

          return {
            cancelled: true,
            sessionId: currentSession.id,
            progressSaved: saveProgress,
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.warn('RPC: wizard:cancel error', {
            error: errorMessage,
          });
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(errorMessage),
            { errorSource: 'WizardGenerationRpcHandlers.registerCancel' },
          );

          // Reset generation flag even on error to prevent deadlock
          this.isGenerating = false;

          // Return cancelled: false since we could not perform the cancellation
          return { cancelled: false };
        }
      },
    );
  }

  /**
   * wizard:retry-item - Retry a single failed generation item.
   *
   * Currently implements a simplified retry that acknowledges the request
   * and triggers a targeted re-generation via the orchestrator for the
   * single specified agent. If the orchestrator does not support single-item
   * retry natively, this runs a full generation with just that one agent ID.
   *
   * Edge cases handled:
   * - Empty itemId: returns error
   * - Generation already running: returns error (same concurrency guard)
   * - Orchestrator unavailable: returns error
   * - No workspace folder: returns error
   */
  private registerRetryItem(): void {
    this.rpcHandler.registerMethod<
      WizardRetryItemParams,
      WizardRetryItemResponse
    >('wizard:retry-item', async (params) => {
      // Validate itemId
      if (!params?.itemId) {
        return {
          success: false,
          error: 'Item ID is required for retry.',
        };
      }

      // Concurrent generation guard
      if (this.isGenerating) {
        return {
          success: false,
          error:
            'Agent generation is already in progress. Please wait for it to complete before retrying.',
        };
      }

      // Get workspace folder
      const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        return {
          success: false,
          error: 'No workspace folder open. Please open a folder first.',
        };
      }

      this.isGenerating = true;

      try {
        this.logger.info('RPC: wizard:retry-item started', {
          itemId: params.itemId,
          workspace: workspaceRoot,
        });

        // Resolve orchestrator
        const orchestrator = this.resolveService<OrchestratorServiceInterface>(
          AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR,
          'AgentGenerationOrchestratorService',
        );

        // Resolve WebviewManager for progress broadcasting (best-effort)
        let webviewManager: WebviewBroadcaster | null = null;
        try {
          webviewManager = this.resolveService<WebviewBroadcaster>(
            TOKENS.WEBVIEW_MANAGER,
            'WebviewManager',
          );
        } catch {
          // Progress broadcasting will be skipped
        }

        // Stream event broadcaster -- broadcasts real-time generation events
        // (text deltas, tool calls, thinking) to the frontend for live transcript
        const onStreamEvent = (event: GenerationStreamPayload): void => {
          try {
            if (!webviewManager) return;
            webviewManager
              .broadcastMessage('setup-wizard:generation-stream', event)
              .catch((broadcastError) => {
                this.logger.warn(
                  'Failed to broadcast generation stream event',
                  {
                    error:
                      broadcastError instanceof Error
                        ? broadcastError.message
                        : String(broadcastError),
                  },
                );
              });
          } catch {
            // Swallow synchronous errors to avoid crashing generation pipeline
          }
        };

        // Reuse stored options from original generation to preserve rich context
        // (analysis data, premium status, MCP config, enhanced prompts)
        const options: OrchestratorGenerationOptions = {
          ...(this.lastGenerationOptions ?? {}),
          workspacePath: workspaceRoot,
          userOverrides: [params.itemId],
          onStreamEvent,
        };

        const result = await orchestrator.generateAgents(options);

        if (result.isOk()) {
          const summary = result.value as GenerationSummary;
          this.logger.info('RPC: wizard:retry-item completed', {
            itemId: params.itemId,
            successful: summary.successful,
          });

          // Broadcast completion for the retried item
          if (webviewManager) {
            const completePayload: GenerationCompletePayload = {
              success: true,
              generatedCount: summary.successful,
              duration: summary.durationMs,
            };

            webviewManager
              .broadcastMessage(
                'setup-wizard:generation-complete',
                completePayload,
              )
              .catch((broadcastError) => {
                this.logger.warn('Failed to broadcast retry completion', {
                  error:
                    broadcastError instanceof Error
                      ? broadcastError.message
                      : String(broadcastError),
                });
              });
          }

          return { success: true };
        }

        const errorMessage =
          result.error?.message || `Failed to retry item ${params.itemId}`;
        this.logger.error('RPC: wizard:retry-item failed', {
          itemId: params.itemId,
          error: errorMessage,
        });

        return { success: false, error: errorMessage };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: wizard:retry-item unexpected error',
          error instanceof Error ? error : new Error(errorMessage),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(errorMessage),
          { errorSource: 'WizardGenerationRpcHandlers.registerRetryItem' },
        );
        return {
          success: false,
          error: `Retry failed: ${errorMessage}`,
        };
      } finally {
        this.isGenerating = false;
      }
    });
  }

  // TASK_2025_154 wiring: wizard:start-multi-phase-analysis and
  // wizard:cancel-multi-phase-analysis removed. Multi-phase analysis is now
  // integrated into wizard:deep-analyze (SetupRpcHandlers) and
  // wizard:cancel-analysis (SetupRpcHandlers).
}
