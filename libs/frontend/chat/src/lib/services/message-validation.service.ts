/**
 * MessageValidationService - Centralized Message Content Validation
 *
 * Provides consistent validation rules across all message sending paths.
 * Eliminates duplicate validation logic in MessageSenderService and ConversationService.
 *
 * Responsibilities:
 * - Validate message content (null, type, whitespace, length, meaningful content)
 * - Sanitize message content (trim whitespace)
 * - Return clear error messages for validation failures
 *
 * Benefits:
 * - Centralized validation rules (single source of truth)
 * - Consistent error messages across all paths
 * - Prevents token waste (empty content, max length)
 * - Easy to extend (add new rules in one place)
 *
 * Created in ChatStore refactoring (TASK_2025_054) - Batch 5
 */

import { Injectable } from '@angular/core';

/**
 * Result of message validation
 * Contains success flag and optional reason for failure
 */
export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Centralized message validation service
 *
 * Applies 5 validation rules to ensure message quality:
 * 1. Null/undefined check
 * 2. Type check (must be string)
 * 3. Whitespace-only check
 * 4. Maximum length check (100,000 characters)
 * 5. Minimum meaningful content (alphanumeric required)
 */
@Injectable({ providedIn: 'root' })
export class MessageValidationService {
  /**
   * Maximum allowed message length (100,000 characters)
   * Prevents token waste and API errors
   */
  private readonly MAX_LENGTH = 100000;

  /**
   * Validate message content
   *
   * Applies 5 validation rules:
   * 1. Null/undefined - Content must exist
   * 2. Type check - Content must be string
   * 3. Whitespace-only - Content must contain non-whitespace
   * 4. Maximum length - Content must not exceed 100k chars
   * 5. Alphanumeric - Content must contain at least one letter or number
   *
   * @param content - Content to validate (unknown type for safety)
   * @returns ValidationResult with success flag and optional error reason
   *
   * @example
   * ```typescript
   * const result = validator.validate('Hello world');
   * if (!result.valid) {
   *   console.warn(`Invalid message: ${result.reason}`);
   * }
   * ```
   */
  validate(content: unknown): ValidationResult {
    // Rule 1: Null/undefined check
    if (content === null || content === undefined) {
      return {
        valid: false,
        reason: 'Message content is null or undefined',
      };
    }

    // Rule 2: Type check (must be string)
    if (typeof content !== 'string') {
      return {
        valid: false,
        reason: `Message content must be a string, received ${typeof content}`,
      };
    }

    // Rule 3: Whitespace-only check
    const trimmed = content.trim();
    if (trimmed === '') {
      return {
        valid: false,
        reason: 'Message content is empty or contains only whitespace',
      };
    }

    // Rule 4: Maximum length check (prevent token waste)
    if (content.length > this.MAX_LENGTH) {
      return {
        valid: false,
        reason: `Message content exceeds maximum length of ${this.MAX_LENGTH} characters (received ${content.length})`,
      };
    }

    // Rule 5: Minimum meaningful content (alphanumeric required)
    // Ensures message contains at least one letter or number in ANY language
    // Prevents purely punctuation-based messages
    // Uses Unicode property escapes to support ALL languages (Chinese, Arabic, Japanese, etc.)
    if (!/[\p{L}\p{N}]/u.test(content)) {
      return {
        valid: false,
        reason: 'Message content must contain at least one letter or number',
      };
    }

    // All rules passed
    return { valid: true };
  }

  /**
   * Sanitize message content
   *
   * Removes leading and trailing whitespace.
   * Should be called after validation passes.
   *
   * @param content - Content to sanitize
   * @returns Sanitized content (trimmed)
   *
   * @example
   * ```typescript
   * const sanitized = validator.sanitize('  Hello world  ');
   * // Returns: 'Hello world'
   * ```
   */
  sanitize(content: string): string {
    return content.trim();
  }
}
