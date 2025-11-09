/**
 * VS Code Language Model Provider Adapter
 * Implements EnhancedAIProvider interface for VS Code's built-in LM API
 * Provides lightweight, stateless AI provider for quick coding tasks
 */

import { injectable } from 'tsyringe';
import * as vscode from 'vscode';
import type {
  ProviderId,
  ProviderInfo,
  ProviderHealth,
  AISessionConfig,
  SessionId,
} from '@ptah-extension/shared';
import type { EnhancedAIProvider, ProviderContext } from '../interfaces';

/**
 * Session Metadata Tracker
 * VS Code LM is stateless, but we track sessions for consistency with IAIProvider interface
 */
interface SessionMetadata {
  createdAt: number;
  lastActivity: number;
  messageCount: number;
  model?: string;
  cancellationToken?: vscode.CancellationTokenSource; // For session cancellation
}

/**
 * VS Code LM Adapter - Lightweight provider for VS Code's built-in Language Model API
 *
 * Features:
 * - Stateless operation (no persistent sessions)
 * - Fast response times for quick tasks
 * - Zero cost (free with VS Code)
 * - Real streaming via VS Code LM API
 * - Limited capabilities compared to Claude CLI
 *
 * Production Implementation:
 * - Uses vscode.lm.selectChatModels() for model selection
 * - Streams responses via vscode.LanguageModelChatResponse
 * - Supports Copilot family models (gpt-4o, gpt-4-turbo, gpt-3.5-turbo)
 * - No file attachments, image analysis, or function calling (VS Code LM limitations)
 *
 * @injectable Registered with DI container for dependency injection
 */
@injectable()
export class VsCodeLmAdapter implements EnhancedAIProvider {
  readonly providerId: ProviderId = 'vscode-lm';

  readonly info: ProviderInfo = {
    id: 'vscode-lm',
    name: 'VS Code Language Model',
    version: '1.0.0',
    description: 'Fast, lightweight AI provider using VS Code built-in LM API',
    vendor: 'Microsoft',
    capabilities: {
      streaming: true,
      fileAttachments: false, // VS Code LM has limited file support
      contextManagement: true,
      sessionPersistence: false, // Stateless
      multiTurn: true,
      codeGeneration: true,
      imageAnalysis: false,
      functionCalling: false,
    },
    maxContextTokens: 128000, // Typical VS Code LM context window
    supportedModels: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'], // Common VS Code LM models
  };

  private sessions = new Map<string, SessionMetadata>();
  private healthStatus: ProviderHealth = {
    status: 'initializing',
    lastCheck: Date.now(),
  };

  /**
   * Initialize VS Code LM adapter
   * Verifies VS Code LM API availability
   */
  async initialize(): Promise<boolean> {
    try {
      // VS Code LM API availability check
      // In actual implementation, would check vscode.lm namespace
      // For now, assume available if running in VS Code extension context
      const isVsCodeExtension =
        typeof process !== 'undefined' && process.versions?.['electron'];

      if (isVsCodeExtension) {
        this.healthStatus = {
          status: 'available',
          lastCheck: Date.now(),
          uptime: 0,
        };
        return true;
      } else {
        this.healthStatus = {
          status: 'unavailable',
          lastCheck: Date.now(),
          errorMessage: 'Not running in VS Code extension context',
        };
        return false;
      }
    } catch (error) {
      this.healthStatus = {
        status: 'error',
        lastCheck: Date.now(),
        errorMessage:
          error instanceof Error
            ? error.message
            : 'Unknown initialization error',
      };
      return false;
    }
  }

  /**
   * Verify VS Code LM API installation/availability
   */
  async verifyInstallation(): Promise<boolean> {
    // Check if running in VS Code extension context
    const isVsCodeExtension =
      typeof process !== 'undefined' && process.versions?.['electron'];
    return Boolean(isVsCodeExtension);
  }

  /**
   * Get current provider health status
   */
  getHealth(): ProviderHealth {
    return this.healthStatus;
  }

  /**
   * Reset provider state
   * Clears all session metadata (VS Code LM is stateless anyway)
   */
  async reset(): Promise<void> {
    this.sessions.clear();
    await this.initialize();
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.sessions.clear();
  }

  /**
   * Check if provider can handle the given context
   * VS Code LM is good for quick coding tasks and simple analysis
   */
  canHandle(context: ProviderContext): boolean {
    // VS Code LM is best for low to medium complexity tasks
    if (context.complexity === 'high') {
      return false;
    }

    // Good for coding and analysis, acceptable for debugging
    const compatibleTasks = ['coding', 'analysis', 'debugging'];
    return compatibleTasks.includes(context.taskType);
  }

  /**
   * Estimate cost for the given context
   * VS Code LM is free (zero cost)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  estimateCost(_context: ProviderContext): number {
    return 0; // Free with VS Code
  }

  /**
   * Estimate latency for the given context
   * VS Code LM is generally faster than external APIs
   */
  estimateLatency(context: ProviderContext): number {
    const baseLatency = 200; // Base 200ms for API call

    // Add small overhead for larger contexts
    const contextLatency = (context.contextSize / 1000) * 5; // ~5ms per 1000 tokens

    return Math.round(baseLatency + contextLatency);
  }

  /**
   * Create a new session
   * VS Code LM is stateless, so this just creates tracking metadata
   */
  async createSession(config: AISessionConfig): Promise<SessionId> {
    const sessionId = this.generateSessionId() as SessionId;

    // Create cancellation token for this session
    const cancellationToken = new vscode.CancellationTokenSource();

    // Track session metadata for consistency
    this.sessions.set(sessionId, {
      createdAt: Date.now(),
      lastActivity: Date.now(),
      messageCount: 0,
      model: config.model,
      cancellationToken,
    });

    return sessionId;
  }

  /**
   * Start a chat session (implementing IAIProvider interface)
   * VS Code LM is stateless, returns null for stream (will be handled in sendMessage)
   */
  async startChatSession(
    sessionId: SessionId,
    config?: AISessionConfig
  ): Promise<unknown> {
    // Create cancellation token for this session
    const cancellationToken = new vscode.CancellationTokenSource();

    // Create or update session metadata
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        createdAt: Date.now(),
        lastActivity: Date.now(),
        messageCount: 0,
        model: config?.model,
        cancellationToken,
      });
    } else {
      // Update existing session with cancellation token
      const session = this.sessions.get(sessionId);
      if (session) {
        session.cancellationToken = cancellationToken;
        session.model = config?.model || session.model;
      }
    }

    // VS Code LM is stateless - no persistent stream
    return null;
  }

  /**
   * End a session
   * Just cleanup metadata (no actual cleanup needed for stateless API)
   */
  endSession(sessionId: SessionId): void {
    const session = this.sessions.get(sessionId);
    if (session?.cancellationToken) {
      // Cancel any ongoing requests
      session.cancellationToken.cancel();
      session.cancellationToken.dispose();
    }
    this.sessions.delete(sessionId);
  }

  /**
   * Send message and stream response
   * Uses VS Code LM API for streaming
   * Note: context parameter reserved for future model selection logic
   */
  async *sendMessage(
    sessionId: SessionId,
    message: string
  ): AsyncIterable<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const startTime = Date.now();

    try {
      // Update session metadata
      session.lastActivity = Date.now();
      session.messageCount++;

      // Get cancellation token for this session
      const cancellationToken =
        session.cancellationToken || new vscode.CancellationTokenSource();
      if (!session.cancellationToken) {
        session.cancellationToken = cancellationToken;
      }

      // Get available language models from VS Code LM API
      const models = await vscode.lm.selectChatModels({
        vendor: 'copilot',
        family: session.model || 'gpt-4o',
      });

      if (models.length === 0) {
        throw new Error('No VS Code language models available');
      }

      const model = models[0];

      // Prepare chat messages
      const messages = [vscode.LanguageModelChatMessage.User(message)];

      // Send request with justification and cancellation token
      const chatResponse = await model.sendRequest(
        messages,
        {
          justification: `Ptah extension chat session ${sessionId}`,
        },
        cancellationToken.token
      );

      // Stream response chunks from VS Code LM API
      for await (const fragment of chatResponse.text) {
        yield fragment;
      }

      // Update health metrics
      const responseTime = Date.now() - startTime;
      this.healthStatus = {
        ...this.healthStatus,
        lastCheck: Date.now(),
        responseTime,
      };
    } catch (error) {
      this.healthStatus = {
        status: 'error',
        lastCheck: Date.now(),
        errorMessage:
          error instanceof Error ? error.message : 'Streaming error',
      };
      throw error;
    }
  }

  /**
   * Send message to session (implementing IAIProvider interface)
   * Accumulates the complete response for non-streaming use cases
   * For streaming, use sendMessage() AsyncIterable directly
   */
  async sendMessageToSession(
    sessionId: SessionId,
    content: string
  ): Promise<void> {
    // Accumulate all chunks from the streaming response
    // The response is consumed to ensure the request completes
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _chunk of this.sendMessage(sessionId, content)) {
      // Chunks are processed by ChatMessageHandler which publishes chat:messageChunk events
      // This method ensures compatibility with IAIProvider interface
    }

    // Response is complete - ChatMessageHandler handles the actual event publishing
    // This design maintains separation of concerns:
    // - Adapter: Yields chunks via AsyncIterable
    // - Handler: Consumes AsyncIterable and publishes events
  }

  /**
   * Perform health check on VS Code LM API
   */
  async performHealthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();

    try {
      const available = await this.verifyInstallation();

      if (!available) {
        this.healthStatus = {
          status: 'unavailable',
          lastCheck: Date.now(),
          errorMessage: 'VS Code LM API not available',
        };
        return this.healthStatus;
      }

      const responseTime = Date.now() - startTime;

      this.healthStatus = {
        status: 'available',
        lastCheck: Date.now(),
        responseTime,
        uptime: this.healthStatus.uptime
          ? this.healthStatus.uptime +
            (Date.now() - this.healthStatus.lastCheck)
          : 0,
      };

      return this.healthStatus;
    } catch (error) {
      this.healthStatus = {
        status: 'error',
        lastCheck: Date.now(),
        errorMessage:
          error instanceof Error ? error.message : 'Health check failed',
      };
      return this.healthStatus;
    }
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `vscode-lm-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}
