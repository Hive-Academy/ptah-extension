/**
 * Provider Message Handler
 * Handles all provider-related messages between webview and extension
 */

import { Logger } from '../../core/logger';
import { BaseWebviewMessageHandler, StrictPostMessageFunction } from './base-message-handler';
import { MessageResponse, CorrelationId } from '@ptah-extension/shared';
import {
  ProvidersGetAvailablePayload,
  ProvidersGetCurrentPayload,
  ProvidersSwitchPayload,
  ProvidersGetHealthPayload,
  ProvidersGetAllHealthPayload,
  ProvidersSetDefaultPayload,
  ProvidersEnableFallbackPayload,
  ProvidersSetAutoSwitchPayload,
  MessagePayloadMap,
} from '@ptah-extension/shared';
import {
  ProviderManager,
  ProviderId,
  ProviderHealth,
  ProviderSwitchEvent,
  ProviderErrorEvent,
  ProviderHealthChangeEvent,
  isValidProviderId,
  isProviderError,
} from '../../services/ai-providers';
import { SessionId, BrandedTypeValidator } from '@ptah-extension/shared';

/**
 * Provider Message Handler
 * Manages AI provider operations and notifications
 */
export class ProviderMessageHandler extends BaseWebviewMessageHandler {
  readonly messageType = 'providers';

  private readonly supportedMessageTypes = [
    'providers:getAvailable',
    'providers:getCurrent',
    'providers:switch',
    'providers:getHealth',
    'providers:getAllHealth',
    'providers:setDefault',
    'providers:enableFallback',
    'providers:setAutoSwitch',
  ] as const;

  constructor(
    postMessage: StrictPostMessageFunction,
    private providerManager: ProviderManager
  ) {
    super(postMessage);
    this.setupProviderEventListeners();
  }

  canHandle(messageType: string): boolean {
    return this.supportedMessageTypes.includes(messageType as any);
  }

  async handle<K extends keyof MessagePayloadMap>(
    messageType: K,
    payload: MessagePayloadMap[K]
  ): Promise<MessageResponse> {
    const requestId = CorrelationId.create();

    try {
      Logger.info(`Handling provider message: ${messageType}`, { messageType, requestId });

      switch (messageType) {
        case 'providers:getAvailable':
          return this.handleGetAvailable(requestId, payload as ProvidersGetAvailablePayload);

        case 'providers:getCurrent':
          return this.handleGetCurrent(requestId, payload as ProvidersGetCurrentPayload);

        case 'providers:switch':
          return this.handleSwitch(requestId, payload as ProvidersSwitchPayload);

        case 'providers:getHealth':
          return this.handleGetHealth(requestId, payload as ProvidersGetHealthPayload);

        case 'providers:getAllHealth':
          return this.handleGetAllHealth(requestId, payload as ProvidersGetAllHealthPayload);

        case 'providers:setDefault':
          return this.handleSetDefault(requestId, payload as ProvidersSetDefaultPayload);

        case 'providers:enableFallback':
          return this.handleEnableFallback(requestId, payload as ProvidersEnableFallbackPayload);

        case 'providers:setAutoSwitch':
          return this.handleSetAutoSwitch(requestId, payload as ProvidersSetAutoSwitchPayload);

        default:
          return {
            requestId,
            success: false,
            error: {
              code: 'UNSUPPORTED_MESSAGE',
              message: `Unsupported provider message type: ${messageType}`,
            },
            metadata: {
              timestamp: Date.now(),
              source: 'extension',
              version: '1.0.0',
            },
          };
      }
    } catch (error) {
      Logger.error(`Error handling provider message ${messageType}:`, error);
      return {
        requestId,
        success: false,
        error: {
          code: 'HANDLER_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error occurred',
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
   * Get available providers
   */
  private async handleGetAvailable(
    requestId: CorrelationId,
    payload: ProvidersGetAvailablePayload
  ): Promise<MessageResponse> {
    try {
      const availableProviders = this.providerManager.getAvailableProviders();

      const providerData = availableProviders.map((provider) => ({
        id: provider.providerId,
        name: provider.info.name,
        description: provider.info.description,
        vendor: provider.info.vendor,
        capabilities: provider.info.capabilities,
        health: provider.getHealth(),
      }));

      return {
        requestId,
        success: true,
        data: providerData,
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      Logger.error('Error getting available providers:', error);
      return {
        requestId,
        success: false,
        error: {
          code: 'GET_AVAILABLE_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get available providers',
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
   * Get current provider
   */
  private async handleGetCurrent(
    requestId: CorrelationId,
    payload: ProvidersGetCurrentPayload
  ): Promise<MessageResponse> {
    try {
      const currentProvider = this.providerManager.getCurrentProvider();

      if (!currentProvider) {
        return {
          requestId,
          success: true,
          data: null,
          metadata: {
            timestamp: Date.now(),
            source: 'extension',
            version: '1.0.0',
          },
        };
      }

      const providerData = {
        id: currentProvider.providerId,
        name: currentProvider.info.name,
        description: currentProvider.info.description,
        vendor: currentProvider.info.vendor,
        capabilities: currentProvider.info.capabilities,
        health: currentProvider.getHealth(),
      };

      return {
        requestId,
        success: true,
        data: providerData,
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      Logger.error('Error getting current provider:', error);
      return {
        requestId,
        success: false,
        error: {
          code: 'GET_CURRENT_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get current provider',
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
   * Switch to different provider
   */
  private async handleSwitch(
    requestId: CorrelationId,
    payload: ProvidersSwitchPayload
  ): Promise<MessageResponse> {
    try {
      const { providerId, reason = 'user-request' } = payload;

      if (!isValidProviderId(providerId)) {
        return {
          requestId,
          success: false,
          error: {
            code: 'INVALID_PROVIDER_ID',
            message: `Invalid provider ID: ${providerId}`,
          },
          metadata: {
            timestamp: Date.now(),
            source: 'extension',
            version: '1.0.0',
          },
        };
      }

      const success = await this.providerManager.switchProvider(providerId as ProviderId, reason);

      if (!success) {
        return {
          requestId,
          success: false,
          error: {
            code: 'SWITCH_FAILED',
            message: `Failed to switch to provider: ${providerId}`,
          },
          metadata: {
            timestamp: Date.now(),
            source: 'extension',
            version: '1.0.0',
          },
        };
      }

      // Get the new current provider info
      const currentProvider = this.providerManager.getCurrentProvider();
      const providerData = currentProvider
        ? {
            id: currentProvider.providerId,
            name: currentProvider.info.name,
            description: currentProvider.info.description,
            vendor: currentProvider.info.vendor,
            capabilities: currentProvider.info.capabilities,
            health: currentProvider.getHealth(),
          }
        : null;

      return {
        requestId,
        success: true,
        data: {
          switched: true,
          provider: providerData,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      Logger.error('Error switching provider:', error);
      return {
        requestId,
        success: false,
        error: {
          code: 'SWITCH_ERROR',
          message: error instanceof Error ? error.message : 'Failed to switch provider',
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
   * Get provider health
   */
  private async handleGetHealth(
    requestId: CorrelationId,
    payload: ProvidersGetHealthPayload
  ): Promise<MessageResponse> {
    try {
      const { providerId } = payload;

      let health: ProviderHealth | undefined;

      if (providerId) {
        if (!isValidProviderId(providerId)) {
          return {
            requestId,
            success: false,
            error: {
              code: 'INVALID_PROVIDER_ID',
              message: `Invalid provider ID: ${providerId}`,
            },
            metadata: {
              timestamp: Date.now(),
              source: 'extension',
              version: '1.0.0',
            },
          };
        }
        health = this.providerManager.getProviderHealth(providerId as ProviderId);
      } else {
        // Get current provider health
        const currentProvider = this.providerManager.getCurrentProvider();
        health = currentProvider ? currentProvider.getHealth() : undefined;
      }

      if (!health) {
        return {
          requestId,
          success: false,
          error: {
            code: 'PROVIDER_NOT_FOUND',
            message: `Provider ${providerId || 'current'} not found`,
          },
          metadata: {
            timestamp: Date.now(),
            source: 'extension',
            version: '1.0.0',
          },
        };
      }

      return {
        requestId,
        success: true,
        data: health,
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      Logger.error('Error getting provider health:', error);
      return {
        requestId,
        success: false,
        error: {
          code: 'GET_HEALTH_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get provider health',
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
   * Get all providers health
   */
  private async handleGetAllHealth(
    requestId: CorrelationId,
    payload: ProvidersGetAllHealthPayload
  ): Promise<MessageResponse> {
    try {
      const allHealth = this.providerManager.getAllProviderHealth();
      return {
        requestId,
        success: true,
        data: allHealth,
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      Logger.error('Error getting all providers health:', error);
      return {
        requestId,
        success: false,
        error: {
          code: 'GET_ALL_HEALTH_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get all providers health',
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
   * Set default provider
   */
  private async handleSetDefault(
    requestId: CorrelationId,
    payload: ProvidersSetDefaultPayload
  ): Promise<MessageResponse> {
    try {
      const { providerId } = payload;

      if (!isValidProviderId(providerId)) {
        return {
          requestId,
          success: false,
          error: {
            code: 'INVALID_PROVIDER_ID',
            message: `Invalid provider ID: ${providerId}`,
          },
          metadata: {
            timestamp: Date.now(),
            source: 'extension',
            version: '1.0.0',
          },
        };
      }

      await this.providerManager.setDefaultProvider(providerId as ProviderId);

      return {
        requestId,
        success: true,
        data: {
          defaultProvider: providerId,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      Logger.error('Error setting default provider:', error);
      return {
        requestId,
        success: false,
        error: {
          code: 'SET_DEFAULT_ERROR',
          message: error instanceof Error ? error.message : 'Failed to set default provider',
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
   * Enable/disable fallback
   */
  private async handleEnableFallback(
    requestId: CorrelationId,
    payload: ProvidersEnableFallbackPayload
  ): Promise<MessageResponse> {
    try {
      const { enabled } = payload;

      this.providerManager.enableFallback(enabled);

      return {
        requestId,
        success: true,
        data: {
          fallbackEnabled: enabled,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      Logger.error('Error enabling/disabling fallback:', error);
      return {
        requestId,
        success: false,
        error: {
          code: 'ENABLE_FALLBACK_ERROR',
          message: error instanceof Error ? error.message : 'Failed to update fallback setting',
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
   * Enable/disable auto-switch on failure
   */
  private async handleSetAutoSwitch(
    requestId: CorrelationId,
    payload: ProvidersSetAutoSwitchPayload
  ): Promise<MessageResponse> {
    try {
      const { enabled } = payload;

      this.providerManager.setAutoSwitchOnFailure(enabled);

      return {
        requestId,
        success: true,
        data: {
          autoSwitchEnabled: enabled,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      Logger.error('Error setting auto-switch on failure:', error);
      return {
        requestId,
        success: false,
        error: {
          code: 'SET_AUTO_SWITCH_ERROR',
          message: error instanceof Error ? error.message : 'Failed to update auto-switch setting',
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
   * Set up provider event listeners to forward events to webview
   */
  private setupProviderEventListeners(): void {
    // Provider switch events
    this.providerManager.on('provider-switched', (event: ProviderSwitchEvent) => {
      this.sendSuccessResponse('providers:currentChanged', {
        from: event.from,
        to: event.to,
        reason: event.reason,
        timestamp: event.timestamp,
      });
    });

    // Provider health change events
    this.providerManager.on('provider-health-changed', (event: ProviderHealthChangeEvent) => {
      this.sendSuccessResponse('providers:healthChanged', {
        providerId: event.providerId,
        health: event.currentHealth,
      });
    });

    // Provider error events
    this.providerManager.on('provider-error', (event: ProviderErrorEvent) => {
      this.sendSuccessResponse('providers:error', {
        providerId: event.providerId,
        error: {
          type: event.error.type,
          message: event.error.message,
          recoverable: event.error.recoverable,
          suggestedAction: event.error.suggestedAction,
          context: event.error.context,
        },
        timestamp: event.timestamp,
      });
    });

    Logger.info('Provider event listeners set up');
  }

  /**
   * Dispose handler resources
   */
  dispose(): void {
    // The provider manager will be disposed by the service registry
    Logger.info('Provider message handler disposed');
  }
}
