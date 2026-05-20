/**
 * HarnessLlmRunner.
 *
 * Centralises the streaming-LLM-call boilerplate previously duplicated across
 * the five harness AI services (`harness-suggestion`, `harness-subagent-design`,
 * `harness-skill-generation`, `harness-document-generation`, `harness-chat`).
 *
 * Each call site previously inlined:
 *   1. `setTimeout(abortController.abort, …)` with a service-specific timeout.
 *   2. `internalQueryService.execute({ … })` with a fixed parameter shape.
 *   3. A `SdkStreamProcessor` configured with the call-site's `serviceTag`.
 *   4. A teed stream via `HarnessStreamBroadcaster.teeStreamWithFlatEvents` so
 *      the webview gets `harness:flat-stream` events alongside the SDK message
 *      pipeline.
 *   5. `broadcastComplete(operation, …)` and `broadcastFlatComplete(…)` lifecycle
 *      messages on both success and failure.
 *   6. `clearTimeout` + `handle.close()` cleanup in `finally`.
 *
 * The runner preserves all of that behaviour byte-identically. Per-service
 * post-processing (validation, sanitisation, response shaping) is kept at the
 * call site — services either:
 *   - pass a `postProcess` callback that runs INSIDE the try block (so a
 *     post-validation throw broadcasts `success=false`); or
 *   - omit the callback and run their post-processing AFTER the runner returns
 *     (which preserves the pre-extraction broadcast timing of
 *     `buildSuggestionViaAgent`).
 */

import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, SdkStreamProcessor } from '@ptah-extension/agent-sdk';
import type { InternalQueryService } from '@ptah-extension/agent-sdk';
import type { HarnessStreamOperation } from '@ptah-extension/shared';

import { HARNESS_TOKENS } from '../tokens';
import { HarnessStreamBroadcaster } from '../streaming/harness-stream-broadcaster.service';

/**
 * SDK query parameters forwarded to `InternalQueryService.execute`.
 *
 * Mirrors the subset of `InternalQueryConfig` actually used by the harness
 * services. The `abortController` is supplied by the runner.
 */
export interface HarnessLlmExecuteParams {
  cwd: string;
  model: string;
  prompt: string;
  systemPromptAppend: string;
  isPremium: boolean;
  mcpServerRunning: boolean;
  maxTurns: number;
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> };
}

/** Arguments for {@link HarnessLlmRunner.run}. */
export interface HarnessLlmRunArgs<TPostProcessed = unknown> {
  /** Stream operation tag — used for `createStreamEmitter` + broadcast events. */
  operation: HarnessStreamOperation;
  /** Service tag passed to `SdkStreamProcessor` (e.g. `'[HarnessSuggest]'`). */
  serviceTag: string;
  /** AbortController abort timeout in milliseconds. */
  timeoutMs: number;
  /** SDK query parameters forwarded verbatim to `InternalQueryService.execute`. */
  execute: HarnessLlmExecuteParams;
  /**
   * Optional in-try post-processing callback.
   *
   * Runs INSIDE the try block AFTER `processor.process(...)` but BEFORE the
   * success-complete broadcast. If it throws, the runner broadcasts
   * `success=false` with the error message and rethrows.
   *
   * Omit this when the call site needs to broadcast success immediately
   * after streaming and run validation outside the try block (preserves
   * `harness-suggestion.buildSuggestionViaAgent`'s historical broadcast
   * timing).
   */
  postProcess?: (
    structuredOutput: unknown,
  ) => Promise<TPostProcessed> | TPostProcessed;
}

/** Runner result. `postProcessed` is undefined when no `postProcess` is supplied. */
export interface HarnessLlmRunResult<TPostProcessed = unknown> {
  structuredOutput: unknown;
  postProcessed: TPostProcessed | undefined;
}

@injectable()
export class HarnessLlmRunner {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE)
    private readonly internalQueryService: InternalQueryService,
    @inject(HARNESS_TOKENS.STREAM_BROADCASTER)
    private readonly broadcaster: HarnessStreamBroadcaster,
  ) {}

  /**
   * Run a harness LLM call with streaming, teeing, broadcast, and cleanup
   * all centralised. Returns `{ structuredOutput, postProcessed }`.
   */
  async run<TPostProcessed = unknown>(
    args: HarnessLlmRunArgs<TPostProcessed>,
  ): Promise<HarnessLlmRunResult<TPostProcessed>> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), args.timeoutMs);

    const { emitter, operationId } = this.broadcaster.createStreamEmitter(
      args.operation,
    );

    const handle = await this.internalQueryService.execute({
      cwd: args.execute.cwd,
      model: args.execute.model,
      prompt: args.execute.prompt,
      systemPromptAppend: args.execute.systemPromptAppend,
      isPremium: args.execute.isPremium,
      mcpServerRunning: args.execute.mcpServerRunning,
      maxTurns: args.execute.maxTurns,
      outputFormat: args.execute.outputFormat,
      abortController,
    });

    try {
      const processor = new SdkStreamProcessor({
        emitter,
        logger: this.logger,
        serviceTag: args.serviceTag,
      });
      const teedStream = this.broadcaster.teeStreamWithFlatEvents(
        handle.stream,
        operationId,
      );
      const result = await processor.process(teedStream);
      const structuredOutput = result.structuredOutput;

      let postProcessed: TPostProcessed | undefined;
      if (args.postProcess) {
        postProcessed = await args.postProcess(structuredOutput);
      }

      this.broadcaster.broadcastComplete(args.operation, operationId, true);
      this.broadcaster.broadcastFlatComplete(operationId, true);

      return { structuredOutput, postProcessed };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.broadcaster.broadcastComplete(
        args.operation,
        operationId,
        false,
        message,
      );
      this.broadcaster.broadcastFlatComplete(operationId, false, message);
      throw error;
    } finally {
      clearTimeout(timeout);
      handle.close();
    }
  }
}
