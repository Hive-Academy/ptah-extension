/**
 * Wizard Generation RPC Handlers
 *
 * Handles RPC methods for the setup wizard generation pipeline:
 * - wizard:submit-selection - Submit agent selection and trigger generation
 * - wizard:cancel - Cancel active generation or wizard session
 * - wizard:retry-item - Retry a single failed generation item
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
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import {
  HARNESS_SYNC_TOKENS,
  type AgentSyncGate,
  type HarnessPropagationService,
} from '@ptah-extension/harness-sync';
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
} from '@ptah-extension/shared';
import type {
  GenerationSummary,
  OrchestratorGenerationOptions,
} from '@ptah-extension/agent-generation';
import { CliDetectionService } from '@ptah-extension/cli-agent-runtime';
import { Result } from '@ptah-extension/shared';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { RpcMethodName } from '@ptah-extension/shared';
import type { WebviewBroadcaster } from '../harness/streaming';

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
 * Connects the frontend Angular SPA to the backend
 * AgentGenerationOrchestratorService via RPC, replacing the old
 * postMessage-based webview panel handlers.
 *
 * Concurrency: Only one generation can run at a time. The `isGenerating`
 * flag prevents concurrent submissions and is always reset in finally blocks.
 */
@injectable()
export class WizardGenerationRpcHandlers {
  static readonly METHODS = [
    'wizard:submit-selection',
    'wizard:cancel',
    'wizard:retry-item',
  ] as const satisfies readonly RpcMethodName[];

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
    @inject(PLATFORM_TOKENS.DI_CONTAINER)
    private readonly container: DependencyContainer,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  /**
   * Resolve plugin paths for the generation run.
   */
  private resolvePluginPaths(): string[] | undefined {
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
   * Fan freshly generated subagents out to every harness target.
   *
   * Replaces the orchestrator's Phase 5, which called
   * `MultiCliAgentWriterService.writeForClis` with a hand-rolled list of
   * detected CLIs (deleted in TASK_2026_278 Batch 2).
   *
   * Batch 2 spelled the mirror-then-reconcile sequence out here, inline. Batch 3
   * folded it into `HarnessPropagationService`, which is the same two steps in
   * the same order for every trigger — so this method is now a `reason` and a
   * log line. The ordering rationale moved with the code and is worth
   * repeating once: the reconciler's desired state IS the user layer, and
   * `{ws}/.claude/agents` is a SOURCE, so an agent the wizard just wrote is
   * invisible to a reconcile until the mirror has run.
   *
   * Non-fatal throughout — a wizard run must not fail because a rival CLI's
   * directory was read-only.
   */
  private async propagateGeneratedAgents(workspaceRoot: string): Promise<void> {
    try {
      // BEFORE the propagate, because the reconciler resolves the gate at the
      // top of the pass: granting after it would leave the agents this run just
      // generated sitting in the user layer until some later trigger fired.
      this.grantAgentSyncConsent(workspaceRoot);
      if (!this.container.isRegistered(HARNESS_SYNC_TOKENS.PROPAGATION)) return;
      const propagation = this.resolveService<HarnessPropagationService>(
        HARNESS_SYNC_TOKENS.PROPAGATION,
        'HarnessPropagationService',
      );
      const health = await propagation.propagate(
        workspaceRoot,
        'wizard:generation-complete',
      );
      if (health === null) return;
      this.logger.info('Generated agents propagated to harness targets', {
        targets: health.targets
          .filter((target) => target.detected)
          .map((target) => target.target),
      });
    } catch (error: unknown) {
      this.logger.warn('Harness propagation after generation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Completing the setup wizard IS the user asking Ptah to manage subagents in
   * this workspace, so it is what grants the `agents` consent gate.
   *
   * Without this the wizard would generate agents into `{ws}/.claude/agents`,
   * the mirror would publish them to `~/.ptah/user/agents`, and the reconciler
   * would decline to fan a single one of them out to Codex, Copilot or Cursor —
   * a gate is only honest if the obvious action clears it.
   *
   * Non-fatal, like everything else on this path: a state file that would not
   * write costs the user one un-propagated pass, not a failed wizard run.
   */
  private grantAgentSyncConsent(workspaceRoot: string): void {
    try {
      if (!this.container.isRegistered(HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE)) {
        return;
      }
      const gate = this.resolveService<AgentSyncGate>(
        HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE,
        'AgentSyncGate',
      );
      if (gate.enable(workspaceRoot)) return;
      this.logger.warn(
        'Could not record agent-sync consent; generated agents may not reach rival CLIs',
        { workspaceRoot },
      );
    } catch (error: unknown) {
      this.logger.warn('Recording agent-sync consent failed', {
        error: error instanceof Error ? error.message : String(error),
      });
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
   * Removed wizard:start-multi-phase-analysis and
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
      if (!params?.selectedAgentIds?.length) {
        this.logger.warn(
          'RPC: wizard:submit-selection called with empty agent selection',
        );
        return {
          success: false,
          error: 'No agents selected. Please select at least one agent.',
        };
      }
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
        const orchestrator = this.resolveService<OrchestratorServiceInterface>(
          AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR,
          'AgentGenerationOrchestratorService',
        );
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
        let enhancedPromptContent: string | undefined;
        try {
          const enhancedPromptsService =
            this.resolveService<EnhancedPromptsServiceInterface>(
              AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE,
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
        let mcpServerRunning = false;
        let mcpPort: number | undefined;
        try {
          const codeExecutionMcp = this.resolveService<CodeExecutionMCP>(
            TOKENS.CODE_EXECUTION_MCP,
            'CodeExecutionMCP',
          );
          const actualPort = codeExecutionMcp.getPort();
          mcpServerRunning = actualPort !== null;
          mcpPort = actualPort ?? undefined;
        } catch (error) {
          this.logger.debug('Could not resolve MCP service for generation', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        const onStreamEvent = (event: GenerationStreamPayload): void => {
          if (!webviewManager) return;
          webviewManager
            .broadcastMessage('setup-wizard:generation-stream', event)
            .catch((broadcastError) => {
              this.logger.warn('Failed to broadcast generation stream event', {
                error:
                  broadcastError instanceof Error
                    ? broadcastError.message
                    : String(broadcastError),
              });
            });
        };
        const currentModel = params.model || undefined;
        const pluginPaths = this.resolvePluginPaths();
        const options: OrchestratorGenerationOptions = {
          workspacePath: workspaceRoot,
          userOverrides: params.selectedAgentIds,
          threshold: params.threshold,
          variableOverrides: params.variableOverrides,
          enhancedPromptContent,
          preComputedAnalysis,
          mcpServerRunning,
          mcpPort,
          onStreamEvent,
          model: currentModel,
          analysisDir,
          pluginPaths,
        };
        this.lastGenerationOptions = options;
        const progressCallback = (progress: GenerationProgress): void => {
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
            this.logger.warn('Error in generation progress callback', {
              error:
                callbackError instanceof Error
                  ? callbackError.message
                  : String(callbackError),
              phase: progress.phase,
            });
          }
        };
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

          void this.propagateGeneratedAgents(options.workspacePath);

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
            .catch(() => {});
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
          const setupWizardService =
            this.resolveService<SetupWizardServiceInterface>(
              AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE,
              'SetupWizardService',
            );
          const currentSession = setupWizardService.getCurrentSession();

          if (!currentSession) {
            this.logger.debug(
              'RPC: wizard:cancel - no active session to cancel',
            );
            if (this.isGenerating) {
              this.isGenerating = false;
              this.logger.info(
                'RPC: wizard:cancel - reset stuck isGenerating flag',
              );
            }

            return { cancelled: false };
          }
          const cancelResult = await setupWizardService.cancelWizard(
            currentSession.id,
            saveProgress,
          );
          this.isGenerating = false;

          if (cancelResult.isErr()) {
            this.logger.error('Failed to cancel wizard session', {
              sessionId: currentSession.id,
              error: cancelResult.error?.message,
            });
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
          this.isGenerating = false;
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
      if (!params?.itemId) {
        return {
          success: false,
          error: 'Item ID is required for retry.',
        };
      }
      if (this.isGenerating) {
        return {
          success: false,
          error:
            'Agent generation is already in progress. Please wait for it to complete before retrying.',
        };
      }
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
        const orchestrator = this.resolveService<OrchestratorServiceInterface>(
          AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR,
          'AgentGenerationOrchestratorService',
        );
        let webviewManager: WebviewBroadcaster | null = null;

        webviewManager = this.resolveService<WebviewBroadcaster>(
          TOKENS.WEBVIEW_MANAGER,
          'WebviewManager',
        );
        const onStreamEvent = (event: GenerationStreamPayload): void => {
          if (!webviewManager) return;
          webviewManager
            .broadcastMessage('setup-wizard:generation-stream', event)
            .catch((broadcastError) => {
              this.logger.warn('Failed to broadcast generation stream event', {
                error:
                  broadcastError instanceof Error
                    ? broadcastError.message
                    : String(broadcastError),
              });
            });
        };
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
          // A retried agent is a generated agent. Batch 2 wired propagation to
          // `wizard:submit-selection` only, so retrying the one item that had
          // failed wrote `{ws}/.claude/agents/<id>.md` and stopped there — the
          // item the user cared about most was the one item no rival CLI
          // received. Awaited, unlike the submit path, because a retry has no
          // long tail of remaining work to overlap with.
          await this.propagateGeneratedAgents(workspaceRoot);
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
}
