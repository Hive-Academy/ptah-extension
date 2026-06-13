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
        turnComplete: {
          enabled: SKILL_TRIGGER_DEFAULTS.turnComplete.enabled,
        },
        postToolUse: {
          enabled: SKILL_TRIGGER_DEFAULTS.postToolUse.enabled,
          minEditCount: SKILL_TRIGGER_DEFAULTS.postToolUse.minEditCount,
        },
        maxAnalyzesPerHour: SKILL_TRIGGER_DEFAULTS.maxAnalyzesPerHour,
      });
    });

    it('reads seeded values across all keys', () => {
      const ws = createMockWorkspaceProvider({
        config: {
          [`ptah.${SKILL_TRIGGER_KEYS.sessionEnd}`]: false,
          [`ptah.${SKILL_TRIGGER_KEYS.idleMs}`]: 12000,
          [`ptah.${SKILL_TRIGGER_KEYS.bootScan}`]: false,
          [`ptah.${SKILL_TRIGGER_KEYS.subagentStop.enabled}`]: false,
          [`ptah.${SKILL_TRIGGER_KEYS.turnComplete.enabled}`]: false,
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
        turnComplete: { enabled: false },
        postToolUse: { enabled: false, minEditCount: 9 },
        maxAnalyzesPerHour: 99,
      });
    });

    it('defaults turnComplete to enabled when only that key is unseeded', () => {
      const ws = createMockWorkspaceProvider();
      const out = readSkillTriggers(ws);
      expect(out.turnComplete).toEqual({
        enabled: SKILL_TRIGGER_DEFAULTS.turnComplete.enabled,
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

    it('flattens nested turnComplete object into dotted keys', () => {
      const out = flattenSkillTriggers({
        turnComplete: { enabled: false },
      });
      expect(out).toEqual([[SKILL_TRIGGER_KEYS.turnComplete.enabled, false]]);
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
