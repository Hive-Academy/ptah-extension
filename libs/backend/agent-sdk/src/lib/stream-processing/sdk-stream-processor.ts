/**
 * SdkStreamProcessor - Unified SDK message stream processing
 *
 * Extracts the common stream processing loop shared by:
 * - AgenticAnalysisService.processStream()
 * - ContentGenerationService.processGenerationStream()
 * - EnhancedPromptsService.processPromptDesignerStream()
 *
 * Each service creates a config with its own emitter, optional phase tracker,
 * and optional timeout. The processor handles:
 * - Text/thinking delta throttling (100ms)
 * - Tool call tracking (activeToolBlocks + completedToolNames)
 * - JSON input accumulation for tool calls
 * - Tool result extraction from user messages
 * - Structured output extraction from result messages
 *
 * This is a plain utility class (not injectable) — each service constructs
 * it with the appropriate config.
 */

import type {
  SDKMessage,
  ToolResultBlock,
} from '../types/sdk-types/claude-sdk.types';
import {
  isContentBlockDelta,
  isContentBlockStart,
  isContentBlockStop,
  isTextDelta,
  isInputJsonDelta,
  isThinkingDelta,
} from '../types/sdk-types/claude-sdk.types';
import type {
  SdkStreamProcessorConfig,
  StreamProcessorResult,
} from './sdk-stream-processor.types';

/** Throttle interval for text and thinking deltas */
const THROTTLE_MS = 100;

export class SdkStreamProcessor {
  private readonly config: SdkStreamProcessorConfig;

  constructor(config: SdkStreamProcessorConfig) {
    this.config = config;
  }

  /**
   * Process an SDK message stream and return the structured output.
   *
   * Iterates the async iterable, emitting events for live UI updates,
   * and returns the structured_output from the result message.
   */
  async process(
    stream: AsyncIterable<SDKMessage>,
  ): Promise<StreamProcessorResult> {
    const { emitter, timeout, phaseTracker, logger, serviceTag } = this.config;
    const toolCallIdFactory =
      this.config.toolCallIdFactory ?? ((_, __, id) => id);

    // Throttle state
    let lastTextEmit = 0;
    let lastThinkingEmit = 0;

    // Tool tracking state
    let toolCallCount = 0;
    const activeToolBlocks = new Map<
      number,
      { name: string; inputBuffer: string; toolCallId: string }
    >();
    const completedToolNames = new Map<string, string>();

    // Timeout setup
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (timeout) {
      timeoutId = setTimeout(() => {
        logger.warn(`${serviceTag} Stream timed out after ${timeout.ms}ms`);
        timeout.abortController.abort('analysis_timeout');
      }, timeout.ms);
    }

    try {
      for await (const message of stream) {
        // =============================================================
        // Result message — extract structured_output
        // =============================================================
        if (message.type === 'result') {
          if (timeoutId !== undefined) clearTimeout(timeoutId);

          if (message.subtype === 'success') {
            logger.info(`${serviceTag} Query completed`, {
              turns: message.num_turns,
              cost: message.total_cost_usd,
              inputTokens: message.usage.input_tokens,
              outputTokens: message.usage.output_tokens,
              hasStructuredOutput: !!message.structured_output,
            });

            const resultMeta = {
              turns: message.num_turns,
              cost: message.total_cost_usd,
              inputTokens: message.usage.input_tokens,
              outputTokens: message.usage.output_tokens,
            };

            // When skipStructuredOutput is set (e.g., multi-phase markdown pipeline),
            // skip JSON extraction entirely — the caller captures text via its own mechanism.
            if (this.config.skipStructuredOutput) {
              return { structuredOutput: null, resultMeta };
            }

            // Primary: SDK structured output
            if (message.structured_output) {
              return {
                structuredOutput: message.structured_output,
                resultMeta,
              };
            }

            // Fallback: parse from result text
            if (message.result) {
              logger.warn(
                `${serviceTag} No structured_output, falling back to text parsing`,
              );
              try {
                return {
                  structuredOutput: JSON.parse(message.result),
                  resultMeta,
                };
              } catch {
                logger.warn(
                  `${serviceTag} Could not parse result text as JSON`,
                );
              }
            }

            return { structuredOutput: null, resultMeta };
          }

          // Error result
          const errorResult = message as {
            subtype: string;
            errors?: string[];
          };
          logger.error(`${serviceTag} Query failed`, {
            subtype: errorResult.subtype,
            errors: errorResult.errors,
          });
          return { structuredOutput: null };
        }

        // =============================================================
        // Stream events — live UI updates
        // =============================================================
        if (message.type === 'stream_event') {
          const event = message.event;

          // Content block deltas
          if (isContentBlockDelta(event)) {
            // Text delta
            if (isTextDelta(event.delta)) {
              const now = Date.now();
              if (now - lastTextEmit >= THROTTLE_MS) {
                const trimmed = event.delta.text.trim();
                if (trimmed.length > 0) {
                  lastTextEmit = now;
                  this.safeEmit(emitter, {
                    kind: 'text',
                    content: event.delta.text,
                    timestamp: now,
                  });
                }
              }
            }

            // JSON input accumulation
            if (isInputJsonDelta(event.delta)) {
              const activeBlock = activeToolBlocks.get(event.index);
              if (activeBlock) {
                activeBlock.inputBuffer += event.delta.partial_json;
              }
            }

            // Thinking delta
            if (isThinkingDelta(event.delta)) {
              const now = Date.now();
              if (now - lastThinkingEmit >= THROTTLE_MS) {
                lastThinkingEmit = now;
                const thinkingPreview = event.delta.thinking.substring(0, 120);
                phaseTracker?.onThinking(thinkingPreview);
                this.safeEmit(emitter, {
                  kind: 'thinking',
                  content: event.delta.thinking,
                  timestamp: now,
                });
              }
            }
          }

          // Tool use start
          if (
            isContentBlockStart(event) &&
            event.content_block.type === 'tool_use'
          ) {
            toolCallCount++;
            const toolCallId = toolCallIdFactory(
              event.content_block.name,
              event.index,
              event.content_block.id,
            );
            activeToolBlocks.set(event.index, {
              name: event.content_block.name,
              inputBuffer: '',
              toolCallId,
            });

            phaseTracker?.onToolStart(toolCallCount, event.content_block.name);

            this.safeEmit(emitter, {
              kind: 'tool_start',
              content: `Calling ${event.content_block.name}`,
              toolName: event.content_block.name,
              toolCallId,
              timestamp: Date.now(),
            });
          }

          // Tool use stop
          if (isContentBlockStop(event)) {
            const completedBlock = activeToolBlocks.get(event.index);
            if (completedBlock) {
              phaseTracker?.onToolStop(
                completedBlock.toolCallId,
                completedBlock.inputBuffer,
              );

              this.safeEmit(emitter, {
                kind: 'tool_input',
                content: completedBlock.inputBuffer,
                toolName: completedBlock.name,
                toolCallId: completedBlock.toolCallId,
                timestamp: Date.now(),
              });

              completedToolNames.set(
                completedBlock.toolCallId,
                completedBlock.name,
              );
              activeToolBlocks.delete(event.index);
            }
          }
        }

        // =============================================================
        // Assistant messages — log only
        // =============================================================
        if (message.type === 'assistant') {
          logger.debug(`${serviceTag} Assistant message`, {
            contentBlocks: message.message.content.length,
            stopReason: message.message.stop_reason,
          });
        }

        // =============================================================
        // Tool results from user messages
        // =============================================================
        if (message.type === 'user') {
          const content = (message as { message?: { content?: unknown } })
            .message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              const typedBlock = block as { type?: string };
              if (typedBlock.type === 'tool_result') {
                const resultBlock = block as ToolResultBlock;
                const resultContent =
                  typeof resultBlock.content === 'string'
                    ? resultBlock.content
                    : JSON.stringify(resultBlock.content);
                this.safeEmit(emitter, {
                  kind: 'tool_result',
                  content: resultContent,
                  toolName:
                    completedToolNames.get(resultBlock.tool_use_id) || 'tool',
                  toolCallId: resultBlock.tool_use_id,
                  isError: resultBlock.is_error ?? false,
                  timestamp: Date.now(),
                });
              }
            }
          }
        }
      }

      logger.warn(`${serviceTag} Stream ended without result`);
      return { structuredOutput: null };
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  /**
   * Fire-and-forget emit — swallows callback errors.
   */
  private safeEmit(
    emitter: SdkStreamProcessorConfig['emitter'],
    event: Parameters<SdkStreamProcessorConfig['emitter']['emit']>[0],
  ): void {
    try {
      emitter.emit(event);
    } catch {
      // Fire-and-forget: swallow callback errors
    }
  }
}
