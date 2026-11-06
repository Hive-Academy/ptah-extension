import { EventEmitter } from 'node:events';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  installMainProcessErrorGuard,
  installMainProcessErrorGuardFrom,
  type GuardServiceSource,
} from './main-process-error-guard';

describe('installMainProcessErrorGuardFrom', () => {
  it('installs the guard from a container with Logger and SentryService', () => {
    const events = new EventEmitter();
    const logger = { error: jest.fn() };
    const sentry = { captureException: jest.fn() };
    const container: GuardServiceSource = {
      isRegistered: () => true,
      resolve<T>(token: symbol): T {
        return (token === TOKENS.LOGGER ? logger : sentry) as T;
      },
    };
    const dispose = installMainProcessErrorGuardFrom(container, events);
    events.emit('uncaughtException', new Error('late'));
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    dispose?.();
    expect(events.listenerCount('uncaughtException')).toBe(0);
  });

  it('reports and returns null without a container', () => {
    const events = new EventEmitter();
    expect(installMainProcessErrorGuardFrom(null, events)).toBeNull();
    expect(events.listenerCount('uncaughtException')).toBe(0);
  });

  it('never throws when resolving a service throws', () => {
    const events = new EventEmitter();
    const container: GuardServiceSource = {
      isRegistered: () => true,
      resolve<T>(): T {
        throw new Error('resolve failed');
      },
    };
    expect(() =>
      installMainProcessErrorGuardFrom(container, events),
    ).not.toThrow();
    expect(events.listenerCount('uncaughtException')).toBe(0);
  });
});

describe('installMainProcessErrorGuard', () => {
  it('logs and reports post-boot exceptions without exiting, then disposes', () => {
    const events = new EventEmitter();
    const logger = { error: jest.fn() };
    const sentry = { captureException: jest.fn() };
    const dispose = installMainProcessErrorGuard(
      logger,
      sentry,
      events,
    );
    const destroyed = new TypeError('Object has been destroyed');
    events.emit('uncaughtException', destroyed);
    events.emit('unhandledRejection', 'late rejection');
    expect(logger.error).toHaveBeenNthCalledWith(
      1,
      '[Ptah Electron] uncaughtException after boot',
      destroyed,
    );
    expect(logger.error.mock.calls[1]?.[1]).toBeInstanceOf(Error);
    expect(sentry.captureException).toHaveBeenCalledTimes(2);
    expect(sentry.captureException).toHaveBeenNthCalledWith(1, destroyed, {
      errorSource: 'electron-main-uncaughtException',
    });
    dispose();
    expect(events.listenerCount('uncaughtException')).toBe(0);
    expect(events.listenerCount('unhandledRejection')).toBe(0);
  });
});
