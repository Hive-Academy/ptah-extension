/**
 * Auth method normalization — unit specs.
 *
 * Verifies the contract documented in `auth-method.utils.ts`:
 *
 *   - Legacy spellings ('apiKey' | 'claudeCli' | 'thirdParty') pass through
 *   - New spellings ('claude-cli' | 'oauth') map back to legacy triad
 *   - 'openrouter' (legacy migration) maps to 'thirdParty'
 *   - Unknown / non-string / undefined → 'apiKey'
 *   - Case-sensitive (matches existing AuthManager behaviour)
 *
 * Source-under-test:
 *   `libs/backend/agent-sdk/src/lib/helpers/auth-method.utils.ts`
 */

import { normalizeAuthMethod } from './auth-method.utils';

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
      expect(normalizeAuthMethod('APIKEY')).toBe('apiKey');
      expect(normalizeAuthMethod('CLAUDE-CLI')).toBe('apiKey');
      expect(normalizeAuthMethod('OAUTH')).toBe('apiKey');
      expect(normalizeAuthMethod('ThirdParty')).toBe('apiKey');
    });

    it('mixed-case variants fall through to default', () => {
      expect(normalizeAuthMethod('ClaudeCli')).toBe('apiKey');
      expect(normalizeAuthMethod('apikey')).toBe('apiKey');
    });
  });

  describe('invalid input', () => {
    it('maps undefined → "apiKey"', () => {
      expect(normalizeAuthMethod(undefined)).toBe('apiKey');
    });

    it('maps null → "apiKey"', () => {
      expect(normalizeAuthMethod(null)).toBe('apiKey');
    });

    it('maps numbers → "apiKey"', () => {
      expect(normalizeAuthMethod(42)).toBe('apiKey');
    });

    it('maps objects → "apiKey"', () => {
      expect(normalizeAuthMethod({ method: 'apiKey' })).toBe('apiKey');
    });

    it('maps empty string → "apiKey"', () => {
      expect(normalizeAuthMethod('')).toBe('apiKey');
    });

    it('maps unknown strings → "apiKey"', () => {
      expect(normalizeAuthMethod('github-copilot')).toBe('apiKey');
      expect(normalizeAuthMethod('auto')).toBe('apiKey');
      expect(normalizeAuthMethod('garbage')).toBe('apiKey');
    });
  });
});
