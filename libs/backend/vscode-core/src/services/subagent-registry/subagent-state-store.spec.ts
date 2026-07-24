import 'reflect-metadata';

import type { Logger } from '../../logging';
import type { SubagentRecord } from '@ptah-extension/shared';
import {
  SubagentStateStore,
  TTL_MS,
  CLEANUP_INTERVAL_MS,
} from './subagent-state-store';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function makeRecord(overrides: Partial<SubagentRecord> = {}): SubagentRecord {
  return {
    toolCallId: 'tc-1',
    sessionId: 'sess-1',
    agentType: 'test-agent',
    status: 'running',
    startedAt: Date.now(),
    parentSessionId: 'parent-1',
    agentId: 'a1',
    ...overrides,
  } as SubagentRecord;
}

describe('SubagentStateStore', () => {
  let logger: jest.Mocked<Logger>;
  let store: SubagentStateStore;

  beforeEach(() => {
    logger = makeLogger();
    store = new SubagentStateStore(logger);
  });

  describe('basic CRUD', () => {
    it('set and getRaw and has return expected values', () => {
      const record = makeRecord({ toolCallId: 'tc-a' });
      expect(store.has('tc-a')).toBe(false);
      store.set('tc-a', record);
      expect(store.has('tc-a')).toBe(true);
      expect(store.getRaw('tc-a')).toBe(record);
    });

    it('delete removes a record and returns true; returns false when absent', () => {
      store.set('tc-b', makeRecord({ toolCallId: 'tc-b' }));
      expect(store.delete('tc-b')).toBe(true);
      expect(store.has('tc-b')).toBe(false);
      expect(store.delete('tc-b')).toBe(false);
    });

    it('size reflects current entry count', () => {
      expect(store.size).toBe(0);
      store.set('tc-1', makeRecord({ toolCallId: 'tc-1' }));
      store.set('tc-2', makeRecord({ toolCallId: 'tc-2' }));
      expect(store.size).toBe(2);
    });

    it('entries() returns iterable key-value pairs', () => {
      store.set('tc-x', makeRecord({ toolCallId: 'tc-x' }));
      const pairs = Array.from(store.entries());
      expect(pairs).toHaveLength(1);
      expect(pairs[0][0]).toBe('tc-x');
    });

    it('values() returns iterable records', () => {
      store.set('tc-v', makeRecord({ toolCallId: 'tc-v' }));
      const vals = Array.from(store.values());
      expect(vals).toHaveLength(1);
      expect(vals[0].toolCallId).toBe('tc-v');
    });

    it('clear wipes all state', () => {
      store.set('tc-1', makeRecord({ toolCallId: 'tc-1' }));
      store.markPendingBackground('tc-2');
      store.markInjected('tc-3');
      store.clear();
      expect(store.size).toBe(0);
      expect(store.pendingBackgroundCount).toBe(0);
      expect(store.clearedCount).toBe(0);
    });
  });

  describe('pending background', () => {
    it('markPendingBackground and consumePendingBackground', () => {
      store.markPendingBackground('tc-bg');
      expect(store.pendingBackgroundCount).toBe(1);

      const consumed = store.consumePendingBackground('tc-bg');
      expect(consumed).toBe(true);
      expect(store.pendingBackgroundCount).toBe(0);
    });

    it('consumePendingBackground returns false for unknown id', () => {
      expect(store.consumePendingBackground('no-such')).toBe(false);
    });
  });

  describe('pending teammate name', () => {
    it('markPendingTeammateName and consumePendingTeammateName round-trip', () => {
      store.markPendingTeammateName('tc-name', 'backend-developer');

      const consumed = store.consumePendingTeammateName('tc-name');
      expect(consumed).toBe('backend-developer');
    });

    it('consumePendingTeammateName returns undefined for unknown id', () => {
      expect(store.consumePendingTeammateName('no-such')).toBeUndefined();
    });

    it('consumePendingTeammateName is single-consume — a second call returns undefined', () => {
      store.markPendingTeammateName('tc-once', 'reviewer');
      expect(store.consumePendingTeammateName('tc-once')).toBe('reviewer');
      expect(store.consumePendingTeammateName('tc-once')).toBeUndefined();
    });

    it('clear() wipes pending teammate names', () => {
      store.markPendingTeammateName('tc-cleared', 'planner');
      store.clear();

      expect(store.consumePendingTeammateName('tc-cleared')).toBeUndefined();
    });

    it('peekPendingTeammateName is non-consuming — repeated peeks return the name', () => {
      store.markPendingTeammateName('tc-peek', 'architect');

      expect(store.peekPendingTeammateName('tc-peek')).toBe('architect');
      expect(store.peekPendingTeammateName('tc-peek')).toBe('architect');
      // consume still works after peeking
      expect(store.consumePendingTeammateName('tc-peek')).toBe('architect');
    });

    it('peekPendingTeammateName returns undefined for unknown id', () => {
      expect(store.peekPendingTeammateName('no-such')).toBeUndefined();
    });
  });

  describe('injected tracking', () => {
    it('markInjected and wasInjected', () => {
      expect(store.wasInjected('tc-inj')).toBe(false);
      store.markInjected('tc-inj');
      expect(store.wasInjected('tc-inj')).toBe(true);
      expect(store.clearedCount).toBe(1);
    });
  });

  describe('isExpired', () => {
    it('returns false for a freshly started record', () => {
      const record = makeRecord({ startedAt: Date.now() });
      expect(store.isExpired(record)).toBe(false);
    });

    it('returns true for a record older than TTL_MS', () => {
      const record = makeRecord({ startedAt: Date.now() - TTL_MS - 1 });
      expect(store.isExpired(record)).toBe(true);
    });

    it('returns false for background records regardless of age', () => {
      const record = makeRecord({
        startedAt: Date.now() - TTL_MS - 1,
        isBackground: true,
      });
      expect(store.isExpired(record)).toBe(false);
    });

    it('returns false for status=background records regardless of age', () => {
      const record = makeRecord({
        startedAt: Date.now() - TTL_MS - 1,
        status: 'background',
      });
      expect(store.isExpired(record)).toBe(false);
    });
  });

  describe('lazyCleanup', () => {
    it('does not run cleanup when called twice within CLEANUP_INTERVAL_MS', () => {
      store.set(
        'tc-stale',
        makeRecord({
          toolCallId: 'tc-stale',
          startedAt: Date.now() - TTL_MS - 1,
        }),
      );
      store.lazyCleanup();
      const sizeAfterFirst = store.size;

      store.lazyCleanup();
      expect(store.size).toBe(sizeAfterFirst);
    });

    it('removes expired records and old clearedIds on cleanup', () => {
      jest.useFakeTimers();
      const now = Date.now();

      store.set(
        'tc-expired',
        makeRecord({ toolCallId: 'tc-expired', startedAt: now - TTL_MS - 1 }),
      );
      store.set(
        'tc-fresh',
        makeRecord({ toolCallId: 'tc-fresh', startedAt: now }),
      );
      store.markInjected('tc-old-cleared');

      jest.setSystemTime(now - TTL_MS - 1);
      store.markInjected('tc-old-cleared');
      jest.setSystemTime(now + CLEANUP_INTERVAL_MS + 1);

      store.lazyCleanup();

      expect(store.has('tc-expired')).toBe(false);
      expect(store.has('tc-fresh')).toBe(true);

      jest.useRealTimers();
    });

    it('skips logging when nothing was removed', () => {
      jest.useFakeTimers();
      const now = Date.now();
      jest.setSystemTime(now + CLEANUP_INTERVAL_MS + 1);

      store.set(
        'tc-fresh',
        makeRecord({
          toolCallId: 'tc-fresh',
          startedAt: now + CLEANUP_INTERVAL_MS + 1,
        }),
      );

      store.lazyCleanup();

      expect(logger.info).not.toHaveBeenCalled();

      jest.useRealTimers();
    });
  });
});
