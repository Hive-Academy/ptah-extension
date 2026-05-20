/**
 * Unit tests for branded.types.ts
 *
 * Covers:
 *   - SessionId, MessageId, CorrelationId, TabId (UUID v4 backed)
 *   - JobId, RunId (ULID backed)
 *   - SessionIdSchema, MessageIdSchema, CorrelationIdSchema (Zod)
 *   - BrandedTypeValidator static methods
 *   - Cross-format rejection: UUID types reject ULIDs; ULID types reject UUIDs
 */

import {
  SessionId,
  MessageId,
  CorrelationId,
  TabId,
  JobId,
  RunId,
  HarnessStreamId,
  WizardPhaseId,
  SessionIdSchema,
  MessageIdSchema,
  CorrelationIdSchema,
  BrandedTypeValidator,
} from './branded.types';

// Fixed fixtures so tests are deterministic
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID2 = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
// Valid ULID: 26 chars, Crockford base32 (no I, L, O, U)
const VALID_ULID = '01HV4KP9C7N3X5JTGQ2B8DZRMW';
const VALID_ULID2 = '01HWKZM5B0R8TAECFVGX3NJ7PY';

const INVALID_INPUTS = ['', 'not-an-id', 'abc', '1234', 'null'];

// ---------------------------------------------------------------------------
// SessionId
// ---------------------------------------------------------------------------
describe('SessionId', () => {
  describe('create()', () => {
    it('returns a string that passes validate()', () => {
      const id = SessionId.create();
      expect(SessionId.validate(id)).toBe(true);
    });

    it('returns different values on successive calls', () => {
      expect(SessionId.create()).not.toBe(SessionId.create());
    });
  });

  describe('validate()', () => {
    it('accepts a valid UUID v4', () => {
      expect(SessionId.validate(VALID_UUID)).toBe(true);
    });

    it('rejects empty string', () => {
      expect(SessionId.validate('')).toBe(false);
    });

    it('rejects a ULID', () => {
      expect(SessionId.validate(VALID_ULID)).toBe(false);
    });

    it.each(INVALID_INPUTS)('rejects %s', (bad) => {
      expect(SessionId.validate(bad)).toBe(false);
    });
  });

  describe('from()', () => {
    it('returns the branded value for a valid UUID', () => {
      const id = SessionId.from(VALID_UUID);
      expect(id).toBe(VALID_UUID);
    });

    it('throws TypeError for invalid input', () => {
      expect(() => SessionId.from('bad-input')).toThrow(TypeError);
    });

    it('error message includes the bad value', () => {
      expect(() => SessionId.from('bad-input')).toThrow('bad-input');
    });

    it('throws for a ULID', () => {
      expect(() => SessionId.from(VALID_ULID)).toThrow(TypeError);
    });
  });

  describe('safeParse()', () => {
    it('returns the value for a valid UUID', () => {
      expect(SessionId.safeParse(VALID_UUID)).toBe(VALID_UUID);
    });

    it('returns null for invalid input', () => {
      expect(SessionId.safeParse('garbage')).toBeNull();
    });

    it('returns null for a ULID', () => {
      expect(SessionId.safeParse(VALID_ULID)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// MessageId
// ---------------------------------------------------------------------------
describe('MessageId', () => {
  describe('create()', () => {
    it('returns a string that passes validate()', () => {
      const id = MessageId.create();
      expect(MessageId.validate(id)).toBe(true);
    });
  });

  describe('validate()', () => {
    it('accepts a valid UUID v4', () => {
      expect(MessageId.validate(VALID_UUID)).toBe(true);
    });

    it('rejects a ULID', () => {
      expect(MessageId.validate(VALID_ULID)).toBe(false);
    });

    it.each(INVALID_INPUTS)('rejects %s', (bad) => {
      expect(MessageId.validate(bad)).toBe(false);
    });
  });

  describe('from()', () => {
    it('returns the branded value for a valid UUID', () => {
      expect(MessageId.from(VALID_UUID)).toBe(VALID_UUID);
    });

    it('throws TypeError for invalid input', () => {
      expect(() => MessageId.from('bad')).toThrow(TypeError);
    });

    it('throws for a ULID', () => {
      expect(() => MessageId.from(VALID_ULID)).toThrow(TypeError);
    });
  });

  describe('safeParse()', () => {
    it('returns the value for a valid UUID', () => {
      expect(MessageId.safeParse(VALID_UUID)).toBe(VALID_UUID);
    });

    it('returns null for invalid input', () => {
      expect(MessageId.safeParse('')).toBeNull();
    });

    it('returns null for a ULID', () => {
      expect(MessageId.safeParse(VALID_ULID)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// CorrelationId
// ---------------------------------------------------------------------------
describe('CorrelationId', () => {
  describe('create()', () => {
    it('returns a string that passes validate()', () => {
      const id = CorrelationId.create();
      expect(CorrelationId.validate(id)).toBe(true);
    });
  });

  describe('validate()', () => {
    it('accepts a valid UUID v4', () => {
      expect(CorrelationId.validate(VALID_UUID)).toBe(true);
    });

    it('rejects a ULID', () => {
      expect(CorrelationId.validate(VALID_ULID)).toBe(false);
    });

    it.each(INVALID_INPUTS)('rejects %s', (bad) => {
      expect(CorrelationId.validate(bad)).toBe(false);
    });
  });

  describe('from()', () => {
    it('returns the branded value for a valid UUID', () => {
      expect(CorrelationId.from(VALID_UUID)).toBe(VALID_UUID);
    });

    it('throws TypeError for invalid input', () => {
      expect(() => CorrelationId.from('bad')).toThrow(TypeError);
    });

    it('throws for a ULID', () => {
      expect(() => CorrelationId.from(VALID_ULID)).toThrow(TypeError);
    });
  });

  describe('safeParse()', () => {
    it('returns the value for a valid UUID', () => {
      expect(CorrelationId.safeParse(VALID_UUID)).toBe(VALID_UUID);
    });

    it('returns null for invalid input', () => {
      expect(CorrelationId.safeParse('')).toBeNull();
    });

    it('returns null for a ULID', () => {
      expect(CorrelationId.safeParse(VALID_ULID)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// TabId
// ---------------------------------------------------------------------------
describe('TabId', () => {
  describe('create()', () => {
    it('returns a string that passes validate()', () => {
      const id = TabId.create();
      expect(TabId.validate(id)).toBe(true);
    });
  });

  describe('validate()', () => {
    it('accepts a valid UUID v4', () => {
      expect(TabId.validate(VALID_UUID)).toBe(true);
    });

    it('rejects a ULID', () => {
      expect(TabId.validate(VALID_ULID)).toBe(false);
    });

    it.each(INVALID_INPUTS)('rejects %s', (bad) => {
      expect(TabId.validate(bad)).toBe(false);
    });
  });

  describe('from()', () => {
    it('returns the branded value for a valid UUID', () => {
      expect(TabId.from(VALID_UUID)).toBe(VALID_UUID);
    });

    it('throws TypeError for invalid input', () => {
      expect(() => TabId.from('bad')).toThrow(TypeError);
    });

    it('throws for a ULID', () => {
      expect(() => TabId.from(VALID_ULID)).toThrow(TypeError);
    });
  });

  describe('safeParse()', () => {
    it('returns the value for a valid UUID', () => {
      expect(TabId.safeParse(VALID_UUID)).toBe(VALID_UUID);
    });

    it('returns null for invalid input', () => {
      expect(TabId.safeParse('')).toBeNull();
    });

    it('returns null for a ULID', () => {
      expect(TabId.safeParse(VALID_ULID)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// JobId (ULID backed)
// ---------------------------------------------------------------------------
describe('JobId', () => {
  describe('validate()', () => {
    it('accepts a valid ULID', () => {
      expect(JobId.validate(VALID_ULID)).toBe(true);
    });

    it('accepts a second valid ULID', () => {
      expect(JobId.validate(VALID_ULID2)).toBe(true);
    });

    it('rejects a UUID', () => {
      expect(JobId.validate(VALID_UUID)).toBe(false);
    });

    it.each(INVALID_INPUTS)('rejects %s', (bad) => {
      expect(JobId.validate(bad)).toBe(false);
    });
  });

  describe('from()', () => {
    it('returns the branded value for a valid ULID', () => {
      expect(JobId.from(VALID_ULID)).toBe(VALID_ULID);
    });

    it('throws TypeError for a UUID', () => {
      expect(() => JobId.from(VALID_UUID)).toThrow(TypeError);
    });

    it('error message mentions ULID', () => {
      expect(() => JobId.from('bad')).toThrow('ULID');
    });
  });

  describe('safeParse()', () => {
    it('returns the value for a valid ULID', () => {
      expect(JobId.safeParse(VALID_ULID)).toBe(VALID_ULID);
    });

    it('returns null for a UUID', () => {
      expect(JobId.safeParse(VALID_UUID)).toBeNull();
    });

    it('returns null for invalid input', () => {
      expect(JobId.safeParse('')).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// RunId (ULID backed)
// ---------------------------------------------------------------------------
describe('RunId', () => {
  describe('validate()', () => {
    it('accepts a valid ULID', () => {
      expect(RunId.validate(VALID_ULID)).toBe(true);
    });

    it('rejects a UUID', () => {
      expect(RunId.validate(VALID_UUID)).toBe(false);
    });

    it.each(INVALID_INPUTS)('rejects %s', (bad) => {
      expect(RunId.validate(bad)).toBe(false);
    });
  });

  describe('from()', () => {
    it('returns the branded value for a valid ULID', () => {
      expect(RunId.from(VALID_ULID)).toBe(VALID_ULID);
    });

    it('throws TypeError for a UUID', () => {
      expect(() => RunId.from(VALID_UUID)).toThrow(TypeError);
    });

    it('error message mentions ULID', () => {
      expect(() => RunId.from('bad')).toThrow('ULID');
    });
  });

  describe('safeParse()', () => {
    it('returns the value for a valid ULID', () => {
      expect(RunId.safeParse(VALID_ULID)).toBe(VALID_ULID);
    });

    it('returns null for a UUID', () => {
      expect(RunId.safeParse(VALID_UUID)).toBeNull();
    });

    it('returns null for invalid input', () => {
      expect(RunId.safeParse('')).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Cross-format rejection
// ---------------------------------------------------------------------------
describe('UUID vs ULID cross-rejection', () => {
  it('UUID-backed types all reject the same ULID', () => {
    expect(SessionId.validate(VALID_ULID)).toBe(false);
    expect(MessageId.validate(VALID_ULID)).toBe(false);
    expect(CorrelationId.validate(VALID_ULID)).toBe(false);
    expect(TabId.validate(VALID_ULID)).toBe(false);
  });

  it('ULID-backed types all reject the same UUID', () => {
    expect(JobId.validate(VALID_UUID)).toBe(false);
    expect(RunId.validate(VALID_UUID)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------
describe('SessionIdSchema', () => {
  it('safeParse succeeds on a valid UUID', () => {
    const result = SessionIdSchema.safeParse(VALID_UUID);
    expect(result.success).toBe(true);
  });

  it('safeParse fails with refine message on a malformed string', () => {
    const result = SessionIdSchema.safeParse('not-a-uuid');
    expect(result.success).toBe(false);
  });

  it('safeParse fails on a ULID', () => {
    const result = SessionIdSchema.safeParse(VALID_ULID);
    expect(result.success).toBe(false);
  });

  it('safeParse fails on empty string', () => {
    const result = SessionIdSchema.safeParse('');
    expect(result.success).toBe(false);
  });
});

describe('MessageIdSchema', () => {
  it('safeParse succeeds on a valid UUID', () => {
    const result = MessageIdSchema.safeParse(VALID_UUID2);
    expect(result.success).toBe(true);
  });

  it('safeParse fails on a malformed string', () => {
    const result = MessageIdSchema.safeParse('bad');
    expect(result.success).toBe(false);
  });

  it('safeParse fails on a ULID', () => {
    const result = MessageIdSchema.safeParse(VALID_ULID);
    expect(result.success).toBe(false);
  });
});

describe('CorrelationIdSchema', () => {
  it('safeParse succeeds on a valid UUID', () => {
    const result = CorrelationIdSchema.safeParse(VALID_UUID);
    expect(result.success).toBe(true);
  });

  it('safeParse fails on a malformed string', () => {
    const result = CorrelationIdSchema.safeParse('bad');
    expect(result.success).toBe(false);
  });

  it('safeParse fails on a ULID', () => {
    const result = CorrelationIdSchema.safeParse(VALID_ULID);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BrandedTypeValidator
// ---------------------------------------------------------------------------
describe('BrandedTypeValidator', () => {
  describe('validateSessionId()', () => {
    it('returns the branded value for a valid UUID', () => {
      const result = BrandedTypeValidator.validateSessionId(VALID_UUID);
      expect(result).toBe(VALID_UUID);
    });

    it('throws TypeError with "Invalid SessionId" for a bad string', () => {
      expect(() => BrandedTypeValidator.validateSessionId('garbage')).toThrow(
        TypeError,
      );
      expect(() => BrandedTypeValidator.validateSessionId('garbage')).toThrow(
        'Invalid SessionId',
      );
    });

    it('throws for null', () => {
      expect(() =>
        BrandedTypeValidator.validateSessionId(null as unknown),
      ).toThrow(TypeError);
    });

    it('throws for a number', () => {
      expect(() =>
        BrandedTypeValidator.validateSessionId(42 as unknown),
      ).toThrow(TypeError);
    });

    it('throws for an object', () => {
      expect(() =>
        BrandedTypeValidator.validateSessionId({} as unknown),
      ).toThrow(TypeError);
    });
  });

  describe('validateMessageId()', () => {
    it('returns the branded value for a valid UUID', () => {
      const result = BrandedTypeValidator.validateMessageId(VALID_UUID2);
      expect(result).toBe(VALID_UUID2);
    });

    it('throws TypeError with "Invalid MessageId" for a bad string', () => {
      expect(() => BrandedTypeValidator.validateMessageId('garbage')).toThrow(
        'Invalid MessageId',
      );
    });

    it('throws for null', () => {
      expect(() =>
        BrandedTypeValidator.validateMessageId(null as unknown),
      ).toThrow(TypeError);
    });

    it('throws for a number', () => {
      expect(() =>
        BrandedTypeValidator.validateMessageId(42 as unknown),
      ).toThrow(TypeError);
    });

    it('throws for an object', () => {
      expect(() =>
        BrandedTypeValidator.validateMessageId({} as unknown),
      ).toThrow(TypeError);
    });
  });

  describe('validateCorrelationId()', () => {
    it('returns the branded value for a valid UUID', () => {
      const result = BrandedTypeValidator.validateCorrelationId(VALID_UUID);
      expect(result).toBe(VALID_UUID);
    });

    it('throws TypeError with "Invalid CorrelationId" for a bad string', () => {
      expect(() =>
        BrandedTypeValidator.validateCorrelationId('garbage'),
      ).toThrow('Invalid CorrelationId');
    });

    it('throws for null', () => {
      expect(() =>
        BrandedTypeValidator.validateCorrelationId(null as unknown),
      ).toThrow(TypeError);
    });

    it('throws for a number', () => {
      expect(() =>
        BrandedTypeValidator.validateCorrelationId(42 as unknown),
      ).toThrow(TypeError);
    });

    it('throws for an object', () => {
      expect(() =>
        BrandedTypeValidator.validateCorrelationId({} as unknown),
      ).toThrow(TypeError);
    });
  });
});

// ---------------------------------------------------------------------------
// HarnessStreamId — non-UUID synthetic brand for harness streaming pipelines
// ---------------------------------------------------------------------------
describe('HarnessStreamId', () => {
  describe('from()', () => {
    it('builds the harness-${operationId} string with the brand applied', () => {
      const id = HarnessStreamId.from('op-123');
      expect(id).toBe('harness-op-123');
      expect(HarnessStreamId.validate(id)).toBe(true);
    });

    it('throws TypeError on empty operationId', () => {
      expect(() => HarnessStreamId.from('')).toThrow(TypeError);
    });

    it('throws TypeError on whitespace-only operationId', () => {
      expect(() => HarnessStreamId.from('   ')).toThrow(TypeError);
    });
  });

  describe('validate()', () => {
    it('accepts strings beginning with "harness-"', () => {
      expect(HarnessStreamId.validate('harness-foo')).toBe(true);
      expect(HarnessStreamId.validate('harness-op-1718999999999')).toBe(true);
    });

    it('rejects UUIDs (disjoint from SessionId key space)', () => {
      expect(HarnessStreamId.validate(VALID_UUID)).toBe(false);
    });

    it('rejects bare strings without the prefix', () => {
      expect(HarnessStreamId.validate('foo')).toBe(false);
      expect(HarnessStreamId.validate('wizard-foo')).toBe(false);
      expect(HarnessStreamId.validate('gen-foo')).toBe(false);
      expect(HarnessStreamId.validate('')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// WizardPhaseId — non-UUID synthetic brand for wizard phase + content-gen agents
// ---------------------------------------------------------------------------
describe('WizardPhaseId', () => {
  describe('fromPhase()', () => {
    it('builds the wizard-${phaseId} string with the brand applied', () => {
      const id = WizardPhaseId.fromPhase('phase-1');
      expect(id).toBe('wizard-phase-1');
      expect(WizardPhaseId.validate(id)).toBe(true);
    });

    it('throws TypeError on empty phaseId', () => {
      expect(() => WizardPhaseId.fromPhase('')).toThrow(TypeError);
    });

    it('throws TypeError on whitespace-only phaseId', () => {
      expect(() => WizardPhaseId.fromPhase('  \t  ')).toThrow(TypeError);
    });
  });

  describe('fromAgent()', () => {
    it('builds the gen-${agentId} string', () => {
      const id = WizardPhaseId.fromAgent('team-leader');
      expect(id).toBe('gen-team-leader');
      expect(WizardPhaseId.validate(id)).toBe(true);
    });

    it('falls back to gen-unknown when agentId is undefined', () => {
      const id = WizardPhaseId.fromAgent(undefined);
      expect(id).toBe('gen-unknown');
      expect(WizardPhaseId.validate(id)).toBe(true);
    });
  });

  describe('validate()', () => {
    it('accepts the wizard- prefix', () => {
      expect(WizardPhaseId.validate('wizard-phase-1')).toBe(true);
    });

    it('accepts the gen- prefix', () => {
      expect(WizardPhaseId.validate('gen-foo')).toBe(true);
      expect(WizardPhaseId.validate('gen-unknown')).toBe(true);
    });

    it('rejects UUIDs (disjoint from SessionId key space)', () => {
      expect(WizardPhaseId.validate(VALID_UUID)).toBe(false);
    });

    it('rejects bare strings without a known prefix', () => {
      expect(WizardPhaseId.validate('foo')).toBe(false);
      expect(WizardPhaseId.validate('harness-foo')).toBe(false);
      expect(WizardPhaseId.validate('')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Cross-brand symmetry — synthetic brands and SessionId occupy disjoint
// key spaces. This is the whole reason the brands exist: a wizard/harness
// id must never validate as a SessionId (UUID), and vice versa.
// ---------------------------------------------------------------------------
describe('Cross-brand disjointness', () => {
  it('SessionId.validate rejects a HarnessStreamId', () => {
    const harnessId = HarnessStreamId.from('x');
    expect(SessionId.validate(harnessId)).toBe(false);
  });

  it('SessionId.validate rejects a WizardPhaseId (fromPhase)', () => {
    const wizardId = WizardPhaseId.fromPhase('phase-1');
    expect(SessionId.validate(wizardId)).toBe(false);
  });

  it('SessionId.validate rejects a WizardPhaseId (fromAgent)', () => {
    const wizardId = WizardPhaseId.fromAgent('agent');
    expect(SessionId.validate(wizardId)).toBe(false);
  });

  it('HarnessStreamId.validate rejects a freshly created SessionId', () => {
    expect(HarnessStreamId.validate(SessionId.create())).toBe(false);
  });

  it('WizardPhaseId.validate rejects a freshly created SessionId', () => {
    expect(WizardPhaseId.validate(SessionId.create())).toBe(false);
  });

  it('HarnessStreamId and WizardPhaseId reject each other', () => {
    expect(HarnessStreamId.validate(WizardPhaseId.fromPhase('p'))).toBe(false);
    expect(HarnessStreamId.validate(WizardPhaseId.fromAgent('a'))).toBe(false);
    expect(WizardPhaseId.validate(HarnessStreamId.from('op'))).toBe(false);
  });
});
