import { EventEmitter } from 'node:events';
import { TOKENS } from '@ptah-extension/vscode-core';
import { reportBootFailure } from './boot-trace';
import {
  installMainProcessErrorGuard,
  installMainProcessErrorGuardFrom,
  type GuardServiceSource,
} from './main-process-error-guard';

jest.mock('./boot-trace', () => ({
  ...jest.requireActual('./boot-trace'),
  reportBootFailure: jest.fn(),
}));

describe('installMainProcessErrorGuardFrom', () => {
  it('installs the guard from a container with Logger', () => {
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
    expect(sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      errorSource: 'electron-main-uncaughtException',
    });
    dispose?.();
    expect(events.listenerCount('uncaughtException')).toBe(0);
  });

  it('reports and returns null without a container', () => {
    const events = new EventEmitter();
    expect(installMainProcessErrorGuardFrom(null, events)).toBeNull();
    expect(events.listenerCount('uncaughtException')).toBe(0);
  });

  it('installs logging without a registered Sentry service', () => {
    const events = new EventEmitter();
    const logger = { error: jest.fn() };
    const container: GuardServiceSource = {
      isRegistered: (token) => token === TOKENS.LOGGER,
      resolve<T>(token: symbol): T {
        if (token !== TOKENS.LOGGER) throw new Error('unexpected token');
        return logger as T;
      },
    };
    const dispose = installMainProcessErrorGuardFrom(container, events);
    expect(dispose).not.toBeNull();
    events.emit('uncaughtException', new Error('late'));
    expect(logger.error).toHaveBeenCalledTimes(1);
    dispose?.();
  });

  it('does not install without Logger', () => {
    const events = new EventEmitter();
    const container: GuardServiceSource = {
      isRegistered: () => false,
      resolve<T>(): T {
        throw new Error('unexpected resolve');
      },
    };
    expect(installMainProcessErrorGuardFrom(container, events)).toBeNull();
    expect(reportBootFailure).toHaveBeenCalledWith(
      'Post-boot error guard not installed',
      expect.any(Error),
    );
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
  it('logs a rejection without capturing it again', () => {
    const events = new EventEmitter();
    const logger = { error: jest.fn() };
    const sentry = { captureException: jest.fn() };
    const dispose = installMainProcessErrorGuard(logger, sentry, events);
    events.emit('unhandledRejection', 'late rejection');
    expect(logger.error).toHaveBeenCalledWith(
      '[Ptah Electron] unhandledRejection after boot',
      expect.any(Error),
    );
    expect(sentry.captureException).not.toHaveBeenCalled();
    dispose();
  });

  it('logs and reports post-boot exceptions without exiting, then disposes', () => {
    const events = new EventEmitter();
    const logger = { error: jest.fn() };
    const sentry = { captureException: jest.fn() };
    const dispose = installMainProcessErrorGuard(logger, sentry, events);
    const destroyed = new TypeError('Object has been destroyed');
    events.emit('uncaughtException', destroyed);
    events.emit('unhandledRejection', 'late rejection');
    expect(logger.error).toHaveBeenNthCalledWith(
      1,
      '[Ptah Electron] uncaughtException after boot',
      destroyed,
    );
    expect(logger.error.mock.calls[1]?.[1]).toBeInstanceOf(Error);
    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledWith(destroyed, {
      errorSource: 'electron-main-uncaughtException',
    });
    dispose();
    expect(events.listenerCount('uncaughtException')).toBe(0);
    expect(events.listenerCount('unhandledRejection')).toBe(0);
  });

  it('reports Sentry capture failure without throwing from the guard', () => {
    jest.mocked(reportBootFailure).mockClear();
    const events = new EventEmitter();
    const captureError = new Error('capture failed');
    const dispose = installMainProcessErrorGuard(
      { error: jest.fn() },
      {
        captureException: jest.fn(() => {
          throw captureError;
        }),
      },
      events,
    );
    expect(() =>
      events.emit('uncaughtException', new Error('late')),
    ).not.toThrow();
    expect(reportBootFailure).toHaveBeenCalledWith(
      'Post-boot Sentry capture failed',
      captureError,
    );
    dispose();
  });
});
