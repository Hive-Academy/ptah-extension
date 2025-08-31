import {
  StrictMessageType,
  MessagePayloadMap,
  MessageResponse,
  MessageMetadata,
  MessageError,
} from '@ptah-extension/shared';
import { CorrelationId } from '@ptah-extension/shared';
import { randomUUID } from 'crypto';

/**
 * Strict Message Post Function Type - eliminates 'any'
 */
export type StrictPostMessageFunction = (message: {
  readonly type: string;
  readonly payload: unknown;
  readonly metadata?: MessageMetadata;
}) => void;

/**
 * Base interface for webview message handlers
 * Follows Interface Segregation Principle - only contains what all handlers need
 * Now with strict typing - eliminates 'any' types
 */
export interface IWebviewMessageHandler<
  T extends keyof MessagePayloadMap = keyof MessagePayloadMap,
> {
  readonly messageType: string;
  canHandle(messageType: string): boolean;
  handle<K extends T>(messageType: K, payload: MessagePayloadMap[K]): Promise<MessageResponse>;
}

/**
 * Base class for webview message handlers
 * Provides common functionality and enforces consistent patterns
 * Now with strict typing - eliminates all 'any' types
 */
export abstract class BaseWebviewMessageHandler<
  T extends keyof MessagePayloadMap = keyof MessagePayloadMap,
> implements IWebviewMessageHandler<T>
{
  abstract readonly messageType: string;

  constructor(protected postMessage: StrictPostMessageFunction) {}

  canHandle(messageType: string): boolean {
    return messageType.startsWith(this.messageType);
  }

  abstract handle<K extends T>(
    messageType: K,
    payload: MessagePayloadMap[K]
  ): Promise<MessageResponse>;

  protected sendSuccessResponse<TData = unknown>(
    type: string,
    data: TData,
    requestId?: CorrelationId
  ): void {
    // Send structured response matching frontend expectations
    this.postMessage({
      type,
      payload: {
        success: true,
        data: data,
        requestId: requestId || randomUUID(),
        timestamp: Date.now(),
      },
    });
  }

  protected sendErrorResponse(
    type: string,
    error: string | Error | MessageError,
    requestId?: CorrelationId
  ): void {
    const messageError: MessageError =
      error instanceof Error
        ? {
            code: 'HANDLER_ERROR',
            message: error.message,
            stack: error.stack,
          }
        : typeof error === 'string'
          ? {
              code: 'HANDLER_ERROR',
              message: error,
            }
          : error;

    // Send error directly as payload for webview compatibility
    this.postMessage({
      type: type.includes(':error') ? type : type.replace(':', ':error'),
      payload: messageError,
    });
  }
}
