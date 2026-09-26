/**
 * OpenAI Responses API Stream Translator
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
 * - `response.incomplete` / `response.failed` / `error` — terminal failures,
 *   classified by `responses-error-mapping.ts` into a stop reason or an
 *   Anthropic `error` event
 *
 * Every stream ends in exactly one Anthropic terminal: `message_delta` +
 * `message_stop`, or one `error` event. The caller ends the stream through
 * `endOfStream()` on clean EOF, or `terminateTruncated()` on upstream failure.
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

import { translateResponsesUsage } from './translation-proxy-helpers';
import {
  classifyResponsesError,
  classifyResponsesTerminal,
  type AnthropicErrorMapping,
  type ResponsesStopReason,
} from './responses-error-mapping';

/**
 * Format a single Anthropic SSE event string.
 * Format: `event: <type>\ndata: <json>\n\n`
 */
function sseEvent(eventType: string, data: Record<string, unknown>): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

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
  /** Full response data (on response.completed / incomplete / failed) */
  response?: ResponsesCompletedData;
  /** Standalone `error` event: top-level code (untrusted, classified only) */
  code?: unknown;
  /** Standalone `error` event: top-level message (untrusted, never echoed) */
  message?: unknown;
  /** Gateway variant of the `error` event: nested `{ code, message }` */
  error?: unknown;
}

/** An output item in a Responses API response */
interface ResponsesOutputItem {
  type: string;
  role?: string;
  content?: Array<{ type: string; text?: string }>;
  call_id?: string;
  name?: string;
  /** Untrusted: checked with `isCompleteToolArguments` on incomplete terminals. */
  arguments?: unknown;
}

/** The response payload in a terminal Responses event */
interface ResponsesCompletedData {
  id?: string;
  status?: string;
  output?: ResponsesOutputItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number } | null;
  };
  /** `response.failed` error (untrusted, classified only) */
  error?: unknown;
  /** `response.incomplete` reason */
  incomplete_details?: { reason?: string | null } | null;
}

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
  /** Every non-empty argument delta received, whether or not the block started */
  receivedArgs: string;
}

const TRUNCATED_STREAM_MESSAGE = 'Upstream Responses stream ended before completion';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

  /** Final cumulative usage; upstream reports input/cache only at completion. */
  private usage = translateResponsesUsage(undefined);

  /** Final argument values of function calls already closed by output_item.done */
  private readonly closedToolArgs: Map<number, unknown> = new Map();

  /** Buffer for incomplete SSE lines across chunks */
  private lineBuffer = '';

  /** `event:` name of the SSE frame being assembled (survives chunk splits) */
  private pendingEventType = '';

  /** `data:` lines of the SSE frame being assembled, joined by `\n` at dispatch */
  private pendingData: string[] = [];

  /**
   * @param model - The model name to include in Anthropic events
   * @param requestId - Unique request identifier for generating IDs
   */
  constructor(
    private readonly model: string,
    private readonly requestId: string,
    private readonly onUsage: (usage: ReturnType<typeof translateResponsesUsage>) => void =
      () => undefined,
    private readonly onTranslationError: () => void = () => undefined,
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

  /** Whether a terminal Responses event (valid or rejected) was observed. */
  isFinalized(): boolean {
    return this.finalized;
  }

  /**
   * Process a raw chunk of SSE data from the Responses API stream.
   *
   * SSE framing: `event:` and `data:` lines accumulate across chunks and are
   * dispatched on the blank line that ends the frame; multiline `data` is
   * joined by `\n`; CR, LF and CRLF all end a line. A frame still pending at
   * EOF is never dispatched (see `endOfStream()`).
   *
   * @param rawChunk - Raw string chunk from the HTTP response stream
   * @returns Array of Anthropic SSE event strings to emit
   */
  processChunk(rawChunk: string): string[] {
    if (this.finalized) return [];
    const events: string[] = [];

    const buffer = this.lineBuffer + rawChunk;
    const delimiter = /\r\n|\r|\n/g;
    let lineStart = 0;
    let match: RegExpExecArray | null;
    while ((match = delimiter.exec(buffer)) !== null) {
      // Hold a trailing CR so a CRLF split across chunks is one delimiter.
      if (match[0] === '\r' && match.index === buffer.length - 1) break;
      events.push(...this.processLine(buffer.slice(lineStart, match.index)));
      lineStart = delimiter.lastIndex;
    }
    this.lineBuffer = buffer.slice(lineStart);

    return events;
  }

  /**
   * Clean upstream EOF. A CR held back by `processChunk` is a complete line
   * end here, so a frame whose closing blank line it forms is dispatched. A
   * genuinely unfinished frame is never dispatched; a stream still without a
   * terminal then ends through `terminateTruncated()`.
   */
  endOfStream(): string[] {
    if (this.finalized) return [];
    const events: string[] = [];
    if (this.lineBuffer.endsWith('\r')) {
      const line = this.lineBuffer.slice(0, -1);
      this.lineBuffer = '';
      events.push(...this.processLine(line));
    }
    events.push(...this.terminateTruncated());
    return events;
  }

  /**
   * Close a stream that ended (EOF or upstream error) before any terminal
   * event. Returns one `error` event and finalises; `[]` once finalised.
   */
  terminateTruncated(): string[] {
    if (this.finalized) return [];
    return this.failStream({ type: 'api_error', message: TRUNCATED_STREAM_MESSAGE });
  }

  /** Apply one SSE line to the pending frame; a blank line dispatches it. */
  private processLine(line: string): string[] {
    if (!line) return this.dispatchFrame();
    if (line.startsWith(':')) return [];
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const raw = colon < 0 ? '' : line.slice(colon + 1);
    const value = raw.startsWith(' ') ? raw.slice(1) : raw;
    if (field === 'event') this.pendingEventType = value;
    else if (field === 'data') this.pendingData.push(value);
    return [];
  }

  /** Dispatch the completed SSE frame and reset the pending frame state. */
  private dispatchFrame(): string[] {
    const frameEventType = this.pendingEventType;
    const data = this.pendingData;
    this.pendingEventType = '';
    this.pendingData = [];
    if (!data.length) return [];

    const payload = data.join('\n');
    if (payload === '[DONE]') return this.emitFinalEvents();

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch (error: unknown) {
      // Malformed frames are skipped; a missing terminal is reported at EOF.
      void error;
      return [];
    }
    if (!isRecord(parsed)) return [];
    const event = parsed as unknown as ResponsesStreamEvent;
    const eventType =
      typeof event.type === 'string' && event.type ? event.type : frameEventType;
    return this.handleEvent(eventType, event);
  }

  /**
   * Route a parsed Responses API event to the appropriate handler.
   */
  private handleEvent(
    eventType: string,
    event: ResponsesStreamEvent,
  ): string[] {
    if (this.finalized) return [];
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

      case 'response.incomplete':
        return this.handleResponseIncomplete(event);

      case 'response.failed':
        return this.handleResponseFailed(event);

      case 'error':
        return this.handleErrorEvent(event);

      default:
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
        receivedArgs: '',
      });
      if (name) {
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
    if (!toolCall) {
      const callId = event.call_id ?? `call_${this.requestId}_${outputIndex}`;
      const name = event.name ?? '';
      toolCall = {
        callId,
        name,
        blockIndex: this.blockIndex,
        started: false,
        receivedArgs: '',
      };
      this.activeToolCalls.set(outputIndex, toolCall);
    }
    toolCall.receivedArgs += argumentsDelta;
    if (event.call_id) {
      toolCall.callId = event.call_id;
    }
    if (event.name) {
      toolCall.name = event.name;
    }
    if (!toolCall.started && toolCall.name) {
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
      // The done item carries the authoritative final arguments; fall back to
      // what the deltas delivered. Kept for the incomplete-terminal check.
      this.closedToolArgs.set(
        outputIndex,
        item.arguments !== undefined ? item.arguments : toolCall?.receivedArgs,
      );
      this.activeToolCalls.delete(outputIndex);
    } else if (item?.type === 'message') {
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
    return this.publishUsage(event.response) ?? this.emitFinalEvents();
  }

  /**
   * Handle response.incomplete. Tool input is checked first (precedence rule):
   * any incomplete function-call arguments give `upstream_incomplete` whatever
   * the reason. Otherwise the reason maps to `max_tokens` / `refusal` with
   * usage forwarded, or to the generic incomplete error.
   */
  private handleResponseIncomplete(event: ResponsesStreamEvent): string[] {
    const response = event.response;
    const outcome = classifyResponsesTerminal('response.incomplete', response, {
      hadToolUse: this.hadToolCalls,
      toolArgs: this.finalToolArgs(response),
    });
    if (outcome.kind === 'error') return this.failStream(outcome.mapping);
    return this.publishUsage(response) ?? this.emitFinalEvents(outcome.stopReason);
  }

  /** Handle response.failed: classify `response.error.{code,message}`. */
  private handleResponseFailed(event: ResponsesStreamEvent): string[] {
    // A failed snapshot may omit `output`/`status`; only its `error` is read.
    const response: unknown = event.response;
    const error = isRecord(response) && isRecord(response['error']) ? response['error'] : undefined;
    return this.failStream(classifyResponsesError(error?.['code'], error?.['message']));
  }

  /**
   * Handle the standalone `error` event: top-level `code` / `message` first,
   * then the nested `error.{code,message}` shape some gateways send.
   */
  private handleErrorEvent(event: ResponsesStreamEvent): string[] {
    const nested = isRecord(event.error) ? event.error : undefined;
    return this.failStream(
      classifyResponsesError(event.code ?? nested?.['code'], event.message ?? nested?.['message']),
    );
  }

  /**
   * Final argument value of every function call: the terminal snapshot's
   * `output` when present, else what this stream received (open calls'
   * accumulated deltas plus closed calls' final arguments).
   */
  private finalToolArgs(response: ResponsesCompletedData | undefined): unknown[] {
    const output: unknown = isRecord(response) ? response.output : undefined;
    if (Array.isArray(output)) {
      return output
        .filter((item): item is ResponsesOutputItem =>
          isRecord(item) && item['type'] === 'function_call')
        .map((item) => item.arguments);
    }
    return [
      ...this.closedToolArgs.values(),
      ...[...this.activeToolCalls.values()].map((call) => call.receivedArgs),
    ];
  }

  /**
   * Validate and report terminal usage. Returns the error terminal when the
   * usage is invalid, `undefined` when the stream may finish normally.
   */
  private publishUsage(response: ResponsesCompletedData | undefined): string[] | undefined {
    try {
      this.usage = translateResponsesUsage(response?.usage);
      this.onUsage(this.usage);
      return undefined;
    } catch (error: unknown) {
      // Completion runs inside an HTTP data listener: validation errors must not
      // escape as uncaught exceptions or allow a later sentinel to claim success.
      void error;
      return this.failStream({ type: 'api_error', message: 'Invalid upstream Responses usage' });
    }
  }

  /**
   * Finalise with one Anthropic `error` event. No `content_block_stop` or
   * `message_delta` precedes it: the client must not see a successful turn.
   */
  private failStream(error: Pick<AnthropicErrorMapping, 'type' | 'message'>): string[] {
    this.onTranslationError();
    this.finalized = true;
    this.activeToolCalls.clear();
    this.inTextBlock = false;
    return [sseEvent('error', {
      type: 'error',
      error: { type: error.type, message: error.message },
    })];
  }

  /**
   * Emit the final message_delta and message_stop events.
   * Closes any open content blocks first.
   *
   * @param stopReasonOverride - Terminal-table stop reason (`max_tokens`,
   *   `refusal`); defaults to `tool_use` / `end_turn`.
   */
  private emitFinalEvents(stopReasonOverride?: ResponsesStopReason): string[] {
    if (this.finalized) return [];
    this.finalized = true;

    const events: string[] = [];
    if (this.inTextBlock) {
      events.push(
        sseEvent('content_block_stop', {
          type: 'content_block_stop',
          index: this.blockIndex,
        }),
      );
      this.inTextBlock = false;
    }
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
    const stopReason =
      stopReasonOverride ?? (this.hadToolCalls ? 'tool_use' : 'end_turn');
    events.push(
      sseEvent('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: this.usage,
      }),
    );
    events.push(sseEvent('message_stop', { type: 'message_stop' }));

    return events;
  }
}
