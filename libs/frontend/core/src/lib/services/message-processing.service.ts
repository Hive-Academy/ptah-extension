import { Injectable, inject } from '@angular/core';
import { LoggingService } from './logging.service';
import {
  StrictChatMessage,
  CorrelationId,
  MessageError,
  MessageNormalizer,
} from '@ptah-extension/shared';
import {
  ClaudeMessageTransformerService,
  ClaudeCliStreamMessage,
  ProcessedClaudeMessage,
} from './claude-message-transformer.service';

/**
 * Message Processing Service - Message Transformation & Validation
 *
 * **Responsibilities**:
 * - Transform Claude CLI messages to ProcessedClaudeMessage format
 * - Convert between message formats (Claude <-> StrictChatMessage)
 * - Validate message structure and content
 * - Handle message parsing errors gracefully
 *
 * **Dependencies**:
 * - ClaudeMessageTransformerService: Transform raw Claude messages
 * - LoggingService: Error logging and diagnostics
 *
 * **Design Pattern**: Facade pattern - simplifies message format conversions
 *
 * Extracted from ChatService for single responsibility principle
 *
 * @example
 * ```typescript
 * // Transform Claude CLI message to ProcessedClaudeMessage
 * const processed = messageProcessing.transformClaudeMessage(claudeMessage);
 *
 * // Convert to StrictChatMessage for UI display
 * const strictMessage = messageProcessing.convertToStrictChatMessage(processed);
 *
 * // Validate message structure
 * if (messageProcessing.validateMessage(unknownMessage)) {
 *   // Safe to use as StrictChatMessage
 * }
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class MessageProcessingService {
  private readonly claudeTransformer = inject(ClaudeMessageTransformerService);
  private readonly logger = inject(LoggingService);

  /**
   * Transform Claude CLI stream message to ProcessedClaudeMessage
   *
   * Delegates to ClaudeMessageTransformerService for actual transformation
   * Provides error handling and logging
   *
   * @param claudeMessage - Raw Claude CLI stream message
   * @returns Transformed message or null if transformation fails
   *
   * @example
   * ```typescript
   * const processed = transformClaudeMessage(rawMessage);
   * if (processed) {
   *   console.log('Transformed:', processed.content);
   * }
   * ```
   */
  transformClaudeMessage(
    claudeMessage: ClaudeCliStreamMessage
  ): ProcessedClaudeMessage | null {
    try {
      return this.claudeTransformer.transform(claudeMessage);
    } catch (error) {
      this.logger.error('Failed to transform Claude message', String(error));
      return null;
    }
  }

  /**
   * Convert ProcessedClaudeMessage to StrictChatMessage for UI compatibility
   *
   * Maps Claude's ProcessedClaudeMessage format to the UI's StrictChatMessage format
   * Extracts metadata, token usage, and content flags
   *
   * @param processedMessage - Processed Claude message
   * @returns StrictChatMessage for UI consumption
   *
   * @example
   * ```typescript
   * const strictMessage = convertToStrictChatMessage(processedMessage);
   * // Use in Angular component
   * chatMessages().push(strictMessage);
   * ```
   */
  convertToStrictChatMessage(
    processedMessage: ProcessedClaudeMessage
  ): StrictChatMessage {
    return {
      id: processedMessage.id,
      sessionId: processedMessage.sessionId,
      type: processedMessage.type,
      contentBlocks: processedMessage.content.map((block) => {
        if (block.type === 'text') {
          return { type: 'text' as const, text: block.text || '' };
        } else if (block.type === 'thinking') {
          return { type: 'thinking' as const, thinking: block.thinking || '' };
        } else if (block.type === 'tool_use') {
          return {
            type: 'tool_use' as const,
            id: block.id || '',
            name: block.name || '',
            input: block.input || {},
          };
        } else if (block.type === 'tool_result') {
          return {
            type: 'tool_result' as const,
            tool_use_id: block.tool_use_id || '',
            content: block.content || '',
            is_error: block.is_error,
          };
        }
        // Fallback for unknown types
        return { type: 'text' as const, text: '' };
      }),
      timestamp: processedMessage.timestamp || Date.now(),
      streaming: processedMessage.isStreaming || false,
      isComplete: processedMessage.isComplete,
      files: processedMessage.filePaths,
      metadata: {
        ['correlationId']: crypto.randomUUID() as CorrelationId, // Generate if not present
        ['hasTools']: (processedMessage.toolsUsed?.length || 0) > 0,
        ['hasImages']: processedMessage.hasImages || false,
        ['hasFiles']: processedMessage.hasFiles || false,
        ['filePaths']: processedMessage.filePaths,
        ['tokenUsage']: processedMessage.tokenUsage
          ? {
              input: processedMessage.tokenUsage.input_tokens,
              output: processedMessage.tokenUsage.output_tokens,
              total:
                processedMessage.tokenUsage.input_tokens +
                processedMessage.tokenUsage.output_tokens,
            }
          : undefined,
      },
    };
  }

  /**
   * Convert StrictChatMessage to ProcessedClaudeMessage (reverse conversion)
   *
   * Maps UI's StrictChatMessage format back to Claude's ProcessedClaudeMessage format
   * Useful for re-sending messages or state persistence
   *
   * @param strictMessage - StrictChatMessage from UI
   * @returns ProcessedClaudeMessage for Claude API
   *
   * @example
   * ```typescript
   * const processedMessage = convertToProcessedMessage(strictMessage);
   * // Send to Claude API
   * ```
   */
  convertToProcessedMessage(
    strictMessage: StrictChatMessage
  ): ProcessedClaudeMessage {
    const tokenUsage = strictMessage.metadata?.['tokenUsage'] as
      | { input: number; output: number; total: number }
      | undefined;

    // DEFENSIVE: Ensure contentBlocks exists and is array
    let contentBlocks = strictMessage.contentBlocks || [];

    // DEFENSIVE: If contentBlocks is empty, try to normalize from legacy content field
    if (contentBlocks.length === 0 && (strictMessage as any).content) {
      const normalized = MessageNormalizer.normalize({
        role: strictMessage.type,
        content: (strictMessage as any).content,
      });
      contentBlocks = normalized.contentBlocks;
    }

    return {
      id: strictMessage.id,
      sessionId: strictMessage.sessionId,
      timestamp: strictMessage.timestamp,
      type: strictMessage.type,
      content: contentBlocks.map((block) => {
        if (block.type === 'text') {
          return { type: 'text', text: block.text };
        } else if (block.type === 'tool_use') {
          return {
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          };
        } else if (block.type === 'thinking') {
          return { type: 'thinking', text: block.thinking };
        } else if (block.type === 'tool_result') {
          // Convert tool_result content to string if it's an array
          const contentString =
            typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content);
          return {
            type: 'tool_result',
            tool_use_id: block.tool_use_id,
            content: contentString,
            is_error: block.is_error,
          };
        } else {
          // Fallback for unexpected types
          return { type: 'text', text: '' };
        }
      }),
      isComplete: strictMessage.isComplete,
      isStreaming: strictMessage.streaming,
      filePaths: strictMessage.files as string[] | undefined,
      tokenUsage: tokenUsage
        ? {
            input_tokens: tokenUsage.input,
            output_tokens: tokenUsage.output,
          }
        : undefined,
    };
  }

  /**
   * Validate message structure and content
   *
   * Type guard to check if an unknown object is a valid StrictChatMessage
   * Validates required fields and types
   *
   * @param message - Unknown message object
   * @returns True if valid StrictChatMessage, false otherwise
   *
   * @example
   * ```typescript
   * if (validateMessage(unknownMessage)) {
   *   // TypeScript knows unknownMessage is StrictChatMessage
   *   console.log(unknownMessage.content);
   * }
   * ```
   */
  validateMessage(message: unknown): message is StrictChatMessage {
    if (!message || typeof message !== 'object') {
      return false;
    }

    const msg = message as Partial<StrictChatMessage>;

    return !!(
      msg.id &&
      msg.sessionId &&
      msg.type &&
      ['user', 'assistant', 'system'].includes(msg.type) &&
      msg.contentBlocks &&
      Array.isArray(msg.contentBlocks) &&
      typeof msg.timestamp === 'number'
    );
  }

  /**
   * Extract error information from failed message processing
   *
   * Converts any error type to structured MessageError format
   * Preserves stack traces and error details for debugging
   *
   * @param error - Unknown error object
   * @returns Structured MessageError
   *
   * @example
   * ```typescript
   * try {
   *   processMessage(rawMessage);
   * } catch (error) {
   *   const messageError = extractErrorInfo(error);
   *   logger.error('Processing failed', messageError);
   * }
   * ```
   */
  extractErrorInfo(error: unknown): MessageError {
    if (error instanceof Error) {
      return {
        code: 'processing_error',
        message: error.message,
        stack: error.stack,
        context: {
          name: error.name,
        },
      };
    }

    return {
      code: 'unknown_error',
      message: 'Unknown error occurred during message processing',
      context: { originalError: String(error) },
    };
  }

  /**
   * Extract all text content from ProcessedClaudeMessage
   *
   * @private
   * @param message - Processed Claude message
   * @returns Combined text content
   */
  private extractTextContent(message: ProcessedClaudeMessage): string {
    return message.content
      .filter((c) => c.type === 'text')
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join(' ')
      .trim();
  }
}
