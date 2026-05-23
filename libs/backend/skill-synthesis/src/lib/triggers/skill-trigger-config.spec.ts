import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import {
  SKILL_TRIGGER_DEFAULTS,
  SKILL_TRIGGER_KEYS,
  flattenSkillTriggers,
  readSkillTriggers,
} from './skill-trigger-config';

describe('skill-trigger-config', () => {
  describe('readSkillTriggers', () => {
    it('returns DEFAULTS when nothing seeded', () => {
      const ws = createMockWorkspaceProvider();
      const out = readSkillTriggers(ws);
      expect(out).toEqual({
        sessionEnd: SKILL_TRIGGER_DEFAULTS.sessionEnd,
        idleMs: SKILL_TRIGGER_DEFAULTS.idleMs,
        bootScan: SKILL_TRIGGER_DEFAULTS.bootScan,
        subagentStop: {
          enabled: SKILL_TRIGGER_DEFAULTS.subagentStop.enabled,
        },
        postToolUse: {
          enabled: SKILL_TRIGGER_DEFAULTS.postToolUse.enabled,
          minEditCount: SKILL_TRIGGER_DEFAULTS.postToolUse.minEditCount,
        },
        maxAnalyzesPerHour: SKILL_TRIGGER_DEFAULTS.maxAnalyzesPerHour,
      });
    });

    it('reads seeded values across all seven keys', () => {
      const ws = createMockWorkspaceProvider({
        config: {
          [`ptah.${SKILL_TRIGGER_KEYS.sessionEnd}`]: false,
          [`ptah.${SKILL_TRIGGER_KEYS.idleMs}`]: 12000,
          [`ptah.${SKILL_TRIGGER_KEYS.bootScan}`]: false,
          [`ptah.${SKILL_TRIGGER_KEYS.subagentStop.enabled}`]: false,
          [`ptah.${SKILL_TRIGGER_KEYS.postToolUse.enabled}`]: false,
          [`ptah.${SKILL_TRIGGER_KEYS.postToolUse.minEditCount}`]: 9,
          [`ptah.${SKILL_TRIGGER_KEYS.maxAnalyzesPerHour}`]: 99,
        },
      });
      const out = readSkillTriggers(ws);
      expect(out).toEqual({
        sessionEnd: false,
        idleMs: 12000,
        bootScan: false,
        subagentStop: { enabled: false },
        postToolUse: { enabled: false, minEditCount: 9 },
        maxAnalyzesPerHour: 99,
      });
    });
  });

  describe('flattenSkillTriggers', () => {
    it('flattens nested postToolUse object into dotted keys', () => {
      const out = flattenSkillTriggers({
        postToolUse: { enabled: false, minEditCount: 5 },
      });
      expect(out).toEqual(
        expect.arrayContaining([
          [SKILL_TRIGGER_KEYS.postToolUse.enabled, false],
          [SKILL_TRIGGER_KEYS.postToolUse.minEditCount, 5],
        ]),
      );
      expect(out).toHaveLength(2);
    });

    it('emits leaf keys for scalar fields', () => {
      const out = flattenSkillTriggers({
        sessionEnd: false,
        idleMs: 60,
        maxAnalyzesPerHour: 10,
      });
      expect(out).toEqual([
        [SKILL_TRIGGER_KEYS.sessionEnd, false],
        [SKILL_TRIGGER_KEYS.idleMs, 60],
        [SKILL_TRIGGER_KEYS.maxAnalyzesPerHour, 10],
      ]);
    });

    it('skips undefined entries', () => {
      const out = flattenSkillTriggers({
        sessionEnd: undefined,
        idleMs: 1,
      });
      expect(out).toEqual([[SKILL_TRIGGER_KEYS.idleMs, 1]]);
    });
  });
});
