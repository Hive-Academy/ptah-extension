/**
 * MultiPhaseAnalysisService - Multi-phase workspace analysis orchestrator
 *
 * Executes 4 sequential LLM phases (project profile, architecture
 * assessment, quality audit, elevation plan).
 *
 * Architecture:
 * - Delegates SDK query execution to InternalQueryService (agent-sdk)
 * - Uses SdkStreamProcessor for UI-only stream events (throttled to 100 ms)
 * - Captures phase text from COMPLETE SDK assistant/result messages, never
 *   from the throttled UI emitter
 * - Checkpoints a version-3 manifest through AnalysisRunCheckpoint on every
 *   lifecycle transition, so a run survives a host restart and can resume
 * - Broadcasts progress via WebviewManager for real-time frontend updates
 * - Each phase is independent: a failed phase is recorded as `failed` with a
 *   non-empty error and the pipeline continues
 *
 * @module @ptah-extension/agent-generation
 */

import { injectable, inject } from 'tsyringe';
import { relative } from 'path';
import {
  Logger,
  TOKENS,
  type WebviewManager,
} from '@ptah-extension/vscode-core';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import type { ModelSettings } from '@ptah-extension/settings-core';
import { Result, MESSAGE_TYPES, WizardPhaseId } from '@ptah-extension/shared';
import type {
  AnalysisPhase,
  AnalysisStreamPayload,
  ScanProgressPayload,
  FlatStreamEventUnion,
  MessageStartEvent,
  TextDeltaEvent,
  ThinkingDeltaEvent,
  ToolStartEvent,
  ToolDeltaEvent,
  ToolResultEvent,
  MessageCompleteEvent,
} from '@ptah-extension/shared';
import { SDK_TOKENS, SdkStreamProcessor } from '@ptah-extension/agent-sdk';
import type {
  InternalQueryService,
  SDKMessage,
  StreamEventEmitter,
  StreamEvent,
} from '@ptah-extension/agent-sdk';
import type { AnalysisStorageService } from '../analysis-storage.service';
import { AGENT_GENERATION_TOKENS } from '../../di/tokens';
import type {
  MultiPhaseManifest,
  MultiPhaseAnalysisOptions,
  MultiPhaseId,
} from '../../types/multi-phase.types';
import { PHASE_CONFIGS } from '../../types/multi-phase.types';
import {
  AnalysisRunCheckpoint,
  type PhaseStatusSnapshot,
} from './analysis-run-checkpoint';
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

const SERVICE_TAG = '[MultiPhaseAnalysis]';
/** Per-phase ceiling, covering the queue wait AND the stream. */
export const PER_PHASE_TIMEOUT_MS = 900_000; // 15 minutes per phase
const MAX_AGENT_TURNS = 50;
const DEFAULT_MODEL = 'default';
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

/**
 * What one phase execution produced, independent of any file on disk.
 */
export interface PhaseExecutionOutcome {
  /** A `result` message with subtype `success` arrived. */
  resultReceived: boolean;
  /** The per-phase timeout fired before a result arrived. */
  timedOut: boolean;
  /** Complete assistant text captured from SDK messages, or null. */
  assistantText: string | null;
  /** Non-empty when the phase cannot be `completed`. */
  error?: string;
}

/** Mutable capture filled by the text-capturing stream wrapper. */
interface PhaseTextCapture {
  assistantTexts: string[];
  resultText: string | null;
  resultReceived: boolean;
  resultError?: string;
}

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
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE)
    private readonly internalQueryService: InternalQueryService,
    @inject(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE)
    private readonly storageService: AnalysisStorageService,
    @inject(SETTINGS_TOKENS.MODEL_SETTINGS)
    private readonly modelSettings: ModelSettings,
  ) {}

  /**
   * Execute the full multi-phase analysis pipeline.
   *
   * With `options.resume === true` the existing version-3 manifest for the
   * workspace slug is continued: completed phases are skipped, a stale
   * `running` phase restarts, and nothing under the slug is deleted. Without
   * a resumable manifest the call falls back to a fresh run.
   *
   * @param workspacePath - Workspace root path to analyze
   * @param options - Pipeline configuration
   * @returns Result containing the manifest (lifecycle `completed`, `failed`
   *   or `paused`) on success, or an Error when persistence or setup failed
   */
  async analyzeWorkspace(
    workspacePath: string,
    options?: MultiPhaseAnalysisOptions,
  ): Promise<Result<MultiPhaseManifest, Error>> {
    const mcpServerRunning = options?.mcpServerRunning ?? false;
    const mcpPort = options?.mcpPort;
    const pluginPaths = options?.pluginPaths;
    const resume = options?.resume === true;
    const model =
      options?.model || this.modelSettings.selectedModel.get() || DEFAULT_MODEL;

    this.logger.info(`${SERVICE_TAG} Starting multi-phase analysis`, {
      workspace: workspacePath,
      model,
      mcpServerRunning,
      resume,
    });
    if (!mcpServerRunning) {
      return Result.err(
        new Error(
          `Multi-phase analysis requires the MCP server. mcpRunning=${mcpServerRunning}`,
        ),
      );
    }
    if (this.activeAbortController) {
      this.activeAbortController.abort('new_analysis_started');
      this.activeAbortController = null;
    }
    const masterAbortController = new AbortController();
    this.activeAbortController = masterAbortController;

    try {
      const folderName = workspacePath.split(/[\\/]/).pop() || 'project';
      const checkpoint = await AnalysisRunCheckpoint.open(
        this.storageService,
        workspacePath,
        folderName,
        model,
        resume,
      );
      const { slugDir, manifest } = checkpoint;

      this.logger.info(`${SERVICE_TAG} Analysis run opened`, {
        runId: manifest.runId,
        slug: manifest.slug,
        slugDir,
        resumed: checkpoint.resumed,
      });

      let paused = false;
      for (let i = 0; i < LLM_PHASE_COUNT; i++) {
        const phaseConfig = PHASE_CONFIGS[i];
        const phaseId = phaseConfig.id as MultiPhaseId;

        if (checkpoint.isCompleted(phaseId)) {
          this.logger.info(
            `${SERVICE_TAG} Phase ${phaseId} already completed, skipping`,
          );
          continue;
        }
        if (masterAbortController.signal.aborted) {
          await checkpoint.pause(null);
          paused = true;
          break;
        }

        await checkpoint.markRunning(phaseId);
        this.broadcastPhaseProgress(
          phaseId as AnalysisPhase,
          i,
          LLM_PHASE_COUNT,
          checkpoint.statuses(),
          phaseConfig.label,
        );

        const phaseStart = Date.now();
        let outcome: PhaseExecutionOutcome;
        try {
          outcome = await this.executePhase(
            i,
            slugDir,
            workspacePath,
            manifest.model,
            mcpServerRunning,
            mcpPort,
            masterAbortController,
            pluginPaths,
          );
        } catch (error: unknown) {
          if (masterAbortController.signal.aborted) {
            await checkpoint.pause(phaseId);
            paused = true;
            break;
          }
          outcome = {
            resultReceived: false,
            timedOut: false,
            assistantText: null,
            error: error instanceof Error ? error.message : String(error),
          };
        }
        if (!outcome.resultReceived && masterAbortController.signal.aborted) {
          this.logger.info(
            `${SERVICE_TAG} Phase ${phaseId} paused by user; partial file kept`,
          );
          await checkpoint.pause(phaseId);
          paused = true;
          break;
        }

        await this.recordPhaseOutcome(
          checkpoint,
          phaseId,
          phaseConfig.file,
          outcome,
          Date.now() - phaseStart,
        );

        const statuses = checkpoint.statuses();
        this.broadcastPhaseProgress(
          phaseId as AnalysisPhase,
          i,
          LLM_PHASE_COUNT,
          statuses,
          statuses[i].status === 'completed'
            ? `${phaseConfig.label.replace('...', '')} complete`
            : phaseConfig.label,
        );
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

      if (!paused) {
        await checkpoint.finish();
      }

      this.logger.info(
        `${SERVICE_TAG} Multi-phase analysis ${paused ? 'paused' : 'finished'}`,
        {
          runId: manifest.runId,
          lifecycle: manifest.lifecycle,
          totalDurationMs: manifest.totalDurationMs,
          phases: Object.entries(manifest.phases).map(([id, r]) => ({
            id,
            status: r.status,
            durationMs: r.durationMs,
          })),
        },
      );
      this.broadcastPhaseProgress(
        'elevation-plan' as AnalysisPhase,
        PHASE_CONFIGS.length - 1,
        PHASE_CONFIGS.length,
        checkpoint.statuses(),
        paused ? 'Analysis paused' : 'Analysis complete',
      );

      return Result.ok(manifest);
    } catch (error: unknown) {
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
   * Pause a running multi-phase analysis. The active phase returns to
   * `pending` (its partial file is kept) and the manifest is left resumable.
   */
  cancelAnalysis(): void {
    if (this.activeAbortController) {
      this.logger.info(`${SERVICE_TAG} Pausing active multi-phase analysis`);
      this.activeAbortController.abort('user_cancelled');
      this.activeAbortController = null;
    } else {
      this.logger.debug(
        `${SERVICE_TAG} cancelAnalysis called but no active analysis`,
      );
    }
  }

  /**
   * Turn an execution outcome into the phase's terminal manifest state.
   *
   * `completed` requires a successful result AND a phase file — either one the
   * agent wrote or one created from the complete captured text. Everything
   * else is `failed` with a non-empty error; captured text is still written
   * to the phase file for diagnosis, but the manifest says failed.
   */
  private async recordPhaseOutcome(
    checkpoint: AnalysisRunCheckpoint,
    phaseId: MultiPhaseId,
    filename: string,
    outcome: PhaseExecutionOutcome,
    durationMs: number,
  ): Promise<void> {
    const fileExists = await this.storageService.phaseFileExists(
      checkpoint.slugDir,
      filename,
    );
    const succeeded =
      outcome.resultReceived && !outcome.timedOut && !outcome.error;

    if (succeeded) {
      if (!fileExists) {
        if (!outcome.assistantText) {
          this.logger.warn(
            `${SERVICE_TAG} Phase ${phaseId}: no file written and no text captured`,
          );
          await checkpoint.markFailed(
            phaseId,
            durationMs,
            'Agent did not write the phase file and no text was captured',
          );
          return;
        }
        this.logger.warn(
          `${SERVICE_TAG} Phase ${phaseId}: agent did not write file, creating it from the complete captured text`,
        );
        await this.storageService.writePhaseFile(
          checkpoint.slugDir,
          filename,
          outcome.assistantText,
        );
      }
      await checkpoint.markCompleted(phaseId, durationMs);
      return;
    }

    const error =
      outcome.error ??
      (outcome.timedOut
        ? `analysis_timeout: phase exceeded ${PER_PHASE_TIMEOUT_MS} ms`
        : 'Stream ended without a result');
    if (!fileExists && outcome.assistantText) {
      this.logger.warn(
        `${SERVICE_TAG} Phase ${phaseId}: keeping captured text as a diagnostic file (phase still failed)`,
      );
      await this.storageService.writePhaseFile(
        checkpoint.slugDir,
        filename,
        outcome.assistantText,
      );
    }
    this.logger.error(
      `${SERVICE_TAG} Phase ${phaseId} failed after ${durationMs}ms: ${error}`,
      { phaseId, durationMs, timedOut: outcome.timedOut },
    );
    await checkpoint.markFailed(phaseId, durationMs, error);
  }

  /**
   * Execute a single LLM phase (1-4).
   *
   * Creates a per-phase AbortController linked to the master, builds prompts,
   * calls InternalQueryService, processes the stream, and returns what the
   * stream produced. Throws only when the master controller aborted (a user
   * pause); every other failure is reported inside the outcome.
   */
  private async executePhase(
    phaseIndex: number,
    slugDir: string,
    cwd: string,
    model: string,
    mcpServerRunning: boolean,
    mcpPort: number | undefined,
    masterAbortController: AbortController,
    pluginPaths?: string[],
  ): Promise<PhaseExecutionOutcome> {
    const phaseConfig = PHASE_CONFIGS[phaseIndex];
    const promptBuilder = PROMPT_BUILDERS[phaseIndex];
    let pluginSkillsContext: string | undefined;
    if (pluginPaths && pluginPaths.length > 0) {
      const skills = discoverPluginSkills(pluginPaths);
      if (skills.length > 0) {
        pluginSkillsContext = formatSkillsForPrompt(skills);
      }
    }

    // The prompts hand this path to the agent, and the agent reads earlier
    // phases through `ptah.files.read`, which REJECTS absolute paths outright
    // (`resolveWorkspacePath` — the sandbox is workspace-relative by design).
    // An absolute slugDir made every phase after the first fail to read its
    // predecessor's output. The agent's cwd is the workspace root, so the
    // relative form is also correct for the Write tool.
    const { systemPrompt, userPrompt } = promptBuilder(
      relative(cwd, slugDir).replace(/\\/g, '/'),
      pluginSkillsContext,
    );

    this.logger.info(
      `${SERVICE_TAG} Executing phase ${phaseIndex + 1}/${LLM_PHASE_COUNT}: ${phaseConfig.id}`,
      {
        phaseId: phaseConfig.id,
        model,
        cwd,
        mcpServerRunning,
        mcpPort,
        maxTurns: MAX_AGENT_TURNS,
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
        slugDir,
        pluginPathCount: pluginPaths?.length ?? 0,
      },
    );
    const phaseAbortController = new AbortController();
    const onMasterAbort = () => phaseAbortController.abort('master_cancelled');
    masterAbortController.signal.addEventListener('abort', onMasterAbort, {
      once: true,
    });
    // Arm the timeout BEFORE execute() so the budget covers the queue wait for
    // a concurrency slot, not just the stream after the handle resolves.
    const phaseTimeoutHandle = setTimeout(
      () => phaseAbortController.abort('analysis_timeout'),
      PER_PHASE_TIMEOUT_MS,
    );
    const capture: PhaseTextCapture = {
      assistantTexts: [],
      resultText: null,
      resultReceived: false,
    };

    try {
      const executeStartMs = Date.now();
      const handle = await this.internalQueryService.execute({
        cwd,
        model,
        prompt: userPrompt,
        systemPromptAppend: systemPrompt,
        mcpServerRunning,
        mcpPort,
        maxTurns: MAX_AGENT_TURNS,
        abortController: phaseAbortController,
      });

      this.logger.info(
        `${SERVICE_TAG} Phase ${phaseConfig.id}: SDK handle obtained in ${Date.now() - executeStartMs}ms, processing stream...`,
      );

      try {
        await this.processPhaseStream(
          this.createTextCapturingStream(handle.stream, capture),
          phaseConfig.id as MultiPhaseId,
          capture,
        );
      } finally {
        handle.close();
      }
    } catch (error: unknown) {
      if (masterAbortController.signal.aborted) {
        throw error;
      }
      if (!phaseAbortController.signal.aborted) {
        capture.resultError =
          error instanceof Error ? error.message : String(error);
      }
    } finally {
      masterAbortController.signal.removeEventListener('abort', onMasterAbort);
      clearTimeout(phaseTimeoutHandle);
    }

    const timedOut =
      phaseAbortController.signal.aborted &&
      phaseAbortController.signal.reason === 'analysis_timeout';
    const assistantText =
      capture.assistantTexts.length > 0
        ? capture.assistantTexts.join('\n\n')
        : null;
    const error = timedOut
      ? `analysis_timeout: phase exceeded ${PER_PHASE_TIMEOUT_MS} ms`
      : capture.resultError;

    if (capture.resultReceived && !error) {
      this.logger.info(`${SERVICE_TAG} Phase ${phaseConfig.id} completed`, {
        textLength: assistantText?.length ?? 0,
      });
    }

    return {
      resultReceived: capture.resultReceived && !timedOut,
      timedOut,
      assistantText,
      ...(error ? { error } : {}),
    };
  }

  /**
   * Feed the SDK message stream to the SdkStreamProcessor for live UI
   * updates. Persistence never reads from this path: the processor throttles
   * text deltas to 100 ms and is UI-only.
   */
  private async processPhaseStream(
    stream: AsyncIterable<SDKMessage>,
    phaseId: MultiPhaseId,
    capture: PhaseTextCapture,
  ): Promise<void> {
    const convCtx = {
      messageId: `wizard-phase-${phaseId}`,
      sessionId: WizardPhaseId.fromPhase(phaseId),
      counter: 0,
      textBlockIndex: 0,
      thinkingBlockIndex: 0,
      /** Track the active tool's callId so tool_input/tool_result correlate correctly */
      activeToolCallId: null as string | null,
      /** Whether a thinking_start has been emitted for the current thinking block */
      thinkingStartEmitted: false,
    };

    const emitter: StreamEventEmitter = {
      emit: (event: StreamEvent) => {
        const flatEvent = this.convertStreamEventToFlatEvent(
          event,
          phaseId,
          convCtx,
        );
        this.broadcastStreamMessage({
          ...event,
          flatEvent: flatEvent ?? undefined,
        });
      },
    };
    this.broadcastStreamMessage({
      kind: 'status',
      content: `Phase ${phaseId} starting...`,
      timestamp: Date.now(),
      flatEvent: {
        id: `${phaseId}-msg-start`,
        eventType: 'message_start',
        timestamp: Date.now(),
        sessionId: convCtx.sessionId,
        messageId: convCtx.messageId,
        role: 'assistant',
      } as MessageStartEvent,
    });

    const processor = new SdkStreamProcessor({
      emitter,
      logger: this.logger,
      serviceTag: `${SERVICE_TAG}:${phaseId}`,
      skipStructuredOutput: true, // Multi-phase produces markdown, not JSON
    });

    await processor.process(stream);
    if (convCtx.activeToolCallId) {
      const syntheticToolResult: FlatStreamEventUnion = {
        id: `${phaseId}-tool-result-${convCtx.counter++}`,
        eventType: 'tool_result',
        timestamp: Date.now(),
        sessionId: convCtx.sessionId,
        messageId: convCtx.messageId,
        toolCallId: convCtx.activeToolCallId,
        output: capture.resultText ?? '(completed)',
        isError: false,
      } as ToolResultEvent;

      this.broadcastStreamMessage({
        kind: 'tool_result',
        content: capture.resultText ?? '(completed)',
        toolCallId: convCtx.activeToolCallId,
        timestamp: Date.now(),
        flatEvent: syntheticToolResult,
      });

      convCtx.activeToolCallId = null;
    }
    this.broadcastStreamMessage({
      kind: 'status',
      content: `Phase ${phaseId} complete`,
      timestamp: Date.now(),
      flatEvent: {
        id: `${phaseId}-msg-complete`,
        eventType: 'message_complete',
        timestamp: Date.now(),
        sessionId: convCtx.sessionId,
        messageId: convCtx.messageId,
      } as MessageCompleteEvent,
    });
  }

  /**
   * Wrap an SDK message stream to capture complete text for persistence.
   *
   * - Every `assistant` message contributes the concatenation of its `text`
   *   content blocks.
   * - A successful `result` message marks the phase as having a result and
   *   contributes its `result` text when it is not already the last
   *   assistant text.
   * - A non-success `result` message records its subtype as the error.
   */
  private async *createTextCapturingStream(
    stream: AsyncIterable<SDKMessage>,
    capture: PhaseTextCapture,
  ): AsyncIterable<SDKMessage> {
    for await (const message of stream) {
      if (message.type === 'assistant') {
        const text = extractAssistantText(message);
        if (text) capture.assistantTexts.push(text);
      } else if (message.type === 'result') {
        if (message.subtype === 'success') {
          capture.resultReceived = true;
          const resultText = (message as { result?: unknown }).result;
          if (typeof resultText === 'string' && resultText.trim().length > 0) {
            capture.resultText = resultText;
            const last = capture.assistantTexts.at(-1);
            if (last === undefined || last.trim() !== resultText.trim()) {
              capture.assistantTexts.push(resultText);
            }
          }
        } else {
          const errorResult = message as {
            subtype: string;
            errors?: unknown;
          };
          const details = Array.isArray(errorResult.errors)
            ? `: ${errorResult.errors.map(String).join('; ')}`
            : '';
          capture.resultError = `SDK result ${errorResult.subtype}${details}`;
        }
      }
      yield message;
    }
  }

  /**
   * Broadcast phase-level progress to the frontend.
   */
  private broadcastPhaseProgress(
    currentPhase: AnalysisPhase,
    phaseIndex: number,
    totalPhases: number,
    phaseStatuses: PhaseStatusSnapshot,
    phaseLabel?: string,
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
        payload,
      );
    } catch (error: unknown) {
      this.logger.debug(`${SERVICE_TAG} Failed to broadcast phase progress`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Convert a StreamEvent (kind-based) to a FlatStreamEventUnion (eventType-based)
   * for the ExecutionNode rendering pipeline.
   *
   * Maps each StreamEvent kind to the corresponding FlatStreamEventUnion
   * variant. Returns null for event kinds that have no FlatStreamEventUnion equivalent
   * (error, status).
   */
  private convertStreamEventToFlatEvent(
    event: StreamEvent,
    phaseId: MultiPhaseId,
    ctx: {
      messageId: string;
      sessionId: string;
      counter: number;
      textBlockIndex: number;
      thinkingBlockIndex: number;
      activeToolCallId: string | null;
      thinkingStartEmitted: boolean;
    },
  ): FlatStreamEventUnion | null {
    const baseFields = {
      id: `${phaseId}-${ctx.counter++}`,
      timestamp: event.timestamp,
      sessionId: ctx.sessionId,
      messageId: ctx.messageId,
    };

    switch (event.kind) {
      case 'text':
        return {
          ...baseFields,
          eventType: 'text_delta',
          delta: event.content,
          blockIndex: ctx.textBlockIndex,
        } as TextDeltaEvent;

      case 'thinking': {
        if (!ctx.thinkingStartEmitted) {
          ctx.thinkingStartEmitted = true;
          this.broadcastStreamMessage({
            kind: 'status',
            content: '',
            timestamp: event.timestamp,
            flatEvent: {
              ...baseFields,
              id: `${phaseId}-thinking-start-${ctx.thinkingBlockIndex}`,
              eventType: 'thinking_start',
              blockIndex: ctx.thinkingBlockIndex,
            } as FlatStreamEventUnion,
          });
          baseFields.id = `${phaseId}-${ctx.counter++}`;
        }
        return {
          ...baseFields,
          eventType: 'thinking_delta',
          delta: event.content,
          blockIndex: ctx.thinkingBlockIndex,
        } as ThinkingDeltaEvent;
      }

      case 'tool_start': {
        ctx.textBlockIndex++;
        ctx.thinkingBlockIndex++;
        ctx.thinkingStartEmitted = false;
        const toolCallId = event.toolCallId ?? `${phaseId}-tool-${ctx.counter}`;
        ctx.activeToolCallId = toolCallId;

        return {
          ...baseFields,
          eventType: 'tool_start',
          toolCallId,
          toolName: event.toolName ?? 'unknown',
          isTaskTool: false,
        } as ToolStartEvent;
      }

      case 'tool_input':
        return {
          ...baseFields,
          eventType: 'tool_delta',
          toolCallId:
            event.toolCallId ?? ctx.activeToolCallId ?? `${phaseId}-tool-unk`,
          delta: event.content,
        } as ToolDeltaEvent;

      case 'tool_result': {
        const toolResultId =
          event.toolCallId ?? ctx.activeToolCallId ?? `${phaseId}-tool-unk`;
        ctx.activeToolCallId = null;
        return {
          ...baseFields,
          eventType: 'tool_result',
          toolCallId: toolResultId,
          output: event.content,
          isError: event.isError ?? false,
        } as ToolResultEvent;
      }

      case 'error':
      case 'status':
        return null;

      default:
        return null;
    }
  }

  /**
   * Broadcast a stream event to the frontend for real-time transcript display.
   */
  private broadcastStreamMessage(payload: AnalysisStreamPayload): void {
    try {
      this.webviewManager.broadcastMessage(
        MESSAGE_TYPES.SETUP_WIZARD_ANALYSIS_STREAM,
        payload,
      );
    } catch (error: unknown) {
      this.logger.debug(`${SERVICE_TAG} Failed to broadcast stream message`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Concatenate the `text` content blocks of a complete assistant message.
 */
function extractAssistantText(message: SDKMessage): string | null {
  const content = (message as { message?: { content?: unknown } }).message
    ?.content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  const text = parts.join('');
  return text.trim().length > 0 ? text : null;
}
