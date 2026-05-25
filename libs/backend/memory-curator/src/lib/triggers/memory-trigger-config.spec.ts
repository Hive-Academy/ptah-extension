import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import {
  DEFAULT_CUE_LIST,
  MEMORY_TRIGGER_DEFAULTS,
  MEMORY_TRIGGER_KEYS,
  flattenMemoryTriggers,
  readMemoryTriggers,
} from './memory-trigger-config';

describe('memory-trigger-config', () => {
  describe('readMemoryTriggers', () => {
    it('returns DEFAULTS when nothing seeded', () => {
      const ws = createMockWorkspaceProvider();
      const out = readMemoryTriggers(ws);
      expect(out.preCompact).toBe(MEMORY_TRIGGER_DEFAULTS.preCompact);
      expect(out.idleMs).toBe(MEMORY_TRIGGER_DEFAULTS.idleMs);
      expect(out.turnThreshold).toBe(MEMORY_TRIGGER_DEFAULTS.turnThreshold);
      expect(out.bootScan).toBe(MEMORY_TRIGGER_DEFAULTS.bootScan);
      expect(out.userPromptSubmit.enabled).toBe(
        MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.enabled,
      );
      expect(out.userPromptSubmit.cueList).toBe(DEFAULT_CUE_LIST);
      expect(out.userPromptSubmit.minPromptLength).toBe(
        MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.minPromptLength,
      );
      expect(out.postToolUse.enabled).toBe(
        MEMORY_TRIGGER_DEFAULTS.postToolUse.enabled,
      );
      expect(out.maxCuratesPerHour).toBe(
        MEMORY_TRIGGER_DEFAULTS.maxCuratesPerHour,
      );
    });

    it('reads seeded values across all keys', () => {
      const ws = createMockWorkspaceProvider({
        config: {
          [`ptah.${MEMORY_TRIGGER_KEYS.preCompact}`]: false,
          [`ptah.${MEMORY_TRIGGER_KEYS.idleMs}`]: 30000,
          [`ptah.${MEMORY_TRIGGER_KEYS.turnThreshold}`]: 4,
          [`ptah.${MEMORY_TRIGGER_KEYS.bootScan}`]: false,
          [`ptah.${MEMORY_TRIGGER_KEYS.userPromptSubmit.enabled}`]: false,
          [`ptah.${MEMORY_TRIGGER_KEYS.userPromptSubmit.cueList}`]: [
            'custom-cue',
          ],
          [`ptah.${MEMORY_TRIGGER_KEYS.userPromptSubmit.minPromptLength}`]: 5,
          [`ptah.${MEMORY_TRIGGER_KEYS.postToolUse.enabled}`]: false,
          [`ptah.${MEMORY_TRIGGER_KEYS.turnComplete.enabled}`]: false,
          [`ptah.${MEMORY_TRIGGER_KEYS.episode.enabled}`]: false,
          [`ptah.${MEMORY_TRIGGER_KEYS.sessionEnd.enabled}`]: false,
          [`ptah.${MEMORY_TRIGGER_KEYS.maxCuratesPerHour}`]: 24,
        },
      });
      const out = readMemoryTriggers(ws);
      expect(out).toEqual({
        preCompact: false,
        idleMs: 30000,
        turnThreshold: 4,
        bootScan: false,
        userPromptSubmit: {
          enabled: false,
          cueList: ['custom-cue'],
          minPromptLength: 5,
        },
        postToolUse: { enabled: false },
        turnComplete: { enabled: false },
        episode: { enabled: false },
        sessionEnd: { enabled: false },
        maxCuratesPerHour: 24,
      });
    });

    it('falls back to DEFAULTS for non-array cueList', () => {
      const ws = createMockWorkspaceProvider({
        config: {
          [`ptah.${MEMORY_TRIGGER_KEYS.userPromptSubmit.cueList}`]:
            'not-an-array',
        },
      });
      const out = readMemoryTriggers(ws);
      expect(out.userPromptSubmit.cueList).toBe(
        MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.cueList,
      );
    });
  });

  describe('flattenMemoryTriggers', () => {
    it('flattens nested userPromptSubmit object into dotted keys', () => {
      const out = flattenMemoryTriggers({
        userPromptSubmit: {
          enabled: true,
          cueList: ['a', 'b'],
          minPromptLength: 7,
        },
      });
      expect(out).toEqual(
        expect.arrayContaining([
          [MEMORY_TRIGGER_KEYS.userPromptSubmit.enabled, true],
          [MEMORY_TRIGGER_KEYS.userPromptSubmit.cueList, ['a', 'b']],
          [MEMORY_TRIGGER_KEYS.userPromptSubmit.minPromptLength, 7],
        ]),
      );
      expect(out).toHaveLength(3);
    });

    it('emits leaf keys for scalar fields', () => {
      const out = flattenMemoryTriggers({
        preCompact: false,
        idleMs: 99,
        maxCuratesPerHour: 50,
      });
      expect(out).toEqual([
        [MEMORY_TRIGGER_KEYS.preCompact, false],
        [MEMORY_TRIGGER_KEYS.idleMs, 99],
        [MEMORY_TRIGGER_KEYS.maxCuratesPerHour, 50],
      ]);
    });

    it('skips undefined entries', () => {
      const out = flattenMemoryTriggers({
        preCompact: undefined,
        idleMs: 42,
      });
      expect(out).toEqual([[MEMORY_TRIGGER_KEYS.idleMs, 42]]);
    });

    it('treats arrays as leaves, not as recursive objects', () => {
      const out = flattenMemoryTriggers({
        userPromptSubmit: {
          enabled: true,
          cueList: ['x', 'y'],
          minPromptLength: 10,
        },
      });
      const cueEntry = out.find(
        ([k]) => k === MEMORY_TRIGGER_KEYS.userPromptSubmit.cueList,
      );
      expect(cueEntry?.[1]).toEqual(['x', 'y']);
    });
  });
});
