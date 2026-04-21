/**
 * StreamAdapter — Transforms LangGraph's `streamMode: 'messages'` output
 * into Ptah's FlatStreamEventUnion.
 *
 * LangGraph (with streamMode:'messages') yields tuples of the shape:
 *   [AIMessageChunk | ToolMessage | ..., metadata]
 *
 * We convert that stream into the discriminated union the webview already
 * knows how to render. Mapping:
 *
 *   - First AIMessageChunk for a thread     → MESSAGE_START (assistant)
 *   - Content delta on AIMessageChunk       → TEXT_DELTA   (blockIndex 0)
 *   - tool_call_chunks on AIMessageChunk    → TOOL_START + TOOL_DELTA (partial args)
 *   - ToolMessage                           → TOOL_RESULT
 *   - End of stream                         → MESSAGE_COMPLETE
 *
 * Everything is emitted through a plain async generator so the session
 * runs under the caller's AbortSignal.
 *
 * NOTE: LangChain's BaseMessage content can be a string OR an array of
 * content blocks. We treat non-string content defensively by concatenating
 * every `text`-typed block, which matches how DeepAgent composes its
 * plain-text responses.
 */

import { injectable, inject } from 'tsyringe';
import type {
  FlatStreamEventUnion,
  MessageStartEvent,
  TextDeltaEvent,
  ToolStartEvent,
  ToolDeltaEvent,
  ToolResultEvent,
  MessageCompleteEvent,
  SessionId,
} from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';

// -------------------- Local shape guards --------------------
// We avoid importing LangChain types into the public surface of this
// library (keeps the lib's exports small). These type guards check only
// the fields we actually consume — no structural coupling to LangChain
// internals beyond what we observe at runtime.

interface ChunkLike {
  readonly content?: string | readonly ContentBlockLike[];
  readonly tool_call_chunks?: readonly ToolCallChunkLike[];
  readonly type?: string;
  readonly tool_call_id?: string;
  readonly status?: string;
  readonly additional_kwargs?: Record<string, unknown>;
}

interface ContentBlockLike {
  readonly type?: string;
  readonly text?: string;
}

interface ToolCallChunkLike {
  readonly id?: string;
  readonly name?: string;
  readonly args?: string;
  readonly index?: number;
}

function isChunkLike(x: unknown): x is ChunkLike {
  return typeof x === 'object' && x !== null;
}

function extractText(content: ChunkLike['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const block of content) {
    if (block && typeof block === 'object' && typeof block.text === 'string') {
      if (block.type === undefined || block.type === 'text') {
        out += block.text;
      }
    }
  }
  return out;
}

/**
 * Input for the transform — mirrors the shape of deepagents' compiled
 * graph.stream(..., { streamMode: 'messages' }) return value, but typed
 * as `AsyncIterable<unknown>` so we don't leak LangGraph types.
 */
export interface StreamAdapterInput {
  /** LangGraph stream iterable. Each tuple is [chunk, metadata]. */
  readonly stream: AsyncIterable<unknown>;
  readonly sessionId: SessionId;
  readonly tabId?: string;
  readonly abortSignal?: AbortSignal;
  readonly model?: string;
}

/** Callback notified on stream completion with aggregated stats. */
export type StreamResultCallback = (payload: {
  readonly sessionId: SessionId;
  readonly model?: string;
  readonly durationMs: number;
}) => void;

let eventCounter = 0;
function nextEventId(prefix: string): string {
  eventCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${eventCounter.toString(36)}`;
}

@injectable()
export class StreamAdapterService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  /**
   * Consume a LangGraph 'messages' stream and emit FlatStreamEventUnion.
   *
   * The generator is intentionally single-pass — if the caller stops
   * iterating, the underlying stream is dropped when GC'd.
   */
  async *transform(
    input: StreamAdapterInput,
    onComplete?: StreamResultCallback,
  ): AsyncGenerator<FlatStreamEventUnion, void, void> {
    const { stream, sessionId, abortSignal, model } = input;
    const sessionIdStr = String(sessionId);
    const messageId = nextEventId('msg');
    const startedAt = Date.now();

    let messageStarted = false;
    const toolStarted = new Set<string>();

    try {
      for await (const tuple of stream) {
        if (abortSignal?.aborted) {
          this.logger.info(
            '[DeepAgent.StreamAdapter] Abort signal observed — terminating stream',
          );
          break;
        }

        const chunk = this.extractChunk(tuple);
        if (!chunk) continue;

        // Tool messages (tool results) are emitted as separate objects
        // on the stream, distinguished by `type === 'tool'` and a
        // tool_call_id field.
        if (chunk.type === 'tool' && typeof chunk.tool_call_id === 'string') {
          const toolResult: ToolResultEvent = {
            id: nextEventId('evt'),
            eventType: 'tool_result',
            timestamp: Date.now(),
            sessionId: sessionIdStr,
            source: 'stream',
            messageId,
            toolCallId: chunk.tool_call_id,
            output: extractText(chunk.content) || chunk.content || '',
            isError: chunk.status === 'error',
          };
          yield toolResult;
          continue;
        }

        // Everything else we treat as AIMessageChunk-like.
        if (!messageStarted) {
          messageStarted = true;
          const startEvent: MessageStartEvent = {
            id: nextEventId('evt'),
            eventType: 'message_start',
            timestamp: Date.now(),
            sessionId: sessionIdStr,
            source: 'stream',
            messageId,
            role: 'assistant',
          };
          yield startEvent;
        }

        // Text delta
        const text = extractText(chunk.content);
        if (text.length > 0) {
          const textEvent: TextDeltaEvent = {
            id: nextEventId('evt'),
            eventType: 'text_delta',
            timestamp: Date.now(),
            sessionId: sessionIdStr,
            source: 'stream',
            messageId,
            delta: text,
            blockIndex: 0,
          };
          yield textEvent;
        }

        // Tool call chunks — may arrive across multiple chunks, so we
        // emit TOOL_START on first sight (by id) and TOOL_DELTA for
        // subsequent partial-JSON args.
        if (Array.isArray(chunk.tool_call_chunks)) {
          for (const tc of chunk.tool_call_chunks) {
            const toolCallId = tc.id ?? `tool-${String(tc.index ?? 0)}`;
            if (!toolStarted.has(toolCallId)) {
              toolStarted.add(toolCallId);
              const startTool: ToolStartEvent = {
                id: nextEventId('evt'),
                eventType: 'tool_start',
                timestamp: Date.now(),
                sessionId: sessionIdStr,
                source: 'stream',
                messageId,
                toolCallId,
                toolName: tc.name ?? 'unknown',
                toolInput: tc.args ? this.tryParseJson(tc.args) : undefined,
                isTaskTool: tc.name === 'task',
              };
              yield startTool;
            } else if (typeof tc.args === 'string' && tc.args.length > 0) {
              const delta: ToolDeltaEvent = {
                id: nextEventId('evt'),
                eventType: 'tool_delta',
                timestamp: Date.now(),
                sessionId: sessionIdStr,
                source: 'stream',
                messageId,
                toolCallId,
                delta: tc.args,
              };
              yield delta;
            }
          }
        }
      }

      // Message complete
      if (messageStarted) {
        const complete: MessageCompleteEvent = {
          id: nextEventId('evt'),
          eventType: 'message_complete',
          timestamp: Date.now(),
          sessionId: sessionIdStr,
          source: 'stream',
          messageId,
          stopReason: 'end_turn',
          duration: Date.now() - startedAt,
          model,
        };
        yield complete;
      }

      if (onComplete) {
        onComplete({
          sessionId,
          model,
          durationMs: Date.now() - startedAt,
        });
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      // AbortError is an expected, controlled shutdown — not a real failure.
      // It is thrown when endSession() calls AbortController.abort() either
      // during an explicit chat:abort or as post-completion cleanup in the
      // finally block of streamExecutionNodesToWebview. In both cases the
      // consumer is already done with the stream; swallow silently.
      if (error.name === 'AbortError') {
        this.logger.debug(
          '[DeepAgent.StreamAdapter] Stream aborted (expected shutdown)',
        );
        return;
      }

      this.sentryService.captureException(error, {
        errorSource: 'StreamAdapterService.transform',
      });
      this.logger.error(
        '[DeepAgent.StreamAdapter] Stream transform failed',
        error,
      );
      throw err;
    }
  }

  /**
   * LangGraph streamMode:'messages' yields `[chunk, metadata]` tuples.
   * Some versions yield a bare chunk. We handle both shapes.
   */
  private extractChunk(tuple: unknown): ChunkLike | null {
    if (Array.isArray(tuple)) {
      const [first] = tuple;
      return isChunkLike(first) ? first : null;
    }
    return isChunkLike(tuple) ? tuple : null;
  }

  private tryParseJson(raw: string): Record<string, unknown> | undefined {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Partial JSON — leave undefined; TOOL_DELTA events carry the args.
    }
    return undefined;
  }
}
