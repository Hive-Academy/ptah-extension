/**
 * SDK Stream Processor Types
 *
 * Shared interfaces for the unified stream processing utility.
 * Used by AgenticAnalysisService, ContentGenerationService, and EnhancedPromptsService.
 */

import type { Logger } from '@ptah-extension/vscode-core';

/**
 * Emitter abstraction for stream events.
 * Each service wraps its own broadcast mechanism (webview, callback, etc.).
 */
export interface StreamEventEmitter {
  emit(event: StreamEvent): void;
}

/**
 * Union of all stream event kinds emitted during processing.
 */
export interface StreamEvent {
  kind:
    | 'text'
    | 'thinking'
    | 'tool_start'
    | 'tool_input'
    | 'tool_result'
    | 'error'
    | 'status';
  content: string;
  timestamp: number;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  agentId?: string;
}

/**
 * Phase tracker for analysis-specific progress heuristics.
 * Only used by AgenticAnalysisService.
 */
export interface PhaseTracker {
  onToolStart(toolCallCount: number, toolName: string): void;
  onToolStop(toolCallId: string, inputBuffer: string): void;
  onThinking(thinkingPreview: string): void;
}

/**
 * Configuration for SdkStreamProcessor.
 */
export interface SdkStreamProcessorConfig {
  /** Emitter to broadcast stream events */
  emitter: StreamEventEmitter;

  /** Optional timeout with abort controller (analysis only) */
  timeout?: { ms: number; abortController: AbortController };

  /** Optional phase tracker for progress heuristics (analysis only) */
  phaseTracker?: PhaseTracker;

  /**
   * Factory for generating tool call IDs.
   * Defaults to using the SDK's content_block.id.
   * Override for custom prefixes (e.g., `gen-${agentId}-${index}-${Date.now()}`).
   */
  toolCallIdFactory?: (
    toolName: string,
    index: number,
    contentBlockId: string
  ) => string;

  /** Logger instance */
  logger: Logger;

  /** Service tag for log messages (e.g., '[AgenticAnalysis]') */
  serviceTag: string;
}

/**
 * Result returned by the stream processor after consuming all messages.
 */
export interface StreamProcessorResult {
  /** Structured output from the SDK result message, or null */
  structuredOutput: unknown | null;

  /** Metadata from the result message */
  resultMeta?: {
    turns: number;
    cost: number;
    inputTokens: number;
    outputTokens: number;
  };
}
