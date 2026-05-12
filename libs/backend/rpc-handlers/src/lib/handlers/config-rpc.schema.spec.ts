/**
 * config-rpc.schema.ts — unit tests for the Zod-based config parsers.
 *
 * Coverage:
 *   - `parsePermissionLevel`: accepted values, rejected values, fallback behavior.
 *   - `parseEffortLevel`: accepted values, rejected values, undefined for empty.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.schema.ts`
 */

import { parsePermissionLevel, parseEffortLevel } from './config-rpc.schema';

describe('parsePermissionLevel', () => {
  it.each(['ask', 'auto-edit', 'yolo', 'plan'] as const)(
    'returns "%s" for the canonical value',
    (level) => {
      expect(parsePermissionLevel(level)).toBe(level);
    },
  );

  it('returns "ask" as the default fallback for unknown values', () => {
    expect(parsePermissionLevel('unknown-level')).toBe('ask');
  });

  it('returns "ask" for null', () => {
    expect(parsePermissionLevel(null)).toBe('ask');
  });

  it('returns "ask" for undefined', () => {
    expect(parsePermissionLevel(undefined)).toBe('ask');
  });

  it('returns "ask" for empty string', () => {
    expect(parsePermissionLevel('')).toBe('ask');
  });

  it('returns "ask" for a number', () => {
    expect(parsePermissionLevel(42)).toBe('ask');
  });

  it('returns "ask" for an object', () => {
    expect(parsePermissionLevel({ level: 'ask' })).toBe('ask');
  });

  it('accepts a custom fallback parameter', () => {
    expect(parsePermissionLevel('bad-value', 'yolo')).toBe('yolo');
  });

  it('does not accept mixed-case variants', () => {
    expect(parsePermissionLevel('ASK')).toBe('ask'); // fallback, not 'ASK'
    expect(parsePermissionLevel('Auto-Edit')).toBe('ask');
  });
});

describe('parseEffortLevel', () => {
  it.each(['low', 'medium', 'high', 'xhigh', 'max'] as const)(
    'returns "%s" for the canonical value',
    (level) => {
      expect(parseEffortLevel(level)).toBe(level);
    },
  );

  it('returns undefined for an unknown string', () => {
    expect(parseEffortLevel('ultra')).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(parseEffortLevel(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(parseEffortLevel(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseEffortLevel('')).toBeUndefined();
  });

  it('returns undefined for a number', () => {
    expect(parseEffortLevel(3)).toBeUndefined();
  });

  it('does not accept mixed-case variants', () => {
    // 'HIGH' is not a valid EffortLevel — schema is case-sensitive.
    expect(parseEffortLevel('HIGH')).toBeUndefined();
    expect(parseEffortLevel('Max')).toBeUndefined();
  });
});
