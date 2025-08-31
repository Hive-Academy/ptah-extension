import { IWebviewMessageHandler, StrictPostMessageFunction } from './base-message-handler';
import { Logger } from '../../core/logger';
import {
  StrictMessageType,
  MessagePayloadMap,
  MessageResponse,
  CorrelationId,
} from '@ptah-extension/shared';
import { MessageValidatorService, ValidationError } from '../validation/message-validator.service';

/**
 * WebviewMessageRouter - Single Responsibility: Route messages to appropriate handlers
 * Follows Open/Closed Principle - new handlers can be added without modifying this class
 */
export class WebviewMessageRouter {
  private handlers: IWebviewMessageHandler<keyof MessagePayloadMap>[] = [];

  /**
   * Register a message handler
   * Follows Dependency Inversion Principle - depends on abstraction, not concrete classes
   */
  registerHandler<T extends keyof MessagePayloadMap>(handler: IWebviewMessageHandler<T>): void {
    this.handlers.push(handler);
    Logger.info(`Registered message handler for: ${handler.messageType}`);
  }

  /**
   * Route a message to the appropriate handler
   */
  async routeMessage<T extends keyof MessagePayloadMap>(
    messageType: T,
    payload: MessagePayloadMap[T],
    correlationId?: CorrelationId
  ): Promise<MessageResponse> {
    try {
      // Validate message payload first
      const validatedMessage = MessageValidatorService.validateMessage(
        {
          id: correlationId || CorrelationId.create(),
          type: messageType,
          payload,
          metadata: {
            timestamp: Date.now(),
            source: 'webview',
            version: '1.0.0',
          },
        },
        messageType
      );

      const handler = this.findHandler(messageType);

      if (!handler) {
        Logger.warn(`No handler found for message type: ${messageType}`);
        const errorResponse: MessageResponse = {
          requestId: correlationId || CorrelationId.create(),
          success: false,
          error: {
            code: 'NO_HANDLER_FOUND',
            message: `Unknown message type: ${messageType}`,
            context: { messageType },
          },
          metadata: {
            timestamp: Date.now(),
            source: 'extension',
            version: '1.0.0',
          },
        };
        return errorResponse;
      }

      const response = await handler.handle(messageType, payload);
      Logger.info(`Successfully handled message: ${messageType}`);
      return response;
    } catch (error) {
      Logger.error(`Error handling message ${messageType}:`, error);

      // Create structured error response
      const errorResponse: MessageResponse = {
        requestId: correlationId || CorrelationId.create(),
        success: false,
        error:
          error instanceof ValidationError
            ? {
                code: error.code,
                message: error.message,
                context: error.context,
              }
            : {
                code: 'HANDLER_ERROR',
                message: error instanceof Error ? error.message : String(error),
                context: { messageType },
              },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };

      return errorResponse;
    }
  }

  /**
   * Find appropriate handler for message type
   */
  private findHandler(
    messageType: string
  ): IWebviewMessageHandler<keyof MessagePayloadMap> | undefined {
    return this.handlers.find((handler) => handler.canHandle(messageType));
  }

  /**
   * Get all registered handlers (for debugging/testing)
   */
  getRegisteredHandlers(): string[] {
    return this.handlers.map((h) => h.messageType);
  }
}
