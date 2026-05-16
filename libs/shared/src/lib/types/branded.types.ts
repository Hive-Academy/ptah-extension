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

/**
 * Branded TabId type — identifies a frontend VS Code tab.
 * Prevents accidental mixing with SessionId (real SDK UUID) or other IDs.
 */
export type TabId = string & { readonly __brand: 'TabId' };

// === TRACK_3_CRON_SCHEDULER_BEGIN ===
/**
 * Branded JobId type — identifies a scheduled cron job row.
 * Backed by ULID (Crockford base32, 26 chars) per architecture §8.5.
 */
export type JobId = string & { readonly __brand: 'JobId' };

/**
 * Branded RunId type — identifies a single execution slot in `job_runs`.
 * Also ULID-backed.
 */
export type RunId = string & { readonly __brand: 'RunId' };
// === TRACK_3_CRON_SCHEDULER_END ===

// UUID validation regex for branded type validation.
// Exported so validation schemas (e.g. permission.types.ts) can re-use it
// without duplicating the pattern.
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// === TRACK_3_CRON_SCHEDULER_BEGIN ===
/**
 * ULID validation regex — Crockford base32, 26 characters.
 * Excludes I, L, O, U to avoid ambiguity (per the spec).
 */
const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;
// === TRACK_3_CRON_SCHEDULER_END ===

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
 * TabId smart constructors with validation
 */
export const TabId = {
  /**
   * Create a new TabId with UUID v4
   */
  create(): TabId {
    return uuidv4() as TabId;
  },

  /**
   * Validate if a string is a valid TabId format
   */
  validate(id: string): id is TabId {
    return UUID_REGEX.test(id);
  },

  /**
   * Convert string to TabId with validation
   * @throws TypeError if invalid format
   */
  from(id: string): TabId {
    if (!TabId.validate(id)) {
      throw new TypeError(`Invalid TabId format: ${id}`);
    }
    return id as TabId;
  },

  /**
   * Safely convert string to TabId, returns null if invalid
   */
  safeParse(id: string): TabId | null {
    return TabId.validate(id) ? (id as TabId) : null;
  },
};

// === TRACK_3_CRON_SCHEDULER_BEGIN ===
/**
 * JobId smart constructors with validation.
 * Note: callers (cron-scheduler/JobStore) generate ULIDs via the `ulid`
 * package and pass them through `from()` rather than asking us to mint one,
 * so we avoid pulling `ulid` into shared.
 */
export const JobId = {
  /**
   * Validate the runtime string shape (ULID 26 chars, Crockford base32).
   */
  validate(id: string): id is JobId {
    return ULID_REGEX.test(id);
  },
  /**
   * Convert string to JobId with validation.
   * @throws TypeError if invalid format
   */
  from(id: string): JobId {
    if (!JobId.validate(id)) {
      throw new TypeError(`Invalid JobId format (expected ULID): ${id}`);
    }
    return id as JobId;
  },
  /** Returns null instead of throwing on invalid input. */
  safeParse(id: string): JobId | null {
    return JobId.validate(id) ? (id as JobId) : null;
  },
};

/**
 * RunId smart constructors with validation. Same shape as JobId
 * (ULID 26 chars, Crockford base32) — distinct brand for type safety.
 */
export const RunId = {
  validate(id: string): id is RunId {
    return ULID_REGEX.test(id);
  },
  from(id: string): RunId {
    if (!RunId.validate(id)) {
      throw new TypeError(`Invalid RunId format (expected ULID): ${id}`);
    }
    return id as RunId;
  },
  safeParse(id: string): RunId | null {
    return RunId.validate(id) ? (id as RunId) : null;
  },
};
// === TRACK_3_CRON_SCHEDULER_END ===

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

/**
 * Branded HarnessStreamId — identifies a streaming pipeline for the harness
 * builder. Deliberately NON-UUID: format is `harness-${operationId}` where
 * operationId is a caller-supplied string. Distinct brand so consumers that
 * validate SessionId as UUID never accidentally receive this synthetic id.
 */
export type HarnessStreamId = string & { readonly __brand: 'HarnessStreamId' };

export const HarnessStreamId = {
  /** Construct from an operationId. Does NOT validate UUID — by design. */
  from(operationId: string): HarnessStreamId {
    if (!operationId || operationId.trim().length === 0) {
      throw new TypeError('HarnessStreamId: operationId required');
    }
    return `harness-${operationId}` as HarnessStreamId;
  },
  validate(id: string): id is HarnessStreamId {
    return /^harness-.+$/.test(id);
  },
};

/**
 * Branded WizardPhaseId — identifies a setup-wizard analysis phase or content-
 * generation agent. Deliberately NON-UUID: format is `wizard-${phaseId}` or
 * `gen-${agentId}`. Distinct brand to prevent leakage into UUID-validating
 * SessionId consumers.
 */
export type WizardPhaseId = string & { readonly __brand: 'WizardPhaseId' };

export const WizardPhaseId = {
  fromPhase(phaseId: string): WizardPhaseId {
    if (!phaseId || phaseId.trim().length === 0) {
      throw new TypeError('WizardPhaseId: phaseId required');
    }
    return `wizard-${phaseId}` as WizardPhaseId;
  },
  fromAgent(agentId: string | undefined): WizardPhaseId {
    return `gen-${agentId ?? 'unknown'}` as WizardPhaseId;
  },
  validate(id: string): id is WizardPhaseId {
    return /^(wizard|gen)-.+$/.test(id);
  },
};
