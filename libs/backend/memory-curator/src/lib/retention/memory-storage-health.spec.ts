import {
  RETENTION_HEALTH_MIN_ATTEMPTS,
  RETENTION_HEALTH_MIN_AGE_MS,
  RETENTION_HEALTH_STALL_MS,
  RETENTION_HEALTH_STALL_PENDING_ROWS,
} from './memory-retention-config';
import { computeRetentionHealthVerdict } from './memory-storage-health';

const NOW = 1_900_000_000_000;
const neverCompleted = {
  lastCompletedAt: null,
  attemptCount: RETENTION_HEALTH_MIN_ATTEMPTS,
  firstAttemptAt: NOW - RETENTION_HEALTH_MIN_AGE_MS - 1,
  backlogRemaining: false,
};

describe('retention health verdict', () => {
  it('pins all four health thresholds to the agreed literal values', () => {
    expect(RETENTION_HEALTH_MIN_ATTEMPTS).toBe(72);
    expect(RETENTION_HEALTH_MIN_AGE_MS).toBe(259_200_000);
    expect(RETENTION_HEALTH_STALL_MS).toBe(604_800_000);
    expect(RETENTION_HEALTH_STALL_PENDING_ROWS).toBe(10_000);
  });

  it('distinguishes a failed state read from an absent row, with disabled taking priority', () => {
    expect(computeRetentionHealthVerdict(true, undefined, NOW, 10_001)).toBe(
      'unknown',
    );
    expect(computeRetentionHealthVerdict(true, null, NOW, 10_001)).toBe(
      'healthy',
    );
    expect(computeRetentionHealthVerdict(false, undefined, NOW, 10_001)).toBe(
      'disabled',
    );
  });

  it('detects an old clean completion when live pending rows strictly exceed the bound', () => {
    const completed = {
      ...neverCompleted,
      lastCompletedAt: NOW - RETENTION_HEALTH_STALL_MS - 1,
    };
    expect(computeRetentionHealthVerdict(true, completed, NOW, 10_001)).toBe(
      'stalled',
    );
    for (const pending of [null, 0, 9_999, 10_000]) {
      expect(computeRetentionHealthVerdict(true, completed, NOW, pending)).toBe(
        'healthy',
      );
    }
    expect(
      computeRetentionHealthVerdict(
        true,
        { ...completed, lastCompletedAt: NOW - RETENTION_HEALTH_STALL_MS },
        NOW,
        10_001,
      ),
    ).toBe('healthy');
    expect(computeRetentionHealthVerdict(false, completed, NOW, 10_001)).toBe(
      'disabled',
    );
  });

  it('clamps ages when the clock moves backwards past recorded timestamps', () => {
    const firstAttemptAt = NOW;
    expect(
      computeRetentionHealthVerdict(
        true,
        { ...neverCompleted, firstAttemptAt },
        NOW - 1,
        null,
      ),
    ).toBe('healthy');
    expect(
      computeRetentionHealthVerdict(
        true,
        { ...neverCompleted, firstAttemptAt },
        NOW + RETENTION_HEALTH_MIN_AGE_MS + 1,
        null,
      ),
    ).toBe('never-completed');
    expect(
      computeRetentionHealthVerdict(
        true,
        { ...neverCompleted, lastCompletedAt: NOW, backlogRemaining: true },
        NOW - 1,
        10_001,
      ),
    ).toBe('healthy');
  });

  it('prioritizes disabled over both faults and absent history', () => {
    for (const state of [
      null,
      neverCompleted,
      {
        ...neverCompleted,
        lastCompletedAt: 0,
        backlogRemaining: true,
      },
    ]) {
      expect(computeRetentionHealthVerdict(false, state, NOW, null)).toBe(
        'disabled',
      );
    }
  });

  it('requires at least 72 attempts AND strictly more than 72 hours', () => {
    expect(computeRetentionHealthVerdict(true, neverCompleted, NOW, null)).toBe(
      'never-completed',
    );
    for (const state of [
      null,
      { ...neverCompleted, attemptCount: RETENTION_HEALTH_MIN_ATTEMPTS - 1 },
      { ...neverCompleted, firstAttemptAt: null },
      { ...neverCompleted, firstAttemptAt: NOW },
      { ...neverCompleted, firstAttemptAt: NOW + 1 },
      { ...neverCompleted, firstAttemptAt: NOW - RETENTION_HEALTH_MIN_AGE_MS },
    ]) {
      expect(computeRetentionHealthVerdict(true, state, NOW, null)).toBe(
        'healthy',
      );
    }
  });

  it('requires an old completion AND backlog for stalled, regardless of attempts', () => {
    const stalled = {
      ...neverCompleted,
      attemptCount: 0,
      firstAttemptAt: null,
      lastCompletedAt: NOW - RETENTION_HEALTH_STALL_MS - 1,
      backlogRemaining: true,
    };
    expect(computeRetentionHealthVerdict(true, stalled, NOW, null)).toBe(
      'stalled',
    );
    expect(
      computeRetentionHealthVerdict(
        true,
        { ...stalled, backlogRemaining: false },
        NOW,
        null,
      ),
    ).toBe('healthy');
    expect(
      computeRetentionHealthVerdict(
        true,
        { ...stalled, lastCompletedAt: NOW - RETENTION_HEALTH_STALL_MS },
        NOW,
        null,
      ),
    ).toBe('healthy');
    expect(
      computeRetentionHealthVerdict(
        true,
        { ...stalled, lastCompletedAt: NOW },
        NOW,
        null,
      ),
    ).toBe('healthy');
  });

  it('treats epoch zero as a real first-attempt timestamp', () => {
    expect(
      computeRetentionHealthVerdict(
        true,
        { ...neverCompleted, firstAttemptAt: 0 },
        NOW,
        null,
      ),
    ).toBe('never-completed');
  });
});
