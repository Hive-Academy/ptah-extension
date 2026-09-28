import { EventEmitter } from 'events';
import * as fs from 'fs';
import {
  armBootGuards,
  bootStep,
  disarmBootGuards,
  type BootProcessEvents,
  lastBootStep,
  RENDERER_LOADED_STEP,
  reportBootFailure,
} from './boot-trace';

// `fs.writeSync` is a non-configurable export, so it is replaced at module
// level rather than spied on.
jest.mock('fs', () => ({
  ...jest.requireActual<typeof import('fs')>('fs'),
  writeSync: jest.fn(),
}));

/**
 * The start-up trace (TASK_2026_556). A boot that stalls short of the renderer
 * must name where it stopped, and a boot that fails must never be silent — the
 * original report had neither, which is why the stall read as a hang.
 */

describe('boot-trace', () => {
  const writeSync = jest.mocked(fs.writeSync);
  let written: string[];

  beforeEach(() => {
    jest.useFakeTimers();
    written = [];
    writeSync.mockReset();
    writeSync.mockImplementation((fd: number, data: unknown) => {
      if (fd === 2) written.push(String(data));
      return 0;
    });
  });

  /** A real emitter standing in for `process`, so listeners are countable. */
  function arm(exit: (code: number) => void = jest.fn()): EventEmitter {
    const events = new EventEmitter();
    armBootGuards({
      goal: RENDERER_LOADED_STEP,
      timeoutMs: 20_000,
      exit,
      processEvents: events as unknown as BootProcessEvents,
    });
    return events;
  }

  function listeners(events: EventEmitter): number {
    return (
      events.listenerCount('uncaughtException') +
      events.listenerCount('unhandledRejection')
    );
  }

  afterEach(() => {
    disarmBootGuards();
    jest.useRealTimers();
  });

  it('writes each step synchronously to stderr and remembers the last one', () => {
    bootStep('preparing shell loaded');

    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(
      /^\[Ptah Boot \+\d+ms\] preparing shell loaded\n$/,
    );
    expect(lastBootStep()).toBe('preparing shell loaded');
  });

  it('names the last step reached when the renderer never loads', () => {
    arm();
    bootStep('MCP server started');

    jest.advanceTimersByTime(20_000);

    expect(written[written.length - 1]).toBe(
      `[Ptah Boot] WATCHDOG: "${RENDERER_LOADED_STEP}" not reached after 20000ms (last step: MCP server started)\n`,
    );
  });

  it('stays quiet once the goal step is reached', () => {
    arm();
    bootStep(RENDERER_LOADED_STEP);
    const before = written.length;

    jest.advanceTimersByTime(60_000);

    expect(written).toHaveLength(before);
  });

  it('stays quiet after an explicit disarm (recovery shell, failed boot)', () => {
    arm();
    disarmBootGuards();

    jest.advanceTimersByTime(60_000);

    expect(written).toHaveLength(0);
  });

  it('reports a failure with its stack and the last step', () => {
    bootStep('bootstrapElectron done');
    written.length = 0;

    reportBootFailure('Start-up failed', new Error('registerRpcSurface threw'));

    expect(written).toHaveLength(1);
    expect(written[0]).toContain(
      '[Ptah Boot] Start-up failed (last step: bootstrapElectron done): Error: registerRpcSurface threw',
    );
    expect(written[0]).toContain('boot-trace.spec.ts');
  });

  it('reports a non-Error rejection as its string form', () => {
    reportBootFailure('UNHANDLED_REJECTION', 'plain string');

    expect(written[written.length - 1]).toMatch(
      /UNHANDLED_REJECTION .*: plain string\n$/,
    );
  });

  it('never throws when stderr is gone', () => {
    writeSync.mockImplementation(() => {
      throw new Error('EPIPE');
    });

    expect(() => bootStep('whenReady')).not.toThrow();
    expect(() => reportBootFailure('x', new Error('y'))).not.toThrow();
  });

  describe('process-level handlers — boot window only (round 1, D1)', () => {
    it('exits non-zero after logging an uncaught exception during boot', () => {
      const exit = jest.fn();
      const events = arm(exit);
      bootStep('bootstrapElectron done');

      events.emit('uncaughtException', new Error('handler threw'));

      expect(written[written.length - 1]).toContain(
        '[Ptah Boot] UNCAUGHT_EXCEPTION during boot (last step: bootstrapElectron done): Error: handler threw',
      );
      jest.runOnlyPendingTimers();
      expect(exit).toHaveBeenCalledWith(1);
    });

    it('lets a later listener (Sentry) run before it exits (round 2, D1)', () => {
      const order: string[] = [];
      const events = arm(() => order.push('exit'));
      events.on('uncaughtException', () => order.push('sentry'));

      events.emit('uncaughtException', new Error('handler threw'));
      expect(order).toEqual(['sentry']);

      jest.runOnlyPendingTimers();
      expect(order).toEqual(['sentry', 'exit']);
    });

    it('still exits when stderr is gone', () => {
      const exit = jest.fn();
      const events = arm(exit);
      writeSync.mockImplementation(() => {
        throw new Error('EBADF');
      });

      events.emit('uncaughtException', new Error('handler threw'));

      jest.runOnlyPendingTimers();
      expect(exit).toHaveBeenCalledWith(1);
    });

    it('logs an unhandled rejection during boot without exiting', () => {
      const exit = jest.fn();
      const events = arm(exit);

      events.emit('unhandledRejection', new Error('late promise'));

      expect(written[written.length - 1]).toContain(
        'UNHANDLED_REJECTION during boot',
      );
      expect(exit).not.toHaveBeenCalled();
    });

    it('removes both handlers once the renderer has loaded', () => {
      const exit = jest.fn();
      const events = arm(exit);
      expect(listeners(events)).toBe(2);

      bootStep(RENDERER_LOADED_STEP);

      expect(listeners(events)).toBe(0);
      // A crash later in the session is no longer ours to handle.
      expect(events.emit('uncaughtException', new Error('after boot'))).toBe(
        false,
      );
      expect(exit).not.toHaveBeenCalled();
    });

    it('removes both handlers when the boot ends another way', () => {
      const events = arm();

      disarmBootGuards();

      expect(listeners(events)).toBe(0);
    });

    it('leaves the real process with no extra listeners after boot', () => {
      const before = {
        exception: process.listenerCount('uncaughtException'),
        rejection: process.listenerCount('unhandledRejection'),
      };
      armBootGuards({
        goal: RENDERER_LOADED_STEP,
        timeoutMs: 20_000,
        exit: jest.fn(),
      });
      expect(process.listenerCount('uncaughtException')).toBe(
        before.exception + 1,
      );

      bootStep(RENDERER_LOADED_STEP);

      expect(process.listenerCount('uncaughtException')).toBe(before.exception);
      expect(process.listenerCount('unhandledRejection')).toBe(
        before.rejection,
      );
    });

    it('clears the watchdog timer when the boot finishes', () => {
      arm();
      expect(jest.getTimerCount()).toBe(1);

      bootStep(RENDERER_LOADED_STEP);

      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
