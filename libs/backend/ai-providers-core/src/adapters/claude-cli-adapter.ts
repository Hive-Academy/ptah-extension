/**
 * Claude CLI Provider Adapter
 * Implements EnhancedAIProvider interface for Claude Code CLI integration
 * Delegates to claude-domain services for all Claude CLI operations
 *
 * MONSTER Week 5 - Uses dependency injection to consume claude-domain library
 */

import { injectable, inject } from 'tsyringe';
import type {
  ProviderId,
  ProviderInfo,
  ProviderHealth,
  AISessionConfig,
  AIMessageOptions,
  SessionId,
} from '@ptah-extension/shared';
import type { EnhancedAIProvider, ProviderContext } from '../interfaces';
import type {
  ClaudeCliDetector,
  ClaudeCliService,
  // SessionManager, // DELETED - Phase 2 RPC will replace
} from '@ptah-extension/claude-domain';
import { TOKENS } from '@ptah-extension/vscode-core';

/**
 * Session metadata tracker
 * Maps session IDs to their creation time and activity
 */
interface SessionMetadata {
  createdAt: number;
  lastActivity: number;
  messageCount: number;
}

/**
 * Claude CLI Adapter - Delegates to claude-domain services
 *
 * Features:
 * - CLI detection via ClaudeCliDetector
 * - Process spawning via ClaudeCliLauncher
 * - Session management via SessionManager
 * - Event-driven architecture with EventBus integration
 * - Streaming response handling via AsyncIterable
 * - Health monitoring with response time tracking
 *
 * @injectable Registered with DI container for dependency injection
 */
@injectable()
export class ClaudeCliAdapter implements EnhancedAIProvider {
  readonly providerId: ProviderId = 'claude-cli';

  readonly info: ProviderInfo = {
    id: 'claude-cli',
    name: 'Claude Code CLI',
    version: '1.0.0',
    description: 'Claude AI via official CLI with full coding capabilities',
    vendor: 'Anthropic',
    capabilities: {
      streaming: true,
      fileAttachments: true,
      contextManagement: true,
      sessionPersistence: true,
      multiTurn: true,
      codeGeneration: true,
      imageAnalysis: true,
      functionCalling: true,
    },
    maxContextTokens: 200000,
    supportedModels: [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ],
  };

  private sessions = new Map<string, SessionMetadata>();
  private healthStatus: ProviderHealth = {
    status: 'initializing',
    lastCheck: Date.now(),
  };

  constructor(
    @inject(TOKENS.CLAUDE_CLI_DETECTOR)
    private readonly detector: ClaudeCliDetector,
    @inject(TOKENS.CLAUDE_CLI_SERVICE)
    private readonly claudeCliService: ClaudeCliService
  ) // @inject(TOKENS.SESSION_MANAGER) // TODO: Phase 2 RPC - use ClaudeRpcService
  // private readonly sessionManager: SessionManager
  {}

  /**
   * Verify Claude CLI installation
   * Delegates to ClaudeCliDetector
   */
  async verifyInstallation(): Promise<boolean> {
    const installation = await this.detector.findExecutable();
    return installation !== null;
  }

  /**
   * Get available models (optional interface method)
   */
  async getAvailableModels(): Promise<readonly string[]> {
    return this.info.supportedModels as readonly string[];
  }

  /**
   * Attempt recovery (optional interface method)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async attemptRecovery(_sessionId?: SessionId): Promise<boolean> {
    // Attempt to reinitialize
    return await this.initialize();
  }

  /**
   * Register event listener (optional interface method)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  on(_event: string, _listener: (...args: unknown[]) => void): void {
    // Event handling delegated to EventBus via launcher
    // This method exists for interface compatibility
  }

  /**
   * Unregister event listener (optional interface method)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  off(_event: string, _listener: (...args: unknown[]) => void): void {
    // Event handling delegated to EventBus via launcher
    // This method exists for interface compatibility
  }

  /**
   * Initialize Claude CLI adapter
   * Delegates to ClaudeCliDetector for installation verification
   */
  async initialize(): Promise<boolean> {
    try {
      const installation = await this.detector.findExecutable();

      if (installation) {
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
          errorMessage: 'Claude CLI not found in PATH',
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
   * Get current provider health status
   */
  getHealth(): ProviderHealth {
    return this.healthStatus;
  }

  /**
   * Reset provider state and cleanup all sessions
   */
  async reset(): Promise<void> {
    // Cleanup all active sessions
    for (const [sessionId] of this.sessions) {
      this.endSession(sessionId as SessionId);
    }
    this.sessions.clear();

    // Reinitialize
    await this.initialize();
  }

  /**
   * Dispose of all resources and cleanup
   */
  dispose(): void {
    for (const [sessionId] of this.sessions) {
      this.endSession(sessionId as SessionId);
    }
    this.sessions.clear();
  }

  /**
   * Check if provider can handle the given context
   * Claude CLI excels at coding, reasoning, and refactoring tasks
   */
  canHandle(context: ProviderContext): boolean {
    // Claude CLI is excellent for complex tasks
    const compatibleTasks = ['coding', 'reasoning', 'refactoring'];
    return compatibleTasks.includes(context.taskType);
  }

  /**
   * Estimate cost for the given context
   * Based on Claude 3.5 Sonnet pricing (~$3 per million input tokens)
   */
  estimateCost(context: ProviderContext): number {
    const baseRate = 0.003; // $3 per 1M tokens = $0.003 per 1k tokens
    const contextTokens = context.contextSize;
    const estimatedOutputTokens = Math.min(contextTokens * 0.5, 4096); // Assume 50% of input or 4k max
    const outputRate = 0.015; // $15 per 1M output tokens

    return (
      (contextTokens / 1000) * baseRate +
      (estimatedOutputTokens / 1000) * outputRate
    );
  }

  /**
   * Estimate latency for the given context
   * Factors in complexity and context size
   */
  estimateLatency(context: ProviderContext): number {
    const baseLatency = 500; // Base 500ms for process startup and first token

    const complexityMultiplier = {
      low: 1,
      medium: 1.5,
      high: 2.5,
    }[context.complexity];

    // Add ~10ms per 1000 tokens of context
    const contextLatency = (context.contextSize / 1000) * 10;

    return Math.round(baseLatency * complexityMultiplier + contextLatency);
  }

  /**
   * Create a new chat session with Claude CLI
   * Delegates to SessionManager for tracking
   */
  async createSession(config: AISessionConfig): Promise<SessionId> {
    // TODO: Phase 2 RPC - use ClaudeRpcService instead of SessionManager
    // Create session in SessionManager with optional name
    // const session = await this.sessionManager.createSession({
    //   name: config.model ? `Claude ${config.model} Session` : undefined,
    //   workspaceId: config.projectPath,
    // });

    // Temporary: create a fake session ID
    const sessionId = `session-${Date.now()}` as SessionId;

    // Track locally for compatibility
    this.sessions.set(sessionId, {
      createdAt: Date.now(),
      lastActivity: Date.now(),
      messageCount: 0,
    });

    // Store Claude session info if we have config details
    // if (config.model || config.projectPath) {
    //   this.sessionManager.setClaudeSessionInfo(session.id, {
    //     model: config.model || 'default',
    //     tools: [],
    //     cwd: config.projectPath || process.cwd(),
    //     capabilities: {},
    //   });
    // }

    return sessionId;
  }

  /**
   * Start a chat session (implementing IAIProvider interface)
   * Creates session and returns session ID for compatibility
   */
  async startChatSession(
    sessionId: SessionId,
    config?: AISessionConfig
  ): Promise<unknown> {
    // TODO: Phase 2 RPC - use ClaudeRpcService instead of SessionManager
    // If config provided, create new session with that ID
    // if (config) {
    //   const session = await this.sessionManager.createSession({
    //     name: config.model ? `Claude ${config.model} Session` : undefined,
    //     workspaceId: config.projectPath,
    //   });

    //   this.sessions.set(session.id, {
    //     createdAt: Date.now(),
    //     lastActivity: Date.now(),
    //     messageCount: 0,
    //   });
    // }

    return sessionId;
  }

  /**
   * End a chat session and cleanup
   * Note: Claude CLI doesn't support deleting sessions - sessions persist in .claude_sessions/
   */
  endSession(sessionId: SessionId): void {
    // Claude CLI sessions cannot be deleted - they persist in .claude_sessions/ directory
    // Only remove local tracking
    this.sessions.delete(sessionId);
  }

  /**
   * Send message to session and stream response
   * Delegates to ClaudeCliService for process spawning and streaming
   * Implements AsyncIterable for efficient streaming
   *
   * @param sessionId - Session identifier
   * @param message - Message content to send
   * @param context - Provider context (unused - ClaudeCliService handles context)
   * @param options - Message options (unused - ClaudeCliService uses session config)
   */
  async *sendMessage(
    sessionId: SessionId,
    message: string,
    context: ProviderContext,
    options?: AIMessageOptions
  ): AsyncIterable<string> {
    // Suppress unused params - they're part of the interface but handled by ClaudeCliService
    void context;
    void options;
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const startTime = Date.now();

    try {
      // Update session activity
      session.lastActivity = Date.now();
      session.messageCount++;

      // TODO: Phase 2 RPC - use ClaudeRpcService instead of SessionManager
      // Get Claude session ID for resume support
      // const claudeSessionId = this.sessionManager.getClaudeSessionId(sessionId);
      const claudeSessionId = undefined; // Temporary placeholder

      // Delegate to ClaudeCliService which handles launcher creation and streaming
      const stream = await this.claudeCliService.sendMessage(
        message,
        sessionId,
        claudeSessionId
      );

      // Consume Node.js Readable stream and yield text chunks
      // ClaudeCliService's stream emits events via ClaudeDomainEventPublisher
      const chunks: string[] = [];

      // Add error handling for stream
      stream.on('error', (streamError) => {
        throw streamError; // Propagate to async iterator
      });

      for await (const event of stream) {
        if (typeof event === 'object' && event !== null) {
          const typedEvent = event as { type: string; data: unknown };

          if (typedEvent.type === 'content') {
            // FIXED: ClaudeContentChunk has 'delta' field, not 'text'
            const chunk = typedEvent.data as { delta?: string };
            if (chunk.delta) {
              chunks.push(chunk.delta);
              yield chunk.delta;
            }
          }
          // Other event types (thinking, tool) are already published via EventBus
          // by ClaudeCliService's internal launcher, so we don't need to handle them here
        }
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
   * Non-streaming version that uses sendMessage internally
   */
  async sendMessageToSession(
    sessionId: SessionId,
    content: string,
    _options?: AIMessageOptions // Prefixed with _ to avoid unused param lint error
  ): Promise<void> {
    // Create a minimal context for the message
    const context: ProviderContext = {
      taskType: 'coding',
      complexity: 'medium',
      fileTypes: [],
      contextSize: content.length,
    };

    // Consume the async iterable to send the message
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _chunk of this.sendMessage(
      sessionId,
      content,
      context,
      _options
    )) {
      // Process chunks (events are already published via EventBus by launcher)
    }
  }

  /**
   * Perform health check on Claude CLI
   * Delegates to ClaudeCliDetector for verification and health status
   */
  async performHealthCheck(): Promise<ProviderHealth> {
    try {
      const health = await this.detector.performHealthCheck();

      // Convert claude-domain health to ProviderHealth format
      this.healthStatus = {
        status: health.available ? 'available' : 'unavailable',
        lastCheck: Date.now(),
        responseTime: health.responseTime,
        uptime: this.healthStatus.uptime
          ? this.healthStatus.uptime +
            (Date.now() - this.healthStatus.lastCheck)
          : 0,
        errorMessage: health.error,
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
    return `claude-cli-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 11)}`;
  }
}
