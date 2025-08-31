import {
  BaseWebviewMessageHandler,
  StrictPostMessageFunction,
  IWebviewMessageHandler,
} from './base-message-handler';
import {
  StrictMessageType,
  MessagePayloadMap,
  MessageResponse,
  ViewChangedPayload,
  ViewRouteChangedPayload,
  ViewGenericPayload,
} from '@ptah-extension/shared';
import { CorrelationId } from '@ptah-extension/shared';
import { Logger } from '../../core/logger';

/**
 * View Message Types - Strict type definition
 */
type ViewMessageTypes = 'view:changed' | 'view:routeChanged' | 'view:generic';

/**
 * ViewMessageHandler - Handles view-related messages from Angular webview
 * Single Responsibility: Manage view state changes and navigation events
 */
export class ViewMessageHandler
  extends BaseWebviewMessageHandler<ViewMessageTypes>
  implements IWebviewMessageHandler<ViewMessageTypes>
{
  readonly messageType = 'view:';

  constructor(postMessage: StrictPostMessageFunction) {
    super(postMessage);
  }

  async handle<K extends ViewMessageTypes>(
    messageType: K,
    payload: MessagePayloadMap[K]
  ): Promise<MessageResponse> {
    try {
      Logger.info(`Handling view message: ${messageType}`, payload);

      switch (messageType) {
        case 'view:changed':
          return await this.handleViewChanged(payload as ViewChangedPayload);
        case 'view:routeChanged':
          return await this.handleRouteChanged(payload as ViewRouteChangedPayload);
        case 'view:generic':
          return await this.handleGenericView(payload as ViewGenericPayload);
        default:
          throw new Error(`Unknown view message type: ${messageType}`);
      }
    } catch (error) {
      Logger.error(`Error handling view message ${messageType}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to handle view message';
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'VIEW_HANDLER_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  /**
   * Handle view change events from Angular
   */
  private async handleViewChanged(payload: ViewChangedPayload): Promise<MessageResponse> {
    Logger.info(`View changed to: ${payload.view}`);

    // Could potentially update extension state or context here
    // For now, just log the view change
    Logger.info(`Angular webview navigated to: ${payload.view}`);

    return {
      requestId: CorrelationId.create(),
      success: true,
      data: { view: payload.view },
      metadata: {
        timestamp: Date.now(),
        source: 'extension',
        version: '1.0.0',
      },
    };
  }

  /**
   * Handle route change events from Angular router
   */
  private async handleRouteChanged(payload: ViewRouteChangedPayload): Promise<MessageResponse> {
    Logger.info(`Route changed to: ${payload.route}`);

    // Track route changes for analytics or state management
    Logger.info(`Angular router navigated to: ${payload.route}`);

    return {
      requestId: CorrelationId.create(),
      success: true,
      data: { route: payload.route, previousRoute: payload.previousRoute },
      metadata: {
        timestamp: Date.now(),
        source: 'extension',
        version: '1.0.0',
      },
    };
  }

  /**
   * Handle generic view messages
   */
  private async handleGenericView(payload: ViewGenericPayload): Promise<MessageResponse> {
    Logger.info('Handling generic view message', payload);

    return {
      requestId: CorrelationId.create(),
      success: true,
      data: payload,
      metadata: {
        timestamp: Date.now(),
        source: 'extension',
        version: '1.0.0',
      },
    };
  }
}
