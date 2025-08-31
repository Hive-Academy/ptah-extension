/**
 * Branded Types for Type Safety - Prevents accidental ID mixing
 * Based on architectural analysis lines 540-564
 * Ensures SessionId, MessageId, and CorrelationId cannot be accidentally swapped
 */

import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

// Brand types to make types distinct at compile time
// Using string literals instead of unique symbols for library compatibility
/**
 * Branded SessionId type - prevents mixing with other string IDs
 */
export type SessionId = string & { readonly __brand: 'SessionId' };

/**
 * Branded MessageId type - prevents mixing with other string IDs
 */
export type MessageId = string & { readonly __brand: 'MessageId' };

/**
 * Branded CorrelationId type - prevents mixing with other string IDs
 */
export type CorrelationId = string & { readonly __brand: 'CorrelationId' };

// UUID validation regex for branded type validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * SessionId smart constructors with validation
 */
export const SessionId = {
  /**
   * Create a new SessionId with UUID v4
   */
  create(): SessionId {
    return uuidv4() as SessionId;
  },

  /**
   * Validate if a string is a valid SessionId format
   */
  validate(id: string): id is SessionId {
    return UUID_REGEX.test(id);
  },

  /**
   * Convert string to SessionId with validation
   * @throws TypeError if invalid format
   */
  from(id: string): SessionId {
    if (!SessionId.validate(id)) {
      throw new TypeError(`Invalid SessionId format: ${id}`);
    }
    return id as SessionId;
  },

  /**
   * Safely convert string to SessionId, returns null if invalid
   */
  safeParse(id: string): SessionId | null {
    return SessionId.validate(id) ? (id as SessionId) : null;
  },
};

/**
 * MessageId smart constructors with validation
 */
export const MessageId = {
  /**
   * Create a new MessageId with UUID v4
   */
  create(): MessageId {
    return uuidv4() as MessageId;
  },

  /**
   * Validate if a string is a valid MessageId format
   */
  validate(id: string): id is MessageId {
    return UUID_REGEX.test(id);
  },

  /**
   * Convert string to MessageId with validation
   * @throws TypeError if invalid format
   */
  from(id: string): MessageId {
    if (!MessageId.validate(id)) {
      throw new TypeError(`Invalid MessageId format: ${id}`);
    }
    return id as MessageId;
  },

  /**
   * Safely convert string to MessageId, returns null if invalid
   */
  safeParse(id: string): MessageId | null {
    return MessageId.validate(id) ? (id as MessageId) : null;
  },
};

/**
 * CorrelationId smart constructors with validation
 */
export const CorrelationId = {
  /**
   * Create a new CorrelationId with UUID v4
   */
  create(): CorrelationId {
    return uuidv4() as CorrelationId;
  },

  /**
   * Validate if a string is a valid CorrelationId format
   */
  validate(id: string): id is CorrelationId {
    return UUID_REGEX.test(id);
  },

  /**
   * Convert string to CorrelationId with validation
   * @throws TypeError if invalid format
   */
  from(id: string): CorrelationId {
    if (!CorrelationId.validate(id)) {
      throw new TypeError(`Invalid CorrelationId format: ${id}`);
    }
    return id as CorrelationId;
  },

  /**
   * Safely convert string to CorrelationId, returns null if invalid
   */
  safeParse(id: string): CorrelationId | null {
    return CorrelationId.validate(id) ? (id as CorrelationId) : null;
  },
};

/**
 * Zod schemas for runtime validation of branded types
 */
export const SessionIdSchema = z
  .string()
  .uuid()
  .refine((id): id is SessionId => SessionId.validate(id), {
    message: 'Invalid SessionId format',
  });

export const MessageIdSchema = z
  .string()
  .uuid()
  .refine((id): id is MessageId => MessageId.validate(id), {
    message: 'Invalid MessageId format',
  });

export const CorrelationIdSchema = z
  .string()
  .uuid()
  .refine((id): id is CorrelationId => CorrelationId.validate(id), {
    message: 'Invalid CorrelationId format',
  });

/**
 * Runtime validation functions for branded types
 */
export class BrandedTypeValidator {
  static validateSessionId(data: unknown): SessionId {
    const result = SessionIdSchema.safeParse(data);
    if (!result.success) {
      throw new TypeError(`Invalid SessionId: ${JSON.stringify(data)}`);
    }
    return result.data;
  }

  static validateMessageId(data: unknown): MessageId {
    const result = MessageIdSchema.safeParse(data);
    if (!result.success) {
      throw new TypeError(`Invalid MessageId: ${JSON.stringify(data)}`);
    }
    return result.data;
  }

  static validateCorrelationId(data: unknown): CorrelationId {
    const result = CorrelationIdSchema.safeParse(data);
    if (!result.success) {
      throw new TypeError(`Invalid CorrelationId: ${JSON.stringify(data)}`);
    }
    return result.data;
  }
}
