/**
 * VS Code Language Model Provider
 * Implements IAIProvider interface using VS Code's Language Model API
 * Supports streaming and session management
 */

import * as vscode from 'vscode';
import { Readable, pipeline } from 'stream';
import { promisify } from 'util';
import { BaseAIProvider } from './base-ai-provider';
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
import {
  SessionId,
  CorrelationId,
  MessageId,
  BrandedTypeValidator,
} from '@ptah-extension/shared';
import { StrictChatMessage, MessageResponse } from '@ptah-extension/shared';

/**
 * VS Code LM Provider Configuration
 */
export interface VSCodeLMProviderConfig {
  preferredFamily?: string;
  fallbackModels?: string[];
  maxRetries?: number;
  modelSelectionStrategy?: 'first-available' | 'best-match' | 'user-preference';
}

/**
 * VS Code Language Model Provider Implementation
 */
export class VSCodeLMProvider extends BaseAIProvider {
  private client: vscode.LanguageModelChat | null = null;
  private disposables: vscode.Disposable[] = [];
  private sessionTokens = new Map<SessionId, vscode.CancellationTokenSource>();
  private availableModels: vscode.LanguageModelChat[] = [];

  private readonly config: VSCodeLMProviderConfig;

  constructor(config: VSCodeLMProviderConfig = {}) {
    const info: ProviderInfo = {
      id: 'vscode-lm' as ProviderId,
      name: 'VS Code Language Model',
      version: '1.0.0',
      description: 'VS Code integrated language model provider with Copilot support',
      vendor: 'Microsoft/GitHub',
      capabilities: {
        ...DEFAULT_PROVIDER_CAPABILITIES,
        imageAnalysis: false, // VS Code LM doesn't support images yet
        functionCalling: false, // VS Code LM doesn't support function calling yet
      },
      maxContextTokens: 8192, // Default context window
    };

    super('vscode-lm', info);

    this.config = {
      preferredFamily: 'gpt-4',
      fallbackModels: ['gpt-4', 'gpt-3.5-turbo'],
      maxRetries: 3,
      modelSelectionStrategy: 'first-available',
      ...config,
    };
  }

  /**
   * Initialize VS Code LM provider
   */
  protected async doInitialize(): Promise<boolean> {
    try {
      Logger.info('Initializing VS Code Language Model provider...');

      // Check if VS Code LM API is available
      if (!vscode.lm) {
        Logger.error('VS Code Language Model API not available');
        return false;
      }

      // Set up configuration change listener
      this.setupConfigurationListener();

      // Discover available models
      await this.discoverAvailableModels();

      // Select initial model
      await this.selectBestModel();

      if (!this.client) {
        Logger.error('No VS Code language models available');
        return false;
      }

      Logger.info(
        `VS Code LM provider initialized with model: ${this.client.name} (${this.client.vendor})`
      );
      return true;
    } catch (error) {
      Logger.error('Failed to initialize VS Code LM provider:', error);
      return false;
    }
  }

  /**
   * Dispose provider resources
   */
  protected doDispose(): void {
    Logger.info('Disposing VS Code LM provider...');

    // Cancel all active sessions
    for (const [sessionId, cancellationToken] of this.sessionTokens) {
      try {
        cancellationToken.cancel();
        cancellationToken.dispose();
      } catch (error) {
        Logger.error(`Error disposing session ${sessionId}:`, error);
      }
    }
    this.sessionTokens.clear();

    // Dispose VS Code disposables
    for (const disposable of this.disposables) {
      try {
        disposable.dispose();
      } catch (error) {
        Logger.error('Error disposing VS Code resource:', error);
      }
    }
    this.disposables = [];

    Logger.info('VS Code LM provider disposed');
  }

  /**
   * Verify VS Code LM installation
   */
  protected async doVerifyInstallation(): Promise<boolean> {
    try {
      // Check if VS Code LM API is available
      if (!vscode.lm) {
        Logger.error('VS Code Language Model API not available');
        return false;
      }

      // Try to get available models
      const models = await vscode.lm.selectChatModels({});

      if (!models || models.length === 0) {
        Logger.error('No VS Code language models available. Please ensure Copilot is enabled.');
        return false;
      }

      // Logger.info(`Found ${models.length} VS Code language model(s)`);
      return true;
    } catch (error) {
      Logger.error('Error verifying VS Code LM installation:', error);
      return false;
    }
  }

  /**
   * Reset provider state
   */
  protected async doReset(): Promise<void> {
    Logger.info('Resetting VS Code LM provider...');

    // Re-discover models
    await this.discoverAvailableModels();
    await this.selectBestModel();

    // Clear active sessions (they will be recreated as needed)
    for (const [sessionId, cancellationToken] of this.sessionTokens) {
      cancellationToken.cancel();
      cancellationToken.dispose();
    }
    this.sessionTokens.clear();

    Logger.info('VS Code LM provider reset completed');
  }

  /**
   * Start a chat session
   */
  async startChatSession(sessionId: SessionId, config?: AISessionConfig): Promise<Readable> {
    if (!this.client) {
      throw this.createProviderError(
        ProviderErrorType.MODEL_UNAVAILABLE,
        'No VS Code language model available',
        undefined,
        { sessionId }
      );
    }

    // Validate sessionId
    const validatedSessionId =
      typeof sessionId === 'string' ? BrandedTypeValidator.validateSessionId(sessionId) : sessionId;

    Logger.info(`Starting VS Code LM chat session: ${validatedSessionId}`);

    // Create cancellation token for this session
    const cancellationTokenSource = new vscode.CancellationTokenSource();
    this.sessionTokens.set(validatedSessionId, cancellationTokenSource);

    // Add to active sessions
    this.addActiveSession(validatedSessionId);

    // Create stream pipeline
    return this.createStreamPipeline(validatedSessionId, cancellationTokenSource.token);
  }

  /**
   * Start a chat session
   */
  protected async doStartChatSession(
    sessionId: SessionId,
    config?: AISessionConfig
  ): Promise<Readable> {
    Logger.info(`Starting VS Code LM session: ${sessionId}`);

    const cancellationTokenSource = new vscode.CancellationTokenSource();
    this.sessionTokens.set(sessionId, cancellationTokenSource);

    // Create stream pipeline
    const validatedSessionId = BrandedTypeValidator.validateSessionId(sessionId);
    return this.createStreamPipeline(validatedSessionId, cancellationTokenSource.token);
  }

  /**
   * End a session
   */
  protected doEndSession(sessionId: SessionId): void {
    const cancellationToken = this.sessionTokens.get(sessionId);
    if (cancellationToken) {
      cancellationToken.cancel();
      cancellationToken.dispose();
      this.sessionTokens.delete(sessionId);
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
    const cancellationToken = this.sessionTokens.get(sessionId);
    if (!cancellationToken) {
      throw this.createProviderError(
        ProviderErrorType.SESSION_NOT_FOUND,
        `Session ${sessionId} not found`,
        undefined,
        { sessionId }
      );
    }

    if (!this.client) {
      throw this.createProviderError(
        ProviderErrorType.MODEL_UNAVAILABLE,
        'No VS Code language model available',
        undefined,
        { sessionId }
      );
    }

    try {
      // Convert to VS Code message format
      const messages = [vscode.LanguageModelChatMessage.User(content)];

      // Send request directly
      const result = await this.client!.sendRequest(
        messages,
        {
          justification: `Ptah extension chat session ${sessionId}`,
        },
        cancellationToken.token
      );

      // VS Code LM returns a stream response, handle it appropriately
      if (!result || !result.stream) {
        throw this.createProviderError(
          ProviderErrorType.STREAMING_ERROR,
          'VS Code LM request failed or returned no stream',
          undefined,
          { sessionId, content: content.substring(0, 100) }
        );
      }

      Logger.info(
        `Message sent to VS Code LM session ${sessionId}: ${content.substring(0, 100)}...`
      );
    } catch (error) {
      Logger.error(`Failed to send message to VS Code LM session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Get available models
   */
  async getAvailableModels(): Promise<readonly string[]> {
    try {
      const models = await vscode.lm.selectChatModels({});
      return models.map((model) => `${model.vendor}/${model.family}:${model.name}`);
    } catch (error) {
      Logger.error('Error getting available VS Code LM models:', error);
      return [];
    }
  }

  /**
   * Attempt recovery
   */
  async attemptRecovery(sessionId?: SessionId): Promise<boolean> {
    // Simple recovery implementation
    return true;
  }

  /**
   * Private helper methods
   */
  private async discoverAvailableModels(): Promise<void> {
    try {
      this.availableModels = await vscode.lm.selectChatModels({});
      Logger.info(`Discovered ${this.availableModels.length} VS Code language models`);

      // Send model list to UI for user selection
      if (this.availableModels.length > 0) {
        const modelInfo = this.availableModels.map((model) => ({
          id: model.id,
          name: model.name,
          vendor: model.vendor,
          family: model.family,
          maxTokens: model.maxInputTokens,
          version: model.version || 'unknown',
        }));

        // Log for development visibility
        for (const model of this.availableModels) {
          Logger.info(
            `  - ${model.name} (${model.vendor}/${model.family}, max tokens: ${model.maxInputTokens})`
          );
        }

        // Emit event for webview to handle model selection UI
        this.emit('modelsDiscovered', modelInfo);

        // Set default model to first available if none configured
        if (!this.currentModel && this.availableModels.length > 0) {
          this.currentModel = this.availableModels[0];
          Logger.info(`Auto-selected default model: ${this.currentModel.name}`);
        }
      }
    } catch (error) {
      Logger.error('Error discovering VS Code LM models:', error);
      this.availableModels = [];
    }
  }

  private async selectBestModel(): Promise<void> {
    if (this.availableModels.length === 0) {
      Logger.error('No VS Code language models available for selection');
      return;
    }

    let selectedModel: vscode.LanguageModelChat | null = null;

    switch (this.config.modelSelectionStrategy) {
      case 'first-available':
        selectedModel = this.availableModels[0];
        break;

      case 'best-match':
        // Try preferred family first
        selectedModel =
          this.availableModels.find((model) =>
            model.family
              .toLowerCase()
              .includes(this.config.preferredFamily?.toLowerCase() || 'gpt-4')
          ) || this.availableModels[0];
        break;

      case 'user-preference':
        // For now, fallback to first available (could be enhanced with user settings)
        selectedModel = this.availableModels[0];
        break;

      default:
        selectedModel = this.availableModels[0];
    }

    this.client = selectedModel;

    if (this.client) {
      Logger.info(
        `Selected VS Code LM model: ${this.client.name} (${this.client.vendor}/${this.client.family})`
      );

      // Update provider info with selected model details
      (this.info as any).maxContextTokens = this.client.maxInputTokens;
      (this.info as any).supportedModels = [
        `${this.client.vendor}/${this.client.family}:${this.client.name}`,
      ];
    }
  }

  private setupConfigurationListener(): void {
    const disposable = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('github.copilot') || event.affectsConfiguration('lm')) {
        Logger.info('VS Code LM configuration changed, refreshing models...');
        this.client = null;

        // Refresh models asynchronously
        this.discoverAvailableModels()
          .then(() => this.selectBestModel())
          .catch((error) => {
            Logger.error('Error refreshing VS Code LM models after config change:', error);
          });
      }
    });

    this.disposables.push(disposable);
  }

  private createStreamPipeline(
    sessionId: SessionId,
    cancellationToken: vscode.CancellationToken
  ): Readable {
    // Create simple output stream
    const outputStream = new Readable({
      objectMode: true,
      highWaterMark: 16,
      read() {
        // Backpressure handled by pipeline
      },
    });

    // Set up basic error handling
    this.setupStreamErrorHandling(outputStream, sessionId, cancellationToken);

    return outputStream;
  }

  private setupStreamErrorHandling(
    outputStream: Readable,
    sessionId: SessionId,
    cancellationToken: vscode.CancellationToken
  ): void {
    // Handle cancellation
    cancellationToken.onCancellationRequested(() => {
      Logger.info(`VS Code LM session ${sessionId} cancelled`);
      outputStream.push(null);
    });

    // Handle stream errors
    outputStream.on('error', (error) => {
      Logger.error(`VS Code LM stream error for session ${sessionId}:`, error);
    });

    // Handle output stream completion
    outputStream.on('end', () => {
      Logger.info(`VS Code LM output stream ended for session: ${sessionId}`);
    });
  }
}
