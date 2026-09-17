/**
 * Unit tests for SessionHistoryReadTiming (TASK_2026_437, C13).
 *
 * A manual clock drives every phase, so the split, the threshold and the
 * per-session rate limit are asserted exactly.
 */
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  SessionHistoryReadTiming,
  SESSION_HISTORY_SLOW_LOG_WINDOW_MS,
  SESSION_HISTORY_SLOW_TABLE_MAX_ENTRIES,
  SESSION_HISTORY_SLOW_WARN_MS_ENV,
} from './session-history-read-timing';

const SLOW_LINE = '[SessionHistoryReader] slow history read';

describe('SessionHistoryReadTiming', () => {
  let clock: number;
  let logger: MockLogger;

  const build = (thresholdMs?: number): SessionHistoryReadTiming =>
    new SessionHistoryReadTiming(logger as unknown as Logger, {
      thresholdMs,
      now: () => clock,
    });

  /** One read: `readMs` loading, then `projectMs` projection. */
  const read = (
    timing: SessionHistoryReadTiming,
    sessionId: string,
    readMs: number,
    projectMs: number,
  ): void => {
    const watch = timing.begin(sessionId);
    clock += readMs;
    watch.readDone(4, 1);
    watch.begin('project');
    clock += projectMs;
    watch.events(9);
    watch.finish(false);
  };

  const slowLines = () =>
    logger.warn.mock.calls.filter(([message]) => message === SLOW_LINE);

  beforeEach(() => {
    clock = 5_000;
    logger = createMockLogger();
  });

  afterEach(() => {
    delete process.env[SESSION_HISTORY_SLOW_WARN_MS_ENV];
  });

  it('splits read, projection and pricing into disjoint phases', () => {
    const timing = build(100);
    const watch = timing.begin('s1');
    clock += 30;
    watch.readDone(12, 2);
    watch.begin('project');
    clock += 50;
    watch.begin('pricing'); // closes the projection half
    clock += 200;
    watch.begin('project');
    clock += 20;
    watch.events(40);
    watch.end();
    clock += 5; // untimed bookkeeping still counts toward durationMs
    watch.finish(false);

    expect(slowLines()).toEqual([
      [
        SLOW_LINE,
        {
          sessionId: 's1',
          durationMs: 305,
          readMs: 30,
          projectMs: 70,
          pricingMs: 200,
          mainMessageCount: 12,
          agentSessionCount: 2,
          eventCount: 40,
          failed: false,
        },
      ],
    ]);
  });

  it('stays silent below the threshold', () => {
    read(build(250), 's1', 100, 100);

    expect(slowLines()).toHaveLength(0);
  });

  it('closes an open phase and reports failed when finished from a catch', () => {
    const timing = build(100);
    const watch = timing.begin('s1');
    clock += 10;
    watch.readDone(3, 0);
    watch.begin('pricing');
    clock += 400; // pricing hydration was running when it threw
    watch.finish(true);
    watch.finish(false); // a second finish is a no-op

    expect(slowLines()).toEqual([
      [
        SLOW_LINE,
        expect.objectContaining({
          pricingMs: 400,
          projectMs: 0,
          eventCount: undefined,
          failed: true,
        }),
      ],
    ]);
  });

  it('does not report a read that failed before its transcript loaded', () => {
    const watch = build(100).begin('s1');
    clock += 1_000;
    watch.finish(true);

    expect(slowLines()).toHaveLength(0);
  });

  it('logs a slow session at most once per window, each session on its own budget', () => {
    const timing = build(100);

    read(timing, 's1', 0, 400);
    read(timing, 's1', 0, 400);
    read(timing, 's2', 0, 400);
    expect(slowLines().map(([, ctx]) => ctx?.['sessionId'])).toEqual([
      's1',
      's2',
    ]);

    clock += SESSION_HISTORY_SLOW_LOG_WINDOW_MS;
    read(timing, 's1', 0, 400);
    expect(slowLines()).toHaveLength(3);
  });

  it('evicts only the least recently slow session at the table cap', () => {
    const timing = build(100);
    read(timing, 'quiet', 0, 400);
    read(timing, 'kept', 0, 400);
    for (let i = 0; i < SESSION_HISTORY_SLOW_TABLE_MAX_ENTRIES - 1; i++) {
      read(timing, `filler-${i}`, 0, 400);
    }
    const linesAfterFill = slowLines().length;

    // 'kept' is still rate limited — a full clear would have let it log.
    read(timing, 'kept', 0, 400);
    expect(slowLines()).toHaveLength(linesAfterFill);
    // 'quiet' was the one evicted, so it logs again inside the window.
    read(timing, 'quiet', 0, 400);
    expect(slowLines()).toHaveLength(linesAfterFill + 1);
  });

  it('reads PTAH_HISTORY_SLOW_WARN_MS when no threshold is passed', () => {
    process.env[SESSION_HISTORY_SLOW_WARN_MS_ENV] = '15';

    read(build(), 's1', 10, 10);

    expect(slowLines()).toHaveLength(1);
  });

  it('never lets a throwing logger escape', () => {
    logger.warn.mockImplementation(() => {
      throw new Error('logger down');
    });

    expect(() => read(build(100), 's1', 0, 400)).not.toThrow();
  });
});
