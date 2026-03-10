/**
 * Copilot Response Translator - TASK_2025_186 Batch 1
 *
 * Stateful streaming translator that converts OpenAI Chat Completions
 * SSE chunks into Anthropic Messages API SSE events.
 *
 * Each instance tracks:
 * - Content block indices (incrementing for each new block)
 * - Whether the message_start event has been emitted
 * - Tool call delta accumulation buffers (by tool index)
 * - Token usage counters
 *
 * Create a new instance per request (stateful, not reusable).
 */

import type {
  OpenAIStreamChunk,
  OpenAIStreamChoice,
  OpenAIToolCallDelta,
} from './copilot-provider.types';

// ---------------------------------------------------------------------------
// Internal types for tool call accumulation
// ---------------------------------------------------------------------------

interface ToolCallBuffer {
  /** Unique tool_use ID for Anthropic events */
  id: string;
  /** Tool function name (accumulated from first delta) */
  name: string;
  /** Accumulated JSON arguments string */
  arguments: string;
  /** Whether the content_block_start has been emitted for this tool */
  started: boolean;
}

// ---------------------------------------------------------------------------
// SSE formatting helper
// ---------------------------------------------------------------------------

/**
 * Format a single Anthropic SSE event string.
 * Format: `event: <type>\ndata: <json>\n\n`
 */
function sseEvent(eventType: string, data: Record<string, unknown>): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ---------------------------------------------------------------------------
// Main translator class
// ---------------------------------------------------------------------------

/**
 * Translates OpenAI streaming chunks into Anthropic SSE event strings.
 *
 * Usage:
 * ```
 * const translator = new CopilotResponseTranslator('claude-sonnet-4', 'req-123');
 * for (const chunk of openaiChunks) {
 *   const events = translator.translateChunk(chunk);
 *   for (const event of events) {
 *     response.write(event);
 *   }
 * }
 * const finalEvents = translator.finalize();
 * for (const event of finalEvents) {
 *   response.write(event);
 * }
 * ```
 */
export class CopilotResponseTranslator {
  /** Current content block index (incrementing) */
  private blockIndex = 0;

  /** Whether the message_start event has been emitted */
  private messageStartSent = false;

  /** Whether we are currently in a text content block */
  private inTextBlock = false;

  /** Whether termination events have already been emitted */
  private finalized = false;

  /** Accumulated tool call deltas by OpenAI tool index */
  private readonly toolCallBuffers: Map<number, ToolCallBuffer> = new Map();

  /** Accumulated input token count */
  private inputTokens = 0;

  /** Accumulated output token count */
  private outputTokens = 0;

  /**
   * @param model - The model name to include in Anthropic events
   * @param requestId - Unique request identifier for generating tool_use IDs
   */
  constructor(
    private readonly model: string,
    private readonly requestId: string
  ) {}

  /**
   * Translate a single OpenAI streaming chunk into zero or more
   * Anthropic SSE event strings.
   *
   * @param openaiChunk - A parsed OpenAI SSE chunk
   * @returns Array of SSE event strings (may be empty)
   */
  translateChunk(openaiChunk: OpenAIStreamChunk): string[] {
    const events: string[] = [];

    // Track usage if present (OpenAI sends this in the final chunk)
    if (openaiChunk.usage) {
      this.inputTokens = openaiChunk.usage.prompt_tokens ?? this.inputTokens;
      this.outputTokens =
        openaiChunk.usage.completion_tokens ?? this.outputTokens;
    }

    // Process each choice (typically just one)
    if (openaiChunk.choices) {
      for (const choice of openaiChunk.choices) {
        events.push(...this.translateChoice(choice));
      }
    }

    return events;
  }

  /**
   * Emit final events when the stream ends.
   * Flushes any pending tool call buffers and emits the
   * message_delta + message_stop sequence.
   *
   * @returns Array of final SSE event strings
   */
  finalize(): string[] {
    if (this.finalized) {
      return [];
    }

    const events: string[] = [];

    // Ensure message_start was sent (edge case: empty stream)
    if (!this.messageStartSent) {
      events.push(...this.emitMessageStart());
    }

    // Flush any pending tool call buffers
    events.push(...this.flushToolCallBuffers());

    // Close the current text block if open
    if (this.inTextBlock) {
      events.push(
        sseEvent('content_block_stop', {
          type: 'content_block_stop',
          index: this.blockIndex,
        })
      );
      this.inTextBlock = false;
    }

    // message_delta with stop reason and final usage
    events.push(
      sseEvent('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: this.outputTokens },
      })
    );

    // message_stop
    events.push(sseEvent('message_stop', { type: 'message_stop' }));

    return events;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Translate a single OpenAI choice delta into Anthropic events.
   */
  private translateChoice(choice: OpenAIStreamChoice): string[] {
    const events: string[] = [];
    const delta = choice.delta;

    // Emit message_start on the very first chunk
    if (!this.messageStartSent) {
      events.push(...this.emitMessageStart());
    }

    // Handle text content delta
    if (delta.content != null && delta.content !== '') {
      events.push(...this.handleTextDelta(delta.content));
    }

    // Handle tool call deltas
    if (delta.tool_calls && delta.tool_calls.length > 0) {
      for (const toolDelta of delta.tool_calls) {
        events.push(...this.handleToolCallDelta(toolDelta));
      }
    }

    // Handle finish_reason
    if (choice.finish_reason) {
      events.push(...this.handleFinishReason(choice.finish_reason));
    }

    return events;
  }

  /**
   * Emit the initial message_start event with model info and usage.
   */
  private emitMessageStart(): string[] {
    this.messageStartSent = true;
    return [
      sseEvent('message_start', {
        type: 'message_start',
        message: {
          id: `msg_${this.requestId}`,
          type: 'message',
          role: 'assistant',
          content: [],
          model: this.model,
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: this.inputTokens,
            output_tokens: 0,
          },
        },
      }),
    ];
  }

  /**
   * Handle an incremental text content delta.
   * Opens a text content block if one isn't already open.
   */
  private handleTextDelta(text: string): string[] {
    const events: string[] = [];

    // Flush tool buffers before starting text (tools come before text continuation is unusual,
    // but handle it gracefully)
    if (this.toolCallBuffers.size > 0) {
      events.push(...this.flushToolCallBuffers());
    }

    // Open a new text block if needed
    if (!this.inTextBlock) {
      events.push(
        sseEvent('content_block_start', {
          type: 'content_block_start',
          index: this.blockIndex,
          content_block: { type: 'text', text: '' },
        })
      );
      this.inTextBlock = true;
    }

    // Emit text delta
    events.push(
      sseEvent('content_block_delta', {
        type: 'content_block_delta',
        index: this.blockIndex,
        delta: { type: 'text_delta', text },
      })
    );

    return events;
  }

  /**
   * Accumulate a tool call delta. OpenAI sends tool calls incrementally:
   * - First delta for an index has `id`, `type`, `function.name`
   * - Subsequent deltas for the same index have `function.arguments` chunks
   *
   * We accumulate these and emit Anthropic events when we have enough data,
   * or when flushing at the end.
   */
  private handleToolCallDelta(toolDelta: OpenAIToolCallDelta): string[] {
    const events: string[] = [];
    const idx = toolDelta.index;

    // Close any open text block before tool calls
    if (this.inTextBlock) {
      events.push(
        sseEvent('content_block_stop', {
          type: 'content_block_stop',
          index: this.blockIndex,
        })
      );
      this.blockIndex++;
      this.inTextBlock = false;
    }

    let buffer = this.toolCallBuffers.get(idx);
    if (!buffer) {
      // New tool call — create buffer
      buffer = {
        id: toolDelta.id ?? `toolu_${this.requestId}_${idx}`,
        name: toolDelta.function?.name ?? '',
        arguments: '',
        started: false,
      };
      this.toolCallBuffers.set(idx, buffer);
    }

    // Accumulate name (in case it arrives in parts, though typically it's in the first delta)
    if (toolDelta.function?.name) {
      buffer.name = toolDelta.function.name;
    }

    // Accumulate arguments
    if (toolDelta.function?.arguments) {
      buffer.arguments += toolDelta.function.arguments;
    }

    // Emit content_block_start for this tool once we have the name
    if (!buffer.started && buffer.name) {
      buffer.started = true;
      events.push(
        sseEvent('content_block_start', {
          type: 'content_block_start',
          index: this.blockIndex,
          content_block: {
            type: 'tool_use',
            id: buffer.id,
            name: buffer.name,
            input: {},
          },
        })
      );
    }

    // Emit input_json_delta for argument chunks as they arrive
    if (buffer.started && toolDelta.function?.arguments) {
      events.push(
        sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: this.blockIndex,
          delta: {
            type: 'input_json_delta',
            partial_json: toolDelta.function.arguments,
          },
        })
      );
    }

    return events;
  }

  /**
   * Flush all accumulated tool call buffers, emitting any remaining events.
   */
  private flushToolCallBuffers(): string[] {
    const events: string[] = [];

    for (const [, buffer] of this.toolCallBuffers) {
      // Emit start if we haven't yet (name may have arrived late)
      if (!buffer.started && buffer.name) {
        buffer.started = true;
        events.push(
          sseEvent('content_block_start', {
            type: 'content_block_start',
            index: this.blockIndex,
            content_block: {
              type: 'tool_use',
              id: buffer.id,
              name: buffer.name,
              input: {},
            },
          })
        );
      }

      // Close the tool_use content block
      if (buffer.started) {
        events.push(
          sseEvent('content_block_stop', {
            type: 'content_block_stop',
            index: this.blockIndex,
          })
        );
        this.blockIndex++;
      }
    }

    this.toolCallBuffers.clear();
    return events;
  }

  /**
   * Handle the finish_reason from OpenAI.
   * Maps OpenAI finish reasons to Anthropic stop reasons.
   */
  private handleFinishReason(finishReason: string): string[] {
    const events: string[] = [];

    // Flush pending tool calls
    events.push(...this.flushToolCallBuffers());

    // Close current text block if open
    if (this.inTextBlock) {
      events.push(
        sseEvent('content_block_stop', {
          type: 'content_block_stop',
          index: this.blockIndex,
        })
      );
      this.inTextBlock = false;
    }

    // Map OpenAI finish reasons to Anthropic stop reasons
    let stopReason: string;
    switch (finishReason) {
      case 'stop':
        stopReason = 'end_turn';
        break;
      case 'tool_calls':
        stopReason = 'tool_use';
        break;
      case 'length':
        stopReason = 'max_tokens';
        break;
      case 'content_filter':
        stopReason = 'end_turn';
        break;
      default:
        stopReason = 'end_turn';
    }

    // message_delta with stop reason and usage
    events.push(
      sseEvent('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: this.outputTokens },
      })
    );

    // message_stop
    events.push(sseEvent('message_stop', { type: 'message_stop' }));

    this.finalized = true;
    return events;
  }
}
