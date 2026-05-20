import { resolveAuthProviderKey } from './settings-auth-key';

describe('resolveAuthProviderKey', () => {
  describe('thirdParty authMethod', () => {
    it('returns "thirdParty.<providerId>" when anthropicProviderId is present', () => {
      expect(resolveAuthProviderKey('thirdParty', 'openrouter')).toBe(
        'thirdParty.openrouter',
      );
    });

    it('returns "thirdParty.<providerId>" for other valid provider ids', () => {
      expect(resolveAuthProviderKey('thirdParty', 'moonshot')).toBe(
        'thirdParty.moonshot',
      );
      expect(resolveAuthProviderKey('thirdParty', 'ollama')).toBe(
        'thirdParty.ollama',
      );
      expect(resolveAuthProviderKey('thirdParty', 'lm-studio')).toBe(
        'thirdParty.lm-studio',
      );
    });

    it('falls back to "thirdParty.unknown" when anthropicProviderId is undefined', () => {
      expect(resolveAuthProviderKey('thirdParty', undefined)).toBe(
        'thirdParty.unknown',
      );
    });

    it('falls back to "thirdParty.unknown" when anthropicProviderId is an empty string', () => {
      expect(resolveAuthProviderKey('thirdParty', '')).toBe(
        'thirdParty.unknown',
      );
    });
  });

  describe('non-thirdParty authMethod', () => {
    it('returns the authMethod directly for "apiKey"', () => {
      expect(resolveAuthProviderKey('apiKey')).toBe('apiKey');
    });

    it('returns the authMethod directly for "claudeCli"', () => {
      expect(resolveAuthProviderKey('claudeCli')).toBe('claudeCli');
    });

    it('ignores anthropicProviderId when authMethod is not "thirdParty"', () => {
      expect(resolveAuthProviderKey('apiKey', 'openrouter')).toBe('apiKey');
    });

    it('returns the authMethod as-is for arbitrary string values', () => {
      expect(resolveAuthProviderKey('someOtherMethod')).toBe('someOtherMethod');
    });
  });
});
