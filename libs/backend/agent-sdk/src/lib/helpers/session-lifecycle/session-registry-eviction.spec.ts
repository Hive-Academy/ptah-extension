import type { Logger } from '@ptah-extension/vscode-core';
import type { AISessionConfig } from '@ptah-extension/shared';

import {
  SessionRegistry,
  DEFAULT_SWEEP_INTERVAL_MS,
  DEFAULT_SWEEP_TTL_MS,
  type SessionRecord,
} from './session-registry.service';

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function makeConfig(overrides: Partial<AISessionConfig> = {}): AISessionConfig {
  return {
    model: 'test-model',
    projectPath: '/tmp/test',
    ...overrides,
  } as AISessionConfig;
}

function makeRegistry(): { registry: SessionRegistry; logger: Logger } {
  const logger = makeLogger();
  const registry = new SessionRegistry(logger);
  return { registry, logger };
}

describe('SessionRegistry — eviction sweep (Batch C)', () => {
  describe('evictStale', () => {
    it('preserves a record with query !== null even when past TTL', () => {
      const { registry } = makeRegistry();
      let now = 1_000_000;
      registry.setClockForTesting(() => now);

      registry.register('tab_active', makeConfig(), new AbortController());
      const rec = registry.find('tab_active') as SessionRecord;
      rec.query = { fake: true } as unknown as SessionRecord['query'];

      now += DEFAULT_SWEEP_TTL_MS + 1000;
      const evicted = registry.evictStale(now, DEFAULT_SWEEP_TTL_MS);

      expect(evicted).toBe(0);
      expect(registry.find('tab_active')).toBeDefined();
    });

    it('removes a record past TTL with query === null from both indexes', () => {
      const { registry } = makeRegistry();
      let now = 1_000_000;
      registry.setClockForTesting(() => now);

      registry.register('tab_dead', makeConfig(), new AbortController());
      registry.bindRealSessionId('tab_dead', 'real-dead');

      now += DEFAULT_SWEEP_TTL_MS + 1000;
      const evicted = registry.evictStale(now, DEFAULT_SWEEP_TTL_MS);

      expect(evicted).toBe(1);
      expect(registry.find('tab_dead')).toBeUndefined();
      expect(registry.find('real-dead')).toBeUndefined();

      const r = registry as unknown as {
        byTabId: Map<string, SessionRecord>;
        bySessionId: Map<string, SessionRecord>;
      };
      expect(r.byTabId.size).toBe(0);
      expect(r.bySessionId.size).toBe(0);
    });

    it('does not evict a record under the TTL', () => {
      const { registry } = makeRegistry();
      let now = 1_000_000;
      registry.setClockForTesting(() => now);

      registry.register('tab_fresh', makeConfig(), new AbortController());

      now += 1000;
      const evicted = registry.evictStale(now, DEFAULT_SWEEP_TTL_MS);

      expect(evicted).toBe(0);
      expect(registry.find('tab_fresh')).toBeDefined();
    });

    it('falls back via recomputeLastActiveOnRemoval when evicting the most-recent', () => {
      const { registry } = makeRegistry();
      let now = 1_000_000;
      registry.setClockForTesting(() => now);

      registry.register('tab_keep', makeConfig(), new AbortController());
      now += 100;
      registry.register('tab_evict', makeConfig(), new AbortController());

      now += DEFAULT_SWEEP_TTL_MS + 1000;
      const evicted = registry.evictStale(now, DEFAULT_SWEEP_TTL_MS);

      expect(evicted).toBe(2);
      const r = registry as unknown as { _lastActiveTabId: string | null };
      expect(r._lastActiveTabId).toBeNull();
    });

    it('logs a warn for each eviction', () => {
      const { registry, logger } = makeRegistry();
      let now = 1_000_000;
      registry.setClockForTesting(() => now);

      registry.register('tab_w1', makeConfig(), new AbortController());
      registry.register('tab_w2', makeConfig(), new AbortController());

      now += DEFAULT_SWEEP_TTL_MS + 1000;
      registry.evictStale(now, DEFAULT_SWEEP_TTL_MS);

      const warnCalls = (logger.warn as jest.Mock).mock.calls;
      const evictionWarns = warnCalls.filter((c) =>
        String(c[0]).includes('Evicted stale session record'),
      );
      expect(evictionWarns.length).toBe(2);
    });
  });

  describe('lastActivityAt updates', () => {
    it('register sets lastActivityAt to the current clock value', () => {
      const { registry } = makeRegistry();
      const fixed = 42_000;
      registry.setClockForTesting(() => fixed);

      registry.register('tab_t1', makeConfig(), new AbortController());
      const rec = registry.find('tab_t1') as SessionRecord;
      expect(rec.lastActivityAt).toBe(fixed);
    });

    it('bindRealSessionId bumps lastActivityAt', () => {
      const { registry } = makeRegistry();
      let now = 1000;
      registry.setClockForTesting(() => now);

      registry.register('tab_bump', makeConfig(), new AbortController());
      now = 5000;
      registry.bindRealSessionId('tab_bump', 'real-bump');

      const rec = registry.find('tab_bump') as SessionRecord;
      expect(rec.lastActivityAt).toBe(5000);
    });

    it('markActive bumps lastActivityAt on the marked record', () => {
      const { registry } = makeRegistry();
      let now = 1000;
      registry.setClockForTesting(() => now);

      registry.register('tab_active', makeConfig(), new AbortController());
      now = 9999;
      registry.markActive('tab_active');

      const rec = registry.find('tab_active') as SessionRecord;
      expect(rec.lastActivityAt).toBe(9999);
    });

    it('setSessionQuery bumps lastActivityAt', () => {
      const { registry } = makeRegistry();
      let now = 1000;
      registry.setClockForTesting(() => now);

      registry.register('tab_setq', makeConfig(), new AbortController());
      now = 7777;
      registry.setSessionQuery(
        'tab_setq' as never,
        { fake: true } as unknown as never,
      );

      const rec = registry.find('tab_setq') as SessionRecord;
      expect(rec.lastActivityAt).toBe(7777);
    });
  });

  describe('startEvictionSweep / stopEvictionSweep', () => {
    it('startEvictionSweep schedules an interval timer', () => {
      jest.useFakeTimers();
      try {
        const { registry } = makeRegistry();
        const setIntervalSpy = jest.spyOn(global, 'setInterval');

        registry.startEvictionSweep();

        expect(setIntervalSpy).toHaveBeenCalledTimes(1);
        const interval = setIntervalSpy.mock.calls[0][1];
        expect(interval).toBe(DEFAULT_SWEEP_INTERVAL_MS);

        registry.stopEvictionSweep();
        setIntervalSpy.mockRestore();
      } finally {
        jest.useRealTimers();
      }
    });

    it('stopEvictionSweep clears the interval', () => {
      jest.useFakeTimers();
      try {
        const { registry } = makeRegistry();
        const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

        registry.startEvictionSweep();
        registry.stopEvictionSweep();

        expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
        const r = registry as unknown as {
          _sweepTimer: ReturnType<typeof setInterval> | null;
        };
        expect(r._sweepTimer).toBeNull();
        clearIntervalSpy.mockRestore();
      } finally {
        jest.useRealTimers();
      }
    });

    it('stopEvictionSweep is idempotent when no timer is running', () => {
      const { registry } = makeRegistry();
      expect(() => registry.stopEvictionSweep()).not.toThrow();
    });

    it('starting twice replaces the previous timer (single-timer invariant)', () => {
      jest.useFakeTimers();
      try {
        const { registry } = makeRegistry();
        const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

        registry.startEvictionSweep();
        registry.startEvictionSweep();

        expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

        registry.stopEvictionSweep();
        clearIntervalSpy.mockRestore();
      } finally {
        jest.useRealTimers();
      }
    });

    it('sweep fires after intervalMs and evicts stale records', () => {
      jest.useFakeTimers();
      try {
        const { registry } = makeRegistry();
        let now = 1_000_000;
        registry.setClockForTesting(() => now);

        registry.register('tab_stale', makeConfig(), new AbortController());

        registry.startEvictionSweep(10_000, 5_000);

        now += 20_000;
        jest.advanceTimersByTime(10_000);

        expect(registry.find('tab_stale')).toBeUndefined();
        registry.stopEvictionSweep();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('perf-regression: bulk eviction sweep', () => {
    it('evicts 1000 dead records in a single sweep and clears both indexes', () => {
      const { registry } = makeRegistry();
      let now = 1_000_000;
      registry.setClockForTesting(() => now);

      for (let i = 0; i < 1000; i++) {
        registry.register(`tab_${i}`, makeConfig(), new AbortController());
        registry.bindRealSessionId(`tab_${i}`, `real_${i}`);
      }

      const r = registry as unknown as {
        byTabId: Map<string, SessionRecord>;
        bySessionId: Map<string, SessionRecord>;
      };
      expect(r.byTabId.size).toBe(1000);
      expect(r.bySessionId.size).toBe(1000);

      now += DEFAULT_SWEEP_TTL_MS + 1000;
      const evicted = registry.evictStale(now, DEFAULT_SWEEP_TTL_MS);

      expect(evicted).toBe(1000);
      expect(r.byTabId.size).toBe(0);
      expect(r.bySessionId.size).toBe(0);
    });
  });
});
