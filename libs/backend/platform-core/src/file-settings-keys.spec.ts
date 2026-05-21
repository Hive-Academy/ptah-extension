import {
  FILE_BASED_SETTINGS_KEYS,
  FILE_BASED_SETTINGS_DEFAULTS,
  isFileBasedSettingKey,
} from './file-settings-keys';

describe('isFileBasedSettingKey', () => {
  describe('static SET membership', () => {
    it('returns true for every key in FILE_BASED_SETTINGS_KEYS', () => {
      for (const key of FILE_BASED_SETTINGS_KEYS) {
        expect(isFileBasedSettingKey(key)).toBe(true);
      }
    });

    it('returns false for keys not in any registered pattern', () => {
      expect(isFileBasedSettingKey('nonExistent.key')).toBe(false);
      expect(isFileBasedSettingKey('')).toBe(false);
    });
  });

  describe('PROVIDER_BASE_URL_PATTERN (dynamic keys)', () => {
    it('returns true for provider.<id>.baseUrl patterns with lower-case id', () => {
      expect(isFileBasedSettingKey('provider.openrouter.baseUrl')).toBe(true);
      expect(isFileBasedSettingKey('provider.my-provider.baseUrl')).toBe(true);
      expect(isFileBasedSettingKey('provider.lm-studio.baseUrl')).toBe(true);
    });

    it('returns false when the provider id contains uppercase letters', () => {
      expect(isFileBasedSettingKey('provider.OpenRouter.baseUrl')).toBe(false);
    });

    it('returns false for baseUrl patterns with wrong segment count', () => {
      expect(isFileBasedSettingKey('provider.baseUrl')).toBe(false);
      expect(isFileBasedSettingKey('baseUrl')).toBe(false);
    });
  });

  describe('PROVIDER_SCOPED_TIER_PATTERN (dynamic keys)', () => {
    it('returns true for mainAgent tier patterns', () => {
      expect(
        isFileBasedSettingKey('provider.openrouter.mainAgent.modelTier.sonnet'),
      ).toBe(true);
      expect(
        isFileBasedSettingKey('provider.openrouter.mainAgent.modelTier.opus'),
      ).toBe(true);
      expect(
        isFileBasedSettingKey('provider.openrouter.mainAgent.modelTier.haiku'),
      ).toBe(true);
    });

    it('returns true for cliAgent tier patterns', () => {
      expect(
        isFileBasedSettingKey('provider.moonshot.cliAgent.modelTier.sonnet'),
      ).toBe(true);
      expect(
        isFileBasedSettingKey('provider.lm-studio.cliAgent.modelTier.haiku'),
      ).toBe(true);
    });

    it('returns false for unknown scope segments', () => {
      expect(
        isFileBasedSettingKey(
          'provider.openrouter.unknownScope.modelTier.sonnet',
        ),
      ).toBe(false);
    });

    it('returns false for unknown tier names', () => {
      expect(
        isFileBasedSettingKey(
          'provider.openrouter.mainAgent.modelTier.unknown',
        ),
      ).toBe(false);
    });
  });

  describe('FILE_BASED_SETTINGS_DEFAULTS alignment', () => {
    it('every key in FILE_BASED_SETTINGS_DEFAULTS is also in FILE_BASED_SETTINGS_KEYS', () => {
      for (const key of Object.keys(FILE_BASED_SETTINGS_DEFAULTS)) {
        expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
      }
    });

    it('FILE_BASED_SETTINGS_KEYS is non-empty', () => {
      expect(FILE_BASED_SETTINGS_KEYS.size).toBeGreaterThan(0);
    });
  });

  describe('curator/synthesis trigger keys (TASK_2026_126)', () => {
    const memoryTriggerKeys = [
      'memory.triggers.preCompact',
      'memory.triggers.idleMs',
      'memory.triggers.turnThreshold',
      'memory.triggers.bootScan',
    ] as const;

    const skillTriggerKeys = [
      'skillSynthesis.triggers.sessionEnd',
      'skillSynthesis.triggers.idleMs',
      'skillSynthesis.triggers.bootScan',
    ] as const;

    const expectedDefaults: Record<string, boolean | number> = {
      'memory.triggers.preCompact': true,
      'memory.triggers.idleMs': 600000,
      'memory.triggers.turnThreshold': 20,
      'memory.triggers.bootScan': true,
      'skillSynthesis.triggers.sessionEnd': true,
      'skillSynthesis.triggers.idleMs': 600000,
      'skillSynthesis.triggers.bootScan': true,
    };

    it.each([...memoryTriggerKeys, ...skillTriggerKeys])(
      'registers %s in FILE_BASED_SETTINGS_KEYS',
      (key) => {
        expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
      },
    );

    it.each([...memoryTriggerKeys, ...skillTriggerKeys])(
      'declares a default for %s in FILE_BASED_SETTINGS_DEFAULTS',
      (key) => {
        expect(
          Object.prototype.hasOwnProperty.call(
            FILE_BASED_SETTINGS_DEFAULTS,
            key,
          ),
        ).toBe(true);
        expect(FILE_BASED_SETTINGS_DEFAULTS[key]).toBe(expectedDefaults[key]);
      },
    );

    it('routes every trigger key through isFileBasedSettingKey', () => {
      for (const key of [...memoryTriggerKeys, ...skillTriggerKeys]) {
        expect(isFileBasedSettingKey(key)).toBe(true);
      }
    });
  });
});
