import { createHash } from 'node:crypto';
import { claudeIdentityReference } from './claude-identity-reference';

// The executor (`session-query-executor.service.ts` namedIdentity) and the lane
// runner (`claude-sdk-lane-runner.ts`) hash this exact template (inline, not
// exported). Restated here verbatim; the helper must match it byte for byte.
function executorOwnerKey(email: string, organization?: string): string {
  return createHash('sha256')
    .update(
      `ptah-quota-owner\0${email.trim()}\0${organization?.trim() ?? ''}`,
      'utf8',
    )
    .digest('hex');
}

describe('claudeIdentityReference', () => {
  it('equals the executor and lane owner-key formula', () => {
    expect(claudeIdentityReference('person@example.test', 'org')).toBe(
      executorOwnerKey('person@example.test', 'org'),
    );
    expect(claudeIdentityReference('person@example.test', 'org')).toBe(
      createHash('sha256')
        .update('ptah-quota-owner\0person@example.test\0org')
        .digest('hex'),
    );
  });

  it('trims both values and treats a missing organization as empty', () => {
    expect(claudeIdentityReference('  person@example.test ', ' org ')).toBe(
      executorOwnerKey('person@example.test', 'org'),
    );
    expect(claudeIdentityReference('person@example.test', undefined)).toBe(
      executorOwnerKey('person@example.test'),
    );
    expect(claudeIdentityReference('person@example.test', null)).toBe(
      claudeIdentityReference('person@example.test', '  '),
    );
  });

  it('returns null without an email', () => {
    expect(claudeIdentityReference(undefined, 'org')).toBeNull();
    expect(claudeIdentityReference(null, 'org')).toBeNull();
    expect(claudeIdentityReference('   ', 'org')).toBeNull();
  });

  it('separates identities that differ only by organization', () => {
    expect(claudeIdentityReference('person@example.test', 'a')).not.toBe(
      claudeIdentityReference('person@example.test', 'b'),
    );
    expect(claudeIdentityReference('person@example.test', 'a')).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});
