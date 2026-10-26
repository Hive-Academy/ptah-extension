/**
 * Wizard Generation RPC Handlers
 *
 * Handles RPC methods for the setup wizard generation pipeline:
 * - wizard:submit-selection - Start (or `resume: true` continue) a generation
 * - wizard:preview-generation - The files a generation would write; read-only
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
 * - A fresh submit's keep/replace decisions are bound to a server-held
 *   preview token (`GenerationPreviewService`); without one it only creates
 *   missing files. The validated guards, the target and the output root are
 *   persisted in the run manifest, and every launch, resume and retry takes
 *   them from the manifest only.
 * - Harness propagation runs whenever the settled summary wrote at least one
 *   file under the harness root — a timed-out or paused run included — and
 *   stays warning-only. Its user-layer refresh decides the run's Library
 *   outcome. `GenerationLibraryPassService` runs that pass for every agents
 *   run, tab-bound or not (`wizard-generation/generation-library-pass.service.ts`).
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
import * as path from 'path';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import type {
  AnalysisFreshnessService,
  AnalysisStorageService,
  GenerationCheckpointManifest,
  OrchestratorGenerationOptions,
  WizardAgentOriginStore,
  WrittenAgentFile,
} from '@ptah-extension/agent-generation';
import { SDK_TOKENS, PluginLoaderService } from '@ptah-extension/agent-sdk';
import { CodeExecutionMCP } from '@ptah-extension/vscode-lm-tools';
import type {
  WizardPreviewGenerationParams,
  WizardPreviewGenerationResponse,
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
  SetupGenerationTabBinding,
  SetupGenerationRunBinding,
  SetupGenerationResultFacts,
  GenerationContextSource,
  WizardGetGenerationRunStateParams,
  WizardGetGenerationRunStateResponse,
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
  GenerationLibraryPassService,
  libraryScopeOf,
  type RunLibraryScope,
} from './wizard-generation/generation-library-pass.service';
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
  WizardPreviewGenerationParamsSchema,
  WizardRetryItemParamsSchema,
  WizardSubmitSelectionParamsSchema,
  formatIssue,
  WizardTabBindingSchema,
  WizardRunBindingSchema,
  WizardGetGenerationRunStateParamsSchema,
} from './wizard-generation-rpc.schema';
import {
  acceptedSubmit,
  authorizeTabWorkspace,
  blockedSubmit,
  previewRequiredSubmit,
  resolveGenerationContext,
  generationRunState,
  rejectSubmit,
  resolveProviderRoute,
  sameWorkspacePath,
  resultDetailsFromManifest,
  type GenerationProviderModels,
} from './wizard-generation-binding';
import {
  GenerationPreviewService,
  previewKeyFor,
  type DecisionValidation,
} from './wizard-generation/generation-preview.service';

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

/** The origin store calls this handler makes: record a write, read the hashes. */
type AgentOriginRecorder = Pick<
  WizardAgentOriginStore,
  'read' | 'recordWritten' | 'hashWrittenFile'
>;

const CHANGED_SINCE_PREVIEW_RETRY_ERROR =
  'The file changed after the preview, so it was kept. Preview again to replace it.';

/** Exact DI identity from auth-providers-tokens, without pulling its package into this project. */
const SDK_PROVIDER_MODELS_TOKEN = Symbol.for('SdkProviderModels');

/**
 * RPC handlers for setup wizard generation operations.
 *
 * Concurrency: only one generation runs at a time. A submit reserves the slot
 * while preparing; `GenerationRunSupervisor` holds it from launch until the
 * completion payload has gone out. A second submit/resume/retry is rejected.
 */
@injectable()
export class WizardGenerationRpcHandlers {
  static readonly METHODS = [
    'wizard:submit-selection',
    'wizard:preview-generation',
    'wizard:cancel',
    'wizard:get-generation-run-state',
    'wizard:retry-item',
  ] as const satisfies readonly RpcMethodName[];

  /**
   * Options of the last launched run (without abort signal), reused by
   * `wizard:retry-item` to preserve analysis, SDK config and enhanced prompt.
   */
  private lastGenerationOptions: OrchestratorGenerationOptions | null = null;

  /** Library scope of the last launched untabbed run, reused by its retry. */
  private lastRunScope: RunLibraryScope | null = null;

  /** Checkpoint of the last launched run; a retry updates the same record. */
  private lastCheckpoint: GenerationCheckpointLocation | null = null;

  /** Reserves the submit slot while its checkpoint and runtime are prepared. */
  private submitReserved = false;

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
    @inject(GenerationPreviewService)
    private readonly previews: GenerationPreviewService,
    @inject(AGENT_GENERATION_TOKENS.AGENT_ORIGIN_STORE)
    private readonly originStore: AgentOriginRecorder,
    @inject(GenerationLibraryPassService)
    private readonly libraryPass: GenerationLibraryPassService,
  ) {}

  register(): void {
    this.registerSubmitSelection();
    this.registerPreviewGeneration();
    this.registerCancel();
    this.rpcHandler.registerMethod<
      WizardGetGenerationRunStateParams,
      WizardGetGenerationRunStateResponse
    >('wizard:get-generation-run-state', (params) =>
      this.getGenerationRunState(params),
    );
    this.registerRetryItem();

    this.logger.debug('Wizard generation RPC handlers registered', {
      methods: [...WizardGenerationRpcHandlers.METHODS],
    });
  }

  /** Internal recovery seam. B03 owns registration of its RPC name. */
  async getGenerationRunState(
    params: WizardGetGenerationRunStateParams,
  ): Promise<WizardGetGenerationRunStateResponse> {
    const parsed = WizardGetGenerationRunStateParamsSchema.safeParse(params);
    if (!parsed.success)
      return { run: null, rejection: { reason: 'invalid-binding' } };
    const hostRoot = this.workspaceProvider.getWorkspaceRoot();
    if (!hostRoot)
      return { run: null, rejection: { reason: 'workspace-mismatch' } };
    const workspaceRoot = await authorizeTabWorkspace(
      hostRoot,
      parsed.data.tabBinding,
      this.logger,
    );
    if (!workspaceRoot)
      return { run: null, rejection: { reason: 'workspace-mismatch' } };
    const active = this.runs.binding;
    const canonicalBinding = {
      ...parsed.data.tabBinding,
      workspacePath: workspaceRoot,
    };
    const checkpoint = await this.checkpoints.locateBound(
      workspaceRoot,
      canonicalBinding,
      parsed.data.runId,
    );
    if (!checkpoint) return { run: null };
    return generationRunState(checkpoint.manifest, canonicalBinding, active);
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
      if (
        params?.tabBinding !== undefined &&
        !WizardTabBindingSchema.safeParse(params.tabBinding).success
      )
        return rejectSubmit('invalid-binding');
      const requestedBinding = params?.tabBinding;
      const hostRoot = this.workspaceProvider.getWorkspaceRoot();
      const authorizedWorkspace =
        requestedBinding && hostRoot
          ? await authorizeTabWorkspace(hostRoot, requestedBinding, this.logger)
          : null;
      if (requestedBinding && !authorizedWorkspace)
        return rejectSubmit('workspace-mismatch');
      const parsed = this.parse(
        WizardSubmitSelectionParamsSchema,
        requestedBinding ? { ...params, analysisData: undefined } : params,
      );
      const tabBinding =
        parsed.tabBinding && authorizedWorkspace
          ? { ...parsed.tabBinding, workspacePath: authorizedWorkspace }
          : undefined;
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
      if (this.runs.isActive || this.submitReserved) {
        this.logger.warn(
          'RPC: wizard:submit-selection rejected - generation already in progress',
        );
        if (tabBinding) {
          return blockedSubmit(tabBinding, this.runs.binding);
        }
        return {
          success: false,
          error:
            'Agent generation is already in progress. Please wait for it to complete or cancel it first.',
        };
      }
      this.submitReserved = true;
      try {
        const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
        if (!workspaceRoot) {
          if (tabBinding) return rejectSubmit('workspace-mismatch');
          return {
            success: false,
            error:
              'No workspace folder open. Please open a folder to generate agents.',
          };
        }
        const canonicalWorkspace = authorizedWorkspace ?? workspaceRoot;
        const effectiveWorkspace = canonicalWorkspace ?? workspaceRoot;
        if (
          tabBinding &&
          parsed.analysisDir &&
          !this.checkpoints.resolveAuthorizedAnalysisDir(
            effectiveWorkspace,
            parsed.analysisDir,
          )
        )
          return rejectSubmit('foreign-directory');
        const analysisDir = this.authorizeAnalysisDir(
          effectiveWorkspace,
          parsed.analysisDir,
        );
        if (
          !tabBinding &&
          params?.analysisData !== undefined &&
          parsed.analysisData === undefined
        ) {
          this.logger.warn(
            'RPC: wizard:submit-selection ignored analysisData that is not a ProjectAnalysisResult; the orchestrator will analyze the workspace itself',
          );
        }

        try {
          return await this.executeSubmitInWorkspace({
            workspaceRoot,
            effectiveWorkspace,
            analysisDir,
            parsed,
            tabBinding,
            resume,
            selectedAgentIds,
          });
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            'RPC: wizard:submit-selection unexpected error',
            error instanceof Error ? error : new Error(errorMessage),
          );
          if (error instanceof RpcUserError) throw error;
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(errorMessage),
            {
              errorSource:
                'WizardGenerationRpcHandlers.registerSubmitSelection',
            },
          );
          return {
            success: false,
            error: tabBinding
              ? 'Agent generation could not start. Please retry.'
              : `Agent generation failed: ${errorMessage}`,
          };
        }
      } finally {
        this.submitReserved = false;
      }
    });
  }

  private async executeSubmitInWorkspace(args: {
    workspaceRoot: string;
    effectiveWorkspace: string;
    analysisDir: string | null;
    parsed: z.infer<typeof WizardSubmitSelectionParamsSchema>;
    tabBinding: SetupGenerationTabBinding | undefined;
    resume: boolean;
    selectedAgentIds: string[];
  }): Promise<WizardSubmitSelectionResponse> {
    const {
      workspaceRoot,
      effectiveWorkspace,
      analysisDir,
      parsed,
      tabBinding,
      resume,
      selectedAgentIds,
    } = args;
    const freshness = this.resolveService<AnalysisFreshnessService>(
      AGENT_GENERATION_TOKENS.ANALYSIS_FRESHNESS_SERVICE,
      'AnalysisFreshnessService',
    );
    const storage = this.resolveService<AnalysisStorageService>(
      AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE,
      'AnalysisStorageService',
    );
    const { status, freshDir, trustedDir, source } =
      await resolveGenerationContext(
        freshness,
        storage,
        effectiveWorkspace,
        analysisDir,
        tabBinding,
        this.logger,
      );
    const runtime = await this.resolveRuntime(effectiveWorkspace);
    const route = tabBinding
      ? resolveProviderRoute(
          this.resolveService<GenerationProviderModels>(
            SDK_PROVIDER_MODELS_TOKEN,
            'ProviderModelsService',
          ),
          parsed.model,
        )
      : null;
    if (resume && tabBinding) {
      const owner = await this.checkpoints.locateResumable(
        effectiveWorkspace,
        null,
      );
      if (
        owner &&
        this.checkpoints.isTrusted(owner.location, owner.manifest) &&
        owner.manifest.tabBinding &&
        (owner.manifest.tabBinding.tabId !== tabBinding.tabId ||
          !(await sameWorkspacePath(
            owner.manifest.tabBinding.workspacePath,
            tabBinding.workspacePath,
          )))
      ) {
        return {
          success: false,
          rejection: {
            reason: 'blocked',
            ownerTabId: owner.manifest.tabBinding.tabId,
          },
          error: 'Agent generation is already owned by another tab.',
        };
      }
    }
    // A fresh submit binds its keep/replace decisions to the preview token and
    // persists them in the run manifest; a resume never takes decisions from
    // the request (A1), it applies the ones its manifest recorded.
    const previewKey = previewKeyFor(tabBinding?.tabId);
    let decisions: Extract<DecisionValidation, { ok: true }> | null = null;
    let usedPreview = false;
    if (!resume) {
      const decided = await this.previews.validateDecisions({
        key: previewKey,
        workspace: effectiveWorkspace,
        agentIds: selectedAgentIds,
        target: parsed.target,
        previewToken: parsed.previewToken,
        decisions: parsed.fileDecisions,
        requirePreview: !!tabBinding,
      });
      if (!decided.ok) return previewRequiredSubmit();
      usedPreview = !!tabBinding || decided.tokenBound;
      decisions = decided;
    } else if (
      parsed.previewToken !== undefined ||
      parsed.fileDecisions !== undefined
    ) {
      this.logger.warn(
        'RPC: wizard:submit-selection ignored preview decisions on a resume; the run keeps its own',
      );
    }
    const prepared = await this.prepareSubmittedRun({
      effectiveWorkspace,
      analysisDir,
      tabBinding,
      source,
      route,
      runtime,
      selectedAgentIds,
      parsed,
      trustedDir,
      decisions,
    });
    if (!prepared) {
      return {
        success: false,
        error: 'No resumable generation run was found for this workspace.',
      };
    }
    if (prepared.agentIds.length === 0) {
      await this.completeWithoutWork(prepared, runtime.webviewManager, {
        source,
        effectiveProvider: route?.provider,
        effectiveModel: route?.model,
        enhancedPromptsUsed: !!runtime.enhancedPromptContent,
      });
      if (usedPreview) this.previews.release(previewKey);
      return acceptedSubmit(tabBinding, prepared, source, route);
    }

    const accepted = await this.launchSubmittedRun({
      workspaceRoot,
      effectiveWorkspace,
      analysisDir,
      status,
      freshDir,
      trustedDir,
      source,
      route,
      runtime,
      prepared,
      tabBinding,
      resume,
    });
    if (accepted.success && usedPreview) this.previews.release(previewKey);
    return accepted;
  }

  private async prepareSubmittedRun(args: {
    effectiveWorkspace: string;
    analysisDir: string | null;
    tabBinding: SetupGenerationTabBinding | undefined;
    source: GenerationContextSource;
    route: { provider: string; model: string } | null;
    runtime: GenerationRuntime;
    selectedAgentIds: string[];
    parsed: z.infer<typeof WizardSubmitSelectionParamsSchema>;
    trustedDir: string | null;
    /** Validated decisions of a fresh submit; null means a resume. */
    decisions: Extract<DecisionValidation, { ok: true }> | null;
  }): Promise<PreparedGenerationRun | null> {
    const {
      effectiveWorkspace,
      analysisDir,
      tabBinding,
      source,
      route,
      runtime,
      selectedAgentIds,
      parsed,
      trustedDir,
      decisions,
    } = args;
    const prepared =
      decisions === null
        ? await this.prepareResumedRun(
            effectiveWorkspace,
            tabBinding ? null : analysisDir,
            tabBinding
              ? {
                  tabBinding,
                  source,
                  effectiveProvider: route?.provider,
                  effectiveModel: route?.model,
                  enhancedPromptsUsed: !!runtime.enhancedPromptContent,
                }
              : undefined,
          )
        : await this.checkpoints.createFresh({
            workspaceRoot: effectiveWorkspace,
            analysisDir: tabBinding
              ? source.kind === 'verified-analysis'
                ? trustedDir
                : null
              : analysisDir,
            selectedAgentIds,
            ...(tabBinding
              ? {
                  tabBinding,
                  source,
                  effectiveProvider: route?.provider,
                  effectiveModel: route?.model,
                  enhancedPromptsUsed: !!runtime.enhancedPromptContent,
                }
              : {}),
            input: {
              threshold: parsed.threshold,
              variableOverrides: parsed.variableOverrides,
              model: route?.model ?? parsed.model,
              analysisData: tabBinding ? undefined : parsed.analysisData,
            },
            target: decisions.target,
            fileGuards: decisions.guards,
          });
    return prepared;
  }

  private async launchSubmittedRun(args: {
    workspaceRoot: string;
    effectiveWorkspace: string;
    analysisDir: string | null;
    status: Awaited<ReturnType<AnalysisFreshnessService['getStatus']>>;
    freshDir: string | null;
    trustedDir: string | null;
    source: GenerationContextSource;
    route: { provider: string; model: string } | null;
    runtime: GenerationRuntime;
    prepared: PreparedGenerationRun;
    tabBinding: SetupGenerationTabBinding | undefined;
    resume: boolean;
  }): Promise<WizardSubmitSelectionResponse> {
    const {
      workspaceRoot,
      effectiveWorkspace,
      analysisDir,
      status,
      freshDir,
      trustedDir,
      source,
      route,
      runtime,
      prepared,
      tabBinding,
      resume,
    } = args;
    const resumeRequestedDir = analysisDir ?? prepared.location.analysisDir;
    const selectedTrustedDir =
      freshDir && (!resumeRequestedDir || resumeRequestedDir === freshDir)
        ? freshDir
        : null;
    if (!selectedTrustedDir) {
      this.logger.warn('RPC: wizard:submit-selection using workspace context', {
        analysisState: status.state,
        analysisReason: status.reason,
        analysisDirMatches:
          !resumeRequestedDir || resumeRequestedDir === freshDir,
      });
    }
    const scope = libraryScopeOf(effectiveWorkspace, prepared.manifest);
    const options = this.buildOptions(
      effectiveWorkspace,
      prepared,
      runtime,
      tabBinding
        ? source.kind === 'verified-analysis'
          ? trustedDir
          : null
        : selectedTrustedDir,
      scope,
    );
    if (this.runs.isActive) {
      await this.checkpoints.finalize(prepared.location, 'failed');
      return {
        success: false,
        error:
          'Agent generation is already in progress. Please wait for it to complete or cancel it first.',
      };
    }
    if (!tabBinding) {
      this.lastGenerationOptions = options;
      this.lastCheckpoint = prepared.location;
      this.lastRunScope = scope;
    }
    this.logger.info('RPC: wizard:submit-selection started', {
      runId: prepared.manifest.runId,
      resume,
      agents: prepared.agentIds,
      carriedOver: prepared.carriedOver.length,
      workspace: workspaceRoot,
    });
    void this.runs
      .run({
        orchestrator: runtime.orchestrator,
        ...(tabBinding
          ? {
              tabBinding: {
                ...tabBinding,
                runId: prepared.manifest.runId,
              },
            }
          : {}),
        source,
        effectiveProvider: route?.provider,
        effectiveModel: route?.model,
        enhancedPromptsUsed: !!runtime.enhancedPromptContent,
        options,
        progressCallback: this.createProgressBroadcaster(
          runtime.webviewManager,
          tabBinding
            ? { ...tabBinding, runId: prepared.manifest.runId }
            : undefined,
        ),
        broadcaster: runtime.webviewManager,
        outputDirectory: prepared.manifest.outputDirectory,
        carriedOver: prepared.carriedOver,
        onSettled: (settled) =>
          this.afterSettled(
            'wizard:submit-selection',
            prepared.location,
            scope,
            settled,
            !!tabBinding,
            prepared.previousPropagation,
          ),
      })
      .catch(async (error: unknown) => {
        try {
          await this.reportSubmitLaunchFailure(error, prepared.location);
        } finally {
          if (tabBinding) {
            await this.runs.broadcastCompletion(runtime.webviewManager, {
              ...buildCompletePayload({
                summary: null,
                failure: {
                  message: 'Agent generation could not start.',
                  thrown: true,
                },
                abortReason: null,
                carriedOver: prepared.carriedOver,
                outputDirectory: prepared.manifest.outputDirectory,
                durationMs: 0,
              }),
              tabBinding: { ...tabBinding, runId: prepared.manifest.runId },
              terminalStatus: 'failed',
              result: {
                status: 'failed',
                success: false,
                source,
                effectiveProvider: route?.provider ?? 'unknown',
                effectiveModel: route?.model ?? 'unknown',
                committedState: 'unknown',
              },
            });
          }
        }
      })
      .catch(() => {
        // degradation-audit: reported - the launch failure was already logged,
        // captured and its checkpoint finalized; a secondary reporting failure
        // must not become an unhandled rejection.
        this.logger.warn(
          'RPC: wizard:submit-selection failure reporting did not complete',
        );
      });
    return acceptedSubmit(tabBinding, prepared, source, route);
  }

  private async reportSubmitLaunchFailure(
    error: unknown,
    location: GenerationCheckpointLocation,
  ): Promise<void> {
    try {
      this.logger.error('RPC: wizard:submit-selection launch failed');
      this.sentryService.captureException(
        error instanceof Error
          ? error
          : new Error('Generation run launch failed'),
        {
          errorSource: 'WizardGenerationRpcHandlers.registerSubmitSelection',
        },
      );
    } finally {
      await this.checkpoints.finalize(location, 'failed');
    }
  }

  /**
   * Locate and prepare the checkpoint a `resume: true` request refers to.
   * Returns null when there is none or when its paths are not trusted; the
   * checkpoint itself is never deleted.
   */
  private async prepareResumedRun(
    workspaceRoot: string,
    analysisDir: string | null,
    metadata?: Parameters<GenerationCheckpointService['prepareResume']>[2],
  ): Promise<PreparedGenerationRun | null> {
    const located = await this.checkpoints.locateResumable(
      workspaceRoot,
      analysisDir,
      !metadata?.tabBinding && analysisDir === null,
    );
    if (!located) return null;
    if (!this.checkpoints.isTrusted(located.location, located.manifest)) {
      this.logger.warn(
        'RPC: wizard:submit-selection refused a checkpoint whose paths leave the workspace',
        { runId: located.manifest.runId },
      );
      return null;
    }
    // An unbound resume (legacy wizard / CLI) must not adopt a chat-tab run.
    if (!metadata?.tabBinding && located.manifest.tabBinding) {
      throw new RpcUserError(
        'This generation run belongs to a chat tab. Resume it in that tab.',
        'INVALID_PARAMS',
      );
    }
    if (
      metadata?.tabBinding &&
      located.manifest.tabBinding &&
      (located.manifest.tabBinding.tabId !== metadata.tabBinding.tabId ||
        !(await sameWorkspacePath(
          located.manifest.tabBinding.workspacePath,
          metadata.tabBinding.workspacePath,
        )))
    )
      return null;
    if (
      metadata?.tabBinding &&
      located.manifest.workspaceRoot &&
      !(await sameWorkspacePath(located.manifest.workspaceRoot, workspaceRoot))
    )
      return null;
    return this.checkpoints.prepareResume(
      located.location,
      located.manifest,
      metadata,
    );
  }

  /**
   * Every selected agent is already current: no orchestrator work, but the
   * run still settles — the checkpoint completes and one payload goes out.
   */
  private async completeWithoutWork(
    prepared: PreparedGenerationRun,
    broadcaster: WebviewBroadcaster | null,
    live: {
      source: GenerationContextSource;
      effectiveProvider?: string;
      effectiveModel?: string;
      enhancedPromptsUsed: boolean;
    },
  ): Promise<void> {
    await this.checkpoints.finalize(prepared.location, 'completed', true);
    const payload = buildCompletePayload({
      summary: null,
      failure: null,
      abortReason: null,
      carriedOver: prepared.carriedOver,
      outputDirectory: prepared.manifest.outputDirectory,
      durationMs: 0,
    });
    const manifest = prepared.manifest;
    // This invocation wrote nothing, so no Library pass was due for it; a
    // resume drops the earlier invocation's pass (it described other writes).
    const library = manifest.library ?? {
      pass: 'not-applicable' as const,
      diverged: [],
    };
    manifest.library = library;
    if (prepared.previousPropagation) {
      try {
        await this.checkpoints.recordPropagation(
          prepared.location,
          prepared.previousPropagation,
          library,
        );
        manifest.propagation = prepared.previousPropagation;
      } catch (error: unknown) {
        // degradation-audit: reported - finalization is committed; propagation persistence is supplementary.
        this.logger.error(
          'RPC: completed propagation could not be restored',
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
    // Every agents run carries its result facts (A4); only the tab binding
    // is conditional. A bound manifest's recorded facts win; an unbound run
    // records none, so this invocation's live facts are used.
    await this.runs.broadcastCompletion(broadcaster, {
      ...payload,
      ...(manifest.tabBinding
        ? { tabBinding: { ...manifest.tabBinding, runId: manifest.runId } }
        : {}),
      terminalStatus: 'completed',
      result: {
        status: 'completed',
        success: true,
        source: manifest.source ?? live.source,
        effectiveProvider:
          manifest.effectiveProvider ?? live.effectiveProvider ?? 'unknown',
        effectiveModel:
          manifest.effectiveModel ?? live.effectiveModel ?? 'unknown',
        enhancedPromptsUsed:
          manifest.enhancedPromptsUsed ?? live.enhancedPromptsUsed,
        ...resultDetailsFromManifest(manifest),
      },
    });
  }

  /**
   * After the orchestrator settled: record the terminal lifecycle, then
   * propagate whenever this run actually wrote a file under the harness root
   * — a timed-out or paused run included — and record the Library outcome.
   * Runs before the single completion broadcast.
   *
   * The Library facts are recorded and reloaded into `resultDetails` for
   * every run (A4); `bound` only decides that a completed tab run with a
   * failed agent settles as `failed`.
   */
  private async afterSettled(
    method: string,
    location: GenerationCheckpointLocation,
    scope: RunLibraryScope,
    settled: SettledGenerationRun,
    bound = false,
    previousPropagation?: PreparedGenerationRun['previousPropagation'],
  ): Promise<void> {
    let lifecycle =
      settled.abortReason === GENERATION_CANCEL_REASON
        ? 'paused'
        : settled.abortReason !== null
          ? 'timed-out'
          : bound &&
              settled.summary?.lifecycle === 'completed' &&
              settled.payload.failedCount > 0
            ? 'failed'
            : (settled.summary?.lifecycle ?? 'failed');
    let finalizeError: unknown;
    try {
      if (
        bound &&
        settled.abortReason === null &&
        settled.summary?.lifecycle === 'completed'
      ) {
        const checkpoint = await this.checkpoints.loadAt(location);
        if (!checkpoint)
          throw new Error('Generation checkpoint missing before settlement');
        const recordedFailedCount = checkpoint.selectedAgentIds.filter(
          (agentId) => checkpoint.agents[agentId]?.status === 'failed',
        ).length;
        if (recordedFailedCount > 0) {
          lifecycle = 'failed';
          settled.payload = {
            ...settled.payload,
            success: false,
            failedCount: Math.max(
              settled.payload.failedCount,
              recordedFailedCount,
            ),
            errors: settled.payload.errors ?? ['Some agents still failed.'],
          };
        }
      }
      await this.checkpoints.finalize(
        location,
        lifecycle,
        settled.summary !== null,
      );
    } catch (error: unknown) {
      finalizeError = error;
    }
    if (settled.summary) {
      this.logger.info(`RPC: ${method} settled`, {
        lifecycle,
        written: settled.summary.writtenCount,
        unchanged: settled.summary.unchangedCount,
        kept: settled.summary.keptCount,
        changedSincePreview: settled.summary.changedSincePreviewCount,
        failed: settled.summary.failedCount,
        durationMs: settled.durationMs,
      });
      const facts = await this.libraryPass.afterRun(
        scope,
        settled.summary,
        previousPropagation,
      );
      try {
        await this.checkpoints.recordPropagation(
          location,
          facts.propagation,
          facts.library,
        );
        settled.propagation = facts.propagation;
      } catch (error: unknown) {
        // degradation-audit: reported - finalization succeeded; omit unrecorded propagation facts.
        this.logger.error(
          'RPC: propagation checkpoint update failed',
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    } else {
      this.logger.error(`RPC: ${method} failed`, {
        error: settled.failure?.message,
        durationMs: settled.durationMs,
      });
    }
    if (finalizeError) throw finalizeError;
    if (settled.summary) {
      try {
        const committed = await this.checkpoints.loadAt(location);
        if (!committed)
          throw new Error('Generation checkpoint missing after settlement');
        settled.resultDetails = resultDetailsFromManifest(committed);
      } catch (error: unknown) {
        // degradation-audit: reported - finalization succeeded; the push can omit unreadable facts.
        this.logger.error(
          'RPC: finalized generation checkpoint could not be reloaded',
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  }

  /**
   * Record that the wizard wrote `agentId` under the harness root, with the
   * hash of the bytes on disk. A failure is logged by the orchestrator's hook
   * runner and never fails the agent.
   */
  private async recordWizardOrigin(
    harnessRoot: string,
    written: WrittenAgentFile,
  ): Promise<void> {
    const hash = await this.originStore.hashWrittenFile(written.filePath);
    await this.originStore.recordWritten(harnessRoot, written.agentId, hash);
  }

  // ---------------------------------------------------------------------------
  // wizard:preview-generation
  // ---------------------------------------------------------------------------

  /**
   * The files a `wizard:submit-selection` of the same ids will write, worked
   * out from the state the workspace will be in AFTER generation. Read-only:
   * a fresh `verify` (never `reconcile`), one source read and one `lstat` per
   * path. It records no consent — `grantAgentSyncConsent` stays the submit
   * path's job.
   *
   * `definite` means: after generation this file holds the generated content.
   *
   * - `.claude/agents/<id>.md` is `definite`: the orchestrator writes it, or
   *   leaves it as is when it already holds the same content.
   * - A rival copy is listed when a fresh verify reports its target detected
   *   with `agents: 'supported'`, and the manifest builder's own per-agent
   *   rule keeps the agent. The workspace consent half of that rule is `true`
   *   because the wizard grants it before it propagates.
   * - Without the gate or the propagation service the wizard cannot grant or
   *   propagate, so every rival copy is `conditional`; the same holds while
   *   the plugin/skill policy is unreadable.
   * - Otherwise a rival copy is `definite` only when that verify lists its
   *   exact path in the target's `agentsInSync`: the submit path propagates
   *   only when a file was written, so an all-unchanged run syncs nothing,
   *   while an in-sync copy is either left as is or rewritten. Any other
   *   rival copy is `conditional` on generation writing a file.
   * - Without a reconciler, or when its verify throws, only the Claude paths
   *   are listed and `warning` says why.
   *
   * {@link GenerationPreviewService} builds the response (target, file
   * states, revisions, model lines) and records the token a submit's
   * keep/replace decisions are later checked against.
   */
  private registerPreviewGeneration(): void {
    this.rpcHandler.registerMethod<
      WizardPreviewGenerationParams,
      WizardPreviewGenerationResponse
    >('wizard:preview-generation', async (params) => {
      const previewBinding = (params as { tabBinding?: unknown })?.tabBinding;
      if (
        previewBinding !== undefined &&
        !WizardTabBindingSchema.safeParse(previewBinding).success
      )
        throw new RpcUserError(
          'Invalid generation tab binding.',
          'INVALID_PARAMS',
        );
      const parsed = this.parse(WizardPreviewGenerationParamsSchema, params);
      const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        throw new RpcUserError(
          'Open a workspace folder to preview agent generation.',
          'INVALID_PARAMS',
        );
      }
      const canonicalWorkspace = parsed.tabBinding
        ? await authorizeTabWorkspace(
            workspaceRoot,
            parsed.tabBinding,
            this.logger,
          )
        : null;
      if (parsed.tabBinding && !canonicalWorkspace)
        throw new RpcUserError(
          'Generation workspace does not match the active workspace.',
          'UNAUTHORIZED_WORKSPACE',
        );
      const binding =
        parsed.tabBinding && canonicalWorkspace
          ? { ...parsed.tabBinding, workspacePath: canonicalWorkspace }
          : undefined;
      return this.previews.preview({
        key: previewKeyFor(binding?.tabId),
        openedFolder: workspaceRoot,
        canonicalWorkspace: binding?.workspacePath ?? workspaceRoot,
        agentIds: parsed.selectedAgentIds,
        target: parsed.target,
      });
    });
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
        if (
          params?.tabBinding !== undefined &&
          !WizardRunBindingSchema.safeParse(params.tabBinding).success
        )
          return { cancelled: false, rejection: { reason: 'invalid-binding' } };
        const parsed = this.parse(WizardCancelParamsSchema, params);
        if (parsed.tabBinding) {
          const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
          const canonicalWorkspace = workspaceRoot
            ? await authorizeTabWorkspace(
                workspaceRoot,
                parsed.tabBinding,
                this.logger,
              )
            : null;
          if (!canonicalWorkspace)
            return {
              cancelled: false,
              rejection: { reason: 'workspace-mismatch' },
            };
          const active = this.runs.binding;
          if (
            !active ||
            !this.runs.abortBound(
              { ...parsed.tabBinding, workspacePath: canonicalWorkspace },
              GENERATION_CANCEL_REASON,
            )
          )
            return { cancelled: false, rejection: { reason: 'not-running' } };
          return { cancelled: true, progressSaved: true };
        }
        const saveProgress = parsed.saveProgress ?? true;
        // Legacy cancel has no tab id. Abort only an unbound run; a chat-tab
        // run stays active and this response does not claim it was cancelled.
        const abortedRun = this.runs.binding
          ? false
          : this.runs.abort(GENERATION_CANCEL_REASON);
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
      if (
        params?.tabBinding !== undefined &&
        !WizardRunBindingSchema.safeParse(params.tabBinding).success
      )
        return { success: false, rejection: { reason: 'invalid-binding' } };
      const parsed = this.parse(WizardRetryItemParamsSchema, params);
      if (this.runs.isActive || this.submitReserved) {
        return {
          success: false,
          error:
            'Agent generation is already in progress. Please wait for it to complete before retrying.',
        };
      }
      const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        if (parsed.tabBinding)
          return {
            success: false,
            rejection: { reason: 'workspace-mismatch' },
          };
        return {
          success: false,
          error: 'No workspace folder open. Please open a folder first.',
        };
      }
      const canonicalWorkspace = parsed.tabBinding
        ? await authorizeTabWorkspace(
            workspaceRoot,
            parsed.tabBinding,
            this.logger,
          )
        : null;
      if (parsed.tabBinding && !canonicalWorkspace)
        return { success: false, rejection: { reason: 'workspace-mismatch' } };
      const retryBinding =
        parsed.tabBinding && canonicalWorkspace
          ? { ...parsed.tabBinding, workspacePath: canonicalWorkspace }
          : undefined;

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
        const boundCheckpoint = retryBinding
          ? await this.checkpoints.locateBound(
              canonicalWorkspace!,
              retryBinding,
              retryBinding.runId,
            )
          : null;
        if (
          retryBinding &&
          (!boundCheckpoint ||
            boundCheckpoint.manifest.runId !== retryBinding.runId ||
            boundCheckpoint.manifest.tabBinding?.tabId !== retryBinding.tabId ||
            !this.checkpoints.isTrusted(
              boundCheckpoint.location,
              boundCheckpoint.manifest,
            ))
        )
          return { success: false, rejection: { reason: 'not-running' } };
        const checkpoint = retryBinding
          ? (boundCheckpoint?.location ?? null)
          : this.lastCheckpoint;
        const boundRuntime = retryBinding
          ? await this.resolveRuntime(workspaceRoot)
          : null;
        // The retried item gets the decision its run recorded: a kept file
        // stays kept (no generation), a replace keeps its baseline check, and
        // a run without recorded guards is create-only.
        const scope = boundCheckpoint
          ? libraryScopeOf(canonicalWorkspace!, boundCheckpoint.manifest)
          : (this.lastRunScope ?? libraryScopeOf(workspaceRoot, null));
        const options: OrchestratorGenerationOptions = {
          ...(retryBinding
            ? {
                threshold: boundCheckpoint?.manifest.input.threshold,
                variableOverrides:
                  boundCheckpoint?.manifest.input.variableOverrides,
                model:
                  boundCheckpoint?.manifest.effectiveModel ??
                  boundCheckpoint?.manifest.input.model,
                enhancedPromptContent: boundCheckpoint?.manifest
                  .enhancedPromptsUsed
                  ? boundRuntime?.enhancedPromptContent
                  : undefined,
                analysisDir:
                  boundCheckpoint?.manifest.source?.kind === 'verified-analysis'
                    ? boundCheckpoint.manifest.source.analysisDir
                    : undefined,
                ...this.manifestWriteOptions(
                  boundCheckpoint?.manifest ?? null,
                  scope,
                ),
              }
            : (this.lastGenerationOptions ?? {})),
          workspacePath: workspaceRoot,
          userOverrides: [parsed.itemId],
          onStreamEvent: this.createStreamBroadcaster(
            webviewManager,
            retryBinding,
          ),
          onAgentOutcome: checkpoint
            ? (outcome) => this.checkpoints.recordOutcome(checkpoint, outcome)
            : undefined,
        };

        const settled = await this.runs.run({
          orchestrator,
          ...(retryBinding
            ? {
                tabBinding: retryBinding,
                source: boundCheckpoint?.manifest.source,
                effectiveProvider: boundCheckpoint?.manifest.effectiveProvider,
                effectiveModel: boundCheckpoint?.manifest.effectiveModel,
                enhancedPromptsUsed:
                  boundCheckpoint?.manifest.enhancedPromptsUsed,
              }
            : {}),
          options,
          ...(retryBinding
            ? {
                progressCallback: this.createProgressBroadcaster(
                  webviewManager,
                  retryBinding,
                ),
              }
            : {}),
          broadcaster: webviewManager,
          outputDirectory: this.checkpoints.outputDirectoryFor(
            scope.outputRoot,
          ),
          carriedOver: [],
          onSettled: (result) =>
            checkpoint
              ? this.afterSettled(
                  'wizard:retry-item',
                  checkpoint,
                  scope,
                  result,
                  !!retryBinding,
                )
              : this.afterSettledWithoutCheckpoint(scope, result),
        });

        if (settled.failure?.thrown) {
          throw new Error(settled.failure.message);
        }
        const itemOutcome = settled.summary?.outcomes.find(
          (outcome) => outcome.agentId === parsed.itemId,
        );
        if (itemOutcome?.status === 'changed-since-preview') {
          this.logger.warn('RPC: wizard:retry-item kept a changed file', {
            itemId: parsed.itemId,
          });
          return { success: false, error: CHANGED_SINCE_PREVIEW_RETRY_ERROR };
        }
        if (
          settled.payload.success ||
          (retryBinding &&
            settled.resultDetails?.finalizationFailed !== true &&
            settled.abortReason === null &&
            settled.failure === null &&
            settled.summary?.lifecycle === 'completed' &&
            settled.summary.outcomes.some(
              (outcome) =>
                outcome.agentId === parsed.itemId &&
                (outcome.status === 'written' ||
                  outcome.status === 'unchanged' ||
                  outcome.status === 'kept'),
            ))
        ) {
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
          error: parsed.tabBinding
            ? 'Agent retry failed. Please retry or resume.'
            : `Retry failed: ${errorMessage}`,
        };
      }
    });
  }

  /** Retry with no checkpoint on record: propagation still follows a write. */
  private async afterSettledWithoutCheckpoint(
    scope: RunLibraryScope,
    settled: SettledGenerationRun,
  ): Promise<void> {
    if (!settled.summary) return;
    const facts = await this.libraryPass.afterRun(scope, settled.summary);
    settled.resultDetails = {
      ...settled.resultDetails,
      propagation: facts.propagation,
      libraryPass: facts.library.pass,
      libraryDiverged: [...facts.library.diverged],
    };
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
   * The write half of a run's options, from its manifest only: the output
   * root, the confirmed guards, and the origin record of each file written
   * under the harness root. A manifest without guards (written before runs
   * carried them) runs create-only, the orchestrator's default.
   */
  private manifestWriteOptions(
    manifest: Pick<
      GenerationCheckpointManifest,
      'outputRoot' | 'fileGuards'
    > | null,
    scope: RunLibraryScope,
  ): Pick<
    OrchestratorGenerationOptions,
    'outputRoot' | 'fileGuards' | 'onAgentWritten'
  > {
    return {
      ...(manifest?.outputRoot !== undefined
        ? { outputRoot: manifest.outputRoot }
        : {}),
      ...(manifest?.fileGuards !== undefined
        ? { fileGuards: manifest.fileGuards }
        : {}),
      ...(scope.atHarnessRoot
        ? {
            onAgentWritten: (written: WrittenAgentFile) =>
              this.recordWizardOrigin(scope.harnessRoot, written),
          }
        : {}),
    };
  }

  /**
   * Orchestrator options for a prepared run. Generation inputs and write
   * decisions come from the checkpoint (persisted at submit time, so a resume
   * needs no frontend memory); runtime facts come from `resolveRuntime`.
   */
  private buildOptions(
    workspaceRoot: string,
    prepared: PreparedGenerationRun,
    runtime: GenerationRuntime,
    trustedDir: string | null,
    scope: RunLibraryScope,
  ): OrchestratorGenerationOptions {
    const { input } = prepared.manifest;
    return {
      ...this.manifestWriteOptions(prepared.manifest, scope),
      workspacePath: workspaceRoot,
      userOverrides: prepared.agentIds,
      threshold: input.threshold,
      variableOverrides: input.variableOverrides,
      enhancedPromptContent: runtime.enhancedPromptContent,
      preComputedAnalysis:
        trustedDir && !prepared.manifest.tabBinding
          ? input.analysisData
          : undefined,
      mcpServerRunning: runtime.mcpServerRunning,
      mcpPort: runtime.mcpPort,
      onStreamEvent: this.createStreamBroadcaster(
        runtime.webviewManager,
        prepared.manifest.tabBinding
          ? { ...prepared.manifest.tabBinding, runId: prepared.manifest.runId }
          : undefined,
      ),
      model: input.model,
      analysisDir: trustedDir ?? undefined,
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
    tabBinding?: SetupGenerationRunBinding,
  ): (event: GenerationStreamPayload) => void {
    return (event) => {
      if (!webviewManager) return;
      webviewManager
        .broadcastMessage(
          'setup-wizard:generation-stream',
          tabBinding ? { ...event, tabBinding } : event,
        )
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
    tabBinding?: SetupGenerationRunBinding,
  ): (progress: GenerationProgress) => void {
    return (progress) => {
      if (!webviewManager) return;
      try {
        const payload: GenerationProgressPayload = {
          ...(tabBinding ? { tabBinding, lifecycle: 'running' as const } : {}),
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
      // degradation-audit: optional-capability - plugin paths are an optional
      // generation input; undefined generates with no plugin directories.
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
      // degradation-audit: optional-capability - the webview manager is absent
      // on headless hosts; null runs generation with no progress broadcasts.
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
