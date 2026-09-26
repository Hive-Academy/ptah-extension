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
 * - `response.function_call_arguments.done` — final tool call arguments
 * - `response.completed` — entire response completed with usage
 * - `response.incomplete` / `response.failed` / `error` — terminal failures,
 *   classified by `responses-error-mapping.ts` into a stop reason or an
 *   Anthropic `error` event
 *
 * Every stream ends in exactly one Anthropic terminal: `message_delta` +
 * `message_stop`, or one `error` event. The caller ends the stream through
 * `endOfStream()` on clean EOF, or `terminateTruncated()` on upstream failure.
 *
 * `hasClientOutput()` and `getTerminalError()` let the caller defer its
 * headers and `message_start` until output exists: an error that finalises
 * the stream before any output can then go out as a plain HTTP error, which
 * the SDK CLI handles (prompt-too-long compaction) where an SSE error is not.
 *
 * Each instance tracks:
 * - Content block indices: allocated densely, only when a block starts
 * - Tool call state by output index: arguments received from upstream and
 *   how many of their characters were emitted (each exactly once, and only
 *   after that call's `content_block_start`)
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
  /** `response.function_call_arguments.done`: final arguments (untrusted) */
  arguments?: unknown;
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
  /** Upstream function name ('' until one arrives); resolved only when emitted */
  name: string;
  /** Anthropic content block index; set when content_block_start is emitted */
  blockIndex: number | undefined;
  /** Argument text received from upstream, whether or not the block started */
  receivedArgs: string;
  /** Characters of `receivedArgs` already emitted as `input_json_delta` */
  emittedLength: number;
}

const TRUNCATED_STREAM_MAPPING: AnthropicErrorMapping = {
  status: 502,
  type: 'api_error',
  message: 'Upstream Responses stream ended before completion',
};

const INVALID_USAGE_MAPPING: AnthropicErrorMapping = {
  status: 502,
  type: 'api_error',
  message: 'Invalid upstream Responses usage',
};

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
 * // Process each SSE chunk from Responses API
 * for (const rawChunk of chunks) {
 *   const events = translator.processChunk(rawChunk);
 *   // Before the first output, an error terminal can still become an HTTP error.
 *   if (!started && !translator.hasClientOutput()) continue;
 *   // Emit message_start once, before the first output event
 *   if (!started) {
 *     started = true;
 *     response.write(translator.getInitialEvents());
 *   }
 *   for (const event of events) {
 *     response.write(event);
 *   }
 * }
 * ```
 */
export class ResponsesStreamTranslator {
  /** Index the next content_block_start gets (dense, monotonically increasing) */
  private nextBlockIndex = 0;

  /** Index of the open text content block, if any */
  private textBlockIndex: number | undefined;

  /** Whether termination events have already been emitted */
  private finalized = false;

  /** Whether a content block or a successful terminal was emitted */
  private emittedOutput = false;

  /** The mapping of the `error` terminal, once the stream failed */
  private terminalError: AnthropicErrorMapping | undefined;

  /** Active tool calls by output_index */
  private readonly activeToolCalls: Map<number, ActiveToolCall> = new Map();

  /** Whether any tool calls (function_call items) were emitted during this stream */
  private hadToolCalls = false;

  /** Final cumulative usage; upstream reports input/cache only at completion. */
  private usage = translateResponsesUsage(undefined);

  /**
   * Final argument values of function calls closed by output_item.done, for
   * the incomplete-terminal check. Only calls that started or carried
   * arguments are recorded: a done item with neither contributed no tool input.
   */
  private readonly closedToolArgs: Map<number, unknown> = new Map();

  /**
   * Argument text actually delivered to the client by each closed call that
   * started. The incomplete check validates these bytes as well as the
   * terminal snapshot: a snapshot cannot repair input already emitted.
   */
  private readonly closedEmittedArgs: Map<number, string> = new Map();

  /** Output indexes and call ids already closed by output_item.done */
  private readonly closedOutputIndexes = new Set<number>();
  private readonly closedCallIds = new Set<string>();

  /** Buffer for incomplete SSE lines across chunks */
  private lineBuffer = '';

  /** `event:` name of the SSE frame being assembled (survives chunk splits) */
  private pendingEventType = '';

  /** `data:` lines of the SSE frame being assembled, joined by `\n` at dispatch */
  private pendingData: string[] = [];

  /**
   * @param model - The model name to include in Anthropic events
   * @param requestId - Unique request identifier for generating IDs
   * @param resolveToolName - Maps an upstream tool name back to the SDK's
   *   original (see `guardResponsesToolNames`); applied to every emitted name
   */
  constructor(
    private readonly model: string,
    private readonly requestId: string,
    private readonly onUsage: (usage: ReturnType<typeof translateResponsesUsage>) => void =
      () => undefined,
    private readonly onTranslationError: () => void = () => undefined,
    private readonly resolveToolName: (upstream: string) => string = (name) => name,
  ) {}

  /**
   * Get the message_start event that opens the Anthropic stream. Call it once,
   * before writing the first event of the stream.
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
   * Whether an event the client must see as a turn was produced: a content
   * block start or a successful terminal. Before that, the only event this
   * translator can have returned is a single `error` terminal.
   */
  hasClientOutput(): boolean {
    return this.emittedOutput;
  }

  /** The status, type and message of the `error` terminal, once failed. */
  getTerminalError(): AnthropicErrorMapping | undefined {
    return this.terminalError;
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
    return this.failStream(TRUNCATED_STREAM_MAPPING);
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

      case 'response.function_call_arguments.done':
        return this.handleFunctionCallArgumentsDone(event);

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
    let index = this.textBlockIndex;
    if (index === undefined) {
      index = this.allocateBlockIndex();
      this.textBlockIndex = index;
      events.push(
        sseEvent('content_block_start', {
          type: 'content_block_start',
          index,
          content_block: { type: 'text', text: '' },
        }),
      );
    }
    events.push(
      sseEvent('content_block_delta', {
        type: 'content_block_delta',
        index,
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
      if (this.isClosedCall(outputIndex, item.call_id)) return events;
      this.hadToolCalls = true;
      this.closeTextBlock(events);
      const toolCall = this.trackToolCall(outputIndex);
      this.adoptIdentity(toolCall, item.call_id, item.name);
      this.advanceToolCall(toolCall, events);
    }

    return events;
  }

  /**
   * Handle response.function_call_arguments.delta — streaming tool call arguments.
   * The delta is appended to the call's received arguments, the block starts if
   * this delta supplies the name, then ONE flush emits whatever is unemitted.
   * A name-bearing delta after buffered pre-name deltas therefore emits the
   * buffered text plus this delta exactly once. An empty delta that supplies
   * the name still starts the block and flushes the buffered text.
   */
  private handleFunctionCallArgumentsDelta(
    event: ResponsesStreamEvent,
  ): string[] {
    const events: string[] = [];
    const outputIndex = event.output_index ?? 0;
    const argumentsDelta = typeof event.delta === 'string' ? event.delta : '';

    if (argumentsDelta === '' && !event.name) return events;
    if (this.isClosedCall(outputIndex, event.call_id)) return events;

    const toolCall = this.trackToolCall(outputIndex);
    toolCall.receivedArgs += argumentsDelta;
    this.adoptIdentity(toolCall, event.call_id, event.name);
    this.advanceToolCall(toolCall, events);

    return events;
  }

  /**
   * Handle response.function_call_arguments.done — the call's final arguments.
   * They fill `receivedArgs` only when no delta arrived (deltas are
   * authoritative; a differing payload is not merged). A done event for an
   * unknown output index without a name is ignored.
   */
  private handleFunctionCallArgumentsDone(event: ResponsesStreamEvent): string[] {
    const events: string[] = [];
    const outputIndex = event.output_index ?? 0;
    if (this.isClosedCall(outputIndex, event.call_id)) return events;
    if (!this.activeToolCalls.has(outputIndex) && !event.name) return events;

    const toolCall = this.trackToolCall(outputIndex);
    this.fillFinalArgs(toolCall, event.arguments);
    this.adoptIdentity(toolCall, event.call_id, event.name);
    this.advanceToolCall(toolCall, events);
    return events;
  }

  /**
   * Handle response.output_item.done — an output item has completed.
   * For a function call: fill arguments and name from the done item, start
   * and flush if that completes the call, then emit its content_block_stop.
   * A call never seen before but carrying a name starts, flushes and stops
   * here. A call that never got a name emits nothing. A repeated done for an
   * already closed output index or call id is ignored: it never reopens the call.
   */
  private handleOutputItemDone(event: ResponsesStreamEvent): string[] {
    const events: string[] = [];
    const outputIndex = event.output_index ?? 0;
    const item = event.item;

    if (item?.type === 'function_call') {
      if (this.isClosedCall(outputIndex, item.call_id)) return events;
      const known = this.activeToolCalls.get(outputIndex);
      const toolCall = known ?? (item.name ? this.trackToolCall(outputIndex) : undefined);
      if (toolCall) {
        this.fillFinalArgs(toolCall, item.arguments);
        this.adoptIdentity(toolCall, item.call_id, item.name);
        this.advanceToolCall(toolCall, events);
        if (toolCall.blockIndex !== undefined) {
          events.push(
            sseEvent('content_block_stop', {
              type: 'content_block_stop',
              index: toolCall.blockIndex,
            }),
          );
          this.closedEmittedArgs.set(outputIndex, toolCall.receivedArgs);
        }
        this.closedCallIds.add(toolCall.callId);
        this.activeToolCalls.delete(outputIndex);
      }
      this.closedOutputIndexes.add(outputIndex);
      if (item.call_id) this.closedCallIds.add(item.call_id);
      this.recordClosedToolArgs(outputIndex, toolCall, item.arguments);
    } else if (item?.type === 'message') {
      this.closeTextBlock(events);
    }

    return events;
  }

  /** Whether output_item.done already closed this output index or call id. */
  private isClosedCall(outputIndex: number, callId: string | undefined): boolean {
    return this.closedOutputIndexes.has(outputIndex) ||
      (callId !== undefined && this.closedCallIds.has(callId));
  }

  /** Allocate the next dense block index; called only when a block starts. */
  private allocateBlockIndex(): number {
    this.emittedOutput = true;
    return this.nextBlockIndex++;
  }

  /** Emit content_block_stop for the open text block, if any. */
  private closeTextBlock(events: string[]): void {
    if (this.textBlockIndex === undefined) return;
    events.push(
      sseEvent('content_block_stop', {
        type: 'content_block_stop',
        index: this.textBlockIndex,
      }),
    );
    this.textBlockIndex = undefined;
  }

  /** The tracked call at `outputIndex`, created (unstarted, empty) if absent. */
  private trackToolCall(outputIndex: number): ActiveToolCall {
    let toolCall = this.activeToolCalls.get(outputIndex);
    if (!toolCall) {
      toolCall = {
        callId: `call_${this.requestId}_${outputIndex}`,
        name: '',
        blockIndex: undefined,
        receivedArgs: '',
        emittedLength: 0,
      };
      this.activeToolCalls.set(outputIndex, toolCall);
    }
    return toolCall;
  }

  /**
   * Take the call id and name an event supplies. Neither changes once the
   * block has started: the SDK already holds the emitted `tool_use` id/name.
   */
  private adoptIdentity(
    toolCall: ActiveToolCall,
    callId: string | undefined,
    name: string | undefined,
  ): void {
    if (toolCall.blockIndex !== undefined) return;
    if (callId) toolCall.callId = callId;
    if (name) toolCall.name = name;
  }

  /** A done payload's arguments count only when no delta was received. */
  private fillFinalArgs(toolCall: ActiveToolCall, args: unknown): void {
    if (toolCall.receivedArgs === '' && typeof args === 'string') {
      toolCall.receivedArgs = args;
    }
  }

  /**
   * Start the call if it now has a name and has not started, then flush once:
   * one `input_json_delta` of `receivedArgs.slice(emittedLength)`. This is the
   * only place tool blocks start or argument text is emitted, so the emitted
   * text is always a prefix of `receivedArgs` and each character goes out once.
   */
  private advanceToolCall(toolCall: ActiveToolCall, events: string[]): void {
    if (toolCall.blockIndex === undefined) {
      if (!toolCall.name) return;
      this.hadToolCalls = true;
      this.closeTextBlock(events);
      toolCall.blockIndex = this.allocateBlockIndex();
      events.push(
        sseEvent('content_block_start', {
          type: 'content_block_start',
          index: toolCall.blockIndex,
          content_block: {
            type: 'tool_use',
            id: toolCall.callId,
            name: this.resolveToolName(toolCall.name),
            input: {},
          },
        }),
      );
    }
    if (toolCall.emittedLength < toolCall.receivedArgs.length) {
      events.push(
        sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: toolCall.blockIndex,
          delta: {
            type: 'input_json_delta',
            partial_json: toolCall.receivedArgs.slice(toolCall.emittedLength),
          },
        }),
      );
      toolCall.emittedLength = toolCall.receivedArgs.length;
    }
  }

  /**
   * Keep a closed call's final arguments for the incomplete-terminal check:
   * what this stream received (and emitted) when non-empty, else the done
   * item's raw value. A done item for an untracked, nameless call that carried
   * no arguments is not recorded: it contributed no tool input, so it must not
   * turn a later `response.incomplete` into `upstream_incomplete`.
   */
  private recordClosedToolArgs(
    outputIndex: number,
    toolCall: ActiveToolCall | undefined,
    doneArgs: unknown,
  ): void {
    if (toolCall?.receivedArgs) {
      this.closedToolArgs.set(outputIndex, toolCall.receivedArgs);
    } else if (doneArgs !== undefined) {
      this.closedToolArgs.set(outputIndex, doneArgs);
    } else if (toolCall?.blockIndex !== undefined) {
      this.closedToolArgs.set(outputIndex, '');
    }
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
   * Argument values the incomplete check validates. With a terminal snapshot:
   * the snapshot's `output` arguments PLUS the text already delivered to the
   * client by every started call (closed or open), because a complete snapshot
   * cannot repair a truncated or empty input the SDK already holds. Without a
   * snapshot: what this stream received (open calls' accumulated deltas plus
   * closed calls' final arguments).
   */
  private finalToolArgs(response: ResponsesCompletedData | undefined): unknown[] {
    const output: unknown = isRecord(response) ? response['output'] : undefined;
    if (Array.isArray(output)) {
      const snapshotArgs = output
        .filter((item): item is ResponsesOutputItem =>
          isRecord(item) && item['type'] === 'function_call')
        .map((item) => item.arguments);
      const emittedArgs = [
        ...this.closedEmittedArgs.values(),
        ...[...this.activeToolCalls.values()]
          .filter((call) => call.blockIndex !== undefined)
          .map((call) => call.receivedArgs.slice(0, call.emittedLength)),
      ];
      return [...snapshotArgs, ...emittedArgs];
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
      return this.failStream(INVALID_USAGE_MAPPING);
    }
  }

  /**
   * Finalise with one Anthropic `error` event. No `content_block_stop` or
   * `message_delta` precedes it: the client must not see a successful turn.
   */
  private failStream(error: AnthropicErrorMapping): string[] {
    this.onTranslationError();
    this.finalized = true;
    this.terminalError = error;
    this.activeToolCalls.clear();
    this.textBlockIndex = undefined;
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
    this.emittedOutput = true;

    const events: string[] = [];
    this.closeTextBlock(events);
    for (const [, toolCall] of this.activeToolCalls) {
      if (toolCall.blockIndex !== undefined) {
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
