import {
  isProviderAccountLabelTaken,
  isSafeProviderAccountLabel,
  isSafeProviderAccountSummary,
  PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY,
  PROVIDER_ACCOUNT_RESERVED_LABEL,
  PROVIDER_AMBIENT_CLAUDE_REASONS,
  PROVIDER_AMBIENT_CLAUDE_STATES,
  providerAccountLabelKey,
  type ProviderAmbientClaudeStatus,
} from './provider-account.types';

describe('provider account name rule', () => {
  it('keys a name by trimming surrounding space and ignoring case', () => {
    expect(providerAccountLabelKey('  Work Account ')).toBe('work account');
    expect(providerAccountLabelKey('WORK')).toBe(providerAccountLabelKey('work'));
    expect(providerAccountLabelKey('Work  Account')).not.toBe(
      providerAccountLabelKey('Work Account'),
    );
  });

  it('treats case and surrounding-space variants of an existing name as taken', () => {
    const existing = ['Work', 'Personal'];
    expect(isProviderAccountLabelTaken('Work', existing)).toBe(true);
    expect(isProviderAccountLabelTaken('work', existing)).toBe(true);
    expect(isProviderAccountLabelTaken(' PERSONAL ', existing)).toBe(true);
    expect(isProviderAccountLabelTaken('Home', existing)).toBe(false);
    expect(isProviderAccountLabelTaken('Work 2', existing)).toBe(false);
  });

  it('always treats the reserved ambient name as taken, in any case', () => {
    expect(PROVIDER_ACCOUNT_RESERVED_LABEL).toBe('Existing Claude login');
    expect(isSafeProviderAccountLabel(PROVIDER_ACCOUNT_RESERVED_LABEL)).toBe(true);
    expect(isProviderAccountLabelTaken(PROVIDER_ACCOUNT_RESERVED_LABEL, [])).toBe(true);
    expect(isProviderAccountLabelTaken('existing claude LOGIN ', [])).toBe(true);
  });

  it('leaves exclusion of the renamed account to the caller', () => {
    const others = ['Personal'];
    // Renaming "Work" to "WORK": the caller omits the renamed row's own label.
    expect(isProviderAccountLabelTaken('WORK', others)).toBe(false);
    expect(isProviderAccountLabelTaken('WORK', [...others, 'Work'])).toBe(true);
  });

  it('uses a duplicate-name sentence that passes the safe summary check', () => {
    expect(PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY).toBe(
      'That name is already used. Names must be different.',
    );
    expect(isSafeProviderAccountSummary(PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY)).toBe(true);
  });
});

describe('ambient Claude status vocabulary', () => {
  it('lists the closed states and unknown reasons', () => {
    expect(PROVIDER_AMBIENT_CLAUDE_STATES).toEqual(['connected', 'signed-out', 'unknown']);
    expect(PROVIDER_AMBIENT_CLAUDE_REASONS).toEqual(['cli-missing', 'timeout', 'unreadable']);
  });

  it('allows a status with no completed probe time', () => {
    const neverChecked: ProviderAmbientClaudeStatus = {
      state: 'unknown',
      checkedAt: null,
      reason: 'timeout',
    };
    const connected: ProviderAmbientClaudeStatus = {
      state: 'connected',
      checkedAt: '2026-10-26T00:00:00.000Z',
    };
    expect(neverChecked.checkedAt).toBeNull();
    expect(connected.reason).toBeUndefined();
  });
});
