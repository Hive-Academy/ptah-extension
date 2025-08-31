import {
  BaseWebviewMessageHandler,
  StrictPostMessageFunction,
  IWebviewMessageHandler,
} from './base-message-handler';
import {
  StrictMessageType,
  MessagePayloadMap,
  MessageResponse,
  AnalyticsGetDataPayload,
  StateSavePayload,
} from '@ptah-extension/shared';
import { CorrelationId } from '@ptah-extension/shared';
import { Logger } from '../../core/logger';
import * as vscode from 'vscode';

/**
 * Config Message Types - Strict type definition
 */
type ConfigMessageTypes = 'config:get' | 'config:set' | 'config:update' | 'config:refresh';

/**
 * ConfigMessageHandler - Handles configuration-related messages from Angular webview
 * Single Responsibility: Manage extension configuration state
 */
export class ConfigMessageHandler
  extends BaseWebviewMessageHandler<ConfigMessageTypes>
  implements IWebviewMessageHandler<ConfigMessageTypes>
{
  readonly messageType = 'config:';

  constructor(
    postMessage: StrictPostMessageFunction,
    private context: vscode.ExtensionContext
  ) {
    super(postMessage);
  }

  async handle<K extends ConfigMessageTypes>(
    messageType: K,
    payload: MessagePayloadMap[K]
  ): Promise<MessageResponse> {
    try {
      Logger.info(`Handling config message: ${messageType}`, payload);

      switch (messageType) {
        case 'config:get':
          return await this.handleConfigGet(payload as AnalyticsGetDataPayload);
        case 'config:set':
          return await this.handleConfigSet(payload as StateSavePayload);
        case 'config:update':
          return await this.handleConfigUpdate(payload as StateSavePayload);
        case 'config:refresh':
          return await this.handleConfigRefresh(payload as AnalyticsGetDataPayload);
        default:
          throw new Error(`Unknown config message type: ${messageType}`);
      }
    } catch (error) {
      Logger.error(`Error handling config message ${messageType}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to handle config message';
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'CONFIG_HANDLER_ERROR',
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
   * Handle config get requests
   */
  private async handleConfigGet(payload: AnalyticsGetDataPayload): Promise<MessageResponse> {
    try {
      // Get workspace configuration
      const config = vscode.workspace.getConfiguration('ptah');
      const workspaceConfig = {
        claude: {
          model: config.get('claude.model', 'claude-3-sonnet-20241022'),
          temperature: config.get('claude.temperature', 0.1),
          maxTokens: config.get('claude.maxTokens', 200000),
        },
        streaming: {
          bufferSize: config.get('streaming.bufferSize', 8192),
          chunkSize: config.get('streaming.chunkSize', 1024),
          timeoutMs: config.get('streaming.timeoutMs', 30000),
        },
      };

      Logger.info('Retrieved configuration', workspaceConfig);

      return {
        requestId: CorrelationId.create(),
        success: true,
        data: workspaceConfig,
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      Logger.error('Failed to get configuration:', error);
      throw error;
    }
  }

  /**
   * Handle config set requests
   */
  private async handleConfigSet(payload: StateSavePayload): Promise<MessageResponse> {
    try {
      Logger.info('Config set not yet implemented', payload);

      return {
        requestId: CorrelationId.create(),
        success: true,
        data: { message: 'Config set operation logged' },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      Logger.error('Failed to set configuration:', error);
      throw error;
    }
  }

  /**
   * Handle config update requests
   */
  private async handleConfigUpdate(payload: StateSavePayload): Promise<MessageResponse> {
    try {
      Logger.info('Config update not yet implemented', payload);

      return {
        requestId: CorrelationId.create(),
        success: true,
        data: { message: 'Config update operation logged' },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      Logger.error('Failed to update configuration:', error);
      throw error;
    }
  }

  /**
   * Handle config refresh requests
   */
  private async handleConfigRefresh(payload: AnalyticsGetDataPayload): Promise<MessageResponse> {
    try {
      // For now, just return current config (same as get)
      return await this.handleConfigGet(payload);
    } catch (error) {
      Logger.error('Failed to refresh configuration:', error);
      throw error;
    }
  }
}
