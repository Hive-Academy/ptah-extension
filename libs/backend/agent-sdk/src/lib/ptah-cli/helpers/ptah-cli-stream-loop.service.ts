/**
 * Ptah CLI Stream Loop - Per-stream message processing
 *
 * **Not injectable** — instantiated per spawnAgent() call because it holds
 * mutable per-stream state (streaming flags, pending tool args, session ID).
 * Follows the same plain-class pattern as SdkStreamProcessor.
 *
 */

import type {
  CliOutputSegment,
  FlatStreamEventUnion,
  SessionId,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SdkMessageTransformer } from '../../sdk-message-transformer';
import type { SDKMessage } from '../../types/sdk-types/claude-sdk.types';
import {
  isStreamEvent,
  isAssistantMessage,
  isResultMessage,
  isSuccessResult,
  isErrorResult,
  isSystemInit,
  isCompactBoundary,
  isUserMessage,
  isToolProgress,
  isToolUseSummary,
  isContentBlockStart,
  isContentBlockDelta,
  isTextBlock,
  isToolUseBlock,
  isThinkingBlock,
  isTextDelta,
  isInputJsonDelta,
  isThinkingDelta,
} from '../../types/sdk-types/claude-sdk.types';
import {
  summarizeToolInput,
  sanitizeErrorMessage,
} from './ptah-cli-registry.utils';

/**
 * Configuration for PtahCliStreamLoop.
 * Provides all callbacks and dependencies the loop needs.
 */
export interface PtahCliStreamLoopConfig {
  readonly logger: Logger;
  readonly messageTransformer: SdkMessageTransformer;
  readonly emitOutput: (data: string) => void;
  readonly emitSegment: (segment: CliOutputSegment) => void;
  readonly emitStreamEvent: (event: FlatStreamEventUnion) => void;
  readonly agentName: string;
  /** Called when the real SDK session ID is resolved from the system init message. */
  readonly onSessionResolved?: (sessionId: string) => void;
}

/**
 * PtahCliStreamLoop - Consumes the SDK async iterable and dispatches
 * structured segments, raw text, and FlatStreamEventUnion events.
 *
 * One instance per spawnAgent() call — holds mutable streaming state.
 */
export class PtahCliStreamLoop {
  private receivedTextDeltas = false;
  private receivedThinkingDeltas = false;
  private effectiveSessionId = '' as SessionId;
  private readonly streamTransformer: SdkMessageTransformer;
  private readonly pendingToolArgs = new Map<
    number,
    { name: string; id: string; jsonFragments: string[] }
  >();
  /** Track messageIds already emitted via stream_event to avoid duplicate message_start from assistant */
  private readonly emittedMessageIds = new Set<string>();
  /** Track toolCallIds already emitted via stream_event to avoid duplicate tool_start from assistant */
  private readonly emittedToolCallIds = new Set<string>();

  constructor(private readonly config: PtahCliStreamLoopConfig) {
    // Per-stream isolated transformer — the shared singleton has mutable state
    // that causes errors when concurrent Ptah CLI agents interleave events.
    this.streamTransformer = config.messageTransformer.createIsolated();
  }

  /**
   * Run the stream processing loop.
   *
   * @param sdkQuery - The async iterable from SDK queryFn()
   * @returns Exit code: 0 for success, 1 for error
   */
  async run(sdkQuery: AsyncIterable<SDKMessage>): Promise<number> {
    const { logger, emitOutput, emitSegment, emitStreamEvent } = this.config;

    try {
      // outer try-finally for state cleanup
      try {
        for await (const msg of sdkQuery) {
          // ── FlatStreamEventUnion emission (agent monitor) ──
          // DEDUP STRATEGY:
          //  - stream_event → emit all events (primary source for real-time deltas)
          //  - assistant    → emit structural/landmark events only (message_start,
          //                   tool_start, agent_start, message_complete, etc.)
          //                   Content deltas (text_delta, thinking_delta, tool_delta)
          //                   are already provided by stream_event — skipping them
          //                   prevents doubled text in the tree builder accumulators.
          //  - user         → emit all events (provides tool_result)
          if (isStreamEvent(msg) || isUserMessage(msg)) {
            try {
              const flatEvents = this.streamTransformer.transform(
                msg,
                this.effectiveSessionId || undefined,
              );
              for (const event of flatEvents) {
                // Track IDs from stream_event to dedup against assistant
                if (event.eventType === 'message_start') {
                  this.emittedMessageIds.add(
                    (event as { messageId?: string }).messageId ?? '',
                  );
                } else if (event.eventType === 'tool_start') {
                  this.emittedToolCallIds.add(
                    (event as { toolCallId?: string }).toolCallId ?? '',
                  );
                }
                emitStreamEvent(event);
              }
            } catch (transformError) {
              logger.warn(
                '[PtahCliStreamLoop] Failed to transform SDK message to stream events',
                {
                  error:
                    transformError instanceof Error
                      ? transformError.message
                      : String(transformError),
                },
              );
            }
          } else if (isAssistantMessage(msg)) {
            try {
              const flatEvents = this.streamTransformer.transform(
                msg,
                this.effectiveSessionId || undefined,
              );
              // Emit structural events that provide tree structure for the agent
              // monitor. Content deltas are already streamed via stream_event messages.
              // Skip message_start/tool_start if already emitted by stream_event
              // (same messageId) to prevent duplicate tree nodes.
              for (const event of flatEvents) {
                switch (event.eventType) {
                  case 'message_start': {
                    const msgId =
                      (event as { messageId?: string }).messageId ?? '';
                    if (!this.emittedMessageIds.has(msgId)) {
                      this.emittedMessageIds.add(msgId);
                      emitStreamEvent(event);
                    }
                    break;
                  }
                  case 'tool_start': {
                    const tcId =
                      (event as { toolCallId?: string }).toolCallId ?? '';
                    if (!this.emittedToolCallIds.has(tcId)) {
                      this.emittedToolCallIds.add(tcId);
                      emitStreamEvent(event);
                    }
                    break;
                  }
                  case 'message_complete':
                  case 'agent_start':
                  case 'background_agent_started':
                    emitStreamEvent(event);
                    break;
                  // Skip content deltas — already provided by stream_event
                  default:
                    break;
                }
              }
            } catch (transformError) {
              logger.warn(
                '[PtahCliStreamLoop] Failed to transform assistant message for agent events',
                {
                  error:
                    transformError instanceof Error
                      ? transformError.message
                      : String(transformError),
                },
              );
            }
          }

          // ── system init ─────────────────────────────────
          if (isSystemInit(msg)) {
            this.effectiveSessionId = (msg.session_id ?? '') as SessionId;
            const model = msg.model ?? 'unknown';
            emitOutput(`[PtahCli] Session started (model: ${model})\n`);
            emitSegment({
              type: 'info',
              content: `Session started: ${msg.session_id} (model: ${model})`,
            });
            if (this.effectiveSessionId && this.config.onSessionResolved) {
              this.config.onSessionResolved(this.effectiveSessionId);
            }
            continue;
          }

          // ── compact_boundary ────────────────────────────
          if (isCompactBoundary(msg)) {
            const tokens = msg.compact_metadata?.pre_tokens;
            const content = tokens
              ? `Context compaction (${tokens} tokens before)`
              : 'Context compaction';
            emitOutput(`\n[${content}]\n`);
            emitSegment({ type: 'info', content });
            continue;
          }

          // ── stream_event (streaming deltas) ─────────────
          if (isStreamEvent(msg)) {
            const event = msg.event;

            // content_block_start: detect tool_use / thinking / text block starts
            if (isContentBlockStart(event)) {
              const block = event.content_block;
              if (isToolUseBlock(block)) {
                const argsStr = summarizeToolInput(block.input);
                this.pendingToolArgs.set(event.index, {
                  name: block.name,
                  id: block.id,
                  jsonFragments: [],
                });
                emitOutput(
                  `\n**Tool:** \`${block.name}\`${argsStr ? ` ${argsStr}` : ''}\n`,
                );
                emitSegment({
                  type: 'tool-call',
                  content: '',
                  toolName: block.name,
                  toolArgs: argsStr,
                });
              }
              continue;
            }

            // content_block_delta: streaming content
            if (isContentBlockDelta(event)) {
              const delta = event.delta;

              if (isTextDelta(delta)) {
                this.receivedTextDeltas = true;
                emitOutput(delta.text);
                emitSegment({ type: 'text', content: delta.text });
              } else if (isThinkingDelta(delta)) {
                this.receivedThinkingDeltas = true;
                emitSegment({ type: 'thinking', content: delta.thinking });
              } else if (isInputJsonDelta(delta)) {
                const pending = this.pendingToolArgs.get(event.index);
                if (pending) {
                  pending.jsonFragments.push(delta.partial_json);
                }
              }
              continue;
            }

            // Other stream events are structural — no user-visible segments needed
            continue;
          }

          // ── assistant (complete message — fallback if no streaming) ──
          if (isAssistantMessage(msg)) {
            const blocks = msg.message?.content;
            if (Array.isArray(blocks)) {
              for (const block of blocks) {
                if (isTextBlock(block)) {
                  if (!this.receivedTextDeltas) {
                    emitOutput(block.text);
                    emitSegment({ type: 'text', content: block.text });
                  }
                } else if (isToolUseBlock(block)) {
                  if (!this.receivedTextDeltas) {
                    const argsStr = summarizeToolInput(block.input);
                    emitOutput(
                      `\n**Tool:** \`${block.name}\`${
                        argsStr ? ` ${argsStr}` : ''
                      }\n`,
                    );
                    emitSegment({
                      type: 'tool-call',
                      content: '',
                      toolName: block.name,
                      toolArgs: argsStr,
                    });
                  }
                } else if (isThinkingBlock(block)) {
                  if (!this.receivedThinkingDeltas) {
                    emitSegment({
                      type: 'thinking',
                      content: block.thinking,
                    });
                  }
                }
              }
            }
            // Reset streaming flags for next turn
            this.receivedTextDeltas = false;
            this.receivedThinkingDeltas = false;
            this.pendingToolArgs.clear();
            continue;
          }

          // ── user message (contains tool results) ────────
          if (isUserMessage(msg)) {
            const content = msg.message?.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'tool_result') {
                  const resultText =
                    typeof block.content === 'string'
                      ? block.content
                      : Array.isArray(block.content)
                        ? block.content
                            .filter(
                              (b): b is { type: 'text'; text: string } =>
                                b.type === 'text',
                            )
                            .map((b) => b.text)
                            .join('\n')
                        : '';
                  const truncated =
                    resultText.length > 2000
                      ? resultText.substring(0, 2000) + '\n... [truncated]'
                      : resultText;

                  if (block.is_error) {
                    emitOutput(`\n**Tool Error:** ${truncated}\n`);
                    emitSegment({
                      type: 'tool-result-error',
                      content: truncated,
                    });
                  } else {
                    emitOutput(
                      `\n<details><summary>Tool result</summary>\n\n\`\`\`\n${truncated}\n\`\`\`\n</details>\n\n`,
                    );
                    emitSegment({
                      type: 'tool-result',
                      content: truncated,
                    });
                  }
                }
              }
            }
            continue;
          }

          // ── result (final message with usage) ───────────
          if (isResultMessage(msg)) {
            if (isSuccessResult(msg)) {
              const parts: string[] = [];
              if (msg.usage) {
                parts.push(`${msg.usage.input_tokens} input`);
                parts.push(`${msg.usage.output_tokens} output`);
              }
              if (msg.total_cost_usd !== undefined) {
                parts.push(`$${msg.total_cost_usd.toFixed(4)}`);
              }
              if (msg.duration_ms !== undefined) {
                parts.push(`${(msg.duration_ms / 1000).toFixed(1)}s`);
              }
              parts.push(`${msg.num_turns} turns`);
              const usageStr = `Completed: ${parts.join(', ')}`;
              emitOutput(`\n[${usageStr}]\n`);
              emitSegment({ type: 'info', content: usageStr });
            } else if (isErrorResult(msg)) {
              const errorMsg =
                msg.errors?.join('; ') ?? `Error: ${msg.subtype}`;
              emitOutput(`\n[Error: ${errorMsg}]\n`);
              emitSegment({ type: 'error', content: errorMsg });
            }
            continue;
          }

          // ── tool_progress ───────────────────────────────
          if (isToolProgress(msg)) {
            emitSegment({
              type: 'info',
              content: `${
                msg.tool_name
              } running (${msg.elapsed_time_seconds.toFixed(0)}s)`,
            });
            continue;
          }

          // ── tool_use_summary ────────────────────────────
          if (isToolUseSummary(msg)) {
            emitOutput(`\n${msg.summary}\n`);
            emitSegment({ type: 'info', content: msg.summary });
            continue;
          }
        }
        return 0;
      } catch (error) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        const isAbort =
          rawMessage.includes('abort') || rawMessage.includes('cancel');
        if (!isAbort) {
          logger.error(
            `[PtahCliStreamLoop] spawnAgent query error: ${rawMessage}`,
          );
          const sanitized = sanitizeErrorMessage(rawMessage);
          emitOutput(`\n[Error: ${sanitized}]\n`);
          emitSegment({ type: 'error', content: sanitized });
        }
        return 1;
      }
    } finally {
      // Clear mutable per-stream state to release references after stream ends.
      // Safe to call on both success and error paths — the stream is done at this point.
      this.pendingToolArgs.clear();
      this.emittedMessageIds.clear();
      this.emittedToolCallIds.clear();
    }
  }
}
