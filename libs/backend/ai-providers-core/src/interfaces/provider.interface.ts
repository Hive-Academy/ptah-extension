/**
 * Enhanced AI Provider Interfaces - Context-Aware Provider System
 * Extends existing IAIProvider with intelligent provider selection capabilities
 */

import type {
  IAIProvider,
  ProviderHealth,
  AISessionConfig,
} from '@ptah-extension/shared';

/**
 * Provider Context - Task-specific information for intelligent provider selection
 * Used by selection strategies to score and select the best provider for a given task
 */
export interface ProviderContext {
  /** Type of task being performed */
  readonly taskType:
    | 'coding'
    | 'reasoning'
    | 'analysis'
    | 'refactoring'
    | 'debugging';

  /** Complexity level of the task */
  readonly complexity: 'low' | 'medium' | 'high';

  /** File types involved in the task (e.g., ['.ts', '.tsx']) */
  readonly fileTypes: readonly string[];

  /** Optional project type for specialized provider selection */
  readonly projectType?: string;

  /** Estimated context size in tokens */
  readonly contextSize: number;
}

/**
 * Enhanced AI Provider Interface - Extends IAIProvider with context-aware capabilities
 * Adds methods for intelligent provider selection, cost estimation, and health monitoring
 *
 * @extends IAIProvider Base provider interface from @ptah-extension/shared
 */
export interface EnhancedAIProvider extends IAIProvider {
  /**
   * Determines if this provider can handle the given context
   * Used by selection strategy to filter available providers
   *
   * @param context - Task context information
   * @returns true if provider can handle the task
   */
  canHandle(context: ProviderContext): boolean;

  /**
   * Estimates the cost of handling the given context
   * Used by selection strategy for cost-aware provider selection
   *
   * @param context - Task context information
   * @returns Estimated cost in USD
   */
  estimateCost(context: ProviderContext): number;

  /**
   * Estimates the latency for handling the given context
   * Used by selection strategy for performance-aware provider selection
   *
   * @param context - Task context information
   * @returns Estimated latency in milliseconds
   */
  estimateLatency(context: ProviderContext): number;

  /**
   * Creates a new session with the provider
   * Enhanced session creation with configuration support
   *
   * @param config - Session configuration
   * @returns Session identifier
   */
  createSession(config: AISessionConfig): Promise<string>;

  /**
   * Sends a message to an active session with streaming support
   * Supports context-aware message processing
   *
   * @param sessionId - Active session identifier
   * @param message - Message content
   * @param context - Task context for specialized handling
   * @returns AsyncIterable stream of response chunks
   */
  sendMessage(
    sessionId: string,
    message: string,
    context: ProviderContext
  ): AsyncIterable<string>;

  /**
   * Performs a health check on the provider
   * Used by provider manager for health monitoring
   *
   * @returns Current provider health status
   */
  performHealthCheck(): Promise<ProviderHealth>;
}
