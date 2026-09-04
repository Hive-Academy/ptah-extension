/**
 * GenerationRunSupervisor — the one owner of the active wizard generation run.
 *
 * Replaces the detached `Promise.race` watchdog that used to sit in
 * `WizardGenerationRpcHandlers.runGenerationInBackground`. That race rejected
 * at ten minutes and broadcast `success: false`, but never told the
 * orchestrator to stop — it went on to write fifteen agent files twenty-four
 * seconds after the user was told the run had failed, and nothing propagated
 * them (TASK_2026_361 F1).
 *
 * The supervisor holds ONE `AbortController` per run. The watchdog and
 * `wizard:cancel` both `abort()` it; the orchestrator threads the signal into
 * every SDK call and stops before its next agent or write. The run is then
 * AWAITED until the orchestrator actually settles, and exactly one completion
 * payload — derived from the settled per-agent outcomes — goes out. The active
 * flag clears only after that, so a second submit can never overlap a run that
 * is still winding down.
 */

import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type {
  GenerationAgentOutcome,
  GenerationCompletePayload,
  Result,
} from '@ptah-extension/shared';
import type {
  GenerationSummary,
  OrchestratorGenerationOptions,
} from '@ptah-extension/agent-generation';
import type { WebviewBroadcaster } from '../harness/streaming';

export const GENERATION_TIMEOUT_MS = 10 * 60 * 1000;
/** `AbortSignal.reason` the watchdog uses; the orchestrator maps it to `timed-out`. */
export const GENERATION_TIMEOUT_REASON = 'generation_timeout';
/** `AbortSignal.reason` a user cancel uses; the orchestrator maps it to `paused`. */
export const GENERATION_CANCEL_REASON = 'user_cancelled';

/**
 * Progress update callback payload from `AgentGenerationOrchestratorService`.
 * Declared structurally because the orchestrator's own type is not exported
 * from the agent-generation barrel.
 */
export interface GenerationProgress {
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

/** The slice of the orchestrator this run needs, matched structurally. */
export interface GenerationOrchestrator {
  generateAgents(
    options: OrchestratorGenerationOptions,
    progressCallback?: (progress: GenerationProgress) => void,
  ): Promise<Result<GenerationSummary, Error>>;
}

export interface GenerationRunRequest {
  orchestrator: GenerationOrchestrator;
  /** Options WITHOUT `abortSignal`; the supervisor attaches its own. */
  options: OrchestratorGenerationOptions;
  progressCallback?: (progress: GenerationProgress) => void;
  broadcaster: WebviewBroadcaster | null;
  /** Used for the payload when the run fails before a summary exists. */
  outputDirectory: string;
  /** Outcomes settled by an earlier run and skipped by this one (resume). */
  carriedOver: GenerationAgentOutcome[];
  timeoutMs?: number;
  /**
   * Runs after the orchestrator settled and BEFORE the single completion
   * broadcast: checkpoint finalize, harness propagation. Errors are logged;
   * they never suppress the broadcast.
   */
  onSettled?: (settled: SettledGenerationRun) => Promise<void>;
}

export interface SettledGenerationRun {
  /** The orchestrator's summary, or null when it returned Err or threw. */
  summary: GenerationSummary | null;
  /** Why there is no summary: the Err message, or the thrown error's message. */
  failure: { message: string; thrown: boolean } | null;
  /** The abort reason when the watchdog or a cancel stopped the run. */
  abortReason: string | null;
  durationMs: number;
  payload: GenerationCompletePayload;
}

export interface CompletePayloadInput {
  summary: GenerationSummary | null;
  failure: { message: string; thrown: boolean } | null;
  abortReason: string | null;
  carriedOver: GenerationAgentOutcome[];
  outputDirectory: string;
  durationMs: number;
}

function describeAbort(
  lifecycle: GenerationSummary['lifecycle'] | null,
  abortReason: string | null,
): string | null {
  if (lifecycle === 'timed-out') {
    return `Generation stopped: exceeded the ${GENERATION_TIMEOUT_MS / 60_000}-minute limit. Files written before the limit were kept.`;
  }
  if (lifecycle === 'paused') {
    return 'Generation paused. Files written so far were kept and the run can be resumed.';
  }
  if (abortReason) return `Generation stopped: ${abortReason}`;
  return null;
}

/**
 * Derive the one completion payload from explicit outcomes. Carried-over
 * agents count as `unchanged` — this invocation wrote nothing for them and
 * their file is already current. `success` is true only for a run that
 * completed with no failed agent; a paused or timed-out run is never a success
 * even when every agent it reached was written.
 */
export function buildCompletePayload(
  input: CompletePayloadInput,
): GenerationCompletePayload {
  const { summary, failure, abortReason, carriedOver, durationMs } = input;
  const agents: GenerationAgentOutcome[] = [
    ...carriedOver,
    ...(summary?.outcomes ?? []),
  ];
  const count = (status: GenerationAgentOutcome['status']): number =>
    agents.filter((agent) => agent.status === status).length;
  const failedCount = count('failed');
  const lifecycle = summary?.lifecycle ?? null;

  const errors: string[] = [];
  if (failure) errors.push(`Agent generation failed: ${failure.message}`);
  const abortMessage = describeAbort(lifecycle, abortReason);
  if (abortMessage) errors.push(abortMessage);
  for (const agent of agents) {
    if (agent.status === 'failed') {
      errors.push(`${agent.agentId}: ${agent.error ?? 'failed'}`);
    }
  }

  return {
    success:
      failure === null &&
      (lifecycle === null || lifecycle === 'completed') &&
      failedCount === 0,
    outputDirectory: summary?.outputDirectory ?? input.outputDirectory,
    writtenCount: count('written'),
    unchangedCount: count('unchanged'),
    failedCount,
    rejectedSections: agents.reduce((sum, a) => sum + a.rejectedSections, 0),
    tailoredSections: agents.reduce((sum, a) => sum + a.tailoredSections, 0),
    agents,
    duration: durationMs,
    ...(errors.length > 0 ? { errors } : {}),
    ...(summary && summary.warnings.length > 0
      ? { warnings: summary.warnings }
      : {}),
    ...(summary ? { enhancedPromptsUsed: summary.enhancedPromptsUsed } : {}),
  };
}

@injectable()
export class GenerationRunSupervisor {
  private activeController: AbortController | null = null;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /** True from launch until the completion payload has gone out. */
  get isActive(): boolean {
    return this.activeController !== null;
  }

  /**
   * Abort the active run. Returns false when nothing is running. The active
   * flag is NOT cleared here — the run clears it once the orchestrator has
   * actually stopped and its outcome was broadcast.
   */
  abort(reason: string): boolean {
    if (!this.activeController) return false;
    if (!this.activeController.signal.aborted) {
      this.activeController.abort(reason);
    }
    return true;
  }

  /**
   * Run one generation to settlement. Never rejects once launched: every
   * failure becomes a `SettledGenerationRun` with a failure payload. Throws
   * synchronously only when a run is already active.
   */
  async run(request: GenerationRunRequest): Promise<SettledGenerationRun> {
    if (this.activeController) {
      throw new Error('A generation run is already active.');
    }
    const controller = new AbortController();
    this.activeController = controller;
    const startTime = Date.now();
    const timeoutMs = request.timeoutMs ?? GENERATION_TIMEOUT_MS;
    const watchdog = setTimeout(() => {
      this.logger.warn('Generation watchdog fired; aborting the orchestrator', {
        timeoutMs,
      });
      controller.abort(GENERATION_TIMEOUT_REASON);
    }, timeoutMs);
    // The RPC that launched this run has already returned. An ARMED timer
    // keeps the Node event loop alive (TASK_2026_320), so it must never be the
    // reason a process stays up. `unref` exists on Node's Timeout only.
    if (typeof (watchdog as { unref?: () => void }).unref === 'function') {
      (watchdog as { unref: () => void }).unref();
    }

    try {
      let summary: GenerationSummary | null = null;
      let failure: SettledGenerationRun['failure'] = null;
      try {
        const result = await request.orchestrator.generateAgents(
          { ...request.options, abortSignal: controller.signal },
          request.progressCallback,
        );
        if (result.isOk() && result.value) {
          summary = result.value;
        } else {
          failure = {
            message: result.error?.message ?? 'Agent generation failed',
            thrown: false,
          };
        }
      } catch (error: unknown) {
        failure = {
          message: error instanceof Error ? error.message : String(error),
          thrown: true,
        };
      }
      clearTimeout(watchdog);

      const abortReason = controller.signal.aborted
        ? String(controller.signal.reason)
        : null;
      const durationMs = Date.now() - startTime;
      const settled: SettledGenerationRun = {
        summary,
        failure,
        abortReason,
        durationMs,
        payload: buildCompletePayload({
          summary,
          failure,
          abortReason,
          carriedOver: request.carriedOver,
          outputDirectory: request.outputDirectory,
          durationMs,
        }),
      };

      if (request.onSettled) {
        try {
          await request.onSettled(settled);
        } catch (error: unknown) {
          this.logger.warn('Post-settlement step failed; broadcasting anyway', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      await this.broadcastCompletion(request.broadcaster, settled.payload);
      return settled;
    } finally {
      clearTimeout(watchdog);
      this.activeController = null;
    }
  }

  /** The single completion broadcast. A broadcast failure is logged only. */
  async broadcastCompletion(
    broadcaster: WebviewBroadcaster | null,
    payload: GenerationCompletePayload,
  ): Promise<void> {
    if (!broadcaster) return;
    try {
      await broadcaster.broadcastMessage(
        'setup-wizard:generation-complete',
        payload,
      );
    } catch (error: unknown) {
      this.logger.warn('Failed to broadcast generation complete', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
