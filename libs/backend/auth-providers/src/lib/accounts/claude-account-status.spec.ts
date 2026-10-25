import 'reflect-metadata';
import { claudeIdentityReference } from '@ptah-extension/agent-sdk';
import { parseClaudeAccountStatus } from './claude-account-status';

const CANONICAL_DIR = 'C:\\Users\\dev\\.ptah\\claude-accounts\\acct-1';
const EMAIL = 'canary.person@example.test';
const ORG_NAME = 'Canary Personal Org';
const ORG_ID = '7d3c1f00-canary-org-id';

/** Signed-in status shaped like the 2.1.310 builder output (source-derived). */
function signedIn(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    loggedIn: true,
    authMethod: 'claude.ai',
    apiProvider: 'firstParty',
    analyticsDisabled: false,
    projectsDirectory: 'C:\\Users\\dev\\.ptah\\claude-accounts\\acct-1\\projects',
    configDirectory: CANONICAL_DIR,
    email: EMAIL,
    orgId: ORG_ID,
    orgName: ORG_NAME,
    subscriptionType: 'max',
    ...overrides,
  };
}

function without(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function parse(value: unknown, exitCode: number | null = 0, platform: NodeJS.Platform = 'win32') {
  return parseClaudeAccountStatus(JSON.stringify(value), exitCode, CANONICAL_DIR, platform);
}

describe('parseClaudeAccountStatus', () => {
  describe('signed-out (cli 2.1.310 observed)', () => {
    const signedOut = {
      loggedIn: false,
      authMethod: 'none',
      apiProvider: 'firstParty',
      configDirectory: CANONICAL_DIR,
    };

    it('returns loggedIn false for exit 1', () => {
      expect(parse(signedOut, 1)).toEqual({ loggedIn: false });
    });

    it('accepts and ignores apiKeySource on a signed-out result', () => {
      expect(parse({ ...signedOut, apiKeySource: 'ANTHROPIC_API_KEY' }, 1)).toEqual({ loggedIn: false });
    });

    it('is unproved when the exit code disagrees or authMethod is not none', () => {
      expect(parse(signedOut, 0)).toBeNull();
      expect(parse({ ...signedOut, authMethod: 'claude.ai' }, 1)).toBeNull();
    });
  });

  describe('unproved output', () => {
    it.each([
      ['not JSON', 'Not logged in'],
      ['a JSON array', '[]'],
      ['JSON null', 'null'],
    ])('returns null for %s', (_label, text) => {
      expect(parseClaudeAccountStatus(text, 0, CANONICAL_DIR, 'win32')).toBeNull();
    });

    it.each(['loggedIn', 'authMethod', 'apiProvider', 'configDirectory'])(
      'returns null when required key %s is missing',
      (key) => {
        expect(parse(without(signedIn(), key))).toBeNull();
      },
    );

    it('returns null for a mistyped required key', () => {
      expect(parse(signedIn({ loggedIn: 'true' }))).toBeNull();
      expect(parse(signedIn({ configDirectory: 7 }))).toBeNull();
    });

    it('returns null when a signed-in result exits non-zero or without an exit code', () => {
      expect(parse(signedIn(), 1)).toBeNull();
      expect(parse(signedIn(), null)).toBeNull();
    });
  });

  describe('class P (personal pro/max)', () => {
    it.each(['max', 'pro'])('classifies %s with a non-null orgId as P', (subscriptionType) => {
      expect(parse(signedIn({ subscriptionType }))).toMatchObject({ loggedIn: true, accountClass: 'P' });
    });

    it('classifies max with orgId null and orgName null as P', () => {
      expect(parse(signedIn({ orgId: null, orgName: null }))).toMatchObject({ accountClass: 'P' });
    });

    it('accepts apiKeySource none (cli 2.1.278 source-derived)', () => {
      expect(parse(signedIn({ apiKeySource: 'none' }))).toMatchObject({ accountClass: 'P' });
    });

    it('classifies a status without optional metadata as P', () => {
      expect(parse(without(without(signedIn(), 'analyticsDisabled'), 'projectsDirectory'))).toMatchObject({
        accountClass: 'P',
      });
    });
  });

  describe('class O', () => {
    it.each<[string, Record<string, unknown>]>([
      ['team', signedIn({ subscriptionType: 'team' })],
      ['enterprise', signedIn({ subscriptionType: 'enterprise' })],
      ['null subscription', signedIn({ subscriptionType: null })],
      ['missing subscription', without(signedIn(), 'subscriptionType')],
      ['Max (case differs)', signedIn({ subscriptionType: 'Max' })],
      ['claude_max', signedIn({ subscriptionType: 'claude_max' })],
      ['max + forcedLoginMethod', signedIn({ forcedLoginMethod: 'claudeai' })],
      ['max + allowedProviders', signedIn({ allowedProviders: ['firstParty'] })],
      ['max + apiKeySource apiKeyHelper', signedIn({ apiKeySource: 'apiKeyHelper' })],
      ['max + apiKeySource ANTHROPIC_API_KEY', signedIn({ apiKeySource: 'ANTHROPIC_API_KEY' })],
      ['max + unknown key orgRole', signedIn({ orgRole: 'admin' })],
      ['apiProvider bedrock', signedIn({ apiProvider: 'bedrock' })],
      ['apiProvider vertex', signedIn({ apiProvider: 'vertex' })],
      ['authMethod console', signedIn({ authMethod: 'console' })],
      ['malformed orgId', signedIn({ orgId: 42 })],
      ['malformed orgName', signedIn({ orgName: { name: ORG_NAME } })],
      ['malformed analyticsDisabled', signedIn({ analyticsDisabled: 'no' })],
      ['empty email', signedIn({ email: '  ' })],
    ])('classifies %s as O', (_label, status) => {
      expect(parse(status)).toMatchObject({ loggedIn: true, accountClass: 'O' });
    });

    it('still yields the class when the status names no email', () => {
      expect(parse(without(signedIn({ subscriptionType: 'team' }), 'email'))).toEqual({
        loggedIn: true,
        accountClass: 'O',
        identityReference: null,
        configDirectoryMatches: true,
      });
    });

    it('yields class O even when the config directory differs', () => {
      expect(parse(signedIn({ subscriptionType: 'enterprise', configDirectory: 'C:\\other' }))).toMatchObject({
        accountClass: 'O',
        configDirectoryMatches: false,
      });
    });
  });

  describe('identity reference', () => {
    it('equals claudeIdentityReference(email, orgName) from agent-sdk', () => {
      const result = parse(signedIn());
      const expected = claudeIdentityReference(EMAIL, ORG_NAME);
      expect(expected).toMatch(/^[0-9a-f]{64}$/);
      expect(result).toMatchObject({ identityReference: expected });
    });

    it('uses an empty organization when orgName is null', () => {
      expect(parse(signedIn({ orgName: null }))).toMatchObject({
        identityReference: claudeIdentityReference(EMAIL, null),
      });
    });

    it('does not depend on orgId', () => {
      const a = parse(signedIn({ orgId: 'one' }));
      const b = parse(signedIn({ orgId: null }));
      expect(a).toEqual(b);
    });
  });

  describe('config directory', () => {
    it('matches after slash, trailing-separator and case normalization on win32', () => {
      const status = signedIn({ configDirectory: 'c:/users/DEV/.ptah/claude-accounts/ACCT-1/' });
      expect(parse(status)).toMatchObject({ configDirectoryMatches: true });
    });

    it('is case-sensitive off win32', () => {
      const status = signedIn({ configDirectory: CANONICAL_DIR.toUpperCase() });
      expect(parse(status, 0, 'linux')).toMatchObject({ configDirectoryMatches: false });
      expect(parse(status, 0, 'win32')).toMatchObject({ configDirectoryMatches: true });
    });

    it('reports a different directory without changing the class', () => {
      expect(parse(signedIn({ configDirectory: 'C:\\Users\\dev\\.claude' }))).toMatchObject({
        accountClass: 'P',
        configDirectoryMatches: false,
      });
    });
  });

  it('canary: no email, org value or subscription word reaches the result', () => {
    const outputs = [
      parse(signedIn()),
      parse(signedIn({ subscriptionType: 'enterprise' })),
      parse(signedIn({ apiKeySource: 'apiKeyHelper' })),
      parse(signedIn({ orgRole: 'canary-role' })),
    ];
    for (const output of outputs) {
      const serialized = JSON.stringify(output);
      for (const secret of [EMAIL, 'canary', ORG_NAME, ORG_ID, 'max', 'enterprise', 'apiKeyHelper', 'Users']) {
        expect(serialized).not.toContain(secret);
      }
      expect(Object.keys(output ?? {}).sort()).toEqual([
        'accountClass',
        'configDirectoryMatches',
        'identityReference',
        'loggedIn',
      ]);
    }
  });
});
