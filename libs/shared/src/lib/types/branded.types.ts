/**
 * Branded Types for Type Safety - Prevents accidental ID mixing
 * Based on architectural analysis lines 540-564
 * Ensures SessionId, MessageId, and CorrelationId cannot be accidentally swapped
 */

import { v4 as uuidv4 } from 'uuid';
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
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/**
 * ULID validation regex — Crockford base32, 26 characters.
 * Excludes I, L, O, U to avoid ambiguity (per the spec).
 */
const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

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
   * Validate if a string is a valid SessionId format.
   *
   * Accepts `undefined` because absence of a session is a modelled state — a
   * caller asking "is this a valid id" should not have to answer "do I even
   * have one" first. `undefined` is not a valid SessionId, so it returns
   * `false`.
   *
   * `''` is still rejected, and deliberately so: widening the parameter to
   * `string | undefined` does NOT make `''` unrepresentable — `''` is a
   * `string`. Guards elsewhere that reject a blank session id remain
   * load-bearing.
   */
  validate(id: string | undefined): id is SessionId {
    return id !== undefined && UUID_REGEX.test(id);
  },

  /**
   * Convert string to SessionId with validation
   *
   * Deliberately NOT widened to `string | undefined`: this throws by contract,
   * and every caller passes an id it already knows it has. Widening would
   * invite `SessionId.from(undefined)` at sites the compiler checks today.
   *
   * @throws TypeError if invalid format
   */
  from(id: string): SessionId {
    if (!SessionId.validate(id)) {
      throw new TypeError(`Invalid SessionId format: ${id}`);
    }
    return id as SessionId;
  },

  /**
   * Safely convert string to SessionId, returns null if invalid.
   *
   * Accepts `undefined` (returns `null`) so callers need no `x ? parse(x) :
   * null` ternary around the one function whose job is to answer the question.
   *
   * **The widening asymmetry is deliberate — do not "restore consistency".**
   * `SessionId` is the one brand whose *absence* is a modelled state: after
   * TASK_2026_295 Wave 2, "no session yet" travels as `undefined` on wire
   * types rather than as an invented `''`, so possibly-absent ids reach
   * `validate` / `safeParse` on the normal path. The sibling brands —
   * `MessageId`, `CorrelationId`, `TabId`, `JobId`, `RunId` — have no caller
   * that passes them a possibly-undefined value, so their `validate` /
   * `safeParse` stay on a required `string`. Widening those five would be
   * churn against zero evidence.
   */
  safeParse(id: string | undefined): SessionId | null {
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
