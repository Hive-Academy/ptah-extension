import type { Logger } from '@ptah-extension/vscode-core';
import type { GeneratingSession } from './session-turn-state.registry';
import {
  STALE_GENERATING_CEILING_MS,
  TurnStateForegroundSource,
  type ForegroundSourceClock,
} from './turn-state-foreground-source';

/**
 * TASK_2026_437 C14 — the foreground signal must not hold background work
 * forever behind a `generating` record whose teardown never ran. Fake registry,
 * fake clock: the ceiling is an hour.
 */

function createLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function createClock(start = 0) {
  let now = start;
  let nextId = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const clock: ForegroundSourceClock = {
    now: () => now,
    setTimeout: (callback, ms) => {
      const id = nextId++;
      pending.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimeout: (handle) => {
      pending.delete(handle as number);
    },
  };
  return {
    clock,
    get pendingCount() {
      return pending.size;
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...pending]) {
        if (timer.at <= now) {
          pending.delete(id);
          timer.callback();
        }
      }
    },
  };
}

function createRegistry() {
  let sessions: GeneratingSession[] = [];
  const listeners = new Set<() => void>();
  return {
    listeners,
    source: {
      generatingSessions: () => sessions,
      onGeneratingChange: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    set(next: GeneratingSession[]) {
      sessions = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

function setup() {
  const logger = createLogger();
  const clock = createClock(10_000);
  const registry = createRegistry();
  const source = new TurnStateForegroundSource(
    registry.source,
    logger as unknown as Logger,
    clock.clock,
  );
  return { logger, clock, registry, source };
}

describe('TurnStateForegroundSource', () => {
  it('is busy while a session generates and idle when none does', () => {
    const { registry, source } = setup();
    expect(source.isForegroundBusy()).toBe(false);
    registry.set([{ sessionId: 's1', since: 10_000 }]);
    expect(source.isForegroundBusy()).toBe(true);
    registry.set([]);
    expect(source.isForegroundBusy()).toBe(false);
  });

  it('forwards registry notifications to its listeners', () => {
    const { registry, source } = setup();
    const listener = jest.fn();
    source.onForegroundChange(listener);
    registry.set([{ sessionId: 's1', since: 10_000 }]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops counting a record at the stale ceiling, notifies, and warns once', () => {
    const { registry, source, clock, logger } = setup();
    const listener = jest.fn(() => source.isForegroundBusy());
    source.onForegroundChange(listener);
    registry.set([{ sessionId: 'stuck', since: 10_000 }]);
    expect(source.isForegroundBusy()).toBe(true);
    listener.mockClear();

    clock.advance(STALE_GENERATING_CEILING_MS - 1);
    expect(listener).not.toHaveBeenCalled();
    clock.advance(1);

    // The timer re-notified, so the governor re-reads without any transition.
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveLastReturnedWith(false);
    expect(source.isForegroundBusy()).toBe(false);
    expect(source.isForegroundBusy()).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('past the stale ceiling'),
      expect.objectContaining({
        sessionId: 'stuck',
        staleCeilingMs: STALE_GENERATING_CEILING_MS,
      }),
    );
  });

  it('stays busy for a fresh session beside a stale one', () => {
    const { registry, source, clock } = setup();
    source.onForegroundChange(() => undefined);
    registry.set([{ sessionId: 'stuck', since: 10_000 }]);
    clock.advance(STALE_GENERATING_CEILING_MS);
    registry.set([
      { sessionId: 'stuck', since: 10_000 },
      { sessionId: 'live', since: clock.clock.now() },
    ]);
    expect(source.isForegroundBusy()).toBe(true);
  });

  it('warns again for a NEW stale turn after the old one settled', () => {
    const { registry, source, clock, logger } = setup();
    source.onForegroundChange(() => undefined);
    registry.set([{ sessionId: 's1', since: 10_000 }]);
    clock.advance(STALE_GENERATING_CEILING_MS);
    source.isForegroundBusy();
    registry.set([]);
    source.isForegroundBusy();

    const since = clock.clock.now();
    registry.set([{ sessionId: 's1', since }]);
    clock.advance(STALE_GENERATING_CEILING_MS);
    source.isForegroundBusy();
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('isolates a throwing listener', () => {
    const { registry, source, logger } = setup();
    const later = jest.fn();
    source.onForegroundChange(() => {
      throw new Error('boom');
    });
    source.onForegroundChange(later);
    expect(() => registry.set([])).not.toThrow();
    expect(later).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[TurnStateForegroundSource] foreground listener threw',
      { reason: 'boom' },
    );
  });

  it('unsubscribes from the registry and clears its timer when the last listener leaves', () => {
    const { registry, source, clock } = setup();
    const unsubscribe = source.onForegroundChange(() => undefined);
    registry.set([{ sessionId: 's1', since: 10_000 }]);
    source.isForegroundBusy();
    expect(clock.pendingCount).toBe(1);

    unsubscribe();
    expect(registry.listeners.size).toBe(0);
    expect(clock.pendingCount).toBe(0);
  });
});
