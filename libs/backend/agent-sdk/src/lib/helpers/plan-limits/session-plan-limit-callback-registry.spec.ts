import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  SessionPlanLimitCallbackRegistry,
  type SessionPlanLimitEvent,
} from './session-plan-limit-callback-registry';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

const EVENT: SessionPlanLimitEvent = {
  sessionId: 'sess-1',
  signal: { kind: 'turn-start', observedAt: 1 },
};

describe('SessionPlanLimitCallbackRegistry', () => {
  it('fans one event out to every subscriber until it unregisters', () => {
    const registry = new SessionPlanLimitCallbackRegistry(makeLogger());
    const a = jest.fn();
    const b = jest.fn();
    const offA = registry.register(a);
    registry.register(b);
    expect(registry.size).toBe(2);

    registry.notifyAll(EVENT);
    offA();
    registry.notifyAll(EVENT);

    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(EVENT);
    expect(b).toHaveBeenCalledTimes(2);
    expect(registry.size).toBe(1);
  });

  it('a throwing subscriber is logged under the registry scope and does not stop the others', () => {
    const logger = makeLogger();
    const registry = new SessionPlanLimitCallbackRegistry(logger);
    const after = jest.fn();
    registry.register(() => {
      throw new Error('boom');
    });
    registry.register(after);

    expect(() => registry.notifyAll(EVENT)).not.toThrow();
    expect(after).toHaveBeenCalledWith(EVENT);
    expect(logger.error).toHaveBeenCalledWith(
      '[SessionPlanLimitCallbackRegistry] subscriber threw',
      expect.any(Error),
    );
  });
});
