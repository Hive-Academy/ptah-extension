/**
 * Tab-state write back-off after a failed save (TASK_2026_437 C17, INV-10).
 *
 * Pure helpers, so the clock is an argument: every case passes `now`.
 */

import {
  PERSIST_BACKOFF_BASE_MS,
  PERSIST_BACKOFF_MAX_MS,
  nextPersistFailure,
  persistBackedOff,
  persistBackoffMs,
  type PersistFailure,
} from './tab-persistence';

describe('tab persistence back-off', () => {
  describe('persistBackoffMs', () => {
    it('doubles from 5 s per consecutive failure', () => {
      expect(PERSIST_BACKOFF_BASE_MS).toBe(5_000);
      expect([0, 1, 2, 3, 4, 5].map(persistBackoffMs)).toEqual([
        5_000, 10_000, 20_000, 40_000, 80_000, 160_000,
      ]);
    });

    it('is capped at 5 min, including for attempts that overflow 2^n', () => {
      expect(PERSIST_BACKOFF_MAX_MS).toBe(300_000);
      expect(persistBackoffMs(6)).toBe(300_000);
      expect(persistBackoffMs(60)).toBe(300_000);
      expect(persistBackoffMs(5_000)).toBe(300_000);
    });
  });

  describe('nextPersistFailure', () => {
    it('starts at attempt 0 and counts consecutive failures under one key', () => {
      const first = nextPersistFailure(null, 'k', 3, 1_000);
      expect(first).toEqual({
        key: 'k',
        failedAt: 1_000,
        attempt: 0,
        tabCount: 3,
      });

      const second = nextPersistFailure(first, 'k', 2, 7_000);
      expect(second).toEqual({
        key: 'k',
        failedAt: 7_000,
        attempt: 1,
        tabCount: 2,
      });
    });

    it('restarts at attempt 0 when a different key fails', () => {
      const other: PersistFailure = {
        key: 'workspace-a',
        failedAt: 0,
        attempt: 4,
        tabCount: 1,
      };
      expect(nextPersistFailure(other, 'workspace-b', 1, 10).attempt).toBe(0);
    });
  });

  describe('persistBackedOff', () => {
    const failure: PersistFailure = {
      key: 'k',
      failedAt: 100_000,
      attempt: 1, // 10 s window
      tabCount: 3,
    };

    it('does not back off without a failure', () => {
      expect(persistBackedOff(null, 'k', 3, 100_000)).toBe(false);
    });

    it('backs off until failedAt + window, then lets the save through', () => {
      expect(persistBackedOff(failure, 'k', 3, 100_000)).toBe(true);
      expect(persistBackedOff(failure, 'k', 3, 109_999)).toBe(true);
      expect(persistBackedOff(failure, 'k', 3, 110_000)).toBe(false);
    });

    it('still backs off when the tab set grew or stayed the same size', () => {
      expect(persistBackedOff(failure, 'k', 4, 101_000)).toBe(true);
    });

    it('retries at once when the tab set shrank', () => {
      expect(persistBackedOff(failure, 'k', 2, 101_000)).toBe(false);
    });

    it('does not back off a different storage key', () => {
      expect(persistBackedOff(failure, 'other', 3, 101_000)).toBe(false);
    });
  });
});
