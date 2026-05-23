import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import { CallbackRegistryBase } from './callback-registry.base';

interface TestPayload {
  readonly value: number;
}

class TestRegistry extends CallbackRegistryBase<TestPayload> {
  constructor(logger: Logger) {
    super(logger, 'TestRegistry');
  }
}

const makeLogger = (): jest.Mocked<Logger> =>
  ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }) as unknown as jest.Mocked<Logger>;

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe('CallbackRegistryBase', () => {
  it('starts at size 0 and notifyAll without listeners is a no-op', () => {
    const registry = new TestRegistry(makeLogger());
    expect(registry.size).toBe(0);
    expect(() => registry.notifyAll({ value: 1 })).not.toThrow();
  });

  it('register increments size and delivers payload to callback', () => {
    const registry = new TestRegistry(makeLogger());
    const cb = jest.fn();
    registry.register(cb);

    expect(registry.size).toBe(1);
    registry.notifyAll({ value: 42 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ value: 42 });
  });

  it('disposer removes only that callback and is idempotent on double-dispose', () => {
    const registry = new TestRegistry(makeLogger());
    const a = jest.fn();
    const b = jest.fn();
    const disposeA = registry.register(a);
    registry.register(b);

    expect(registry.size).toBe(2);
    disposeA();
    disposeA();
    expect(registry.size).toBe(1);

    registry.notifyAll({ value: 1 });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('isolates sync throw and logs with the concrete scope prefix', () => {
    const logger = makeLogger();
    const registry = new TestRegistry(logger);
    registry.register(() => {
      throw new Error('boom');
    });
    const survivor = jest.fn();
    registry.register(survivor);

    registry.notifyAll({ value: 1 });

    expect(survivor).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[TestRegistry] subscriber threw',
      expect.any(Error),
    );
  });

  it('isolates async rejection and logs with the concrete scope prefix', async () => {
    const logger = makeLogger();
    const registry = new TestRegistry(logger);
    registry.register(async () => {
      throw new Error('async boom');
    });
    const survivor = jest.fn();
    registry.register(survivor);

    registry.notifyAll({ value: 1 });
    await flushMicrotasks();

    expect(survivor).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[TestRegistry] async subscriber threw',
      expect.any(Error),
    );
  });

  it('coerces non-Error throws into Error before logging', () => {
    const logger = makeLogger();
    const registry = new TestRegistry(logger);
    registry.register(() => {
      throw 'string-throw';
    });

    registry.notifyAll({ value: 1 });

    expect(logger.error).toHaveBeenCalledWith(
      '[TestRegistry] subscriber threw',
      expect.any(Error),
    );
    const passedErr = (logger.error.mock.calls[0] as unknown[])[1] as Error;
    expect(passedErr.message).toBe('string-throw');
  });
});
