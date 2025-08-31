/**
 * Base AI Provider - Common implementation for all AI providers
 * Implements shared functionality like health monitoring, error handling, and lifecycle management
 */

import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { Logger } from '../../core/logger';
import {
  IAIProvider,
  ProviderId,
  ProviderInfo,
  ProviderHealth,
  ProviderStatus,
  ProviderError,
  ProviderErrorType,
  AISessionConfig,
  AIMessageOptions,
} from '@ptah-extension/shared';
import { SessionId } from '@ptah-extension/shared';

/**
 * Provider Events
 */
export interface ProviderEvents {
  'health-changed': (health: ProviderHealth) => void;
  error: (error: ProviderError) => void;
  'session-started': (sessionId: SessionId) => void;
  'session-ended': (sessionId: SessionId) => void;
  'message-sent': (sessionId: SessionId, content: string) => void;
}

/**
 * Base Provider Class
 * Provides common functionality for all AI providers
 */
export abstract class BaseAIProvider extends EventEmitter implements IAIProvider {
  protected _isInitialized = false;
  protected _health: ProviderHealth;
  protected _activeSessions = new Set<SessionId>();
  protected _lastHealthCheck = 0;
  protected _initializeTime = 0;

  constructor(
    public readonly providerId: ProviderId,
    public readonly info: ProviderInfo
  ) {
    super();
    this._health = {
      status: 'initializing',
      lastCheck: Date.now(),
    };
  }

  /**
   * Initialize the provider
   */
  async initialize(): Promise<boolean> {
    if (this._isInitialized) {
      return true;
    }

    const startTime = Date.now();
    Logger.info(`Initializing ${this.providerId} provider...`);

    try {
      // Provider-specific initialization
      const success = await this.doInitialize();

      if (success) {
        this._isInitialized = true;
        this._initializeTime = Date.now();
        await this.updateHealth('available', 'Provider initialized successfully');
        Logger.info(`${this.providerId} provider initialized successfully`);
      } else {
        await this.updateHealth('error', 'Provider initialization failed');
        Logger.error(`${this.providerId} provider initialization failed`);
      }

      return success;
    } catch (error) {
      const providerError = this.createProviderError(
        ProviderErrorType.CONFIGURATION_ERROR,
        'Provider initialization failed',
        error
      );

      await this.updateHealth('error', providerError.message);
      Logger.error(`${this.providerId} provider initialization error:`, providerError);

      return false;
    } finally {
      const duration = Date.now() - startTime;
      Logger.info(`${this.providerId} provider initialization took ${duration}ms`);
    }
  }

  /**
   * Dispose the provider
   */
  dispose(): void {
    Logger.info(`Disposing ${this.providerId} provider...`);

    // End all active sessions
    for (const sessionId of this._activeSessions) {
      try {
        this.endSession(sessionId);
      } catch (error) {
        Logger.error(`Error ending session ${sessionId} during disposal:`, error);
      }
    }

    // Provider-specific disposal
    this.doDispose();

    // Clean up state
    this._isInitialized = false;
    this._activeSessions.clear();
    this.removeAllListeners();

    Logger.info(`${this.providerId} provider disposed`);
  }

  /**
   * Verify installation
   */
  async verifyInstallation(): Promise<boolean> {
    Logger.info(`Verifying ${this.providerId} provider installation...`);

    try {
      const isValid = await this.doVerifyInstallation();

      if (isValid) {
        Logger.info(`${this.providerId} provider installation verified`);
        await this.updateHealth('available', 'Installation verified');
      } else {
        Logger.error(`${this.providerId} provider installation not found`);
        await this.updateHealth('unavailable', 'Installation not found');
      }

      return isValid;
    } catch (error) {
      const providerError = this.createProviderError(
        ProviderErrorType.INSTALLATION_NOT_FOUND,
        'Provider installation verification failed',
        error
      );

      Logger.error(`${this.providerId} provider verification error:`, providerError);
      await this.updateHealth('error', providerError.message);

      return false;
    }
  }

  /**
   * Get provider health
   */
  getHealth(): ProviderHealth {
    // Update uptime if provider is available
    if (this._health.status === 'available' && this._initializeTime > 0) {
      return {
        ...this._health,
        uptime: Date.now() - this._initializeTime,
      };
    }

    return this._health;
  }

  /**
   * Reset provider
   */
  async reset(): Promise<void> {
    Logger.info(`Resetting ${this.providerId} provider...`);

    try {
      // End all sessions
      for (const sessionId of this._activeSessions) {
        this.endSession(sessionId);
      }

      // Provider-specific reset
      await this.doReset();

      // Update health
      await this.updateHealth('available', 'Provider reset successfully');

      Logger.info(`${this.providerId} provider reset completed`);
    } catch (error) {
      const providerError = this.createProviderError(
        ProviderErrorType.UNKNOWN_ERROR,
        'Provider reset failed',
        error
      );

      Logger.error(`${this.providerId} provider reset error:`, providerError);
      await this.updateHealth('error', providerError.message);

      throw providerError;
    }
  }

  /**
   * Start a chat session
   */
  async startChatSession(sessionId: SessionId, config?: AISessionConfig): Promise<Readable> {
    if (this._activeSessions.has(sessionId)) {
      throw this.createProviderError(
        ProviderErrorType.SESSION_ALREADY_EXISTS,
        `Session ${sessionId} already exists`,
        undefined,
        { sessionId, providerId: this.providerId }
      );
    }

    try {
      Logger.info(`Starting chat session ${sessionId} for ${this.providerId} provider`);

      const stream = await this.doStartChatSession(sessionId, config);
      this._activeSessions.add(sessionId);
      this.emit('session-started', sessionId);

      Logger.info(`Chat session ${sessionId} started successfully`);
      return stream;
    } catch (error) {
      const providerError = this.createProviderError(
        ProviderErrorType.SESSION_START_FAILED,
        'Failed to start chat session',
        error,
        { sessionId, providerId: this.providerId }
      );

      this.emit('error', providerError);
      throw providerError;
    }
  }

  /**
   * End a chat session
   */
  endSession(sessionId: SessionId): void {
    if (this._activeSessions.has(sessionId)) {
      Logger.info(`Ending session ${sessionId} for ${this.providerId} provider`);

      try {
        this.doEndSession(sessionId);
        this._activeSessions.delete(sessionId);
        this.emit('session-ended', sessionId);
        Logger.info(`Session ${sessionId} ended successfully`);
      } catch (error) {
        Logger.error(`Error ending session ${sessionId}:`, error);
        // Still remove from active sessions to prevent memory leaks
        this._activeSessions.delete(sessionId);
      }
    }
  }

  /**
   * Send message to session
   */
  async sendMessageToSession(
    sessionId: SessionId,
    content: string,
    options?: AIMessageOptions
  ): Promise<void> {
    if (!this._activeSessions.has(sessionId)) {
      throw this.createProviderError(
        ProviderErrorType.SESSION_NOT_FOUND,
        `Session ${sessionId} not found`,
        undefined,
        { sessionId, providerId: this.providerId }
      );
    }

    try {
      await this.doSendMessageToSession(sessionId, content, options);
      this.emit('message-sent', sessionId, content);
      Logger.info(`Message sent to session ${sessionId}: ${content.substring(0, 100)}...`);
    } catch (error) {
      const providerError = this.createProviderError(
        ProviderErrorType.STREAMING_ERROR,
        'Failed to send message to session',
        error,
        { sessionId, contentLength: content.length }
      );

      this.emit('error', providerError);
      throw providerError;
    }
  }

  /**
   * Check if provider is initialized
   */
  get isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * Get active sessions count
   */
  get activeSessionsCount(): number {
    return this._activeSessions.size;
  }

  /**
   * Get active session IDs
   */
  get activeSessions(): readonly SessionId[] {
    return Array.from(this._activeSessions);
  }

  /**
   * Protected helper methods
   */
  protected addActiveSession(sessionId: SessionId): void {
    this._activeSessions.add(sessionId);
    this.emit('session-started', sessionId);
  }

  protected async updateHealth(
    status: ProviderStatus,
    errorMessage?: string,
    responseTime?: number
  ): Promise<void> {
    const previousHealth = { ...this._health };

    this._health = {
      status,
      lastCheck: Date.now(),
      errorMessage,
      responseTime,
      uptime:
        status === 'available' && this._initializeTime > 0
          ? Date.now() - this._initializeTime
          : undefined,
    };

    // Emit health change event if status changed
    if (previousHealth.status !== this._health.status) {
      this.emit('health-changed', this._health);
      Logger.info(
        `${this.providerId} provider health changed: ${previousHealth.status} -> ${this._health.status}`
      );
    }
  }

  protected createProviderError(
    type: ProviderErrorType,
    message: string,
    originalError?: unknown,
    context?: Record<string, unknown>
  ): ProviderError {
    const error: ProviderError = {
      name: 'ProviderError',
      message,
      type,
      providerId: this.providerId,
      recoverable: this.isRecoverableError(type),
      suggestedAction: this.getSuggestedAction(type),
      context,
      stack: originalError instanceof Error ? originalError.stack : new Error().stack,
    };

    return error;
  }

  private isRecoverableError(type: ProviderErrorType): boolean {
    switch (type) {
      case ProviderErrorType.RATE_LIMIT_EXCEEDED:
      case ProviderErrorType.STREAMING_ERROR:
      case ProviderErrorType.NETWORK_ERROR:
        return true;

      case ProviderErrorType.INSTALLATION_NOT_FOUND:
      case ProviderErrorType.AUTHENTICATION_FAILED:
      case ProviderErrorType.MODEL_UNAVAILABLE:
      case ProviderErrorType.CONFIGURATION_ERROR:
      case ProviderErrorType.SESSION_ALREADY_EXISTS:
        return false;

      case ProviderErrorType.SESSION_START_FAILED:
      case ProviderErrorType.SESSION_NOT_FOUND:
        return true;

      default:
        return false;
    }
  }

  private getSuggestedAction(type: ProviderErrorType): string {
    switch (type) {
      case ProviderErrorType.INSTALLATION_NOT_FOUND:
        return this.providerId === 'claude-cli'
          ? 'Install Claude Code CLI: npm install -g @anthropic-ai/claude-code'
          : 'Enable GitHub Copilot in VS Code';

      case ProviderErrorType.AUTHENTICATION_FAILED:
        return this.providerId === 'claude-cli'
          ? 'Check Claude CLI authentication'
          : 'Sign in to GitHub Copilot';

      case ProviderErrorType.MODEL_UNAVAILABLE:
        return 'Try switching to an alternative AI provider';

      case ProviderErrorType.RATE_LIMIT_EXCEEDED:
        return 'Wait a moment and try again, or switch providers';

      case ProviderErrorType.NETWORK_ERROR:
        return 'Check your internet connection and try again';

      case ProviderErrorType.CONFIGURATION_ERROR:
        return 'Check provider configuration in settings';

      case ProviderErrorType.SESSION_NOT_FOUND:
        return 'Session not found. Try starting a new session';

      case ProviderErrorType.SESSION_ALREADY_EXISTS:
        return 'Session already exists. Use a different session ID or end the existing session';

      case ProviderErrorType.SESSION_START_FAILED:
        return 'Failed to start session. Try again or switch providers';

      default:
        return 'Try switching to an alternative provider';
    }
  }

  /**
   * Abstract methods that providers must implement
   */
  protected abstract doInitialize(): Promise<boolean>;
  protected abstract doDispose(): void;
  protected abstract doVerifyInstallation(): Promise<boolean>;
  protected abstract doReset(): Promise<void>;
  protected abstract doStartChatSession(
    sessionId: SessionId,
    config?: AISessionConfig
  ): Promise<Readable>;
  protected abstract doEndSession(sessionId: SessionId): void;
  protected abstract doSendMessageToSession(
    sessionId: SessionId,
    content: string,
    options?: AIMessageOptions
  ): Promise<void>;
}
