/**
 * `anthropic-non-streaming` — accumulator that converts a sequence of Ptah
 * `chat:chunk` events into the Anthropic Messages API non-streaming JSON
 * response shape (`stream: false`).
 *
 * Mirrors the same translation table as `anthropic-sse-translator.ts` but
 * collapses the streaming frames back into a single response body. The
 * proxy service uses this when the caller's request had `stream: false`.
 *
 * Output shape (matches Anthropic's `Message` object):
 *
 *   {
 *     id, type: 'message', role: 'assistant', model,
 *     content: Array<TextBlock | ToolUseBlock>,
 *     stop_reason, stop_sequence: null, usage
 *   }
 */

import type { ChatChunkEventLike } from './anthropic-sse-translator.js';

/** Anthropic content block — text or tool_use. */
export type AnthropicContentBlock =
  | { readonly type: 'text'; text: string }
  | {
      readonly type: 'tool_use';
      readonly id: string;
      readonly name: string;
      input: Record<string, unknown>;
    };

/** Anthropic non-streaming response body. */
export interface AnthropicMessageResponse {
  readonly id: string;
  readonly type: 'message';
  readonly role: 'assistant';
  readonly model: string;
  content: AnthropicContentBlock[];
  stop_reason: string;
  readonly stop_sequence: null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/** Stop-reason mapping — Ptah backend → Anthropic. */
const STOP_REASON_MAP: Record<string, string> = {
  end_turn: 'end_turn',
  max_tokens: 'max_tokens',
  stop_sequence: 'stop_sequence',
  tool_use: 'tool_use',
  natural_stop: 'end_turn',
  stop: 'end_turn',
};

/**
 * Stateful accumulator. Construct one per non-streaming Anthropic request.
 *
 * Same surface as the SSE translator (`onChunk`, `onError`) so the proxy
 * service can swap implementations based on `stream: bool`. The terminal
 * frame is replaced with `build()` which returns the assembled response.
 */
export class AnthropicNonStreamingAccumulator {
  private readonly content: AnthropicContentBlock[] = [];
  private currentTextBlock: { type: 'text'; text: string } | null = null;
  private currentToolBlock: {
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
    /** Accumulated partial JSON deltas — parsed at block close. */
    partialJson: string;
  } | null = null;
  private stopReason = 'end_turn';
  private usage: AnthropicMessageResponse['usage'] = {
    input_tokens: 0,
    output_tokens: 0,
  };
  private stopped = false;
  private errorMessage: string | null = null;

  constructor(
    private readonly model: string,
    private readonly messageId = `msg_${Date.now().toString(36)}`,
  ) {}

  /**
   * Ingest one backend chunk event. Unknown event types are dropped silently.
   */
  onChunk(event: ChatChunkEventLike): void {
    if (this.stopped) return;
    switch (event.eventType) {
      case 'text_delta':
        this.handleTextDelta(event);
        return;
      case 'tool_start':
      case 'tool_use':
        this.handleToolStart(event);
        return;
      case 'tool_delta':
        this.handleToolDelta(event);
        return;
      case 'message_complete':
        this.handleMessageComplete(event);
        return;
      // thinking / tool_result / agent_start / message_start are dropped.
      default:
        return;
    }
  }

  /**
   * Mark the accumulator failed. `build()` will return null after this; the
   * caller should write a JSON error body instead. Stored message is exposed
   * via `getError()` so the caller can include it verbatim.
   */
  onError(message: string): void {
    if (this.stopped) return;
    this.errorMessage = message;
    this.stopped = true;
  }

  /** Returns the error message set by `onError()`, or null. */
  getError(): string | null {
    return this.errorMessage;
  }

  /**
   * Assemble the final Anthropic Messages response. Returns `null` when the
   * accumulator never received a `message_complete` and was not explicitly
   * errored — the caller should treat this as a backend protocol bug and
   * surface an `internal_error`.
   */
  build(): AnthropicMessageResponse | null {
    if (this.errorMessage !== null) return null;
    // Flush any unclosed block defensively so partial responses still land.
    this.flushOpenBlocks();
    return {
      id: this.messageId,
      type: 'message',
      role: 'assistant',
      model: this.model,
      content: this.content,
      stop_reason: this.stopReason,
      stop_sequence: null,
      usage: this.usage,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private handleTextDelta(event: ChatChunkEventLike): void {
    const text = event.delta ?? event.text ?? '';
    if (text.length === 0) return;
    if (this.currentToolBlock !== null) {
      this.flushToolBlock();
    }
    if (this.currentTextBlock === null) {
      this.currentTextBlock = { type: 'text', text: '' };
    }
    this.currentTextBlock.text += text;
  }

  private handleToolStart(event: ChatChunkEventLike): void {
    // Close any prior block before opening tool_use.
    this.flushTextBlock();
    this.flushToolBlock();
    const id = event.toolCallId ?? event.id ?? `toolu_${this.content.length}`;
    const name = event.toolName ?? '';
    const input = event.toolInput
      ? { ...event.toolInput }
      : ({} as Record<string, unknown>);
    this.currentToolBlock = {
      type: 'tool_use',
      id,
      name,
      input,
      partialJson: '',
    };
  }

  private handleToolDelta(event: ChatChunkEventLike): void {
    if (this.currentToolBlock === null) return;
    const partial = event.inputJsonDelta ?? event.delta ?? '';
    if (partial.length === 0) return;
    this.currentToolBlock.partialJson += partial;
  }

  private handleMessageComplete(event: ChatChunkEventLike): void {
    if (
      event.stopReason !== undefined &&
      STOP_REASON_MAP[event.stopReason] !== undefined
    ) {
      this.stopReason = STOP_REASON_MAP[event.stopReason];
    }
    if (event.usage) {
      this.usage = {
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
    this.flushOpenBlocks();
    this.stopped = true;
  }

  private flushOpenBlocks(): void {
    this.flushTextBlock();
    this.flushToolBlock();
  }

  private flushTextBlock(): void {
    if (this.currentTextBlock === null) return;
    this.content.push(this.currentTextBlock);
    this.currentTextBlock = null;
  }

  private flushToolBlock(): void {
    if (this.currentToolBlock === null) return;
    const block = this.currentToolBlock;
    this.currentToolBlock = null;
    // If we accumulated streamed JSON deltas, parse them onto `input`. Best
    // effort — malformed JSON keeps whatever upfront `input` was set.
    if (block.partialJson.length > 0) {
      try {
        const parsed: unknown = JSON.parse(block.partialJson);
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          !Array.isArray(parsed)
        ) {
          block.input = {
            ...block.input,
            ...(parsed as Record<string, unknown>),
          };
        }
      } catch {
        /* keep upfront input on parse failure */
      }
    }
    this.content.push({
      type: 'tool_use',
      id: block.id,
      name: block.name,
      input: block.input,
    });
  }
}
