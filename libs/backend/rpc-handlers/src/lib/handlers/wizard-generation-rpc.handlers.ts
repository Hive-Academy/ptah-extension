/**
 * Wizard Generation RPC Handlers
 *
 * Handles RPC methods for the setup wizard generation pipeline:
 * - wizard:submit-selection - Start (or `resume: true` continue) a generation
 * - wizard:cancel - Pause the active generation; the checkpoint is kept
 * - wizard:retry-item - Re-run a single agent
 *
 * Design decisions:
 * - Every request is parsed with the Zod schemas in
 *   `wizard-generation-rpc.schema.ts` before any service is resolved.
 * - Lazy DI resolution via container for agent-generation services (same as
 *   SetupRpcHandlers); the two run-level collaborators are injected.
 * - `GenerationRunSupervisor` owns the single active run: its abort
 *   controller, watchdog and the one completion broadcast. There is no
 *   detached timer race any more — a timeout aborts the orchestrator and the
 *   completion payload reports what actually settled.
 * - `GenerationCheckpointService` persists a generation manifest BEFORE work
 *   starts and after every terminal agent outcome, so a run survives a host
 *   restart and `resume: true` re-runs only what is not yet current.
 * - Harness propagation runs whenever the settled summary wrote at least one
 *   file — a timed-out or paused run included — and stays warning-only.
 */

import { injectable, inject, DependencyContainer } from 'tsyringe';
import type { z } from 'zod';
import {
  Logger,
  RpcHandler,
  RpcUserError,
  TOKENS,
} from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import type { OrchestratorGenerationOptions } from '@ptah-extension/agent-generation';
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
  GenerationStreamPayload,
  Result,
  RpcMethodName,
} from '@ptah-extension/shared';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { WebviewBroadcaster } from '../harness/streaming';
import {
  GenerationCheckpointService,
  type GenerationCheckpointLocation,
  type PreparedGenerationRun,
} from './wizard-generation-checkpoint.service';
import {
  GenerationRunSupervisor,
  GENERATION_CANCEL_REASON,
  buildCompletePayload,
  type GenerationOrchestrator,
  type GenerationProgress,
  type SettledGenerationRun,
} from './wizard-generation-run.supervisor';
import {
  WizardCancelParamsSchema,
  WizardRetryItemParamsSchema,
  WizardSubmitSelectionParamsSchema,
  formatIssue,
} from './wizard-generation-rpc.schema';

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
 * Interface for the EnhancedPromptsService methods we need.
 * Uses structural typing to avoid importing the concrete class.
 */
interface EnhancedPromptsServiceInterface {
  getEnhancedPromptContent(workspacePath: string): Promise<string | null>;
}

/** Runtime facts resolved fresh for every launch; never persisted. */
interface GenerationRuntime {
  orchestrator: GenerationOrchestrator;
  webviewManager: WebviewBroadcaster | null;
  enhancedPromptContent?: string;
  mcpServerRunning: boolean;
  mcpPort?: number;
  pluginPaths?: string[];
}

/**
 * RPC handlers for setup wizard generation operations.
 *
 * Concurrency: only one generation runs at a time. `GenerationRunSupervisor`
 * is active from launch until the completion payload has gone out, so a
 * second submit/resume/retry is rejected until the previous run settled.
 */
@injectable()
export class WizardGenerationRpcHandlers {
  static readonly METHODS = [
    'wizard:submit-selection',
    'wizard:cancel',
    'wizard:retry-item',
  ] as const satisfies readonly RpcMethodName[];

  /**
   * Options of the last launched run (without abort signal), reused by
   * `wizard:retry-item` to preserve analysis, SDK config and enhanced prompt.
   */
  private lastGenerationOptions: OrchestratorGenerationOptions | null = null;

  /** Checkpoint of the last launched run; a retry updates the same record. */
  private lastCheckpoint: GenerationCheckpointLocation | null = null;

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
    @inject(GenerationCheckpointService)
    private readonly checkpoints: GenerationCheckpointService,
    @inject(GenerationRunSupervisor)
    private readonly runs: GenerationRunSupervisor,
  ) {}

  register(): void {
    this.registerSubmitSelection();
    this.registerCancel();
    this.registerRetryItem();

    this.logger.debug('Wizard generation RPC handlers registered', {
      methods: [...WizardGenerationRpcHandlers.METHODS],
    });
  }

  // ---------------------------------------------------------------------------
  // wizard:submit-selection
  // ---------------------------------------------------------------------------

  /**
   * Start a generation, or with `resume: true` continue the persisted one.
   *
   * Order of operations is load-bearing: validate → guards → resolve runtime
   * services → write/prepare the checkpoint → launch. A checkpoint write
   * failure therefore starts no orchestrator work, and an orchestrator that
   * cannot be resolved leaves no `running` manifest behind.
   */
  private registerSubmitSelection(): void {
    this.rpcHandler.registerMethod<
      WizardSubmitSelectionParams,
      WizardSubmitSelectionResponse
    >('wizard:submit-selection', async (params) => {
      const parsed = this.parse(WizardSubmitSelectionParamsSchema, params);
      const resume = parsed.resume === true;
      const selectedAgentIds = parsed.selectedAgentIds ?? [];
      if (!resume && selectedAgentIds.length === 0) {
        this.logger.warn(
          'RPC: wizard:submit-selection called with empty agent selection',
        );
        return {
          success: false,
          error: 'No agents selected. Please select at least one agent.',
        };
      }
      if (this.runs.isActive) {
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
      const analysisDir = this.authorizeAnalysisDir(
        workspaceRoot,
        parsed.analysisDir,
      );
      if (
        params?.analysisData !== undefined &&
        parsed.analysisData === undefined
      ) {
        this.logger.warn(
          'RPC: wizard:submit-selection ignored analysisData that is not a ProjectAnalysisResult; the orchestrator will analyze the workspace itself',
        );
      }

      try {
        const runtime = await this.resolveRuntime(workspaceRoot);
        const prepared = resume
          ? await this.prepareResumedRun(workspaceRoot, analysisDir)
          : await this.checkpoints.createFresh({
              workspaceRoot,
              analysisDir,
              selectedAgentIds,
              input: {
                threshold: parsed.threshold,
                variableOverrides: parsed.variableOverrides,
                model: parsed.model,
                analysisData: parsed.analysisData,
              },
            });
        if (!prepared) {
          return {
            success: false,
            error: 'No resumable generation run was found for this workspace.',
          };
        }
        if (prepared.agentIds.length === 0) {
          await this.completeWithoutWork(prepared, runtime.webviewManager);
          return { success: true };
        }

        const options = this.buildOptions(workspaceRoot, prepared, runtime);
        this.lastGenerationOptions = options;
        this.lastCheckpoint = prepared.location;
        this.logger.info('RPC: wizard:submit-selection started', {
          runId: prepared.manifest.runId,
          resume,
          agents: prepared.agentIds,
          carriedOver: prepared.carriedOver.length,
          workspace: workspaceRoot,
        });
        void this.runs.run({
          orchestrator: runtime.orchestrator,
          options,
          progressCallback: this.createProgressBroadcaster(
            runtime.webviewManager,
          ),
          broadcaster: runtime.webviewManager,
          outputDirectory: prepared.manifest.outputDirectory,
          carriedOver: prepared.carriedOver,
          onSettled: (settled) =>
            this.afterSettled(
              'wizard:submit-selection',
              prepared.location,
              workspaceRoot,
              settled,
            ),
        });
        return { success: true };
      } catch (error: unknown) {
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
        return {
          success: false,
          error: `Agent generation failed: ${errorMessage}`,
        };
      }
    });
  }

  /**
   * Locate and prepare the checkpoint a `resume: true` request refers to.
   * Returns null when there is none or when its paths are not trusted; the
   * checkpoint itself is never deleted.
   */
  private async prepareResumedRun(
    workspaceRoot: string,
    analysisDir: string | null,
  ): Promise<PreparedGenerationRun | null> {
    const located = await this.checkpoints.locateResumable(
      workspaceRoot,
      analysisDir,
    );
    if (!located) return null;
    if (!this.checkpoints.isTrusted(located.location, located.manifest)) {
      this.logger.warn(
        'RPC: wizard:submit-selection refused a checkpoint whose paths leave the workspace',
        { runId: located.manifest.runId },
      );
      return null;
    }
    return this.checkpoints.prepareResume(located.location, located.manifest);
  }

  /**
   * Every selected agent is already current: no orchestrator work, but the
   * run still settles — the checkpoint completes and one payload goes out.
   */
  private async completeWithoutWork(
    prepared: PreparedGenerationRun,
    broadcaster: WebviewBroadcaster | null,
  ): Promise<void> {
    await this.checkpoints.finalize(prepared.location, 'completed');
    await this.runs.broadcastCompletion(
      broadcaster,
      buildCompletePayload({
        summary: null,
        failure: null,
        abortReason: null,
        carriedOver: prepared.carriedOver,
        outputDirectory: prepared.manifest.outputDirectory,
        durationMs: 0,
      }),
    );
  }

  /**
   * After the orchestrator settled: record the terminal lifecycle, then
   * propagate whenever this run actually wrote a file — a timed-out or paused
   * run included. Runs before the single completion broadcast.
   */
  private async afterSettled(
    method: string,
    location: GenerationCheckpointLocation,
    workspaceRoot: string,
    settled: SettledGenerationRun,
  ): Promise<void> {
    const lifecycle = settled.summary?.lifecycle ?? 'failed';
    await this.checkpoints.finalize(location, lifecycle);
    if (settled.summary) {
      this.logger.info(`RPC: ${method} settled`, {
        lifecycle,
        written: settled.summary.writtenCount,
        unchanged: settled.summary.unchangedCount,
        failed: settled.summary.failedCount,
        durationMs: settled.durationMs,
      });
      if (settled.summary.writtenCount > 0) {
        await this.propagateGeneratedAgents(workspaceRoot);
      }
    } else {
      this.logger.error(`RPC: ${method} failed`, {
        error: settled.failure?.message,
        durationMs: settled.durationMs,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // wizard:cancel
  // ---------------------------------------------------------------------------

  /**
   * Pause the active generation and cancel the wizard session.
   *
   * The abort reaches the orchestrator through the supervisor's signal; the
   * run stays active until it has actually stopped and broadcast its settled
   * outcome, and its checkpoint is kept so `resume: true` can continue it.
   * Safe to call when nothing is running.
   */
  private registerCancel(): void {
    this.rpcHandler.registerMethod<WizardCancelParams, WizardCancelResponse>(
      'wizard:cancel',
      async (params) => {
        const parsed = this.parse(WizardCancelParamsSchema, params);
        const saveProgress = parsed.saveProgress ?? true;
        const abortedRun = this.runs.abort(GENERATION_CANCEL_REASON);
        this.logger.debug('RPC: wizard:cancel called', {
          saveProgress,
          abortedRun,
        });

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
            return abortedRun
              ? { cancelled: true, progressSaved: true }
              : { cancelled: false };
          }
          const cancelResult = await setupWizardService.cancelWizard(
            currentSession.id,
            saveProgress,
          );
          if (cancelResult.isErr()) {
            this.logger.error('Failed to cancel wizard session', {
              sessionId: currentSession.id,
              error: cancelResult.error?.message,
            });
          } else {
            this.logger.info('RPC: wizard:cancel completed', {
              sessionId: currentSession.id,
              progressSaved: saveProgress,
            });
          }
          return {
            cancelled: true,
            sessionId: currentSession.id,
            // A paused generation always keeps its checkpoint.
            progressSaved: abortedRun || saveProgress,
          };
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.warn('RPC: wizard:cancel error', {
            error: errorMessage,
          });
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(errorMessage),
            { errorSource: 'WizardGenerationRpcHandlers.registerCancel' },
          );
          return abortedRun
            ? { cancelled: true, progressSaved: true }
            : { cancelled: false };
        }
      },
    );
  }

  // ---------------------------------------------------------------------------
  // wizard:retry-item
  // ---------------------------------------------------------------------------

  /**
   * Re-run one agent through the same supervisor, checkpoint record and
   * summary-to-payload mapping as a full run. Awaited, unlike submit: a retry
   * has no long tail of remaining work to overlap with.
   */
  private registerRetryItem(): void {
    this.rpcHandler.registerMethod<
      WizardRetryItemParams,
      WizardRetryItemResponse
    >('wizard:retry-item', async (params) => {
      const parsed = this.parse(WizardRetryItemParamsSchema, params);
      if (this.runs.isActive) {
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

      try {
        this.logger.info('RPC: wizard:retry-item started', {
          itemId: parsed.itemId,
          workspace: workspaceRoot,
        });
        const orchestrator = this.resolveService<GenerationOrchestrator>(
          AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR,
          'AgentGenerationOrchestratorService',
        );
        const webviewManager = this.resolveWebviewManager();
        const checkpoint = this.lastCheckpoint;
        const options: OrchestratorGenerationOptions = {
          ...(this.lastGenerationOptions ?? {}),
          workspacePath: workspaceRoot,
          userOverrides: [parsed.itemId],
          onStreamEvent: this.createStreamBroadcaster(webviewManager),
          onAgentOutcome: checkpoint
            ? (outcome) => this.checkpoints.recordOutcome(checkpoint, outcome)
            : undefined,
        };

        const settled = await this.runs.run({
          orchestrator,
          options,
          broadcaster: webviewManager,
          outputDirectory: this.checkpoints.outputDirectoryFor(workspaceRoot),
          carriedOver: [],
          onSettled: (result) =>
            checkpoint
              ? this.afterSettled(
                  'wizard:retry-item',
                  checkpoint,
                  workspaceRoot,
                  result,
                )
              : this.afterSettledWithoutCheckpoint(workspaceRoot, result),
        });

        if (settled.failure?.thrown) {
          throw new Error(settled.failure.message);
        }
        if (settled.payload.success) {
          return { success: true };
        }
        const errorMessage =
          settled.failure?.message ??
          settled.payload.errors?.[0] ??
          `Failed to retry item ${parsed.itemId}`;
        this.logger.error('RPC: wizard:retry-item failed', {
          itemId: parsed.itemId,
          error: errorMessage,
        });
        return { success: false, error: errorMessage };
      } catch (error: unknown) {
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
      }
    });
  }

  /** Retry with no checkpoint on record: propagation still follows a write. */
  private async afterSettledWithoutCheckpoint(
    workspaceRoot: string,
    settled: SettledGenerationRun,
  ): Promise<void> {
    if ((settled.summary?.writtenCount ?? 0) > 0) {
      await this.propagateGeneratedAgents(workspaceRoot);
    }
  }

  // ---------------------------------------------------------------------------
  // Run assembly
  // ---------------------------------------------------------------------------

  /**
   * Resolve the services a launch needs. The orchestrator is required; the
   * webview, enhanced prompt, MCP port and plugin paths are best-effort.
   */
  private async resolveRuntime(
    workspaceRoot: string,
  ): Promise<GenerationRuntime> {
    const orchestrator = this.resolveService<GenerationOrchestrator>(
      AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR,
      'AgentGenerationOrchestratorService',
    );
    const webviewManager = this.resolveWebviewManager();

    let enhancedPromptContent: string | undefined;
    try {
      const enhancedPromptsService =
        this.resolveService<EnhancedPromptsServiceInterface>(
          AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE,
          'EnhancedPromptsService',
        );
      const content =
        await enhancedPromptsService.getEnhancedPromptContent(workspaceRoot);
      if (content) {
        enhancedPromptContent = content;
        this.logger.info(
          'Enhanced prompt content resolved for generation pipeline',
          { contentLength: content.length },
        );
      }
    } catch {
      this.logger.warn(
        'EnhancedPromptsService not available. Generation will proceed without enhanced prompt context.',
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
    } catch (error: unknown) {
      this.logger.debug('Could not resolve MCP service for generation', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      orchestrator,
      webviewManager,
      enhancedPromptContent,
      mcpServerRunning,
      mcpPort,
      pluginPaths: this.resolvePluginPaths(),
    };
  }

  /**
   * Orchestrator options for a prepared run. Generation inputs come from the
   * checkpoint (persisted at submit time, so a resume needs no frontend
   * memory); runtime facts come from `resolveRuntime`.
   */
  private buildOptions(
    workspaceRoot: string,
    prepared: PreparedGenerationRun,
    runtime: GenerationRuntime,
  ): OrchestratorGenerationOptions {
    const { input } = prepared.manifest;
    return {
      workspacePath: workspaceRoot,
      userOverrides: prepared.agentIds,
      threshold: input.threshold,
      variableOverrides: input.variableOverrides,
      enhancedPromptContent: runtime.enhancedPromptContent,
      preComputedAnalysis: input.analysisData,
      mcpServerRunning: runtime.mcpServerRunning,
      mcpPort: runtime.mcpPort,
      onStreamEvent: this.createStreamBroadcaster(runtime.webviewManager),
      model: input.model,
      analysisDir: prepared.location.analysisDir ?? undefined,
      pluginPaths: runtime.pluginPaths,
      onAgentOutcome: (outcome) =>
        this.checkpoints.recordOutcome(prepared.location, outcome),
    };
  }

  /**
   * Canonicalize a caller-supplied analysis directory. Absent → null. Present
   * but outside `<workspace>/.ptah/analysis` → typed rejection.
   */
  private authorizeAnalysisDir(
    workspaceRoot: string,
    candidate: string | undefined,
  ): string | null {
    if (candidate === undefined) return null;
    const canonical = this.checkpoints.resolveAuthorizedAnalysisDir(
      workspaceRoot,
      candidate,
    );
    if (canonical === null) {
      throw new RpcUserError(
        'Access denied: analysis directory is outside the workspace analysis root.',
        'UNAUTHORIZED_WORKSPACE',
      );
    }
    return canonical;
  }

  private createStreamBroadcaster(
    webviewManager: WebviewBroadcaster | null,
  ): (event: GenerationStreamPayload) => void {
    return (event) => {
      if (!webviewManager) return;
      webviewManager
        .broadcastMessage('setup-wizard:generation-stream', event)
        .catch((broadcastError: unknown) => {
          this.logger.warn('Failed to broadcast generation stream event', {
            error:
              broadcastError instanceof Error
                ? broadcastError.message
                : String(broadcastError),
          });
        });
    };
  }

  /** Progress callback errors are caught so they cannot crash the pipeline. */
  private createProgressBroadcaster(
    webviewManager: WebviewBroadcaster | null,
  ): (progress: GenerationProgress) => void {
    return (progress) => {
      if (!webviewManager) return;
      try {
        const payload: GenerationProgressPayload = {
          progress: {
            phase: progress.phase === 'writing' ? 'rendering' : progress.phase,
            percentComplete: progress.percentComplete,
            currentAgent: progress.currentOperation,
          },
        };
        webviewManager
          .broadcastMessage('setup-wizard:generation-progress', payload)
          .catch((broadcastError: unknown) => {
            this.logger.warn('Failed to broadcast generation progress', {
              error:
                broadcastError instanceof Error
                  ? broadcastError.message
                  : String(broadcastError),
              phase: progress.phase,
            });
          });
      } catch (callbackError: unknown) {
        this.logger.warn('Error in generation progress callback', {
          error:
            callbackError instanceof Error
              ? callbackError.message
              : String(callbackError),
          phase: progress.phase,
        });
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Propagation (non-fatal throughout)
  // ---------------------------------------------------------------------------

  /**
   * Fan freshly generated subagents out to every harness target through
   * `HarnessPropagationService` (mirror, then reconcile — the reconciler's
   * desired state IS the user layer, and `{ws}/.claude/agents` is a SOURCE,
   * so an agent the wizard just wrote is invisible to a reconcile until the
   * mirror has run). A wizard run must not fail because a rival CLI's
   * directory was read-only.
   */
  private async propagateGeneratedAgents(workspaceRoot: string): Promise<void> {
    try {
      // BEFORE the propagate, because the reconciler resolves the gate at the
      // top of the pass: granting after it would leave the agents this run
      // just generated sitting in the user layer until a later trigger.
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
   * this workspace, so it is what grants the `agents` consent gate. Without it
   * the reconciler would decline to fan a single generated agent out to
   * Codex, Copilot or Cursor.
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

  // ---------------------------------------------------------------------------
  // Resolution helpers
  // ---------------------------------------------------------------------------

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
    } catch (error: unknown) {
      this.logger.debug('Failed to resolve plugin paths for generation', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private resolveWebviewManager(): WebviewBroadcaster | null {
    try {
      return this.resolveService<WebviewBroadcaster>(
        TOKENS.WEBVIEW_MANAGER,
        'WebviewManager',
      );
    } catch {
      this.logger.warn(
        'WebviewManager not available for progress broadcasting. Generation will proceed without progress updates.',
      );
      return null;
    }
  }

  /**
   * Resolve a service from the DI container with a descriptive failure.
   */
  private resolveService<T>(token: symbol | string, serviceName: string): T {
    try {
      const service = this.container.resolve(token);
      if (service === null || service === undefined) {
        throw new Error(`${serviceName} resolved to null/undefined`);
      }
      return service as T;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to resolve ${serviceName}`, {
        error: message,
      });
      throw new Error(
        `${serviceName} not available. Ensure the agent-generation module is properly initialized. Details: ${message}`,
      );
    }
  }

  /** Parse RPC params at the boundary; a schema failure is a typed user error. */
  private parse<T>(schema: z.ZodType<T>, params: unknown): T {
    const result = schema.safeParse(params ?? {});
    if (!result.success) {
      throw new RpcUserError(
        `Invalid parameters: ${formatIssue(result.error)}`,
        'INVALID_PARAMS',
      );
    }
    return result.data;
  }
}
