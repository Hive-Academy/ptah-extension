import 'reflect-metadata';
import { container } from 'tsyringe';

import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  SessionIdResolvedCallbackRegistry,
  type SessionIdResolvedPayload,
} from './session-id-resolved-callback-registry';
import { SDK_TOKENS } from '../di/tokens';

const makeLogger = (): jest.Mocked<Logger> =>
  ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }) as unknown as jest.Mocked<Logger>;

/**
 * Both ids are real UUID v4 strings. A tabId IS a UUID v4 (`TabId.create()`),
 * so `tab_N` would make these specs pass for the wrong reason — it would imply
 * a shape a consumer could detect, which does not exist in reality.
 */
const TAB_ID = '4a4a0d5e-6a1c-4d2f-9d3b-3e6f1c5a7b21';
const REAL_ID = 'b7c2f9a1-0e44-4a6b-8c1d-2f5e9a3b6d70';

const makePayload = (
  overrides: Partial<SessionIdResolvedPayload> = {},
): SessionIdResolvedPayload => ({
  tabId: TAB_ID,
  realSessionId: REAL_ID,
  timestamp: 1700000000000,
  ...overrides,
});

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe('SessionIdResolvedCallbackRegistry', () => {
  it('register/dispose lifecycle works and is no-op on double-dispose', () => {
    const registry = new SessionIdResolvedCallbackRegistry(makeLogger());
    const cb = jest.fn();
    const dispose = registry.register(cb);
    expect(registry.size).toBe(1);
    dispose();
    dispose();
    expect(registry.size).toBe(0);
    registry.notifyAll(makePayload());
    expect(cb).not.toHaveBeenCalled();
  });

  it('fans out notifyAll to all subscribers with the exact payload', () => {
    const registry = new SessionIdResolvedCallbackRegistry(makeLogger());
    const a = jest.fn();
    const b = jest.fn();
    registry.register(a);
    registry.register(b);

    const payload = makePayload();
    registry.notifyAll(payload);

    expect(a).toHaveBeenCalledWith(payload);
    expect(b).toHaveBeenCalledWith(payload);
  });

  it('dispatches synchronously — the rekey contract depends on it', () => {
    // Subscribers migrate keyed maps in the handler. An asynchronous dispatch
    // would open exactly the window the rekey exists to close, so the
    // synchronous fan-out is pinned rather than assumed.
    const registry = new SessionIdResolvedCallbackRegistry(makeLogger());
    const seen: string[] = [];
    registry.register((payload) => {
      seen.push(payload.realSessionId);
    });

    registry.notifyAll(makePayload());

    expect(seen).toEqual([REAL_ID]);
  });

  it('carries an absent tabId through untouched', () => {
    // Paired-isolation sibling: the adapter calls this alongside
    // `emitSessionIdResolved(tabId, realSessionId)`, whose tabId is
    // `string | undefined`. The registry must not invent a value; the
    // subscriber decides there is nothing to reconcile.
    const registry = new SessionIdResolvedCallbackRegistry(makeLogger());
    const cb = jest.fn();
    registry.register(cb);

    registry.notifyAll(makePayload({ tabId: undefined }));

    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: undefined, realSessionId: REAL_ID }),
    );
  });

  it('isolates a throwing sync subscriber so siblings still fire', () => {
    const logger = makeLogger();
    const registry = new SessionIdResolvedCallbackRegistry(logger);
    registry.register(() => {
      throw new Error('boom');
    });
    const survivor = jest.fn();
    registry.register(survivor);

    registry.notifyAll(makePayload());

    expect(survivor).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[SessionIdResolvedCallbackRegistry] subscriber threw',
      expect.any(Error),
    );
  });

  it('isolates a rejecting async subscriber so siblings still fire', async () => {
    const logger = makeLogger();
    const registry = new SessionIdResolvedCallbackRegistry(logger);
    registry.register(async () => {
      throw new Error('async boom');
    });
    const survivor = jest.fn();
    registry.register(survivor);

    registry.notifyAll(makePayload());
    await flushMicrotasks();

    expect(survivor).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[SessionIdResolvedCallbackRegistry] async subscriber threw',
      expect.any(Error),
    );
  });

  it('resolves via DI under SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY token', () => {
    const testContainer = container.createChildContainer();
    testContainer.registerInstance(TOKENS.LOGGER, makeLogger());
    testContainer.registerSingleton(
      SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY,
      SessionIdResolvedCallbackRegistry,
    );

    const resolved = testContainer.resolve<SessionIdResolvedCallbackRegistry>(
      SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY,
    );

    expect(resolved).toBeInstanceOf(SessionIdResolvedCallbackRegistry);
    expect(resolved.size).toBe(0);
  });
});
