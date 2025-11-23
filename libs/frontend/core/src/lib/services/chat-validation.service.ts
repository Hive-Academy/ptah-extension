import { Injectable } from '@angular/core';
import {
  StrictMessage,
  SessionId,
  MessageId,
  CorrelationId,
} from '@ptah-extension/shared';

/**
 * Validation result for chat operations
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Chat Validation Service - Message & Data Validation
 *
 * Pure validation logic with zero dependencies
 * Extracted from monolithic chat service for single responsibility
 *
 * Responsibilities:
 * - Validate incoming messages from backend
 * - Validate outgoing messages to backend
 * - Validate session data and state
 * - Validate Claude message structure
 * - Provide detailed validation feedback
 * - Sanitize message content for security
 *
 * Migration Notes:
 * - Migrated from: apps/ptah-extension-webview/src/app/core/services/chat/validation.service.ts
 * - Removed undefined MessageValidators (not yet implemented in shared lib)
 * - Pure validation logic - zero external dependencies
 * - Signal-based error reporting (future enhancement)
 */
@Injectable({
  providedIn: 'root',
})
export class ChatValidationService {
  /**
   * Validate strict message structure
   *
   * Ensures message conforms to StrictMessage interface
   */
  validateStrictMessage(message: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!message || typeof message !== 'object') {
      errors.push('Message must be an object');
      return { isValid: false, errors, warnings };
    }

    const msg = message as Record<string, unknown>;

    // Validate required fields
    if (!msg['type'] || typeof msg['type'] !== 'string') {
      errors.push('Message type is required and must be a string');
    }

    if (msg['payload'] === undefined) {
      errors.push('Message payload is required');
    }

    if (
      msg['timestamp'] !== undefined &&
      typeof msg['timestamp'] !== 'number'
    ) {
      errors.push('Message timestamp must be a number when present');
    }

    // Validate correlation ID if present
    if (
      msg['correlationId'] !== undefined &&
      typeof msg['correlationId'] !== 'string'
    ) {
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
   *
   * Validates message content, role, and metadata
   */
  validateChatMessage(data: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!data || typeof data !== 'object') {
      errors.push('Chat message data must be an object');
      return { isValid: false, errors, warnings };
    }

    const chatMsg = data as Record<string, unknown>;

    // Validate required fields
    if (!chatMsg['id'] || typeof chatMsg['id'] !== 'string') {
      errors.push('Message ID is required and must be a string');
    }

    if (!chatMsg['sessionId'] || typeof chatMsg['sessionId'] !== 'string') {
      errors.push('Session ID is required and must be a string');
    }

    if (
      !chatMsg['type'] ||
      !['user', 'assistant', 'system'].includes(chatMsg['type'] as string)
    ) {
      errors.push('Type is required and must be user, assistant, or system');
    }

    // Validate content based on type
    const msgType = chatMsg['type'] as string;
    if (msgType === 'user' || msgType === 'assistant') {
      // UPDATED: Accept contentBlocks: Array (NEW FORMAT - preferred)
      if (chatMsg['contentBlocks']) {
        // Validate contentBlocks structure
        if (!Array.isArray(chatMsg['contentBlocks'])) {
          errors.push('contentBlocks must be an array');
        } else if (chatMsg['contentBlocks'].length === 0) {
          warnings.push('contentBlocks array is empty');
        }
      }
      // DEPRECATED: Accept content: string (LEGACY FORMAT - for backward compatibility)
      else if (chatMsg['content']) {
        if (typeof chatMsg['content'] !== 'string') {
          errors.push('content must be a string (legacy format)');
        } else {
          // Add warnings for content issues
          warnings.push(
            ...this.getChatMessageContentWarnings(chatMsg['content'] as string)
          );
          warnings.push(
            'Using legacy content format - migrate to contentBlocks'
          );
        }
      }
      // NEITHER format present
      else {
        errors.push('Either contentBlocks or content is required');
      }
    }

    // Validate timestamps
    if (
      chatMsg['timestamp'] !== undefined &&
      typeof chatMsg['timestamp'] !== 'number'
    ) {
      warnings.push('Timestamp should be a number');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate session data
   *
   * Ensures session conforms to StrictChatSession interface
   */
  validateSession(session: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!session || typeof session !== 'object') {
      errors.push('Session must be an object');
      return { isValid: false, errors, warnings };
    }

    const sess = session as Record<string, unknown>;

    // Validate required fields
    if (!sess['id'] || typeof sess['id'] !== 'string') {
      errors.push('Session ID is required and must be a string');
    }

    if (!sess['name'] || typeof sess['name'] !== 'string') {
      errors.push('Session name is required and must be a string');
    }

    if (typeof sess['createdAt'] !== 'number') {
      errors.push('Session createdAt is required and must be a number');
    }

    // Validate optional fields
    if (
      sess['lastActiveAt'] !== undefined &&
      typeof sess['lastActiveAt'] !== 'number'
    ) {
      warnings.push('Session lastActiveAt should be a number');
    }

    if (sess['tokenUsage'] && !this.validateTokenUsage(sess['tokenUsage'])) {
      warnings.push('Session tokenUsage has invalid structure');
    }

    // Validate messages array if present
    if (sess['messages'] !== undefined && !Array.isArray(sess['messages'])) {
      errors.push('Session messages must be an array');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate processed Claude message
   *
   * Validates Claude API response structure
   */
  validateProcessedClaudeMessage(message: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!message || typeof message !== 'object') {
      errors.push('Message must be an object');
      return { isValid: false, errors, warnings };
    }

    const msg = message as Record<string, unknown>;

    // Validate required fields
    if (!msg['id'] || typeof msg['id'] !== 'string') {
      errors.push('Message ID is required and must be a string');
    }

    if (!msg['sessionId'] || typeof msg['sessionId'] !== 'string') {
      errors.push('Session ID is required and must be a string');
    }

    if (
      !msg['type'] ||
      !['user', 'assistant', 'system'].includes(msg['type'] as string)
    ) {
      errors.push('Type is required and must be user, assistant, or system');
    }

    if (!msg['content'] || typeof msg['content'] !== 'string') {
      errors.push('Content is required and must be a string');
    }

    // Validate optional fields
    if (
      msg['timestamp'] !== undefined &&
      typeof msg['timestamp'] !== 'number'
    ) {
      warnings.push('Timestamp should be a number');
    }

    if (msg['metadata'] !== undefined && typeof msg['metadata'] !== 'object') {
      warnings.push('Metadata should be an object');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Check if message is chat-related
   *
   * @param msg - Message to check
   * @returns True if message type starts with 'chat:' or 'claude:'
   */
  isChatMessage(msg: StrictMessage): boolean {
    return msg.type.startsWith('chat:') || msg.type.startsWith('claude:');
  }

  /**
   * Check if message is session-related
   *
   * @param msg - Message to check
   * @returns True if message type contains 'session' or 'Session'
   */
  isSessionMessage(msg: StrictMessage): boolean {
    return msg.type.includes('session') || msg.type.includes('Session');
  }

  /**
   * Validate message classification
   *
   * Ensures message type matches expected type
   */
  validateMessageClassification(
    msg: StrictMessage,
    expectedType: string
  ): ValidationResult {
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
   *
   * Prevents XSS attacks by removing potentially dangerous HTML/JS
   *
   * @param content - Raw message content
   * @returns Sanitized content safe for display
   */
  sanitizeMessageContent(content: string): string {
    // Basic XSS prevention
    return content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove <script> tags
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, '') // Remove inline event handlers (onclick, onload, etc.)
      .trim();
  }

  /**
   * Validate session ID format
   *
   * Session IDs must be non-empty alphanumeric strings with hyphens/underscores
   */
  validateSessionId(sessionId: unknown): sessionId is SessionId {
    return (
      typeof sessionId === 'string' &&
      sessionId.length > 0 &&
      /^[a-zA-Z0-9_-]+$/.test(sessionId)
    );
  }

  /**
   * Validate message ID format
   *
   * Message IDs must be non-empty alphanumeric strings with hyphens/underscores
   */
  validateMessageId(messageId: unknown): messageId is MessageId {
    return (
      typeof messageId === 'string' &&
      messageId.length > 0 &&
      /^[a-zA-Z0-9_-]+$/.test(messageId)
    );
  }

  /**
   * Validate correlation ID format
   *
   * Correlation IDs must be non-empty alphanumeric strings with hyphens/underscores
   */
  validateCorrelationId(
    correlationId: unknown
  ): correlationId is CorrelationId {
    return (
      typeof correlationId === 'string' &&
      correlationId.length > 0 &&
      /^[a-zA-Z0-9_-]+$/.test(correlationId)
    );
  }

  // Private helper methods

  /**
   * Get warnings for chat message content
   */
  private getChatMessageContentWarnings(content: string): string[] {
    const warnings: string[] = [];

    // Check for empty content
    if (!content || content.trim().length === 0) {
      warnings.push('Message content is empty');
    }

    // Check for excessively long content
    if (content && content.length > 10000) {
      warnings.push('Message content is very long (>10k characters)');
    }

    // Check for potential security issues
    if (content && /<script|javascript:|on\w+=/i.test(content)) {
      warnings.push('Message content contains potentially unsafe HTML/JS');
    }

    return warnings;
  }

  /**
   * Validate token usage structure
   */
  private validateTokenUsage(tokenUsage: unknown): boolean {
    if (!tokenUsage || typeof tokenUsage !== 'object') {
      return false;
    }

    const usage = tokenUsage as Record<string, unknown>;

    return (
      typeof usage['input'] === 'number' &&
      typeof usage['output'] === 'number' &&
      typeof usage['total'] === 'number' &&
      (usage['input'] as number) >= 0 &&
      (usage['output'] as number) >= 0 &&
      (usage['total'] as number) >= 0
    );
  }
}
