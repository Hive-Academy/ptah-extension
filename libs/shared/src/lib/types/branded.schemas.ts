/**
 * Zod schemas and schema-backed validators for the branded ID types.
 *
 * Split out of `branded.types.ts` so that the (very widely imported) branded
 * types and their smart constructors carry no `zod` dependency. Dependency
 * direction is one-way: schemas → types.
 */

import { z } from 'zod';

import { CorrelationId, MessageId, SessionId } from './branded.types';

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
    return result.data as SessionId;
  }

  static validateMessageId(data: unknown): MessageId {
    const result = MessageIdSchema.safeParse(data);
    if (!result.success) {
      throw new TypeError(`Invalid MessageId: ${JSON.stringify(data)}`);
    }
    return result.data as MessageId;
  }

  static validateCorrelationId(data: unknown): CorrelationId {
    const result = CorrelationIdSchema.safeParse(data);
    if (!result.success) {
      throw new TypeError(`Invalid CorrelationId: ${JSON.stringify(data)}`);
    }
    return result.data as CorrelationId;
  }
}
