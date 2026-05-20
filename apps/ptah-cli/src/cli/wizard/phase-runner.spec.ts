/**
 * Unit tests for `runPhase`.
 *
 * Covers the eight blocker scenarios from the spec:
 *   1. sync happy path → emits start + complete, returns 'completed'
 *   2. sync error → invokes rollback, emits start + error, returns 'failed'
 *   3. sync rollback throws → still emits error notification, no crash, the
 *      original error message survives
 *   4. async-broadcast happy path → listener fires, completion notification
 *      matches
 *   5. async-broadcast timeout → emits error after `timeoutMs`, rollback
 *      invoked
 *   6. async-broadcast `isFailure` returns string → treated as failure
 *   7. progress events forwarded as `setup.phase.progress` with merged payload
 *   8. listeners always detached (verify `adapter.listenerCount(event) === 0`
 *      after every settle)
 */

import { EventEmitter } from 'events';

import { runPhase, type PhaseFn } from './phase-runner.js';
import type { Formatter } from '../output/formatter.js';

interface FormatterTrace {
  notifications: Array<{ method: string; params?: unknown }>;
  formatter: Formatter;
}

function makeFormatter(): FormatterTrace {
  const notifications: FormatterTrace['notifications'] = [];
  const formatter: Formatter = {
    writeNotification: jest.fn(async (method: string, params?: unknown) => {
      notifications.push({ method, params });
    }),
    writeRequest: jest.fn(async () => undefined),
    writeResponse: jest.fn(async () => undefined),
    writeError: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  };
  return { notifications, formatter };
}

describe('runPhase — sync mode', () => {
  it('emits start + complete and returns status: completed on happy path', async () => {
    const { formatter, notifications } = makeFormatter();
    const fn: PhaseFn<{ value: number }> = {
      kind: 'sync',
      run: async () => ({ value: 42 }),
    };

    const result = await runPhase('analyze', fn, { formatter });

    expect(result.status).toBe('completed');
    expect(result.phase).toBe('analyze');
    expect(result.result).toEqual({ value: 42 });
    expect(typeof result.duration_ms).toBe('number');
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(notifications.map((n) => n.method)).toEqual([
      'setup.phase.start',
      'setup.phase.complete',
    ]);
    expect(notifications[0]?.params).toEqual({ phase: 'analyze' });
    expect(notifications[1]?.params).toEqual({
      phase: 'analyze',
      percent: 100,
    });
  });

  it('invokes rollback, emits start + error, returns status: failed when run throws', async () => {
    const { formatter, notifications } = makeFormatter();
    const rollback = jest.fn(async () => undefined);
    const fn: PhaseFn<unknown> = {
      kind: 'sync',
      run: async () => {
        throw new Error('boom');
      },
    };

    const result = await runPhase('install_pack', fn, { formatter, rollback });

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
    expect(result.phase).toBe('install_pack');
    expect(notifications.map((n) => n.method)).toEqual([
      'setup.phase.start',
      'setup.phase.error',
    ]);
    expect(notifications[1]?.params).toEqual({
      phase: 'install_pack',
      error: 'boom',
    });
  });

  it('still emits the error notification when rollback itself throws (original error survives)', async () => {
    const { formatter, notifications } = makeFormatter();
    const stderrWrite = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const rollback = jest.fn(async () => {
      throw new Error('rollback failed');
    });
    const fn: PhaseFn<unknown> = {
      kind: 'sync',
      run: async () => {
        throw new Error('original');
      },
    };

    const result = await runPhase('generate', fn, { formatter, rollback });

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('failed');
    // The ORIGINAL error must surface, not the rollback error.
    expect(result.error).toBe('original');
    expect(notifications.map((n) => n.method)).toEqual([
      'setup.phase.start',
      'setup.phase.error',
    ]);
    expect(notifications[1]?.params).toEqual({
      phase: 'generate',
      error: 'original',
    });
    // Rollback failure surfaces to stderr but does not throw.
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining('rollback failed'),
    );
    stderrWrite.mockRestore();
  });
});

describe('runPhase — async-broadcast mode', () => {
  it('emits complete and returns extracted result when completion event fires (happy path)', async () => {
    const { formatter, notifications } = makeFormatter();
    const adapter = new EventEmitter();
    const submitted = jest.fn(async () => ({ success: true }));

    const fn: PhaseFn<{ generated: number }> = {
      kind: 'async-broadcast',
      run: submitted,
      completionEvent: 'setup-wizard:generation-complete',
      timeoutMs: 60_000,
      adapter,
      extractResult: (payload) => {
        const p = payload as { generatedCount?: number };
        return { generated: p.generatedCount ?? 0 };
      },
      isFailure: () => null,
    };

    // Emit the completion event AFTER `runPhase` registers its listener but
    // BEFORE we await the returned promise. We schedule it on the next tick.
    const promise = runPhase('generate', fn, { formatter });
    setImmediate(() => {
      adapter.emit('setup-wizard:generation-complete', { generatedCount: 7 });
    });
    const result = await promise;

    expect(submitted).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('completed');
    expect(result.result).toEqual({ generated: 7 });
    expect(notifications.map((n) => n.method)).toEqual([
      'setup.phase.start',
      'setup.phase.complete',
    ]);
    // Verify the completion listener was detached.
    expect(adapter.listenerCount('setup-wizard:generation-complete')).toBe(0);
  });

  it('emits error when the timeout fires before the completion event, and invokes rollback', async () => {
    const { formatter, notifications } = makeFormatter();
    const adapter = new EventEmitter();
    const rollback = jest.fn(async () => undefined);

    const fn: PhaseFn<unknown> = {
      kind: 'async-broadcast',
      run: async () => ({ success: true }),
      completionEvent: 'setup-wizard:generation-complete',
      timeoutMs: 5,
      adapter,
      extractResult: (payload) => payload,
      isFailure: () => null,
    };

    const result = await runPhase('generate', fn, { formatter, rollback });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/timed out after 5ms/);
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(notifications.map((n) => n.method)).toEqual([
      'setup.phase.start',
      'setup.phase.error',
    ]);
    expect(adapter.listenerCount('setup-wizard:generation-complete')).toBe(0);
  });

  it('treats isFailure(payload) returning a string as failure with that error', async () => {
    const { formatter, notifications } = makeFormatter();
    const adapter = new EventEmitter();
    const rollback = jest.fn(async () => undefined);

    const fn: PhaseFn<unknown> = {
      kind: 'async-broadcast',
      run: async () => ({ success: true }),
      completionEvent: 'setup-wizard:generation-complete',
      timeoutMs: 60_000,
      adapter,
      extractResult: (payload) => payload,
      isFailure: (payload) => {
        const p = payload as { success?: boolean; errors?: string[] };
        if (p.success === false) {
          return p.errors?.[0] ?? 'generation failed';
        }
        return null;
      },
    };

    const promise = runPhase('generate', fn, { formatter, rollback });
    setImmediate(() => {
      adapter.emit('setup-wizard:generation-complete', {
        success: false,
        errors: ['agent template missing'],
      });
    });
    const result = await promise;

    expect(result.status).toBe('failed');
    expect(result.error).toBe('agent template missing');
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(notifications.map((n) => n.method)).toEqual([
      'setup.phase.start',
      'setup.phase.error',
    ]);
    expect(adapter.listenerCount('setup-wizard:generation-complete')).toBe(0);
  });

  it('forwards progress events as setup.phase.progress with merged { phase, ...payload }', async () => {
    const { formatter, notifications } = makeFormatter();
    const adapter = new EventEmitter();

    const fn: PhaseFn<unknown> = {
      kind: 'async-broadcast',
      run: async () => ({ success: true }),
      completionEvent: 'setup-wizard:generation-complete',
      progressEvents: [
        'setup-wizard:generation-progress',
        'setup-wizard:generation-stream',
      ],
      timeoutMs: 60_000,
      adapter,
      extractResult: (payload) => payload,
      isFailure: () => null,
    };

    const promise = runPhase('generate', fn, { formatter });
    setImmediate(() => {
      adapter.emit('setup-wizard:generation-progress', {
        progress: { phase: 'analysis', percentComplete: 25 },
      });
      adapter.emit('setup-wizard:generation-stream', { chunk: 'hello' });
      adapter.emit('setup-wizard:generation-complete', { success: true });
    });
    await promise;

    const progressFrames = notifications.filter(
      (n) => n.method === 'setup.phase.progress',
    );
    expect(progressFrames).toHaveLength(2);
    expect(progressFrames[0]?.params).toEqual({
      phase: 'generate',
      progress: { phase: 'analysis', percentComplete: 25 },
    });
    expect(progressFrames[1]?.params).toEqual({
      phase: 'generate',
      chunk: 'hello',
    });

    // All progress + completion listeners must be detached on settle.
    expect(adapter.listenerCount('setup-wizard:generation-complete')).toBe(0);
    expect(adapter.listenerCount('setup-wizard:generation-progress')).toBe(0);
    expect(adapter.listenerCount('setup-wizard:generation-stream')).toBe(0);
  });
});
