/**
 * MultiPhaseAnalysisService - Multi-phase workspace analysis orchestrator
 *
 * TASK_2025_154: Executes 4 sequential LLM phases (project profile, architecture
 * assessment, quality audit, elevation plan).
 *
 * Architecture:
 * - Delegates SDK query execution to InternalQueryService (agent-sdk)
 * - Uses SdkStreamProcessor for stream event processing and progress UX
 * - Writes markdown outputs to .claude/analysis/{slug}/ via AnalysisStorageService
 * - Broadcasts progress via WebviewManager for real-time frontend updates
 * - Each phase is independent: failures are logged and the pipeline continues
 *
 * @module @ptah-extension/agent-generation
 */

import { injectable, inject } from 'tsyringe';
import { access } from 'fs/promises';
import { join } from 'path';
import {
  Logger,
  ConfigManager,
  TOKENS,
  type WebviewManager,
} from '@ptah-extension/vscode-core';
import { Result, MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  AnalysisPhase,
  AnalysisStreamPayload,
  ScanProgressPayload,
} from '@ptah-extension/shared';
import { SDK_TOKENS, SdkStreamProcessor } from '@ptah-extension/agent-sdk';
import type {
  InternalQueryService,
  SDKMessage,
  StreamEventEmitter,
  StreamEvent,
  StreamProcessorResult,
} from '@ptah-extension/agent-sdk';
import type { AnalysisStorageService } from '../analysis-storage.service';
import { AGENT_GENERATION_TOKENS } from '../../di/tokens';
import type {
  MultiPhaseManifest,
  MultiPhaseAnalysisOptions,
  MultiPhaseId,
  PhaseResult,
} from '../../types/multi-phase.types';
import { PHASE_CONFIGS } from '../../types/multi-phase.types';
import {
  buildPhase1Prompts,
  buildPhase2Prompts,
  buildPhase3Prompts,
  buildPhase4Prompts,
} from './multi-phase-prompts';
import {
  discoverPluginSkills,
  formatSkillsForPrompt,
} from '@ptah-extension/agent-sdk';

// ============================================================================
// Constants
// ============================================================================

const SERVICE_TAG = '[MultiPhaseAnalysis]';
const DEFAULT_TIMEOUT_MS = 3_600_000; // 1 hour total pipeline
const PER_PHASE_TIMEOUT_MS = 900_000; // 15 minutes per phase
const MAX_AGENT_TURNS = 50;
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
const LLM_PHASE_COUNT = 4; // Phases 1-4 are LLM-based

/**
 * Prompt builder functions indexed by phase position (0-3).
 */
const PROMPT_BUILDERS = [
  (slugDir: string, _pluginSkillsContext?: string) =>
    buildPhase1Prompts(slugDir),
  (slugDir: string, _pluginSkillsContext?: string) =>
    buildPhase2Prompts(slugDir),
  (slugDir: string, _pluginSkillsContext?: string) =>
    buildPhase3Prompts(slugDir),
  (slugDir: string, pluginSkillsContext?: string) =>
    buildPhase4Prompts(slugDir, pluginSkillsContext),
] as const;

// ============================================================================
// Service
// ============================================================================

/**
 * MultiPhaseAnalysisService
 *
 * Orchestrates a 4-phase workspace analysis pipeline:
 * - Phases 1-4: LLM-powered analysis via InternalQueryService
 *
 * Follows the established AgenticAnalysisService pattern for DI, streaming,
 * abort handling, and progress broadcasting.
 */
@injectable()
export class MultiPhaseAnalysisService {
  private activeAbortController: AbortController | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE)
    private readonly internalQueryService: InternalQueryService,
    @inject(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE)
    private readonly storageService: AnalysisStorageService
  ) {}

  /**
   * Execute the full multi-phase analysis pipeline.
   *
   * @param workspacePath - Workspace root path to analyze
   * @param options - Pipeline configuration
   * @returns Result containing the manifest on success, or an Error
   */
  async analyzeWorkspace(
    workspacePath: string,
    options?: MultiPhaseAnalysisOptions
  ): Promise<Result<MultiPhaseManifest, Error>> {
    const isPremium = options?.isPremium ?? false;
    const mcpServerRunning = options?.mcpServerRunning ?? false;
    const mcpPort = options?.mcpPort;
    const pluginPaths = options?.pluginPaths;
    const model =
      options?.model ||
      this.config.getWithDefault<string>('model.selected', DEFAULT_MODEL);

    this.logger.info(`${SERVICE_TAG} Starting multi-phase analysis`, {
      workspace: workspacePath,
      model,
      isPremium,
      mcpServerRunning,
    });

    // ---- Validation ----
    if (!isPremium || !mcpServerRunning) {
      return Result.err(
        new Error(
          `Multi-phase analysis requires premium license and MCP server. isPremium=${isPremium}, mcpRunning=${mcpServerRunning}`
        )
      );
    }

    // ---- Cancel any in-flight analysis before starting ----
    if (this.activeAbortController) {
      this.activeAbortController.abort('new_analysis_started');
      this.activeAbortController = null;
    }

    // ---- Master abort controller ----
    const masterAbortController = new AbortController();
    this.activeAbortController = masterAbortController;
    const pipelineStart = Date.now();

    // ---- Phase status tracking ----
    const phaseStatuses: Array<{
      id: string;
      status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    }> = PHASE_CONFIGS.map((pc) => ({ id: pc.id, status: 'pending' as const }));

    try {
      // ---- Create slug directory ----
      // Use workspace folder name as the project description for the slug
      const folderName = workspacePath.split(/[\\/]/).pop() || 'project';
      const { slugDir, slug } = await this.storageService.createSlugDir(
        workspacePath,
        folderName
      );

      this.logger.info(`${SERVICE_TAG} Created slug directory`, {
        slug,
        slugDir,
      });

      // ---- Initialize manifest ----
      const manifest: MultiPhaseManifest = {
        version: 2,
        slug,
        analyzedAt: new Date().toISOString(),
        model,
        totalDurationMs: 0,
        phases: {} as Record<MultiPhaseId, PhaseResult>,
      };

      // ---- Execute LLM phases 1-4 ----
      for (let i = 0; i < LLM_PHASE_COUNT; i++) {
        const phaseConfig = PHASE_CONFIGS[i];

        // Check for master abort before starting each phase
        if (masterAbortController.signal.aborted) {
          this.logger.info(
            `${SERVICE_TAG} Master abort detected, skipping remaining phases`
          );
          // Mark remaining phases as skipped
          for (let j = i; j < PHASE_CONFIGS.length; j++) {
            manifest.phases[PHASE_CONFIGS[j].id as MultiPhaseId] = {
              status: 'skipped',
              file: PHASE_CONFIGS[j].file,
              durationMs: 0,
            };
            phaseStatuses[j].status = 'skipped';
          }
          break;
        }

        // Mark phase as running
        phaseStatuses[i].status = 'running';
        this.broadcastPhaseProgress(
          phaseConfig.id as AnalysisPhase,
          i,
          LLM_PHASE_COUNT,
          phaseStatuses,
          phaseConfig.label
        );

        const phaseStart = Date.now();

        try {
          const text = await this.executePhase(
            i,
            slugDir,
            workspacePath,
            model,
            isPremium,
            mcpServerRunning,
            mcpPort,
            masterAbortController,
            phaseStatuses,
            pluginPaths
          );

          // The agent writes the phase file directly via prompts.
          // Verify the file exists; fall back to writing captured text if not.
          const expectedFile = join(slugDir, phaseConfig.file);
          const fileExists = await access(expectedFile)
            .then(() => true)
            .catch(() => false);

          if (fileExists) {
            manifest.phases[phaseConfig.id as MultiPhaseId] = {
              status: 'completed',
              file: phaseConfig.file,
              durationMs: Date.now() - phaseStart,
            };
            phaseStatuses[i].status = 'completed';
          } else if (text) {
            // Fallback: agent didn't write the file, use captured text
            this.logger.warn(
              `${SERVICE_TAG} Phase ${phaseConfig.id}: agent did not write file, using captured text fallback`
            );
            await this.storageService.writePhaseFile(
              slugDir,
              phaseConfig.file,
              text
            );
            manifest.phases[phaseConfig.id as MultiPhaseId] = {
              status: 'completed',
              file: phaseConfig.file,
              durationMs: Date.now() - phaseStart,
            };
            phaseStatuses[i].status = 'completed';
          } else {
            // No file and no text -- mark as failed
            manifest.phases[phaseConfig.id as MultiPhaseId] = {
              status: 'failed',
              file: phaseConfig.file,
              durationMs: Date.now() - phaseStart,
              error:
                'Agent did not write the phase file and no text was captured',
            };
            phaseStatuses[i].status = 'failed';
            this.logger.warn(
              `${SERVICE_TAG} Phase ${phaseConfig.id}: no file written and no text captured`
            );
          }
        } catch (error) {
          // Check if this was caused by master abort
          if (masterAbortController.signal.aborted) {
            manifest.phases[phaseConfig.id as MultiPhaseId] = {
              status: 'skipped',
              file: phaseConfig.file,
              durationMs: Date.now() - phaseStart,
            };
            phaseStatuses[i].status = 'skipped';

            // Mark remaining phases as skipped
            for (let j = i + 1; j < PHASE_CONFIGS.length; j++) {
              manifest.phases[PHASE_CONFIGS[j].id as MultiPhaseId] = {
                status: 'skipped',
                file: PHASE_CONFIGS[j].file,
                durationMs: 0,
              };
              phaseStatuses[j].status = 'skipped';
            }
            break;
          }

          // Phase failed -- log and continue to next phase
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(`${SERVICE_TAG} Phase ${phaseConfig.id} failed`, {
            error: errorMessage,
          });
          manifest.phases[phaseConfig.id as MultiPhaseId] = {
            status: 'failed',
            file: phaseConfig.file,
            durationMs: Date.now() - phaseStart,
            error: errorMessage,
          };
          phaseStatuses[i].status = 'failed';
        }

        // Broadcast updated statuses after each phase
        this.broadcastPhaseProgress(
          phaseConfig.id as AnalysisPhase,
          i,
          LLM_PHASE_COUNT,
          phaseStatuses,
          phaseStatuses[i].status === 'completed'
            ? `${phaseConfig.label.replace('...', '')} complete`
            : phaseConfig.label
        );

        // Broadcast inter-phase transition status so the UI doesn't appear frozen
        // between the end of one phase and the start of the next SDK session.
        const nextPhaseIndex = i + 1;
        if (
          nextPhaseIndex < LLM_PHASE_COUNT &&
          !masterAbortController.signal.aborted
        ) {
          const nextPhase = PHASE_CONFIGS[nextPhaseIndex];
          this.broadcastStreamMessage({
            kind: 'status',
            content: `Preparing ${nextPhase.label}...`,
            timestamp: Date.now(),
          });
        }
      }

      // ---- Write manifest ----
      manifest.totalDurationMs = Date.now() - pipelineStart;
      await this.storageService.writeManifest(slugDir, manifest);

      this.logger.info(`${SERVICE_TAG} Multi-phase analysis complete`, {
        totalDurationMs: manifest.totalDurationMs,
        phases: Object.entries(manifest.phases).map(([id, r]) => ({
          id,
          status: r.status,
          durationMs: r.durationMs,
        })),
      });

      // Final progress broadcast
      this.broadcastPhaseProgress(
        'elevation-plan' as AnalysisPhase,
        PHASE_CONFIGS.length - 1,
        PHASE_CONFIGS.length,
        phaseStatuses,
        'Analysis complete'
      );

      return Result.ok(manifest);
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(`${SERVICE_TAG} Multi-phase analysis failed`, errorObj);
      return Result.err(errorObj);
    } finally {
      if (this.activeAbortController === masterAbortController) {
        this.activeAbortController = null;
      }
    }
  }

  /**
   * Cancel a running multi-phase analysis.
   */
  cancelAnalysis(): void {
    if (this.activeAbortController) {
      this.logger.info(`${SERVICE_TAG} Cancelling active multi-phase analysis`);
      this.activeAbortController.abort('user_cancelled');
      this.activeAbortController = null;
    } else {
      this.logger.debug(
        `${SERVICE_TAG} cancelAnalysis called but no active analysis`
      );
    }
  }

  // ==========================================================================
  // Phase Execution
  // ==========================================================================

  /**
   * Execute a single LLM phase (1-4).
   *
   * Creates a per-phase AbortController linked to the master, builds prompts,
   * calls InternalQueryService, processes the stream, and returns captured text.
   */
  private async executePhase(
    phaseIndex: number,
    slugDir: string,
    cwd: string,
    model: string,
    isPremium: boolean,
    mcpServerRunning: boolean,
    mcpPort: number | undefined,
    masterAbortController: AbortController,
    phaseStatuses: Array<{
      id: string;
      status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    }>,
    pluginPaths?: string[]
  ): Promise<string | null> {
    const phaseConfig = PHASE_CONFIGS[phaseIndex];
    const promptBuilder = PROMPT_BUILDERS[phaseIndex];

    // Discover plugin skills for Phase 4 prompt enrichment
    let pluginSkillsContext: string | undefined;
    if (pluginPaths && pluginPaths.length > 0) {
      const skills = discoverPluginSkills(pluginPaths);
      if (skills.length > 0) {
        pluginSkillsContext = formatSkillsForPrompt(skills);
      }
    }

    const { systemPrompt, userPrompt } = promptBuilder(
      slugDir,
      pluginSkillsContext
    );

    this.logger.info(
      `${SERVICE_TAG} Executing phase ${phaseIndex + 1}: ${phaseConfig.id}`
    );

    // Create per-phase AbortController linked to master
    const phaseAbortController = new AbortController();
    const onMasterAbort = () => phaseAbortController.abort('master_cancelled');
    masterAbortController.signal.addEventListener('abort', onMasterAbort, {
      once: true,
    });

    try {
      const handle = await this.internalQueryService.execute({
        cwd,
        model,
        prompt: userPrompt,
        systemPromptAppend: systemPrompt,
        isPremium,
        mcpServerRunning,
        mcpPort,
        maxTurns: MAX_AGENT_TURNS,
        abortController: phaseAbortController,
        pluginPaths,
        // No outputFormat -- we want free-form markdown
      });

      try {
        const { text, resultMeta } = await this.processPhaseStream(
          handle.stream,
          phaseConfig.id as MultiPhaseId,
          phaseIndex,
          phaseAbortController,
          phaseStatuses
        );

        if (resultMeta) {
          this.logger.info(`${SERVICE_TAG} Phase ${phaseConfig.id} completed`, {
            turns: resultMeta.turns,
            cost: resultMeta.cost,
            inputTokens: resultMeta.inputTokens,
            outputTokens: resultMeta.outputTokens,
            textLength: text?.length ?? 0,
          });
        }

        return text;
      } finally {
        handle.close();
      }
    } finally {
      masterAbortController.signal.removeEventListener('abort', onMasterAbort);
    }
  }

  // ==========================================================================
  // Stream Processing
  // ==========================================================================

  /**
   * Process the SDK message stream for a single phase.
   *
   * Intercepts the stream to capture the result text (since we don't use
   * outputFormat, there's no structured_output -- the agent's free-form
   * markdown response is in message.result on the result message).
   *
   * Also forwards events to the SdkStreamProcessor for live UI updates.
   */
  private async processPhaseStream(
    stream: AsyncIterable<SDKMessage>,
    phaseId: MultiPhaseId,
    phaseIndex: number,
    abortController: AbortController,
    phaseStatuses: Array<{
      id: string;
      status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    }>
  ): Promise<{
    text: string | null;
    resultMeta?: StreamProcessorResult['resultMeta'];
  }> {
    // Text capture: accumulate from text events + capture result message text
    let capturedResultText: string | null = null;
    const textChunks: string[] = [];

    const emitter: StreamEventEmitter = {
      emit: (event: StreamEvent) => {
        // Accumulate text chunks for fallback capture
        if (event.kind === 'text' && event.content) {
          textChunks.push(event.content);
        }

        // Forward to frontend stream display
        this.broadcastStreamMessage(event);
      },
    };

    // Wrap the stream to intercept result messages for text extraction
    const wrappedStream = this.createTextCapturingStream(
      stream,
      (resultText: string) => {
        capturedResultText = resultText;
      }
    );

    const processor = new SdkStreamProcessor({
      emitter,
      timeout: { ms: PER_PHASE_TIMEOUT_MS, abortController },
      logger: this.logger,
      serviceTag: `${SERVICE_TAG}:${phaseId}`,
      skipStructuredOutput: true, // Multi-phase produces markdown, not JSON
    });

    const result = await processor.process(wrappedStream);

    // Determine the final text:
    // Priority 1: result message's `result` field (the agent's full text response)
    // Priority 2: accumulated text chunks from stream events
    const finalText =
      capturedResultText ||
      (textChunks.length > 0 ? textChunks.join('') : null);

    return { text: finalText, resultMeta: result.resultMeta };
  }

  /**
   * Wrap an SDK message stream to intercept result messages and capture the text.
   *
   * The `onResultText` callback is called with the `result` field from
   * successful result messages (which contains the agent's full text response
   * when no outputFormat is used).
   */
  private async *createTextCapturingStream(
    stream: AsyncIterable<SDKMessage>,
    onResultText: (text: string) => void
  ): AsyncIterable<SDKMessage> {
    for await (const message of stream) {
      // Intercept result messages to capture the text
      if (
        message.type === 'result' &&
        message.subtype === 'success' &&
        'result' in message &&
        typeof (message as { result?: string }).result === 'string'
      ) {
        onResultText((message as { result: string }).result);
      }
      yield message;
    }
  }

  // ==========================================================================
  // Progress Broadcasting
  // ==========================================================================

  /**
   * Broadcast phase-level progress to the frontend.
   */
  private broadcastPhaseProgress(
    currentPhase: AnalysisPhase,
    phaseIndex: number,
    totalPhases: number,
    phaseStatuses: Array<{
      id: string;
      status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    }>,
    phaseLabel?: string
  ): void {
    try {
      const payload: ScanProgressPayload = {
        filesScanned: 0,
        totalFiles: 0,
        detections: [],
        currentPhase,
        phaseLabel,
        currentPhaseNumber: phaseIndex + 1,
        totalPhaseCount: totalPhases,
        phaseStatuses: phaseStatuses.map((s) => ({
          id: s.id,
          status: s.status,
        })),
        completedPhases: phaseStatuses
          .filter((s) => s.status === 'completed')
          .map((s) => s.id) as AnalysisPhase[],
      };

      this.webviewManager.broadcastMessage(
        MESSAGE_TYPES.SETUP_WIZARD_SCAN_PROGRESS,
        payload
      );
    } catch (error) {
      this.logger.debug(`${SERVICE_TAG} Failed to broadcast phase progress`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Broadcast a stream event to the frontend for real-time transcript display.
   */
  private broadcastStreamMessage(payload: AnalysisStreamPayload): void {
    try {
      this.webviewManager.broadcastMessage(
        MESSAGE_TYPES.SETUP_WIZARD_ANALYSIS_STREAM,
        payload
      );
    } catch (error) {
      this.logger.debug(`${SERVICE_TAG} Failed to broadcast stream message`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
