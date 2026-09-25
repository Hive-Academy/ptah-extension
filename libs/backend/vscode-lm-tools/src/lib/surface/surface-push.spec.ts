import { MESSAGE_TYPES, type SurfaceUpdatedPayload } from '@ptah-extension/shared';
import type { DashboardSurfaceHost } from '../code-execution/namespace-builders/dashboard-namespace.builder';
import { pushSurfaceChange, type SurfacePushHostProvider } from './surface-push';

describe('pushSurfaceChange', () => {
  const payload: SurfaceUpdatedPayload = {
    routingId: 'session-7',
    surfaceId: 'surface-1',
    revision: 2,
    origin: 'host',
    change: { kind: 'deleted', reason: 'evicted' },
    operationId: 'eviction-1',
  };
  const logger = { debug: jest.fn() };

  it('reports no-surface when no host is registered', async () => {
    await expect(
      pushSurfaceChange({ getHost: () => undefined }, logger, payload),
    ).resolves.toEqual({ status: 'no-surface' });
  });

  it('delivers the committed payload to one host without changing it', async () => {
    const sendMessage = jest.fn(async () => true);
    const host: DashboardSurfaceHost = {
      getActiveWebviews: () => ['ptah.main'],
      sendMessage,
    };
    const committed = Object.freeze({
      ...payload,
      change: Object.freeze({ ...payload.change }),
    });

    await expect(
      pushSurfaceChange({ getHost: () => host }, logger, committed),
    ).resolves.toEqual({ status: 'delivered', surfaces: 1 });
    expect(sendMessage).toHaveBeenCalledWith(
      'ptah.main', MESSAGE_TYPES.SURFACE_UPDATED, committed,
    );
    expect(committed).toEqual(payload);
  });

  it('resolves the host on every push, including late registration and replacement', async () => {
    let host: DashboardSurfaceHost | undefined;
    const getHost = jest.fn(() => host);
    const provider: SurfacePushHostProvider = { getHost };
    const firstSend = jest.fn(async () => true);
    const secondSend = jest.fn(async () => true);

    await expect(pushSurfaceChange(provider, logger, payload)).resolves.toEqual({
      status: 'no-surface',
    });
    host = { getActiveWebviews: () => ['first'], sendMessage: firstSend };
    await expect(pushSurfaceChange(provider, logger, payload)).resolves.toEqual({
      status: 'delivered', surfaces: 1,
    });
    host = { getActiveWebviews: () => ['second'], sendMessage: secondSend };
    await expect(pushSurfaceChange(provider, logger, payload)).resolves.toEqual({
      status: 'delivered', surfaces: 1,
    });

    expect(getHost).toHaveBeenCalledTimes(3);
    expect(firstSend).toHaveBeenCalledTimes(1);
    expect(secondSend).toHaveBeenCalledTimes(1);
    expect(secondSend).toHaveBeenCalledWith(
      'second', MESSAGE_TYPES.SURFACE_UPDATED, payload,
    );
  });

  it('reports failed when the host throws without changing the committed payload', async () => {
    const host: DashboardSurfaceHost = {
      getActiveWebviews: () => ['ptah.main'],
      sendMessage: () => {
        throw new Error('disposed');
      },
    };
    const committed = Object.freeze({ ...payload });

    await expect(
      pushSurfaceChange({ getHost: () => host }, logger, committed),
    ).resolves.toEqual({
      status: 'failed',
      delivered: 0,
      surfaces: 1,
      reason: '1 of 1 attached surface(s) did not accept the spec',
    });
    expect(committed).toEqual(payload);
  });

  it('reports failed when lazy host resolution throws', async () => {
    const provider: SurfacePushHostProvider = {
      getHost: () => {
        throw new Error('host resolution failed');
      },
    };

    await expect(pushSurfaceChange(provider, logger, payload)).resolves.toEqual({
      status: 'failed',
      delivered: 0,
      surfaces: 0,
      reason: 'host resolution failed',
    });
  });
});
