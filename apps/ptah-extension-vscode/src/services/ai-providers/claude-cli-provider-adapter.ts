/**
 * Claude CLI Provider Adapter
 * Adapts the existing ClaudeCliService to implement the IAIProvider interface
 * Maintains backward compatibility while providing provider abstraction
 */

import { Readable } from 'stream';
import { BaseAIProvider } from './base-ai-provider';
import { ClaudeCliService } from '../claude-cli.service';
import { Logger } from '../../core/logger';
import {
  ProviderId,
  ProviderInfo,
  ProviderCapabilities,
  ProviderErrorType,
  AISessionConfig,
  AIMessageOptions,
  DEFAULT_PROVIDER_CAPABILITIES,
} from '@ptah-extension/shared';
import { SessionId, BrandedTypeValidator } from '@ptah-extension/shared';

/**
 * Claude CLI Provider Adapter
 * Wraps the existing ClaudeCliService to provide IAIProvider interface
 */
export class ClaudeCliProviderAdapter extends BaseAIProvider {
  private claudeCliService: ClaudeCliService;

  constructor(claudeCliService: ClaudeCliService) {
    const info: ProviderInfo = {
      id: 'claude-cli' as ProviderId,
      name: 'Claude Code CLI',
      version: '1.0.0',
      description: 'Anthropic Claude Code CLI with advanced streaming and resilience features',
      vendor: 'Anthropic',
      capabilities: {
        ...DEFAULT_PROVIDER_CAPABILITIES,
        imageAnalysis: true, // Claude supports image analysis
        functionCalling: true, // Claude supports function calling
      },
      maxContextTokens: 200000, // Claude's context window
    };

    super('claude-cli', info);
    this.claudeCliService = claudeCliService;
  }

  /**
   * Initialize Claude CLI provider
   */
  protected async doInitialize(): Promise<boolean> {
    try {
      Logger.info('Initializing Claude CLI provider adapter...');

      // The ClaudeCliService is already initialized in the service registry
      // We just need to verify it's working
      const isAvailable = await this.claudeCliService.verifyInstallation();

      if (isAvailable) {
        Logger.info('Claude CLI provider adapter initialized successfully');
        return true;
      } else {
        Logger.error('Claude CLI not available');
        return false;
      }
    } catch (error) {
      Logger.error('Failed to initialize Claude CLI provider adapter:', error);
      return false;
    }
  }

  /**
   * Dispose provider resources
   */
  protected doDispose(): void {
    Logger.info('Disposing Claude CLI provider adapter...');
    // The actual ClaudeCliService will be disposed by the service registry
    // We just need to clean up adapter-specific resources
    Logger.info('Claude CLI provider adapter disposed');
  }

  /**
   * Verify Claude CLI installation
   */
  protected async doVerifyInstallation(): Promise<boolean> {
    try {
      return await this.claudeCliService.verifyInstallation();
    } catch (error) {
      Logger.error('Error verifying Claude CLI installation:', error);
      return false;
    }
  }

  /**
   * Reset provider state
   */
  protected async doReset(): Promise<void> {
    Logger.info('Resetting Claude CLI provider adapter...');

    try {
      // Nothing to reset in simplified implementation
      Logger.info('Claude CLI provider adapter reset completed');
    } catch (error) {
      Logger.error('Error resetting Claude CLI provider adapter:', error);
      throw this.createProviderError(
        ProviderErrorType.UNKNOWN_ERROR,
        'Failed to reset Claude CLI provider',
        error
      );
    }
  }

  /**
   * Start a chat session - Now deprecated, use sendMessage flow instead
   */
  async startChatSession(sessionId: SessionId, config?: AISessionConfig): Promise<Readable> {
    throw new Error(
      'startChatSession is deprecated. Use the chat message handler flow with sendMessage instead.'
    );
  }

  /**
   * Start chat session - Now deprecated, use sendMessage flow instead
   */
  protected async doStartChatSession(
    sessionId: SessionId,
    config?: AISessionConfig
  ): Promise<Readable> {
    throw new Error(
      'doStartChatSession is deprecated. Use the chat message handler flow with sendMessage instead.'
    );
  }

  /**
   * End a session
   */
  protected doEndSession(sessionId: SessionId): void {
    try {
      this.claudeCliService.endSession(sessionId);
    } catch (error) {
      Logger.error(`Error ending Claude CLI session ${sessionId}:`, error);
      // Don't throw here, just log the error
    }
  }

  /**
   * Send message to session
   */
  protected async doSendMessageToSession(
    sessionId: SessionId,
    content: string,
    options?: AIMessageOptions
  ): Promise<void> {
    // This is deprecated - messages are sent during spawn now
    throw new Error('sendMessageToSession is deprecated. Use chat message handler flow instead.');
  }

  /**
   * Get available models (Claude CLI specific)
   */
  async getAvailableModels(): Promise<readonly string[]> {
    // Claude CLI typically uses a single model, but could be extended
    return ['claude-3-sonnet', 'claude-3-opus', 'claude-3-haiku'];
  }

  /**
   * Private helper methods
   */
  private classifyClaudeError(error: unknown): ProviderErrorType {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes('not found') || message.includes('command not found')) {
        return ProviderErrorType.INSTALLATION_NOT_FOUND;
      }

      if (message.includes('authentication') || message.includes('unauthorized')) {
        return ProviderErrorType.AUTHENTICATION_FAILED;
      }

      if (message.includes('rate limit') || message.includes('too many requests')) {
        return ProviderErrorType.RATE_LIMIT_EXCEEDED;
      }

      if (message.includes('service unavailable')) {
        return ProviderErrorType.NETWORK_ERROR;
      }

      if (
        message.includes('network') ||
        message.includes('connection') ||
        message.includes('timeout')
      ) {
        return ProviderErrorType.NETWORK_ERROR;
      }

      if (message.includes('session') && message.includes('not found')) {
        return ProviderErrorType.SESSION_NOT_FOUND;
      }

      if (message.includes('stream') || message.includes('pipe')) {
        return ProviderErrorType.STREAMING_ERROR;
      }
    }

    return ProviderErrorType.UNKNOWN_ERROR;
  }
}
