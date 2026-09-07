import 'reflect-metadata';
import type { DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES, isActivityEventPayload } from '@ptah-extension/shared';
import type {
  JobHandler,
  JobHandlerContext,
} from '@ptah-extension/cron-scheduler';

import { createActivityEmitter, withActivityEmit } from './activity-emitter';

function makeContainer(
  entries: Array<[unknown, unknown]>,
): DependencyContainer {
  const map = new Map<unknown, unknown>(entries);
  return {
    isRegistered: (token: unknown) => map.has(token),
    resolve: (token: unknown) => {
      if (!map.has(token)) throw new Error(`not registered: ${String(token)}`);
      return map.get(token);
    },
  } as unknown as DependencyContainer;
}

const CTX = {
  signal: new AbortController().signal,
} as unknown as JobHandlerContext;

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('createActivityEmitter', () => {
  it('broadcasts a well-formed activity payload', () => {
    const broadcastMessage = jest.fn().mockResolvedValue(undefined);
    const emit = createActivityEmitter(
      makeContainer([[TOKENS.WEBVIEW_MANAGER, { broadcastMessage }]]),
    );

    emit('cron', 'backup:daily', 'backup written to /tmp/a.sqlite');

    expect(broadcastMessage).toHaveBeenCalledTimes(1);
    const [type, payload] = broadcastMessage.mock.calls[0];
    expect(type).toBe(MESSAGE_TYPES.ACTIVITY_EVENT);
    // The renderer's admission gate is the contract, so assert against it
    // rather than against a field list this spec would have to keep in step.
    expect(isActivityEventPayload(payload)).toBe(true);
    expect(payload).toMatchObject({
      source: 'cron',
      kind: 'backup:daily',
      summary: 'backup written to /tmp/a.sqlite',
    });
  });

  it('omits `level` when the caller did not supply one', () => {
    const broadcastMessage = jest.fn().mockResolvedValue(undefined);
    const emit = createActivityEmitter(
      makeContainer([[TOKENS.WEBVIEW_MANAGER, { broadcastMessage }]]),
    );

    emit('harness', 'reconcile', 'Harness reconciled');

    expect(broadcastMessage.mock.calls[0][1]).not.toHaveProperty('level');
  });

  it('passes `warn` through when supplied', () => {
    const broadcastMessage = jest.fn().mockResolvedValue(undefined);
    const emit = createActivityEmitter(
      makeContainer([[TOKENS.WEBVIEW_MANAGER, { broadcastMessage }]]),
    );

    emit('cron', 'skills:drain:frequent', 'skipped (on-battery)', 'warn');

    expect(broadcastMessage.mock.calls[0][1]).toMatchObject({ level: 'warn' });
  });

  it('emits nothing and throws nothing without a WEBVIEW_MANAGER', () => {
    // The CLI and every test host: no webview at all. A broadcast failure must
    // never break the pipeline it was narrating.
    const container = makeContainer([]);
    const resolve = jest.spyOn(container, 'resolve');
    const emit = createActivityEmitter(container);

    expect(() => emit('cron', 'backup:daily', 'done')).not.toThrow();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('resolves the manager lazily, per emit', () => {
    const broadcastMessage = jest.fn().mockResolvedValue(undefined);
    const container = makeContainer([]);
    const emit = createActivityEmitter(container);

    emit('cron', 'backup:daily', 'first');
    jest.spyOn(container, 'isRegistered').mockReturnValue(true);
    jest.spyOn(container, 'resolve').mockReturnValue({ broadcastMessage });
    emit('cron', 'backup:daily', 'second');

    expect(broadcastMessage).toHaveBeenCalledTimes(1);
  });

  it('swallows a synchronous throw from the manager', () => {
    const emit = createActivityEmitter(
      makeContainer([
        [
          TOKENS.WEBVIEW_MANAGER,
          {
            broadcastMessage: () => {
              throw new Error('no window');
            },
          },
        ],
      ]),
    );

    expect(() => emit('cron', 'backup:daily', 'done')).not.toThrow();
    expect(console.warn).toHaveBeenCalled();
  });

  it('swallows a rejected broadcast', async () => {
    const emit = createActivityEmitter(
      makeContainer([
        [
          TOKENS.WEBVIEW_MANAGER,
          { broadcastMessage: jest.fn().mockRejectedValue(new Error('ipc')) },
        ],
      ]),
    );

    emit('cron', 'backup:daily', 'done');
    await Promise.resolve();
    await Promise.resolve();

    expect(console.warn).toHaveBeenCalled();
  });
});

describe('withActivityEmit', () => {
  it('returns the handler original result unchanged', async () => {
    const emit = jest.fn();
    const original = { summary: 'backup written to /tmp/a.sqlite' };
    const wrapped = withActivityEmit(
      emit,
      'backup:daily',
      (async () => original) as JobHandler,
    );

    await expect(wrapped(CTX)).resolves.toBe(original);
  });

  it('emits exactly one info event for a successful run', async () => {
    const emit = jest.fn();
    const wrapped = withActivityEmit(emit, 'backup:daily', (async () => ({
      summary: 'backup written',
    })) as JobHandler);

    await wrapped(CTX);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('cron', 'backup:daily', 'backup written');
  });

  it('emits a warn event carrying the skip reason', async () => {
    const emit = jest.fn();
    const wrapped = withActivityEmit(
      emit,
      'skills:drain:frequent',
      (async () => ({
        outcome: 'skipped' as const,
        reason: 'daily-token-budget-exhausted',
      })) as JobHandler,
    );

    const result = await wrapped(CTX);

    expect(result).toEqual({
      outcome: 'skipped',
      reason: 'daily-token-budget-exhausted',
    });
    expect(emit).toHaveBeenCalledWith(
      'cron',
      'skills:drain:frequent',
      'skills:drain:frequent skipped (daily-token-budget-exhausted)',
      'warn',
    );
  });

  it('falls back to a generic summary when the handler returned none', async () => {
    const emit = jest.fn();
    const wrapped = withActivityEmit(
      emit,
      'db:integrity',
      (async () => ({})) as JobHandler,
    );

    await wrapped(CTX);

    expect(emit).toHaveBeenCalledWith(
      'cron',
      'db:integrity',
      'db:integrity completed',
    );
  });

  it('rethrows a failing handler and emits nothing', async () => {
    // The ticker has no `error` level on purpose; the scheduler's run row is
    // the channel for a failed run. Swallowing here would also turn a failure
    // into a success.
    const emit = jest.fn();
    const wrapped = withActivityEmit(emit, 'backup:daily', (async () => {
      throw new Error('disk full');
    }) as JobHandler);

    await expect(wrapped(CTX)).rejects.toThrow('disk full');
    expect(emit).not.toHaveBeenCalled();
  });
});
