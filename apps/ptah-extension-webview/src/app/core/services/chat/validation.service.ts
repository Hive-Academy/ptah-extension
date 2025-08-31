import { Injectable } from '@angular/core';
import {
  StrictMessage,
  StrictChatMessage,
  StrictChatSession,
  ProcessedClaudeMessage,
  SessionId,
  MessageId,
  CorrelationId,
} from '@ptah-extension/shared';
import {
  StrictChatMessageSchema,
  StrictChatSessionSchema,
  ChatSendMessagePayloadSchema,
  ChatMessageChunkPayloadSchema,
} from '@ptah-extension/shared';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Chat Validation Service - Message & Data Validation
 *
 * Responsibilities:
 * - Validate incoming messages from backend
 * - Validate outgoing messages to backend
 * - Validate session data and state
 * - Validate Claude message structure
 * - Provide detailed validation feedback
 *
 * Extracted from EnhancedChatService for single responsibility
 */
@Injectable({
  providedIn: 'root',
})
export class ChatValidationService {
  /**
   * Validate strict message structure
   */
  validateStrictMessage(message: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!message || typeof message !== 'object') {
      errors.push('Message must be an object');
      return { isValid: false, errors, warnings };
    }

    const msg = message as Partial<StrictMessage>;

    // Validate required fields
    if (!msg.type || typeof msg.type !== 'string') {
      errors.push('Message type is required and must be a string');
    }

    if (!msg.data) {
      errors.push('Message data is required');
    }

    if (typeof msg.timestamp !== 'number') {
      errors.push('Message timestamp is required and must be a number');
    }

    // Validate correlation ID if present
    if (msg.correlationId && typeof msg.correlationId !== 'string') {
      warnings.push('Correlation ID should be a string');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate chat message payload
   */
  validateChatMessage(data: unknown): ValidationResult {
    try {
      const result = MessageValidators.chatMessage.safeParse(data);

      if (result.success) {
        return {
          isValid: true,
          errors: [],
          warnings: this.getChatMessageWarnings(result.data),
        };
      } else {
        return {
          isValid: false,
          errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
          warnings: [],
        };
      }
    } catch (error) {
      return {
        isValid: false,
        errors: [`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
        warnings: [],
      };
    }
  }

  /**
   * Validate session data
   */
  validateSession(session: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!session || typeof session !== 'object') {
      errors.push('Session must be an object');
      return { isValid: false, errors, warnings };
    }

    const sess = session as Partial<StrictChatSession>;

    // Validate required fields
    if (!sess.id || typeof sess.id !== 'string') {
      errors.push('Session ID is required and must be a string');
    }

    if (!sess.name || typeof sess.name !== 'string') {
      errors.push('Session name is required and must be a string');
    }

    if (typeof sess.createdAt !== 'number') {
      errors.push('Session createdAt is required and must be a number');
    }

    // Validate optional fields
    if (sess.lastActivity && typeof sess.lastActivity !== 'number') {
      warnings.push('Session lastActivity should be a number');
    }

    if (sess.tokenUsage && !this.validateTokenUsage(sess.tokenUsage)) {
      warnings.push('Session tokenUsage has invalid structure');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate processed Claude message
   */
  validateProcessedClaudeMessage(message: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!message || typeof message !== 'object') {
      errors.push('Message must be an object');
      return { isValid: false, errors, warnings };
    }

    const msg = message as Partial<ProcessedClaudeMessage>;

    // Validate required fields
    if (!msg.messageId || typeof msg.messageId !== 'string') {
      errors.push('Message ID is required and must be a string');
    }

    if (!msg.conversationId || typeof msg.conversationId !== 'string') {
      errors.push('Conversation ID is required and must be a string');
    }

    if (!msg.role || !['user', 'assistant', 'system'].includes(msg.role)) {
      errors.push('Role is required and must be user, assistant, or system');
    }

    if (!Array.isArray(msg.content)) {
      errors.push('Content must be an array');
    } else {
      // Validate content array
      msg.content.forEach((content, index) => {
        if (!content || typeof content !== 'object') {
          errors.push(`Content[${index}] must be an object`);
        } else if (!content.type) {
          errors.push(`Content[${index}] must have a type`);
        }
      });
    }

    // Validate optional fields
    if (msg.timestamp && typeof msg.timestamp !== 'number') {
      warnings.push('Timestamp should be a number');
    }

    if (msg.model && typeof msg.model !== 'string') {
      warnings.push('Model should be a string');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Check if message is a chat-related message
   */
  isChatMessage(msg: StrictMessage): boolean {
    return msg.type.startsWith('chat:') || msg.type.startsWith('claude:');
  }

  /**
   * Check if message is a session-related message
   */
  isSessionMessage(msg: StrictMessage): boolean {
    return msg.type.includes('session') || msg.type.includes('Session');
  }


  /**
   * Validate message classification
   */
  validateMessageClassification(msg: StrictMessage, expectedType: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (msg.type !== expectedType) {
      errors.push(`Expected message type '${expectedType}', got '${msg.type}'`);
    }

    // Check if message was incorrectly classified
    if (msg.type.includes('unknown') || msg.type.includes('unclassified')) {
      warnings.push('Message may have been incorrectly classified');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Sanitize message content for security
   */
  sanitizeMessageContent(content: string): string {
    // Basic XSS prevention
    return content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .trim();
  }

  /**
   * Validate session ID format
   */
  validateSessionId(sessionId: unknown): sessionId is SessionId {
    return (
      typeof sessionId === 'string' && sessionId.length > 0 && /^[a-zA-Z0-9_-]+$/.test(sessionId)
    );
  }

  /**
   * Validate message ID format
   */
  validateMessageId(messageId: unknown): messageId is MessageId {
    return (
      typeof messageId === 'string' && messageId.length > 0 && /^[a-zA-Z0-9_-]+$/.test(messageId)
    );
  }

  /**
   * Validate correlation ID format
   */
  validateCorrelationId(correlationId: unknown): correlationId is CorrelationId {
    return (
      typeof correlationId === 'string' &&
      correlationId.length > 0 &&
      /^[a-zA-Z0-9_-]+$/.test(correlationId)
    );
  }

  // Private helper methods
  private getChatMessageWarnings(data: ChatMessagePayloadType): string[] {
    const warnings: string[] = [];

    // Check for empty content
    if (!data.content || data.content.trim().length === 0) {
      warnings.push('Message content is empty');
    }

    // Check for excessively long content
    if (data.content && data.content.length > 10000) {
      warnings.push('Message content is very long (>10k characters)');
    }

    // Check for agent type
    if (data.agent && !['general', 'code', 'architect', 'researcher'].includes(data.agent)) {
      warnings.push(`Unknown agent type: ${data.agent}`);
    }

    return warnings;
  }

  private validateTokenUsage(tokenUsage: any): boolean {
    if (!tokenUsage || typeof tokenUsage !== 'object') {
      return false;
    }

    return (
      typeof tokenUsage.input === 'number' &&
      typeof tokenUsage.output === 'number' &&
      typeof tokenUsage.total === 'number' &&
      tokenUsage.input >= 0 &&
      tokenUsage.output >= 0 &&
      tokenUsage.total >= 0
    );
  }
}
