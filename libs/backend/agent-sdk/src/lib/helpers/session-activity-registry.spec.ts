import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import {
  SessionActivityRegistry,
  type SessionActivityPayload,
} from './session-activity-registry';

const makeLogger = (): Logger =>
  ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }) as unknown as Logger;

const makePayload = (
  overrides: Partial<SessionActivityPayload> = {},
): SessionActivityPayload => ({
  sessionId: 'sess-1',
  workspaceRoot: '/workspace',
  role: 'user',
  timestamp: 1700000000000,
  ...overrides,
});

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe('SessionActivityRegistry', () => {
  it('starts with zero registered subscribers', () => {
    const registry = new SessionActivityRegistry(makeLogger());
    expect(registry.size).toBe(0);
  });

  it('invokes a registered callback when notifyAll fires', () => {
    const registry = new SessionActivityRegistry(makeLogger());
    const cb = jest.fn();
    registry.register(cb);

    const payload = makePayload();
    registry.notifyAll(payload);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(payload);
  });

  it('forwards the exact payload shape including role discriminator', () => {
    const registry = new SessionActivityRegistry(makeLogger());
    const cb = jest.fn();
    registry.register(cb);

    const userPayload = makePayload({ role: 'user' });
    const assistantPayload = makePayload({
      role: 'assistant',
      timestamp: 1700000000001,
    });

    registry.notifyAll(userPayload);
    registry.notifyAll(assistantPayload);

    expect(cb).toHaveBeenNthCalledWith(1, userPayload);
    expect(cb).toHaveBeenNthCalledWith(2, assistantPayload);
  });

  it('fans out to multiple subscribers in registration order', () => {
    const registry = new SessionActivityRegistry(makeLogger());
    const calls: string[] = [];
    registry.register(() => {
      calls.push('a');
    });
    registry.register(() => {
      calls.push('b');
    });
    registry.register(() => {
      calls.push('c');
    });

    registry.notifyAll(makePayload());

    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('returned disposer removes only that specific callback', () => {
    const registry = new SessionActivityRegistry(makeLogger());
    const a = jest.fn();
    const b = jest.fn();
    const disposeA = registry.register(a);
    registry.register(b);

    disposeA();
    registry.notifyAll(makePayload());

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(1);
  });

  it('isolates a throwing sync callback so siblings still fire', () => {
    const logger = makeLogger();
    const registry = new SessionActivityRegistry(logger);
    const failing = jest.fn(() => {
      throw new Error('boom');
    });
    const survivor = jest.fn();
    registry.register(failing);
    registry.register(survivor);

    registry.notifyAll(makePayload());

    expect(failing).toHaveBeenCalledTimes(1);
    expect(survivor).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[SessionActivityRegistry] subscriber threw',
      expect.any(Error),
    );
  });

  it('isolates a rejecting async callback so siblings still fire', async () => {
    const logger = makeLogger();
    const registry = new SessionActivityRegistry(logger);
    const failing = jest.fn(async () => {
      throw new Error('async boom');
    });
    const survivor = jest.fn();
    registry.register(failing);
    registry.register(survivor);

    registry.notifyAll(makePayload());
    await flushMicrotasks();

    expect(failing).toHaveBeenCalledTimes(1);
    expect(survivor).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[SessionActivityRegistry] async subscriber threw',
      expect.any(Error),
    );
  });

  it('does not leak listeners across many register/dispose cycles', () => {
    const registry = new SessionActivityRegistry(makeLogger());
    for (let i = 0; i < 100; i++) {
      const dispose = registry.register(jest.fn());
      dispose();
    }
    expect(registry.size).toBe(0);

    const cb = jest.fn();
    registry.register(cb);
    registry.notifyAll(makePayload());
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when notifyAll fires with zero subscribers', () => {
    const registry = new SessionActivityRegistry(makeLogger());
    expect(() => registry.notifyAll(makePayload())).not.toThrow();
  });
});
