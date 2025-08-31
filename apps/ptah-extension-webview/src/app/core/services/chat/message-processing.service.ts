import { Injectable, inject } from '@angular/core';
import { Observable, map, catchError, EMPTY } from 'rxjs';
import { LoggingService } from '../logging.service';
import {
  StrictChatMessage,
  MessageId,
  CorrelationId,
  ProcessedClaudeMessage,
  ClaudeCliStreamMessage,
  MessageError,
} from '@ptah-extension/shared';
import { ClaudeMessageTransformerService } from '../claude-message-transformer.service';

/**
 * Message Processing Service - Message Transformation & Validation
 *
 * Responsibilities:
 * - Transform Claude CLI messages to ProcessedClaudeMessage format
 * - Convert between message formats (Claude <-> StrictChatMessage)
 * - Validate message structure and content
 * - Handle message parsing errors gracefully
 *
 * Extracted from EnhancedChatService for single responsibility
 */
@Injectable({
  providedIn: 'root',
})
export class MessageProcessingService {
  private readonly claudeTransformer = inject(ClaudeMessageTransformerService);
  private readonly logger = inject(LoggingService);

  /**
   * Transform Claude CLI stream message to ProcessedClaudeMessage
   */
  transformClaudeMessage(
    claudeMessage: ClaudeCliStreamMessage,
    sessionId: string,
  ): ProcessedClaudeMessage | null {
    try {
      return this.claudeTransformer.transformClaudeMessage(claudeMessage, sessionId);
    } catch (error) {
      console.error('MessageProcessingService: Failed to transform Claude message:', error);
      return null;
    }
  }

  /**
   * Convert ProcessedClaudeMessage to StrictChatMessage for compatibility
   */
  convertToStrictChatMessage(processedMessage: ProcessedClaudeMessage): StrictChatMessage {
    return {
      id: processedMessage.messageId,
      type: this.mapRoleToMessageType(processedMessage.role),
      content: this.extractTextContent(processedMessage),
      timestamp: processedMessage.timestamp || Date.now(),
      streaming: false, // Processed messages are no longer streaming
      agent: processedMessage.role === 'assistant' ? 'claude' : undefined,
      metadata: {
        correlationId: processedMessage.conversationId as CorrelationId,
        sessionId: processedMessage.sessionId,
        hasTools: processedMessage.content.some((c) => c.type === 'tool_use'),
        hasImages: processedMessage.content.some((c) => c.type === 'image'),
        tokenUsage: processedMessage.usage
          ? {
              input: processedMessage.usage.input_tokens,
              output: processedMessage.usage.output_tokens,
              total: processedMessage.usage.input_tokens + processedMessage.usage.output_tokens,
            }
          : undefined,
      },
    };
  }

  /**
   * Convert StrictChatMessage to ProcessedClaudeMessage (reverse conversion)
   */
  convertToProcessedMessage(
    strictMessage: StrictChatMessage,
    sessionId: string,
  ): ProcessedClaudeMessage {
    return {
      messageId: strictMessage.id as MessageId,
      conversationId:
        strictMessage.metadata?.correlationId || (crypto.randomUUID() as CorrelationId),
      sessionId,
      role: strictMessage.type === 'user' ? 'user' : 'assistant',
      content: [
        {
          type: 'text',
          text: strictMessage.content,
        },
      ],
      timestamp: strictMessage.timestamp,
      model: 'claude-3-5-sonnet-20241022',
      stop_reason: strictMessage.type === 'assistant' ? 'end_turn' : null,
      stop_sequence: null,
      usage: strictMessage.metadata?.tokenUsage
        ? {
            input_tokens: strictMessage.metadata.tokenUsage.input,
            output_tokens: strictMessage.metadata.tokenUsage.output,
          }
        : undefined,
    };
  }

  /**
   * Validate message structure and content
   */
  validateMessage(message: unknown): message is StrictChatMessage {
    if (!message || typeof message !== 'object') {
      return false;
    }

    const msg = message as Partial<StrictChatMessage>;

    return !!(
      msg.id &&
      msg.type &&
      ['user', 'assistant', 'system'].includes(msg.type) &&
      msg.content &&
      typeof msg.content === 'string' &&
      typeof msg.timestamp === 'number'
    );
  }

  /**
   * Extract error information from failed message processing
   */
  extractErrorInfo(error: unknown): MessageError {
    if (error instanceof Error) {
      return {
        type: 'processing_error',
        message: error.message,
        timestamp: Date.now(),
        details: {
          stack: error.stack,
          name: error.name,
        },
      };
    }

    return {
      type: 'unknown_error',
      message: 'Unknown error occurred during message processing',
      timestamp: Date.now(),
      details: { originalError: String(error) },
    };
  }

  /**
   * Check if message contains streaming indicators
   */
  isStreamingMessage(message: ProcessedClaudeMessage): boolean {
    // Check for streaming indicators in the message structure
    return !!(
      message.stop_reason === null ||
      message.content.some((c) => c.type === 'text' && c.text?.endsWith('...'))
    );
  }

  /**
   * Merge streaming message chunks
   */
  mergeStreamingChunks(
    baseMessage: ProcessedClaudeMessage,
    newChunk: ProcessedClaudeMessage,
  ): ProcessedClaudeMessage {
    // Merge content arrays
    const mergedContent = [...baseMessage.content];

    newChunk.content.forEach((newContent) => {
      const existingIndex = mergedContent.findIndex(
        (existing) => existing.type === newContent.type,
      );

      if (existingIndex >= 0 && newContent.type === 'text') {
        // Merge text content
        const existing = mergedContent[existingIndex];
        if (existing.type === 'text' && newContent.type === 'text') {
          mergedContent[existingIndex] = {
            ...existing,
            text: (existing.text || '') + (newContent.text || ''),
          };
        }
      } else {
        // Add new content
        mergedContent.push(newContent);
      }
    });

    return {
      ...baseMessage,
      content: mergedContent,
      timestamp: newChunk.timestamp || baseMessage.timestamp,
      stop_reason: newChunk.stop_reason || baseMessage.stop_reason,
      stop_sequence: newChunk.stop_sequence || baseMessage.stop_sequence,
      usage: newChunk.usage || baseMessage.usage,
    };
  }

  // Private helper methods
  private mapRoleToMessageType(role: string): 'user' | 'assistant' | 'system' {
    switch (role) {
      case 'user':
        return 'user';
      case 'assistant':
        return 'assistant';
      case 'system':
        return 'system';
      default:
        return 'assistant';
    }
  }

  private extractTextContent(message: ProcessedClaudeMessage): string {
    return message.content
      .filter((c) => c.type === 'text')
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join(' ')
      .trim();
  }
}
