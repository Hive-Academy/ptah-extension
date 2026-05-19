import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { PendingResponseRegistry } from './pending-response-registry';

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

interface SampleResponse {
  id: string;
  value: string;
}

describe('PendingResponseRegistry', () => {
  let logger: MockLogger;
  let registry: PendingResponseRegistry<SampleResponse>;

  beforeEach(() => {
    logger = createMockLogger();
    registry = new PendingResponseRegistry<SampleResponse>(asLogger(logger));
  });

  it('register stores a resolver retrievable via getPending', () => {
    const resolverSpy = jest.fn();
    registry.register('req-1', { resolve: resolverSpy });
    expect(registry.has('req-1')).toBe(true);
    expect(registry.size).toBe(1);
    expect(registry.getPending('req-1')).toBeDefined();
  });

  it('resolve invokes resolver with value and removes the entry', () => {
    const resolverSpy = jest.fn();
    registry.register('req-1', { resolve: resolverSpy });
    const value: SampleResponse = { id: 'req-1', value: 'ok' };
    const resolved = registry.resolve('req-1', value);
    expect(resolved).toBe(true);
    expect(resolverSpy).toHaveBeenCalledWith(value);
    expect(registry.has('req-1')).toBe(false);
  });

  it('resolve returns false for unknown id', () => {
    const resolved = registry.resolve('missing', null);
    expect(resolved).toBe(false);
  });

  it('reject resolves the entry with null by default', () => {
    const resolverSpy = jest.fn();
    registry.register('req-1', { resolve: resolverSpy });
    registry.reject('req-1');
    expect(resolverSpy).toHaveBeenCalledWith(null);
    expect(registry.has('req-1')).toBe(false);
  });

  it('clear removes an entry without invoking the resolver', () => {
    const resolverSpy = jest.fn();
    registry.register('req-1', { resolve: resolverSpy });
    const cleared = registry.clear('req-1');
    expect(cleared).toBe(true);
    expect(resolverSpy).not.toHaveBeenCalled();
    expect(registry.has('req-1')).toBe(false);
  });

  it('clear cancels an idleTimer when present', () => {
    jest.useFakeTimers();
    try {
      const resolverSpy = jest.fn();
      const timer = setTimeout(() => resolverSpy('timer-fired'), 1000);
      registry.register('req-1', {
        resolve: resolverSpy,
        idleTimer: timer,
      });
      registry.clear('req-1');
      jest.runAllTimers();
      expect(resolverSpy).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('disposeAll resolves every pending entry with null and clears', () => {
    const a = jest.fn();
    const b = jest.fn();
    registry.register('req-a', { resolve: a });
    registry.register('req-b', { resolve: b });
    registry.disposeAll();
    expect(a).toHaveBeenCalledWith(null);
    expect(b).toHaveBeenCalledWith(null);
    expect(registry.size).toBe(0);
  });

  it('cleanupBySession resolves entries matching tabId or sessionId', () => {
    const tabResolver = jest.fn();
    const sessionResolver = jest.fn();
    const unrelatedResolver = jest.fn();
    registry.register('req-tab', {
      resolve: tabResolver,
      tabId: 'TAB-1' as never,
    });
    registry.register('req-session', {
      resolve: sessionResolver,
      sessionId: 'SESS-1' as never,
    });
    registry.register('req-other', {
      resolve: unrelatedResolver,
      tabId: 'TAB-OTHER' as never,
    });
    const removed = registry.cleanupBySession('TAB-1');
    expect(removed).toEqual(['req-tab']);
    expect(tabResolver).toHaveBeenCalledWith(null);
    expect(sessionResolver).not.toHaveBeenCalled();
    expect(unrelatedResolver).not.toHaveBeenCalled();

    const removedSession = registry.cleanupBySession('SESS-1');
    expect(removedSession).toEqual(['req-session']);
    expect(sessionResolver).toHaveBeenCalledWith(null);
  });
});
