import type { QuotaOwnerRef } from '../../types/plan-limit.types';
import { ownerDisplayLabel, ownerKeySuffix } from './owner-display';

const OWNER: QuotaOwnerRef = {
  key: 'claude-cli#account:0123456789abcdef',
  providerId: 'claude-cli',
  identityKind: 'account',
  label: 'Claude account',
};

describe('ownerKeySuffix', () => {
  it('returns the last 4 characters of a hashed fingerprint', () => {
    expect(ownerKeySuffix('claude-cli#account:0123456789abcdef')).toBe('cdef');
  });

  it('accepts the minimum 8 hex characters', () => {
    expect(ownerKeySuffix('claude-cli#account:01234567')).toBe('4567');
  });

  it('is null for a malformed fingerprint', () => {
    // A label mistaken for a fingerprint, an uppercase or short hash tail.
    expect(ownerKeySuffix('anthropic#account:Claude account')).toBeNull();
    expect(ownerKeySuffix('claude-cli#account:0123456789ABCDEF')).toBeNull();
    expect(ownerKeySuffix('claude-cli#account:0123')).toBeNull();
    expect(ownerKeySuffix('claude-cli#account:')).toBeNull();
  });

  it('is null for a key without a fingerprint separator', () => {
    expect(ownerKeySuffix('claude-cli#account')).toBeNull();
    expect(ownerKeySuffix('')).toBeNull();
  });
});

describe('ownerDisplayLabel', () => {
  it('appends the key suffix to the generic label', () => {
    expect(ownerDisplayLabel(OWNER)).toBe('Claude account · cdef');
  });

  it('keeps the plain label when the key has no readable fingerprint', () => {
    const unlabelled: QuotaOwnerRef = {
      ...OWNER,
      key: 'claude-cli#account:aaa',
    };
    expect(ownerDisplayLabel(unlabelled)).toBe('Claude account');
  });

  it('distinguishes two owners that share the generic label', () => {
    const other: QuotaOwnerRef = {
      ...OWNER,
      key: 'claude-cli#account:fedcba9876543210',
    };
    expect(ownerDisplayLabel(OWNER)).toBe('Claude account · cdef');
    expect(ownerDisplayLabel(other)).toBe('Claude account · 3210');
  });
});
