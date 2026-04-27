/**
 * HarnessStreamBroadcaster — Wave C7d.
 *
 * Owns the webview streaming infrastructure for harness operations:
 *   - Creates per-operation stream emitters that broadcast `harness:stream`
 *     events to the webview.
 *   - Tees an SDK message stream so flat-stream events for inline execution
 *     visualisation reach the webview while `SdkStreamProcessor` still
 *     consumes the original `SDKMessage` sequence.
 *   - Broadcasts `harness:stream-complete` + `harness:flat-stream-complete`
 *     lifecycle messages.
 *
 * Extracted from `harness-rpc.handlers.ts` (lines 199–201, 279–343) as part
 * of the C7d god-handler split.
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, SdkMessageTransformer } from '@ptah-extension/agent-sdk';
import type {
  StreamEvent,
  StreamEventEmitter,
  SDKMessage,
} from '@ptah-extension/agent-sdk';
import type {
  HarnessFlatStreamPayload,
  HarnessStreamCompletePayload,
  HarnessStreamOperation,
  HarnessStreamPayload,
  SessionId,
} from '@ptah-extension/shared';

/**
 * Local interface for webview broadcasting.
 *
 * Uses `string` for message type because harness stream types are not members
 * of StrictMessageType. The underlying WebviewManager.broadcastMessage
 * implementation accepts any message type via postMessage.
 */
export interface WebviewBroadcaster {
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

@injectable()
export class HarnessStreamBroadcaster {
  constructor(
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewBroadcaster,
    @inject(SDK_TOKENS.SDK_MESSAGE_TRANSFORMER)
    private readonly messageTransformer: SdkMessageTransformer,
  ) {}

  /**
   * Create a stream emitter + operation id for a given harness operation.
   * The emitter forwards each StreamEvent to the webview as a
   * `harness:stream` message.
   */
  createStreamEmitter(operation: HarnessStreamOperation): {
    emitter: StreamEventEmitter;
    operationId: string;
  } {
    const operationId = `${operation}-${Date.now()}`;
    const emitter: StreamEventEmitter = {
      emit: (event: StreamEvent) => {
        const payload: HarnessStreamPayload = {
          operation,
          operationId,
          kind: event.kind,
          content: event.content,
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          isError: event.isError,
          timestamp: event.timestamp,
        };
        this.webviewManager.broadcastMessage('harness:stream', payload);
      },
    };
    return { emitter, operationId };
  }

  /**
   * Tee an SDK message stream: yields each SDKMessage to the downstream consumer
   * (SdkStreamProcessor) while also converting to FlatStreamEventUnion events
   * and broadcasting them to the webview for real-time execution visualization.
   */
  async *teeStreamWithFlatEvents(
    stream: AsyncIterable<SDKMessage>,
    operationId: string,
  ): AsyncIterable<SDKMessage> {
    const transformer = this.messageTransformer.createIsolated();
    const harnessSessionId = `harness-${operationId}` as SessionId;

    for await (const sdkMessage of stream) {
      const flatEvents = transformer.transform(sdkMessage, harnessSessionId);
      for (const event of flatEvents) {
        this.webviewManager.broadcastMessage('harness:flat-stream', {
          operationId,
          event,
        } satisfies HarnessFlatStreamPayload);
      }
      yield sdkMessage;
    }
  }

  /** Broadcast the `harness:stream-complete` lifecycle message. */
  broadcastComplete(
    operation: HarnessStreamOperation,
    operationId: string,
    success: boolean,
    error?: string,
  ): void {
    const payload: HarnessStreamCompletePayload = {
      operation,
      operationId,
      success,
      error,
      timestamp: Date.now(),
    };
    this.webviewManager.broadcastMessage('harness:stream-complete', payload);
  }

  /** Broadcast the `harness:flat-stream-complete` lifecycle message. */
  broadcastFlatComplete(
    operationId: string,
    success: boolean,
    error?: string,
  ): void {
    this.webviewManager.broadcastMessage('harness:flat-stream-complete', {
      operationId,
      success,
      ...(error !== undefined ? { error } : {}),
    });
  }
}
