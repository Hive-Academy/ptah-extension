/**
 * `anthropic-sse-translator` — pure event translation table mapping Ptah
 * `chat:chunk` / `chat:complete` / `chat:error` broadcasts onto Anthropic
 * Messages API SSE frames.
 *
 * TASK_2026_104 P2 (Anthropic-compatible HTTP proxy).
 *
 * The translator is a stateful, single-turn projection. Each `Translator`
 * instance handles ONE Anthropic request → ONE SSE response stream:
 *
 *   1. `onChatStartAck()` → emits `message_start` (synthesized — backend
 *      `chat:start` doesn't carry a discrete frame for this).
 *   2. `onChunk(event)` → emits 0+ frames per event:
 *        - `text_delta`     → first delta opens a `content_block_start` of
 *                             type `text`, subsequent deltas emit
 *                             `content_block_delta` with `text_delta`. Block
 *                             closes on `tool_start` / `message_complete`.
 *        - `thinking_delta` → DROPPED (Anthropic API does not surface
 *                             thinking on the streaming wire today).
 *        - `tool_start`     → opens a new `content_block_start` of type
 *                             `tool_use` (closes any prior text block).
 *        - `tool_delta`     → `content_block_delta` with `input_json_delta`.
 *        - `tool_result`    → DROPPED (tool results are caller-fulfilled in
 *                             the next request body, not on the assistant
 *                             stream).
 *        - `message_complete` → close the active block + emit
 *                             `message_delta` with stop_reason + final usage,
 *                             then `message_stop`.
 *   3. `onError(message)` → emits an Anthropic `error` SSE frame. SAFE to
 *      call mid-stream — we don't bother closing open blocks because the
 *      caller terminates the connection immediately after.
 *
 * The translator does NOT touch the network — it returns an array of frames
 * (each with `event` + `data`) per call. The proxy service is responsible for
 * piping them through to the response with proper SSE framing. This keeps the
 * unit tests pure.
 *
 * Frame format on the wire (caller responsibility):
 *
 *   event: <type>\n
 *   data: <json>\n\n
 *
 * No third-party deps — pure types + functions.
 */

/**
 * One Anthropic SSE frame, ready to be serialized to the wire by the caller.
 * The caller writes `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`.
 */
export interface SseFrame {
  readonly event: string;
  readonly data: Record<string, unknown>;
}

/**
 * Lightweight projection of Ptah's `FlatStreamEvent` shape — only the fields
 * the translator reads. Mirrors the projection in `chat-bridge.ts` so the two
 * stay symmetric.
 */
export interface ChatChunkEventLike {
  readonly eventType: string;
  readonly delta?: string;
  readonly text?: string;
  readonly toolCallId?: string;
  readonly id?: string;
  readonly toolName?: string;
  readonly toolInput?: Record<string, unknown>;
  /** Raw JSON delta string for streaming tool input (`input_json_delta`). */
  readonly inputJsonDelta?: string;
  readonly stopReason?: string;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_creation_input_tokens?: number;
    readonly cache_read_input_tokens?: number;
  };
}

/** Stop-reason mapping — Ptah backend → Anthropic. */
const STOP_REASON_MAP: Record<string, string> = {
  end_turn: 'end_turn',
  max_tokens: 'max_tokens',
  stop_sequence: 'stop_sequence',
  tool_use: 'tool_use',
  // Backend-specific aliases we still see in the wild.
  natural_stop: 'end_turn',
  stop: 'end_turn',
};

interface OpenBlock {
  readonly index: number;
  readonly type: 'text' | 'tool_use';
  /** Tool-use blocks track the SDK tool_call id so we can echo it back. */
  readonly toolUseId?: string;
}

/**
 * Stateful translator instance. Construct one per Anthropic request.
 *
 * Holds:
 *   - The model name to echo in `message_start`.
 *   - A monotonic content-block index (Anthropic requires sequential indices
 *     starting at 0).
 *   - The currently-open content block (if any) — only one block is ever open
 *     at a time per the Anthropic protocol.
 *   - A flag tracking whether `message_start` has been emitted (idempotent).
 *   - A flag tracking whether `message_stop` has been emitted (defensive).
 */
export class AnthropicSseTranslator {
  private nextBlockIndex = 0;
  private openBlock: OpenBlock | null = null;
  private messageStarted = false;
  private messageStopped = false;
  private finalStopReason = 'end_turn';
  private finalUsage: Record<string, number> = {
    input_tokens: 0,
    output_tokens: 0,
  };

  constructor(
    private readonly model: string,
    private readonly messageId = `msg_${Date.now().toString(36)}`,
  ) {}

  /**
   * Synthesize the opening `message_start` frame. Idempotent — second call
   * returns an empty array. Returns `[]` (caller emits no frame yet) until
   * called explicitly.
   */
  start(): SseFrame[] {
    if (this.messageStarted) return [];
    this.messageStarted = true;
    return [
      {
        event: 'message_start',
        data: {
          type: 'message_start',
          message: {
            id: this.messageId,
            type: 'message',
            role: 'assistant',
            model: this.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        },
      },
    ];
  }

  /**
   * Translate a single backend `chat:chunk` event into 0+ SSE frames.
   * NEVER throws on unknown event types — silently drops them so future
   * backend additions don't break in-flight clients.
   */
  onChunk(event: ChatChunkEventLike): SseFrame[] {
    if (this.messageStopped) return [];
    if (!this.messageStarted) {
      // Defensive — the proxy should have called `start()` already, but if
      // it didn't (e.g. the very first event arrives before our ack handler
      // runs) we synthesize the start frame here so the protocol stays valid.
      const startFrames = this.start();
      return [...startFrames, ...this.onChunk(event)];
    }

    switch (event.eventType) {
      case 'text_delta':
        return this.handleTextDelta(event);
      case 'tool_start':
      case 'tool_use':
        return this.handleToolStart(event);
      case 'tool_delta':
        return this.handleToolDelta(event);
      case 'message_complete':
        return this.handleMessageComplete(event);
      // The following are intentionally dropped — Anthropic's streaming wire
      // does not surface them today.
      case 'thinking_delta':
      case 'thought_delta':
      case 'thinking_start':
      case 'tool_result':
      case 'agent_start':
      case 'message_start':
        return [];
      default:
        return [];
    }
  }

  /**
   * Translate a backend `chat:error` payload into an Anthropic `error` SSE
   * frame. After this call no further frames are emitted (the caller closes
   * the response).
   */
  onError(message: string, type = 'api_error'): SseFrame[] {
    if (this.messageStopped) return [];
    this.messageStopped = true;
    return [
      {
        event: 'error',
        data: {
          type: 'error',
          error: { type, message },
        },
      },
    ];
  }

  /** True when the translator has emitted `message_stop`. */
  isStopped(): boolean {
    return this.messageStopped;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private handleTextDelta(event: ChatChunkEventLike): SseFrame[] {
    const text = event.delta ?? event.text ?? '';
    if (text.length === 0) return [];

    const frames: SseFrame[] = [];

    // If a non-text block is open, close it before opening a new text block.
    if (this.openBlock !== null && this.openBlock.type !== 'text') {
      frames.push(this.closeCurrentBlock());
    }

    // Open a new text block if none is open.
    if (this.openBlock === null) {
      const index = this.allocBlockIndex();
      this.openBlock = { index, type: 'text' };
      frames.push({
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index,
          content_block: { type: 'text', text: '' },
        },
      });
    }

    // Emit the text delta.
    frames.push({
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: this.openBlock.index,
        delta: { type: 'text_delta', text },
      },
    });
    return frames;
  }

  private handleToolStart(event: ChatChunkEventLike): SseFrame[] {
    const frames: SseFrame[] = [];

    // Close any prior block (text or tool_use) — Anthropic only allows one
    // open block at a time.
    if (this.openBlock !== null) {
      frames.push(this.closeCurrentBlock());
    }

    const index = this.allocBlockIndex();
    const toolUseId = event.toolCallId ?? event.id ?? `toolu_${index}`;
    const toolName = event.toolName ?? '';
    this.openBlock = { index, type: 'tool_use', toolUseId };

    frames.push({
      event: 'content_block_start',
      data: {
        type: 'content_block_start',
        index,
        content_block: {
          type: 'tool_use',
          id: toolUseId,
          name: toolName,
          input: {},
        },
      },
    });

    // If the backend supplied the full tool input upfront (non-streaming
    // tool_start), emit a single `input_json_delta` frame so the caller sees
    // the complete arguments. Anthropic streams partial JSON here normally.
    if (event.toolInput && Object.keys(event.toolInput).length > 0) {
      frames.push({
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index,
          delta: {
            type: 'input_json_delta',
            partial_json: JSON.stringify(event.toolInput),
          },
        },
      });
    }
    return frames;
  }

  private handleToolDelta(event: ChatChunkEventLike): SseFrame[] {
    if (this.openBlock === null || this.openBlock.type !== 'tool_use') {
      // Stray tool delta with no active tool block — drop it.
      return [];
    }
    const partial = event.inputJsonDelta ?? event.delta ?? '';
    if (partial.length === 0) return [];
    return [
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: this.openBlock.index,
          delta: { type: 'input_json_delta', partial_json: partial },
        },
      },
    ];
  }

  private handleMessageComplete(event: ChatChunkEventLike): SseFrame[] {
    if (this.messageStopped) return [];
    const frames: SseFrame[] = [];

    // Close any open block before message_delta / message_stop.
    if (this.openBlock !== null) {
      frames.push(this.closeCurrentBlock());
    }

    const stopReason =
      event.stopReason !== undefined && STOP_REASON_MAP[event.stopReason]
        ? STOP_REASON_MAP[event.stopReason]
        : this.finalStopReason;

    if (event.usage) {
      this.finalUsage = {
        input_tokens: event.usage.input_tokens ?? 0,
        output_tokens: event.usage.output_tokens ?? 0,
        ...(event.usage.cache_creation_input_tokens !== undefined
          ? {
              cache_creation_input_tokens:
                event.usage.cache_creation_input_tokens,
            }
          : {}),
        ...(event.usage.cache_read_input_tokens !== undefined
          ? { cache_read_input_tokens: event.usage.cache_read_input_tokens }
          : {}),
      };
    }

    frames.push({
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: this.finalUsage,
      },
    });
    frames.push({
      event: 'message_stop',
      data: { type: 'message_stop' },
    });
    this.messageStopped = true;
    return frames;
  }

  private closeCurrentBlock(): SseFrame {
    const block = this.openBlock;
    if (block === null) {
      // Defensive — caller checked isObject already, but TypeScript needs the
      // narrowing. Synthesize a no-op frame at index 0.
      return {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 0 },
      };
    }
    this.openBlock = null;
    return {
      event: 'content_block_stop',
      data: { type: 'content_block_stop', index: block.index },
    };
  }

  private allocBlockIndex(): number {
    const index = this.nextBlockIndex;
    this.nextBlockIndex += 1;
    return index;
  }
}

/**
 * Serialize one frame to the SSE wire format.
 *
 *     event: <type>\n
 *     data: <json>\n\n
 *
 * Exposed for the proxy service so it doesn't reimplement the formatting.
 */
export function encodeSseFrame(frame: SseFrame): string {
  return `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`;
}
