/**
 * OpenAI Responses API Stream Translator - TASK_2025_199
 *
 * Stateful streaming translator that converts OpenAI Responses API
 * SSE events into Anthropic Messages API SSE events.
 *
 * The Responses API uses different event types than Chat Completions:
 * - `response.output_text.delta` — text content deltas
 * - `response.output_item.added` — new output item started
 * - `response.output_item.done` — output item completed
 * - `response.function_call_arguments.delta` — tool call argument deltas
 * - `response.completed` — entire response completed with usage
 *
 * Each instance tracks:
 * - Content block indices (incrementing for each new block)
 * - Whether the message_start event has been emitted
 * - Tool call state by output index
 * - Token usage counters
 *
 * Create a new instance per request (stateful, not reusable).
 *
 * Follows the same patterns as OpenAIResponseTranslator in response-translator.ts.
 */

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
// Responses API SSE event types
// ---------------------------------------------------------------------------

/** Parsed SSE event from the Responses API stream */
interface ResponsesStreamEvent {
  type: string;
  /** Output index for items */
  output_index?: number;
  /** Content index within an output item */
  content_index?: number;
  /** Text delta content */
  delta?: string;
  /** Item ID for function calls */
  item_id?: string;
  /** Call ID for function calls */
  call_id?: string;
  /** Function call name */
  name?: string;
  /** Completed item data */
  item?: ResponsesOutputItem;
  /** Full response data (on response.completed) */
  response?: ResponsesCompletedData;
}

/** An output item in a Responses API response */
interface ResponsesOutputItem {
  type: string;
  role?: string;
  content?: Array<{ type: string; text?: string }>;
  call_id?: string;
  name?: string;
  arguments?: string;
}

/** The response payload in a response.completed event */
interface ResponsesCompletedData {
  id?: string;
  status?: string;
  output?: ResponsesOutputItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

// ---------------------------------------------------------------------------
// Internal state tracking
// ---------------------------------------------------------------------------

/** Tracks an active tool call (function_call) being streamed */
interface ActiveToolCall {
  /** The call_id from the Responses API */
  callId: string;
  /** Function name */
  name: string;
  /** The Anthropic content block index assigned to this tool */
  blockIndex: number;
  /** Whether content_block_start has been emitted */
  started: boolean;
}

// ---------------------------------------------------------------------------
// Main translator class
// ---------------------------------------------------------------------------

/**
 * Translates OpenAI Responses API streaming events into Anthropic SSE event strings.
 *
 * Usage:
 * ```
 * const translator = new ResponsesStreamTranslator('gpt-5.4', 'req-123');
 *
 * // Emit initial message_start before processing chunks
 * response.write(translator.getInitialEvents());
 *
 * // Process each SSE chunk from Responses API
 * for (const rawChunk of chunks) {
 *   const events = translator.processChunk(rawChunk);
 *   for (const event of events) {
 *     response.write(event);
 *   }
 * }
 * ```
 */
export class ResponsesStreamTranslator {
  /** Current content block index (incrementing) */
  private blockIndex = 0;

  /** Whether we are currently in a text content block */
  private inTextBlock = false;

  /** Whether termination events have already been emitted */
  private finalized = false;

  /** Active tool calls by output_index */
  private readonly activeToolCalls: Map<number, ActiveToolCall> = new Map();

  /** Whether any tool calls (function_call items) were emitted during this stream */
  private hadToolCalls = false;

  /** Accumulated input token count */
  private inputTokens = 0;

  /** Accumulated output token count */
  private outputTokens = 0;

  /** Buffer for incomplete SSE lines across chunks */
  private lineBuffer = '';

  /**
   * @param model - The model name to include in Anthropic events
   * @param requestId - Unique request identifier for generating IDs
   */
  constructor(
    private readonly model: string,
    private readonly requestId: string,
  ) {}

  /**
   * Get the initial message_start event to emit at the beginning of the stream.
   * Call this once before processing any chunks.
   */
  getInitialEvents(): string {
    return sseEvent('message_start', {
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
          input_tokens: 0,
          output_tokens: 0,
        },
      },
    });
  }

  /**
   * Process a raw chunk of SSE data from the Responses API stream.
   * A chunk may contain multiple SSE events separated by newlines.
   *
   * @param rawChunk - Raw string chunk from the HTTP response stream
   * @returns Array of Anthropic SSE event strings to emit
   */
  processChunk(rawChunk: string): string[] {
    const events: string[] = [];

    this.lineBuffer += rawChunk;

    // Split into lines and process complete event blocks
    const lines = this.lineBuffer.split('\n');
    // Keep the last potentially incomplete line in the buffer
    this.lineBuffer = lines.pop() ?? '';

    let currentEventType = '';

    for (const line of lines) {
      const trimmed = line.trim();

      // Track the event type from "event: xxx" lines
      if (trimmed.startsWith('event: ')) {
        currentEventType = trimmed.slice(7);
        continue;
      }

      // Process data lines
      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6);

        // End of stream marker
        if (data === '[DONE]') {
          if (!this.finalized) {
            events.push(...this.emitFinalEvents());
          }
          continue;
        }

        try {
          const parsed = JSON.parse(data) as ResponsesStreamEvent;
          // Use the type from the parsed data, or fall back to the event: line
          const eventType = parsed.type || currentEventType;
          events.push(...this.handleEvent(eventType, parsed));
        } catch {
          // Skip unparseable data lines
        }

        // Reset event type after processing
        currentEventType = '';
        continue;
      }

      // Empty line = end of SSE event block, reset
      if (!trimmed) {
        currentEventType = '';
      }
    }

    return events;
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  /**
   * Route a parsed Responses API event to the appropriate handler.
   */
  private handleEvent(
    eventType: string,
    event: ResponsesStreamEvent,
  ): string[] {
    switch (eventType) {
      case 'response.output_text.delta':
        return this.handleTextDelta(event);

      case 'response.output_item.added':
        return this.handleOutputItemAdded(event);

      case 'response.function_call_arguments.delta':
        return this.handleFunctionCallArgumentsDelta(event);

      case 'response.output_item.done':
        return this.handleOutputItemDone(event);

      case 'response.completed':
        return this.handleResponseCompleted(event);

      default:
        // Ignore unrecognized event types (response.created, response.in_progress, etc.)
        return [];
    }
  }

  /**
   * Handle response.output_text.delta — text content streaming.
   * Opens a text content block if one isn't already open, then emits text_delta.
   */
  private handleTextDelta(event: ResponsesStreamEvent): string[] {
    const events: string[] = [];
    const text = event.delta;

    if (text == null || text === '') {
      return events;
    }

    // Open a new text block if needed
    if (!this.inTextBlock) {
      events.push(
        sseEvent('content_block_start', {
          type: 'content_block_start',
          index: this.blockIndex,
          content_block: { type: 'text', text: '' },
        }),
      );
      this.inTextBlock = true;
    }

    // Emit text delta
    events.push(
      sseEvent('content_block_delta', {
        type: 'content_block_delta',
        index: this.blockIndex,
        delta: { type: 'text_delta', text },
      }),
    );

    return events;
  }

  /**
   * Handle response.output_item.added — a new output item has started.
   * For function_call type items, start tracking a new tool call.
   * For message type items, we don't need to do anything special
   * (text deltas will follow via response.output_text.delta).
   */
  private handleOutputItemAdded(event: ResponsesStreamEvent): string[] {
    const events: string[] = [];
    const item = event.item;
    const outputIndex = event.output_index ?? 0;

    if (!item) return events;

    if (item.type === 'function_call') {
      this.hadToolCalls = true;

      // Close any open text block before tool calls
      if (this.inTextBlock) {
        events.push(
          sseEvent('content_block_stop', {
            type: 'content_block_stop',
            index: this.blockIndex,
          }),
        );
        this.blockIndex++;
        this.inTextBlock = false;
      }

      const callId = item.call_id ?? `call_${this.requestId}_${outputIndex}`;
      const name = item.name ?? '';

      this.activeToolCalls.set(outputIndex, {
        callId,
        name,
        blockIndex: this.blockIndex,
        started: false,
      });

      // Emit content_block_start for this tool use if we have the name
      if (name) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const toolCall = this.activeToolCalls.get(outputIndex)!;
        toolCall.started = true;
        events.push(
          sseEvent('content_block_start', {
            type: 'content_block_start',
            index: this.blockIndex,
            content_block: {
              type: 'tool_use',
              id: callId,
              name,
              input: {},
            },
          }),
        );
      }
    }

    return events;
  }

  /**
   * Handle response.function_call_arguments.delta — streaming tool call arguments.
   * Emits input_json_delta events for the accumulated arguments.
   */
  private handleFunctionCallArgumentsDelta(
    event: ResponsesStreamEvent,
  ): string[] {
    const events: string[] = [];
    const outputIndex = event.output_index ?? 0;
    const argumentsDelta = event.delta;

    if (argumentsDelta == null || argumentsDelta === '') {
      return events;
    }

    let toolCall = this.activeToolCalls.get(outputIndex);

    // If no active tool call, create one from the event data
    if (!toolCall) {
      const callId = event.call_id ?? `call_${this.requestId}_${outputIndex}`;
      const name = event.name ?? '';
      toolCall = {
        callId,
        name,
        blockIndex: this.blockIndex,
        started: false,
      };
      this.activeToolCalls.set(outputIndex, toolCall);
    }

    // Update call_id and name if provided in this event
    if (event.call_id) {
      toolCall.callId = event.call_id;
    }
    if (event.name) {
      toolCall.name = event.name;
    }

    // Emit content_block_start if not yet started
    if (!toolCall.started && toolCall.name) {
      // Close any open text block first
      if (this.inTextBlock) {
        events.push(
          sseEvent('content_block_stop', {
            type: 'content_block_stop',
            index: this.blockIndex,
          }),
        );
        this.blockIndex++;
        this.inTextBlock = false;
        toolCall.blockIndex = this.blockIndex;
      }

      toolCall.started = true;
      events.push(
        sseEvent('content_block_start', {
          type: 'content_block_start',
          index: toolCall.blockIndex,
          content_block: {
            type: 'tool_use',
            id: toolCall.callId,
            name: toolCall.name,
            input: {},
          },
        }),
      );
    }

    // Emit input_json_delta
    if (toolCall.started) {
      events.push(
        sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: toolCall.blockIndex,
          delta: {
            type: 'input_json_delta',
            partial_json: argumentsDelta,
          },
        }),
      );
    }

    return events;
  }

  /**
   * Handle response.output_item.done — an output item has completed.
   * Emits content_block_stop for the completed block.
   */
  private handleOutputItemDone(event: ResponsesStreamEvent): string[] {
    const events: string[] = [];
    const outputIndex = event.output_index ?? 0;
    const item = event.item;

    if (item?.type === 'function_call') {
      const toolCall = this.activeToolCalls.get(outputIndex);
      if (toolCall?.started) {
        events.push(
          sseEvent('content_block_stop', {
            type: 'content_block_stop',
            index: toolCall.blockIndex,
          }),
        );
        this.blockIndex = toolCall.blockIndex + 1;
      }
      this.activeToolCalls.delete(outputIndex);
    } else if (item?.type === 'message') {
      // Message output item done — close any open text block
      if (this.inTextBlock) {
        events.push(
          sseEvent('content_block_stop', {
            type: 'content_block_stop',
            index: this.blockIndex,
          }),
        );
        this.blockIndex++;
        this.inTextBlock = false;
      }
    }

    return events;
  }

  /**
   * Handle response.completed — the entire response is complete.
   * Extracts usage data and emits message_delta + message_stop.
   */
  private handleResponseCompleted(event: ResponsesStreamEvent): string[] {
    if (this.finalized) return [];

    const response = event.response;

    if (response?.usage) {
      this.inputTokens = response.usage.input_tokens ?? this.inputTokens;
      this.outputTokens = response.usage.output_tokens ?? this.outputTokens;
    }

    return this.emitFinalEvents();
  }

  // ---------------------------------------------------------------------------
  // Final event emission
  // ---------------------------------------------------------------------------

  /**
   * Emit the final message_delta and message_stop events.
   * Closes any open content blocks first.
   */
  private emitFinalEvents(): string[] {
    if (this.finalized) return [];
    this.finalized = true;

    const events: string[] = [];

    // Close any open text block
    if (this.inTextBlock) {
      events.push(
        sseEvent('content_block_stop', {
          type: 'content_block_stop',
          index: this.blockIndex,
        }),
      );
      this.inTextBlock = false;
    }

    // Flush any remaining tool calls
    for (const [, toolCall] of this.activeToolCalls) {
      if (toolCall.started) {
        events.push(
          sseEvent('content_block_stop', {
            type: 'content_block_stop',
            index: toolCall.blockIndex,
          }),
        );
      }
    }
    this.activeToolCalls.clear();

    // Determine stop reason based on whether we had tool calls
    const stopReason = this.hadToolCalls ? 'tool_use' : 'end_turn';

    // message_delta with stop reason and usage
    events.push(
      sseEvent('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: this.outputTokens },
      }),
    );

    // message_stop
    events.push(sseEvent('message_stop', { type: 'message_stop' }));

    return events;
  }
}
