import { CompactionCoordinator } from './compaction-coordinator';
import {
  COMPACTION_ALREADY_RUNNING_MESSAGE,
  COMPACTION_MAX_DWELL_MS,
  CompactionState,
  type CompactionSessionClass,
  type CompactionStateChange,
  type CompactionTimers,
} from './compaction-state.types';

const ACTIVE: CompactionSessionClass = { codexProxy: false, e2Passed: true };
const SID = 'session-1';

/** Manual timer seam: records pending callbacks and fires them on demand. */
class FakeTimers implements CompactionTimers {
  private next = 1;
  readonly pending = new Map<number, { callback: () => void; ms: number }>();

  setTimeout(callback: () => void, ms: number): number {
    const id = this.next++;
    this.pending.set(id, { callback, ms });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  fireAll(): void {
    const entries = [...this.pending.entries()];
    this.pending.clear();
    for (const [, entry] of entries) entry.callback();
  }
}

describe('CompactionCoordinator', () => {
  let timers: FakeTimers;
  let coordinator: CompactionCoordinator;
  let changes: CompactionStateChange[];

  beforeEach(() => {
    timers = new FakeTimers();
    coordinator = new CompactionCoordinator(timers);
    changes = [];
    coordinator.subscribe((change) => changes.push(change));
  });

  afterEach(() => coordinator.dispose());

  const arm = (sessionId = SID) =>
    coordinator.onContextUsage(sessionId, {
      totalTokens: 160_000,
      maxTokens: 200_000,
    });

  describe('register and session class', () => {
    it('starts an acting class in IDLE', () => {
      expect(coordinator.register(SID, ACTIVE)).toBe(CompactionState.IDLE);
      expect(coordinator.getState(SID)).toBe(CompactionState.IDLE);
    });

    it('puts the Codex proxy path in OBSERVE_ONLY', () => {
      expect(
        coordinator.register(SID, { codexProxy: true, e2Passed: true }),
      ).toBe(CompactionState.OBSERVE_ONLY);
    });

    it.each([null, false])(
      'puts a class whose E2 is %p in OBSERVE_ONLY (the default class)',
      (e2Passed) => {
        expect(
          coordinator.register(SID, { codexProxy: false, e2Passed }),
        ).toBe(CompactionState.OBSERVE_ONLY);
      },
    );

    it('never leaves OBSERVE_ONLY, never initiates and never dedupes', () => {
      coordinator.register(SID, { codexProxy: false, e2Passed: null });
      expect(arm()).toBe(false);
      expect(coordinator.onPreCompact(SID, 'auto')).toBe(false);
      expect(coordinator.onStatusCompacting(SID)).toBe(false);
      expect(coordinator.onCompactBoundary(SID, { preTokens: 1 })).toBe(false);
      expect(coordinator.onTurnEnd(SID)).toBe(false);
      expect(coordinator.shouldInitiateCompact(SID)).toBe(false);
      expect(coordinator.requestManualCompact(SID)).toEqual({
        action: 'send',
      });
      expect(coordinator.getState(SID)).toBe(CompactionState.OBSERVE_ONLY);
      expect(changes).toEqual([]);
      expect(timers.pending.size).toBe(0);
    });

    it('ignores events for an unknown session', () => {
      expect(arm('nope')).toBe(false);
      expect(coordinator.onPreCompact('nope', 'manual')).toBe(false);
      expect(coordinator.getState('nope')).toBeUndefined();
    });
  });

  describe('transitions', () => {
    beforeEach(() => coordinator.register(SID, ACTIVE));

    it('IDLE → ARMED at 80% of the effective window', () => {
      expect(
        coordinator.onContextUsage(SID, {
          totalTokens: 159_999,
          maxTokens: 200_000,
        }),
      ).toBe(false);
      expect(arm()).toBe(true);
      expect(changes).toEqual([
        { sessionId: SID, from: 'IDLE', to: 'ARMED', trigger: 'threshold' },
      ]);
      expect(coordinator.shouldInitiateCompact(SID)).toBe(true);
    });

    it('does not arm on an unknown window', () => {
      expect(
        coordinator.onContextUsage(SID, { totalTokens: 10, maxTokens: 0 }),
      ).toBe(false);
      expect(coordinator.getState(SID)).toBe(CompactionState.IDLE);
    });

    it('ARMED → TRIGGERED on PreCompact auto', () => {
      arm();
      expect(coordinator.onPreCompact(SID, 'auto')).toBe(true);
      expect(changes[1]).toEqual({
        sessionId: SID,
        from: 'ARMED',
        to: 'TRIGGERED',
        trigger: 'auto',
      });
      expect(timers.pending.size).toBe(1);
      expect([...timers.pending.values()][0].ms).toBe(COMPACTION_MAX_DWELL_MS);
    });

    it('IDLE → TRIGGERED on PreCompact manual', () => {
      expect(coordinator.onPreCompact(SID, 'manual')).toBe(true);
      expect(changes).toEqual([
        { sessionId: SID, from: 'IDLE', to: 'TRIGGERED', trigger: 'manual' },
      ]);
    });

    it('TRIGGERED → COMPACTING on status compacting', () => {
      coordinator.onPreCompact(SID, 'manual');
      expect(coordinator.onStatusCompacting(SID)).toBe(true);
      expect(changes[1]).toMatchObject({
        from: 'TRIGGERED',
        to: 'COMPACTING',
        trigger: 'status-compacting',
      });
    });

    it('COMPACTING → COOLDOWN on compact_boundary with pre/post tokens', () => {
      coordinator.onPreCompact(SID, 'auto');
      coordinator.onStatusCompacting(SID);
      expect(
        coordinator.onCompactBoundary(SID, {
          preTokens: 170_000,
          postTokens: 20_000,
        }),
      ).toBe(true);
      expect(changes[2]).toEqual({
        sessionId: SID,
        from: 'COMPACTING',
        to: 'COOLDOWN',
        trigger: 'compact-boundary',
        preTokens: 170_000,
        postTokens: 20_000,
      });
      expect(timers.pending.size).toBe(0);
    });

    it('TRIGGERED → COOLDOWN on compact_boundary when the status message was missed', () => {
      coordinator.onPreCompact(SID, 'auto');
      expect(coordinator.onCompactBoundary(SID, { preTokens: 5 })).toBe(true);
      expect(changes[1]).toEqual({
        sessionId: SID,
        from: 'TRIGGERED',
        to: 'COOLDOWN',
        trigger: 'compact-boundary',
        preTokens: 5,
      });
      expect(timers.pending.size).toBe(0);
    });

    it('COOLDOWN → IDLE after the next turn', () => {
      coordinator.onPreCompact(SID, 'auto');
      coordinator.onCompactBoundary(SID, { preTokens: 1, postTokens: 0 });
      expect(coordinator.onTurnEnd(SID)).toBe(true);
      expect(changes[2]).toMatchObject({
        from: 'COOLDOWN',
        to: 'IDLE',
        trigger: 'turn-end',
      });
    });

    it('TRIGGERED → BACKOFF when no boundary arrives within the dwell', () => {
      coordinator.onPreCompact(SID, 'auto');
      timers.fireAll();
      expect(changes[1]).toMatchObject({
        from: 'TRIGGERED',
        to: 'BACKOFF',
        trigger: 'dwell-timeout',
      });
    });

    it('COMPACTING → BACKOFF when no boundary arrives within the dwell', () => {
      coordinator.onPreCompact(SID, 'auto');
      coordinator.onStatusCompacting(SID);
      timers.fireAll();
      expect(changes[2]).toMatchObject({
        from: 'COMPACTING',
        to: 'BACKOFF',
        trigger: 'dwell-timeout',
      });
      expect(coordinator.onCompactBoundary(SID, { preTokens: 1 })).toBe(false);
    });

    it('BACKOFF → IDLE after one turn', () => {
      coordinator.onPreCompact(SID, 'auto');
      timers.fireAll();
      expect(coordinator.onTurnEnd(SID)).toBe(true);
      expect(changes[2]).toMatchObject({
        from: 'BACKOFF',
        to: 'IDLE',
        trigger: 'turn-end',
      });
    });

    it('ignores out-of-order events', () => {
      expect(coordinator.onStatusCompacting(SID)).toBe(false);
      expect(coordinator.onCompactBoundary(SID, { preTokens: 1 })).toBe(false);
      expect(coordinator.onTurnEnd(SID)).toBe(false);
      coordinator.onPreCompact(SID, 'auto');
      expect(coordinator.onPreCompact(SID, 'manual')).toBe(false);
      expect(arm()).toBe(false);
      expect(timers.pending.size).toBe(1);
    });
  });

  describe('dwell timeout', () => {
    it('uses the real 300 s bound with the default timers', () => {
      expect(COMPACTION_MAX_DWELL_MS).toBe(300_000);
      jest.useFakeTimers();
      try {
        const real = new CompactionCoordinator();
        real.register(SID, ACTIVE);
        real.onPreCompact(SID, 'auto');
        jest.advanceTimersByTime(COMPACTION_MAX_DWELL_MS - 1);
        expect(real.getState(SID)).toBe(CompactionState.TRIGGERED);
        jest.advanceTimersByTime(1);
        expect(real.getState(SID)).toBe(CompactionState.BACKOFF);
        real.dispose();
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not fire for a session unregistered before the timeout', () => {
      coordinator.register(SID, ACTIVE);
      coordinator.onPreCompact(SID, 'auto');
      coordinator.unregister(SID);
      expect(timers.pending.size).toBe(0);
      expect(changes).toHaveLength(1);
    });
  });

  describe('manual /compact dedupe', () => {
    beforeEach(() => coordinator.register(SID, ACTIVE));

    it('sends when no compaction is open', () => {
      expect(coordinator.requestManualCompact(SID)).toEqual({
        action: 'send',
      });
      arm();
      expect(coordinator.requestManualCompact(SID)).toEqual({
        action: 'send',
      });
    });

    it.each(['TRIGGERED', 'COMPACTING'])(
      'dedupes while %s with "compaction already running"',
      (state) => {
        coordinator.onPreCompact(SID, 'manual');
        if (state === 'COMPACTING') coordinator.onStatusCompacting(SID);
        expect(coordinator.requestManualCompact(SID)).toEqual({
          action: 'deduped',
          message: COMPACTION_ALREADY_RUNNING_MESSAGE,
        });
        expect(COMPACTION_ALREADY_RUNNING_MESSAGE).toBe(
          'compaction already running',
        );
      },
    );

    it('sends again once the compaction closed', () => {
      coordinator.onPreCompact(SID, 'manual');
      coordinator.onCompactBoundary(SID, { preTokens: 1 });
      expect(coordinator.requestManualCompact(SID)).toEqual({
        action: 'send',
      });
    });
  });

  describe('rebind on PostCompact session_id', () => {
    beforeEach(() => coordinator.register(SID, ACTIVE));

    it('moves the state and the open timer to the new session id', () => {
      coordinator.onPreCompact(SID, 'auto');
      expect(coordinator.onPostCompact(SID, 'session-2')).toBe(true);
      expect(coordinator.getState(SID)).toBeUndefined();
      expect(coordinator.getState('session-2')).toBe(
        CompactionState.TRIGGERED,
      );
      expect(coordinator.onCompactBoundary('session-2', { preTokens: 9 })).toBe(
        true,
      );
      expect(changes[1]).toMatchObject({
        sessionId: 'session-2',
        from: 'TRIGGERED',
        to: 'COOLDOWN',
      });
      expect(timers.pending.size).toBe(0);
    });

    it('fires the dwell timeout under the new session id', () => {
      coordinator.onPreCompact(SID, 'auto');
      coordinator.onPostCompact(SID, 'session-2');
      timers.fireAll();
      expect(changes[1]).toMatchObject({
        sessionId: 'session-2',
        to: 'BACKOFF',
      });
    });

    it('is a no-op for the same, an empty or an unknown id', () => {
      expect(coordinator.onPostCompact(SID, SID)).toBe(false);
      expect(coordinator.onPostCompact(SID, '')).toBe(false);
      expect(coordinator.onPostCompact('unknown', 'session-2')).toBe(false);
      expect(coordinator.getState(SID)).toBe(CompactionState.IDLE);
    });

    it('replaces a record already held under the new id and clears its timer', () => {
      coordinator.register('session-2', ACTIVE);
      coordinator.onPreCompact('session-2', 'auto');
      expect(timers.pending.size).toBe(1);
      coordinator.onPostCompact(SID, 'session-2');
      expect(timers.pending.size).toBe(0);
      expect(coordinator.getState('session-2')).toBe(CompactionState.IDLE);
    });
  });

  describe('subscribers', () => {
    it('keeps the transition and later subscribers when one throws', () => {
      const microtasks: Array<() => void> = [];
      const spy = jest
        .spyOn(globalThis, 'queueMicrotask')
        .mockImplementation((cb) => microtasks.push(cb));
      try {
        const later = jest.fn();
        coordinator.subscribe(() => {
          throw new Error('boom');
        });
        coordinator.subscribe(later);
        coordinator.register(SID, ACTIVE);
        arm();
        expect(coordinator.getState(SID)).toBe(CompactionState.ARMED);
        expect(later).toHaveBeenCalledTimes(1);
        expect(microtasks).toHaveLength(1);
        expect(() => microtasks[0]()).toThrow('boom');
      } finally {
        spy.mockRestore();
      }
    });

    it('stops notifying after unsubscribe', () => {
      const listener = jest.fn();
      const unsubscribe = coordinator.subscribe(listener);
      unsubscribe();
      coordinator.register(SID, ACTIVE);
      arm();
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('clears timers and sessions, and is idempotent', () => {
      coordinator.register(SID, ACTIVE);
      coordinator.onPreCompact(SID, 'auto');
      coordinator.dispose();
      expect(timers.pending.size).toBe(0);
      expect(coordinator.getState(SID)).toBeUndefined();
      expect(() => coordinator.dispose()).not.toThrow();
    });

    it('ignores every call after dispose', () => {
      coordinator.dispose();
      expect(coordinator.register(SID, ACTIVE)).toBeUndefined();
      expect(arm()).toBe(false);
      expect(coordinator.onPreCompact(SID, 'auto')).toBe(false);
      const listener = jest.fn();
      coordinator.subscribe(listener)();
      expect(timers.pending.size).toBe(0);
      expect(changes).toEqual([]);
    });
  });
});
