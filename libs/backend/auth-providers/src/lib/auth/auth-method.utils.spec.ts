/**
 * Auth method normalization — unit specs.
 *
 * Verifies the contract documented in `auth-method.utils.ts`:
 *
 *   - Legacy spellings ('apiKey' | 'claudeCli' | 'thirdParty') pass through
 *   - New spellings ('claude-cli' | 'oauth') map back to legacy triad
 *   - 'openrouter' (legacy migration) maps to 'thirdParty'
 *   - Unknown / non-string / undefined → 'claudeCli'
 *   - Case-sensitive (matches existing AuthManager behaviour)
 *
 * Source-under-test:
 *   `libs/backend/agent-sdk/src/lib/helpers/auth-method.utils.ts`
 */

import {
  normalizeAuthMethod,
  parseAuthMethod,
  resolveDefaultAuthMethod,
} from './auth-method.utils';

describe('normalizeAuthMethod', () => {
  describe('legacy spellings (passthrough)', () => {
    it('maps "apiKey" → "apiKey"', () => {
      expect(normalizeAuthMethod('apiKey')).toBe('apiKey');
    });

    it('maps "claudeCli" → "claudeCli"', () => {
      expect(normalizeAuthMethod('claudeCli')).toBe('claudeCli');
    });

    it('maps "thirdParty" → "thirdParty"', () => {
      expect(normalizeAuthMethod('thirdParty')).toBe('thirdParty');
    });
  });

  describe('new spellings (CLI auth use)', () => {
    it('maps "claude-cli" → "claudeCli"', () => {
      expect(normalizeAuthMethod('claude-cli')).toBe('claudeCli');
    });

    it('maps "oauth" → "thirdParty"', () => {
      expect(normalizeAuthMethod('oauth')).toBe('thirdParty');
    });
  });

  describe('legacy migration spellings', () => {
    it('maps "openrouter" → "thirdParty"', () => {
      expect(normalizeAuthMethod('openrouter')).toBe('thirdParty');
    });
  });

  describe('case sensitivity (matches existing AuthManager behaviour)', () => {
    it('uppercase variants fall through to default', () => {
      expect(normalizeAuthMethod('APIKEY')).toBe('claudeCli');
      expect(normalizeAuthMethod('CLAUDE-CLI')).toBe('claudeCli');
      expect(normalizeAuthMethod('OAUTH')).toBe('claudeCli');
      expect(normalizeAuthMethod('ThirdParty')).toBe('claudeCli');
    });

    it('mixed-case variants fall through to default', () => {
      expect(normalizeAuthMethod('ClaudeCli')).toBe('claudeCli');
      expect(normalizeAuthMethod('apikey')).toBe('claudeCli');
    });
  });

  describe('invalid input', () => {
    it('maps undefined → "apiKey"', () => {
      expect(normalizeAuthMethod(undefined)).toBe('claudeCli');
    });

    it('maps null → "apiKey"', () => {
      expect(normalizeAuthMethod(null)).toBe('claudeCli');
    });

    it('maps numbers → "apiKey"', () => {
      expect(normalizeAuthMethod(42)).toBe('claudeCli');
    });

    it('maps objects → "apiKey"', () => {
      expect(normalizeAuthMethod({ method: 'apiKey' })).toBe('claudeCli');
    });

    it('maps empty string → "apiKey"', () => {
      expect(normalizeAuthMethod('')).toBe('claudeCli');
    });

    it('maps unknown strings → "apiKey"', () => {
      expect(normalizeAuthMethod('github-copilot')).toBe('claudeCli');
      expect(normalizeAuthMethod('auto')).toBe('claudeCli');
      expect(normalizeAuthMethod('garbage')).toBe('claudeCli');
    });
  });
});

describe('parseAuthMethod', () => {
  it.each([
    ['apiKey', 'apiKey'],
    ['claudeCli', 'claudeCli'],
    ['claude-cli', 'claudeCli'],
    ['thirdParty', 'thirdParty'],
    ['oauth', 'thirdParty'],
    ['openrouter', 'thirdParty'],
  ])('maps the known spelling %s → %s', (raw, expected) => {
    expect(parseAuthMethod(raw)).toBe(expected);
  });

  it.each([undefined, null, 42, '', 'garbage', 'APIKEY', { method: 'apiKey' }])(
    'reports no method for missing or unknown input (%p)',
    (raw) => {
      expect(parseAuthMethod(raw)).toBeUndefined();
    },
  );
});

describe('resolveDefaultAuthMethod', () => {
  it('uses the Claude CLI login when no API key is stored and the login is connected', () => {
    expect(
      resolveDefaultAuthMethod({ hasApiKey: false, claudeCliConnected: true }),
    ).toBe('claudeCli');
  });

  it('prefers the connected Claude CLI login over a stored API key', () => {
    expect(
      resolveDefaultAuthMethod({ hasApiKey: true, claudeCliConnected: true }),
    ).toBe('claudeCli');
  });

  it('uses the API key only when one is stored and the login is not connected', () => {
    expect(
      resolveDefaultAuthMethod({ hasApiKey: true, claudeCliConnected: false }),
    ).toBe('apiKey');
  });

  it('defaults to the Claude CLI path when neither is available', () => {
    expect(
      resolveDefaultAuthMethod({ hasApiKey: false, claudeCliConnected: false }),
    ).toBe('claudeCli');
  });
});
