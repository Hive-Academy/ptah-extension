import {
  ADVANCED_SETTINGS,
  ADVANCED_SETTING_GROUPS,
  findAdvancedSetting,
  validateAdvancedSettingValue,
} from './advanced-settings.types';
import type {
  AdvancedBooleanSetting,
  AdvancedNumberSetting,
} from './advanced-settings.types';

function numberSetting(key: string): AdvancedNumberSetting {
  const setting = findAdvancedSetting(key);
  if (setting?.kind !== 'number') {
    throw new Error(`${key} is not a described number setting`);
  }
  return setting;
}

function booleanSetting(key: string): AdvancedBooleanSetting {
  const setting = findAdvancedSetting(key);
  if (setting?.kind !== 'boolean') {
    throw new Error(`${key} is not a described boolean setting`);
  }
  return setting;
}

const numberSettings = ADVANCED_SETTINGS.filter(
  (setting): setting is AdvancedNumberSetting => setting.kind === 'number',
);
const booleanSettings = ADVANCED_SETTINGS.filter(
  (setting): setting is AdvancedBooleanSetting => setting.kind === 'boolean',
);

describe('ADVANCED_SETTINGS table', () => {
  it('describes the 29 surfaced keys, each once', () => {
    const keys = ADVANCED_SETTINGS.map((setting) => setting.key);
    expect(keys).toHaveLength(29);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every group id a title and description, each id once', () => {
    const ids = ADVANCED_SETTING_GROUPS.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const group of ADVANCED_SETTING_GROUPS) {
      expect(group.title.trim()).not.toBe('');
      expect(group.description.trim()).not.toBe('');
    }
    for (const setting of ADVANCED_SETTINGS) {
      expect(ids).toContain(setting.group);
    }
  });

  it('gives every group at least one setting', () => {
    for (const group of ADVANCED_SETTING_GROUPS) {
      expect(
        ADVANCED_SETTINGS.some((setting) => setting.group === group.id),
      ).toBe(true);
    }
  });

  it.each(ADVANCED_SETTINGS.map((setting) => [setting.key, setting] as const))(
    '%s has a label, help text and a default its own validator accepts',
    (_key, setting) => {
      expect(setting.label.trim()).not.toBe('');
      expect(setting.help.trim()).not.toBe('');
      expect(validateAdvancedSettingValue(setting, setting.default)).toEqual({
        ok: true,
        value: setting.default,
      });
    },
  );

  it('keeps every number range ordered', () => {
    for (const setting of numberSettings) {
      expect(setting.min).toBeLessThanOrEqual(setting.max);
    }
  });

  /**
   * Literal pins for the bounds the user approved (TASK_2026_658 decisions.md)
   * and for the consumers' own clamps. A changed bound is a red test here.
   */
  it.each([
    ['compaction.toolOutputBudgetTokens', 100, 200_000, true],
    ['compaction.subagentHandoffTokens', 1_000, 2_000_000, true],
    ['compaction.rotationSuggestTokens', 1_000, 5_000_000, true],
    ['compaction.subagentStopWeightedTokens', 1_000, 100_000_000, true],
    ['compaction.idleCompactionMinTokens', 100_000, 5_000_000, true],
    ['agentOrchestration.codexAutoCompactTokens', 0, 2_000_000, true],
    ['agentOrchestration.codexToolOutputTokenLimit', 0, 200_000, true],
    ['internalQuery.maxConcurrent', 1, 16, true],
    ['internalQuery.maxConcurrentPerLane', 1, 16, true],
    ['internalQuery.queueTimeoutMs', 1_000, 600_000, true],
    ['memory.retention.processedDays', 1, 365, true],
    ['memory.retention.stuckDays', 7, 365, true],
    ['memory.retention.batchSize', 50, 5_000, true],
    ['memory.lifecycle.archiveAfterDays', 7, 365, true],
    ['memory.lifecycle.deleteAfterDays', 7, 730, true],
    ['memory.lifecycle.maxPerWorkspace', 1_000, 1_000_000, true],
    ['skillSynthesis.retirement.dormantAfterDays', 1, 3_650, true],
    ['skillSynthesis.retirement.retireAfterDormantDays', 1, 3_650, true],
    ['skillSynthesis.replayValidation.minConfidence', 0, 1, false],
    ['skillSynthesis.judgePanel.disagreementThreshold', 0, 9, false],
    ['skillSynthesis.triggers.bootScanDelayMs', 0, 3_600_000, true],
    ['skillSynthesis.triggers.bootScanIdleBackoffMs', 0, 3_600_000, true],
    ['cron.maxConcurrentJobs', 1, 16, true],
    ['cron.catchupWindowMs', 0, 86_400_000, true],
    ['harness.preflightTimeoutMs', 100, 60_000, true],
  ] as const)('%s is bounded %d-%d (integer: %s)', (key, min, max, integer) => {
    const setting = numberSetting(key);
    expect(setting.min).toBe(min);
    expect(setting.max).toBe(max);
    expect(setting.integer).toBe(integer);
  });

  it('describes the four boolean keys', () => {
    expect(booleanSettings.map((setting) => setting.key).sort()).toEqual([
      'agentOrchestration.codexWebSearch',
      'compaction.idleCompactionEnabled',
      'harness.manageGitignore',
      'memory.symbolInjectionEnabled',
    ]);
  });
});

describe('findAdvancedSetting', () => {
  it('returns the descriptor for a described key', () => {
    expect(findAdvancedSetting('cron.maxConcurrentJobs')?.group).toBe(
      'scheduled-jobs',
    );
  });

  it('returns undefined for a key without a descriptor', () => {
    expect(findAdvancedSetting('sessionBudget.tokens')).toBeUndefined();
    expect(findAdvancedSetting('memory.embeddingModel')).toBeUndefined();
  });
});

describe('validateAdvancedSettingValue', () => {
  describe('number settings', () => {
    const stuckDays = numberSetting('memory.retention.stuckDays');

    it('accepts the bounds themselves', () => {
      expect(validateAdvancedSettingValue(stuckDays, 7)).toEqual({
        ok: true,
        value: 7,
      });
      expect(validateAdvancedSettingValue(stuckDays, 365)).toEqual({
        ok: true,
        value: 365,
      });
    });

    it.each([
      ['below min', 6],
      ['above max', 366],
      ['a fraction for an integer setting', 10.5],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
      ['a numeric string', '30'],
      ['null', null],
      ['undefined', undefined],
      ['a boolean', true],
    ])('refuses %s with the range and unit in plain words', (_case, value) => {
      expect(validateAdvancedSettingValue(stuckDays, value)).toEqual({
        ok: false,
        error: 'Use a whole number from 7 to 365 days.',
      });
    });

    it('groups thousands in the message', () => {
      const result = validateAdvancedSettingValue(
        numberSetting('compaction.subagentStopWeightedTokens'),
        0,
      );
      expect(result).toEqual({
        ok: false,
        error: 'Use a whole number from 1,000 to 100,000,000 weighted tokens.',
      });
    });

    it('accepts a fraction for a decimal setting and words the error without a unit', () => {
      const minConfidence = numberSetting(
        'skillSynthesis.replayValidation.minConfidence',
      );
      expect(validateAdvancedSettingValue(minConfidence, 0.75)).toEqual({
        ok: true,
        value: 0.75,
      });
      expect(validateAdvancedSettingValue(minConfidence, 1.01)).toEqual({
        ok: false,
        error: 'Use a number from 0 to 1.',
      });
    });

    it('refuses a disagreement threshold above the judge score range', () => {
      const threshold = numberSetting(
        'skillSynthesis.judgePanel.disagreementThreshold',
      );
      expect(validateAdvancedSettingValue(threshold, 9)).toEqual({
        ok: true,
        value: 9,
      });
      expect(validateAdvancedSettingValue(threshold, 9.5)).toEqual({
        ok: false,
        error: 'Use a number from 0 to 9 points.',
      });
    });

    it('refuses cron.maxConcurrentJobs 0, which would stop cron at start-up', () => {
      expect(
        validateAdvancedSettingValue(numberSetting('cron.maxConcurrentJobs'), 0)
          .ok,
      ).toBe(false);
    });
  });

  describe('boolean settings', () => {
    const webSearch = booleanSetting('agentOrchestration.codexWebSearch');

    it('accepts true and false', () => {
      expect(validateAdvancedSettingValue(webSearch, false)).toEqual({
        ok: true,
        value: false,
      });
      expect(validateAdvancedSettingValue(webSearch, true)).toEqual({
        ok: true,
        value: true,
      });
    });

    it.each([
      ['a string', 'true'],
      ['a number', 1],
      ['null', null],
      ['undefined', undefined],
    ])('refuses %s', (_case, value) => {
      expect(validateAdvancedSettingValue(webSearch, value)).toEqual({
        ok: false,
        error: 'Use on or off.',
      });
    });
  });
});
